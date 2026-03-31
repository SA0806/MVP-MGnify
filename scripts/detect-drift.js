import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = path.join(__dirname, "../mcp-server/data/schema-snapshots");

// ── Colours ───────────────────────────────────────────────────────
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// ── Resources to check ────────────────────────────────────────────
const RESOURCES = {
  studies:  "/studies",
  samples:  "/samples",
  analyses: "/analyses",
  runs:     "/runs",
};

// ── Extract compact schema from API response ──────────────────────
function extractSchema(data, depth = 0) {
  if (depth > 4) return typeof data;
  if (data === null || data === undefined) return "null";
  if (Array.isArray(data)) return [extractSchema(data[0], depth + 1)];
  if (typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, extractSchema(v, depth + 1)])
    );
  }
  return typeof data;
}

// ── Flatten schema to dot-notation paths ─────────────────────────
// e.g. { attributes: { "samples-count": "number" } }
// becomes { "attributes.samples-count": "number" }
function flattenSchema(obj, prefix = "") {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenSchema(value, fullKey));
    } else {
      result[fullKey] = Array.isArray(value) ? `array<${value[0]}>` : value;
    }
  }
  return result;
}

// ── Fetch live schema from MGnify API ────────────────────────────
async function fetchLiveSchema(apiPath) {
  const url = `https://www.ebi.ac.uk/metagenomics/api/v1${apiPath}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "MGnify-MCP-DriftDetector/0.1" },
  });
  if (!res.ok) throw new Error(`API returned ${res.status} for ${apiPath}`);
  const data = await res.json();
  const sample = Array.isArray(data.data) ? data.data[0] : data.data;
  if (!sample) throw new Error(`No data returned for ${apiPath}`);
  return extractSchema(sample);
}

// ── Compare two flattened schemas ────────────────────────────────
function compareSchemas(stored, live) {
  const storedFlat = flattenSchema(stored);
  const liveFlat   = flattenSchema(live);

  const added   = [];
  const removed = [];
  const changed = [];

  for (const [key, type] of Object.entries(liveFlat)) {
    if (!(key in storedFlat)) {
      added.push({ field: key, type });
    } else if (storedFlat[key] !== type) {
      changed.push({ field: key, from: storedFlat[key], to: type });
    }
  }

  for (const key of Object.keys(storedFlat)) {
    if (!(key in liveFlat)) {
      removed.push({ field: key, type: storedFlat[key] });
    }
  }

  return { added, removed, changed };
}

// ── Save snapshot ─────────────────────────────────────────────────
function saveSnapshot(resource, schema) {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
  const filePath = path.join(SNAPSHOTS_DIR, `${resource}.json`);
  const snapshot = {
    resource,
    savedAt: new Date().toISOString(),
    schema,
  };
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  console.log(c.green(`  Snapshot saved: ${filePath}`));
}

// ── Load snapshot ─────────────────────────────────────────────────
function loadSnapshot(resource) {
  const filePath = path.join(SNAPSHOTS_DIR, `${resource}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// ── Check one resource ────────────────────────────────────────────
async function checkResource(resource, apiPath, saveMode) {
  process.stdout.write(`\nChecking ${c.cyan(resource)}... `);

  let liveSchema;
  try {
    liveSchema = await fetchLiveSchema(apiPath);
  } catch (err) {
    console.log(c.red(`FETCH FAILED: ${err.message}`));
    return { resource, status: "error", error: err.message };
  }

  // Save mode: write snapshot and exit
  if (saveMode) {
    console.log(c.yellow("saving snapshot"));
    saveSnapshot(resource, liveSchema);
    return { resource, status: "saved" };
  }

  // Load stored snapshot
  const stored = loadSnapshot(resource);

  if (!stored) {
    console.log(c.yellow("NO SNAPSHOT — saving current schema as baseline"));
    saveSnapshot(resource, liveSchema);
    return { resource, status: "initialised" };
  }

  console.log(c.dim(`(snapshot from ${stored.savedAt})`));

  const { added, removed, changed } = compareSchemas(stored.schema, liveSchema);
  const hasDrift = added.length > 0 || removed.length > 0 || changed.length > 0;

  if (!hasDrift) {
    console.log(c.green(`  ✓ No drift detected`));
    return { resource, status: "clean" };
  }

  // Report drift
  console.log(c.red(`  ✗ DRIFT DETECTED`));

  if (added.length > 0) {
    console.log(c.yellow(`  New fields (${added.length}):`));
    for (const { field, type } of added) {
      console.log(`    + ${field}: ${type}`);
    }
  }

  if (removed.length > 0) {
    console.log(c.red(`  Removed fields (${removed.length}):`));
    for (const { field, type } of removed) {
      console.log(`    - ${field}: ${type}`);
    }
  }

  if (changed.length > 0) {
    console.log(c.yellow(`  Type changes (${changed.length}):`));
    for (const { field, from, to } of changed) {
      console.log(`    ~ ${field}: ${from} → ${to}`);
    }
  }

  return { resource, status: "drift", added, removed, changed };
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const saveMode = args.includes("--save");
  const resourceFilter = args.find(a => !a.startsWith("--"));

  console.log(c.bold("\n MGnify MCP — Schema Drift Detector"));
  console.log(c.dim(saveMode
    ? " Mode: saving current live schemas as snapshots"
    : " Mode: comparing live API against stored snapshots"
  ));

  // Decide which resources to check
  const toCheck = resourceFilter
    ? { [resourceFilter]: RESOURCES[resourceFilter] }
    : RESOURCES;

  if (resourceFilter && !RESOURCES[resourceFilter]) {
    console.log(c.red(`Unknown resource: ${resourceFilter}`));
    console.log(`Available: ${Object.keys(RESOURCES).join(", ")}`);
    process.exit(1);
  }

  const results = [];
  for (const [resource, apiPath] of Object.entries(toCheck)) {
    const result = await checkResource(resource, apiPath, saveMode);
    results.push(result);
  }

  // Summary
  console.log("\n" + "═".repeat(50));
  console.log(c.bold("SUMMARY"));

  const clean       = results.filter(r => r.status === "clean").length;
  const drifted     = results.filter(r => r.status === "drift").length;
  const errored     = results.filter(r => r.status === "error").length;
  const initialised = results.filter(r => r.status === "initialised" || r.status === "saved").length;

  if (clean)       console.log(c.green(`  Clean:       ${clean}`));
  if (initialised) console.log(c.yellow(`  Initialised: ${initialised}`));
  if (drifted)     console.log(c.red(`  Drifted:     ${drifted}`));
  if (errored)     console.log(c.red(`  Errors:      ${errored}`));

  if (drifted > 0) {
    console.log(c.red(c.bold("\n Schema drift found — update MCP tool schemas and regenerate snapshots.")));
    console.log(c.dim(" Run with --save to update snapshots after reviewing changes.\n"));
    process.exit(1); // Fails CI
  } else if (errored > 0) {
    console.log(c.red(c.bold("\n Some resources could not be checked.\n")));
    process.exit(1);
  } else {
    console.log(c.green(c.bold("\n All schemas up to date.\n")));
  }
}

main();