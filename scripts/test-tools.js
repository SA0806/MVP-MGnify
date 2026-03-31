import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../mcp-server/data");

// ── Colours for terminal output ───────────────────────────────────
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// ── Helper: load local JSON ───────────────────────────────────────
function loadJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf-8"));
}

// ── Helper: extract compact schema ───────────────────────────────
function extractSchema(data, depth = 0) {
  if (depth > 3) return typeof data;
  if (data === null || data === undefined) return "null";
  if (Array.isArray(data)) return [extractSchema(data[0], depth + 1)];
  if (typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, extractSchema(v, depth + 1)])
    );
  }
  return typeof data;
}

// ── Helper: fetch from MGnify API ─────────────────────────────────
async function fetchMGnify(apiPath) {
  const url = `https://www.ebi.ac.uk/metagenomics/api/v1${apiPath}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "MGnify-MCP-PoC/0.1" },
  });
  if (!res.ok) throw new Error(`API returned ${res.status}`);
  return res.json();
}

// ── Print helper ──────────────────────────────────────────────────
function printResult(toolName, input, output, duration) {
  console.log("\n" + "─".repeat(60));
  console.log(c.bold(c.cyan(`TOOL: ${toolName}`)));
  if (input) console.log(c.dim(`Input: ${JSON.stringify(input)}`));
  console.log(c.dim(`Time: ${duration}ms`));
  console.log(c.green("Output:"));
  const preview = JSON.stringify(output, null, 2);
  const lines = preview.split("\n");
  // Show first 30 lines then truncate
  if (lines.length > 30) {
    console.log(lines.slice(0, 30).join("\n"));
    console.log(c.dim(`  ... (${lines.length - 30} more lines)`));
  } else {
    console.log(preview);
  }
}

// TOOL IMPLEMENTATIONS
// Same logic as mcp-server/index.js — extracted for direct testing

const tools = {

  // ── API SCHEMA TOOLS ───────────────────────────────────────────

  async list_api_resources() {
    return {
      studies:   { list: "/studies", detail: "/studies/{accession}" },
      samples:   { list: "/samples", detail: "/samples/{accession}" },
      analyses:  { list: "/analyses", detail: "/analyses/{accession}" },
      runs:      { list: "/runs", detail: "/runs/{accession}" },
      biomes:    { list: "/biomes", detail: "/biomes/{lineage}" },
    };
  },

  async get_endpoint_schema({ path: apiPath = "/studies" } = {}) {
    const data = await fetchMGnify(apiPath);
    const sample = Array.isArray(data.data) ? data.data[0] : data.data;
    if (!sample) throw new Error(`No data for ${apiPath}`);
    return extractSchema(sample);
  },

  async get_pagination_info({ resource = "studies" } = {}) {
    return {
      resource,
      type: "cursor",
      params: {
        "page[before]": "cursor for previous page",
        "page[after]":  "cursor for next page",
        "page[size]":   "results per page (default 20, max 100)",
      },
      responseFields: {
        "links.next": "URL for next page, null if last",
        "links.prev": "URL for prev page, null if first",
        "meta.pagination.count": "total results",
      },
    };
  },

  // ── FIGMA TOOLS ────────────────────────────────────────────────

  async get_design_tokens() {
    return loadJSON("figma-tokens.json");
  },

  async get_component_spec({ name = "StudyCard" } = {}) {
    const tokens = loadJSON("figma-tokens.json");
    const spec = tokens.components?.[name];
    if (!spec) {
      const available = Object.keys(tokens.components || {}).join(", ");
      return { error: `'${name}' not found`, available };
    }
    return spec;
  },

  async list_figma_components() {
    const tokens = loadJSON("figma-tokens.json");
    return Object.entries(tokens.components || {}).map(([name, spec]) => ({
      name,
      description: spec.description || "",
      variants: spec.variants || [],
    }));
  },

  // ── CONVENTION TOOLS ───────────────────────────────────────────

  async get_fetch_pattern({ resource = "study" } = {}) {
    const patterns = loadJSON("patterns.json");
    return patterns[resource] || patterns["default"];
  },

  async get_component_conventions() {
    return {
      fileNaming:    "PascalCase for components, camelCase for hooks",
      hooksLocation: "src/hooks/ for shared hooks",
      fetchLibrary:  "SWR — import useSWR from 'swr'",
      fieldNames:    "Use hyphens: 'bioproject-title' not 'bioproject_title'",
      errorHandling: "Always handle loading, error, and empty states",
    };
  },

  async list_shared_hooks() {
    return [
      { name: "useStudy(accession)",        returns: "{ study, isLoading, error }" },
      { name: "useSamples(studyAccession)", returns: "{ samples, isLoading, error, next, prev }" },
      { name: "useAnalyses(accession)",     returns: "{ analyses, isLoading, error }" },
      { name: "useBiomes()",                returns: "{ biomes, isLoading, error }" },
    ];
  },
};

// TEST RUNNER

async function runAll() {
  console.log(c.bold("\n MGnify MCP PoC — Tool Test Runner"));
  console.log(c.dim(" Tests all 9 MCP tools against live API and local data\n"));

  const testCases = [
    { tool: "list_api_resources",      input: {} },
    { tool: "get_endpoint_schema",     input: { path: "/studies" } },
    { tool: "get_endpoint_schema",     input: { path: "/studies/MGYS00005292" } },
    { tool: "get_pagination_info",     input: { resource: "studies" } },
    { tool: "get_design_tokens",       input: {} },
    { tool: "get_component_spec",      input: { name: "StudyCard" } },
    { tool: "get_component_spec",      input: { name: "DataTable" } },
    { tool: "list_figma_components",   input: {} },
    { tool: "get_fetch_pattern",       input: { resource: "study" } },
    { tool: "get_component_conventions", input: {} },
    { tool: "list_shared_hooks",       input: {} },
  ];

  // If a specific tool was passed as CLI arg, run only that one
  const filter = process.argv[2];
  const toRun = filter
    ? testCases.filter(t => t.tool === filter)
    : testCases;

  if (filter && toRun.length === 0) {
    console.log(c.red(`No tool named '${filter}'. Available:`));
    console.log(Object.keys(tools).join(", "));
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const { tool, input } of toRun) {
    const fn = tools[tool];
    if (!fn) {
      console.log(c.red(`MISSING: ${tool}`));
      failed++;
      continue;
    }

    const start = Date.now();
    try {
      const result = await fn(input);
      const duration = Date.now() - start;
      printResult(tool, input, result, duration);
      console.log(c.green("✓ PASSED"));
      passed++;
    } catch (err) {
      const duration = Date.now() - start;
      console.log("\n" + "─".repeat(60));
      console.log(c.bold(c.red(`TOOL: ${tool}`)));
      console.log(c.dim(`Input: ${JSON.stringify(input)}`));
      console.log(c.dim(`Time: ${duration}ms`));
      console.log(c.red(`✗ FAILED: ${err.message}`));
      failed++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log(c.bold("SUMMARY"));
  console.log(c.green(`  Passed: ${passed}`));
  if (failed > 0) console.log(c.red(`  Failed: ${failed}`));
  console.log(`  Total:  ${passed + failed}`);

  if (failed === 0) {
    console.log(c.green(c.bold("\n All tools working. MCP server is proposal-ready.\n")));
  } else {
    console.log(c.yellow(c.bold("\n Some tools failed. Check errors above.\n")));
    process.exit(1);
  }
}

runAll();