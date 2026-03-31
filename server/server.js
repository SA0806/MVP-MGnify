import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ── Session-level cache (proposal Section 4.3: avoid redundant API calls) ──
const cache = new Map();
const CACHE_TTL_MS = 60_000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// ── Schema extractor (proposal Section 4.4: compact typed representation) ──
function extractSchema(data, depth = 0) {
  if (depth > 3) return typeof data;
  if (Array.isArray(data)) return [extractSchema(data[0], depth + 1)];
  if (data && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, extractSchema(v, depth + 1)])
    );
  }
  return typeof data;
}

// ── MGnify API proxy ──────────────────────────────────────────────
app.get("/studies", async (req, res) => {
  try {
    let externalUrl =
      req.query.url || "https://www.ebi.ac.uk/metagenomics/api/v1/studies";

    // Normalise URL variants
    if (externalUrl.startsWith("/")) {
      externalUrl = "https://www.ebi.ac.uk" + externalUrl;
    }
    if (externalUrl.includes("/api/latest/")) {
      externalUrl = externalUrl.replace("/api/latest/", "/api/v1/");
    }

    // Cache first page only (subsequent pages are user-navigated)
    const isFirstPage = !req.query.url;
    if (isFirstPage) {
      const cached = getCached("studies:first");
      if (cached) {
        console.log("Serving studies from cache");
        return res.json(cached);
      }
    }

    const response = await fetch(externalUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "MGnify-MCP-PoC/0.1",
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        error: "MGnify API request failed",
        status: response.status,
        url: externalUrl,
      });
    }

    const text = await response.text();

    // Guard: API sometimes returns HTML error pages
    if (text.trimStart().startsWith("<")) {
      return res.status(502).json({
        error: "MGnify API returned HTML instead of JSON",
        url: externalUrl,
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: "Invalid JSON from MGnify API" });
    }

    if (isFirstPage) setCached("studies:first", data);

    res.json(data);
  } catch (err) {
    console.error("Studies proxy error:", err);
    res.status(500).json({ error: "Failed to fetch studies" });
  }
});

// ── Schema endpoint (exposes compact schema to frontend) ──────────
// This simulates what get_endpoint_schema() MCP tool returns.

app.get("/schema/studies", async (req, res) => {
  try {
    const cached = getCached("schema:studies");
    if (cached) return res.json(cached);

    const response = await fetch(
      "https://www.ebi.ac.uk/metagenomics/api/v1/studies",
      { headers: { Accept: "application/json" } }
    );
    const data = await response.json();
    const sample = data?.data?.[0];

    if (!sample) {
      return res.status(502).json({ error: "No sample data for schema extraction" });
    }

    const schema = extractSchema(sample);
    setCached("schema:studies", schema);
    res.json(schema);
  } catch (err) {
    res.status(500).json({ error: "Schema extraction failed" });
  }
});

// ── LLM column generation ─────────────────────────────────────────
// Takes a natural language prompt + compact schema.
// Returns a validated column spec for the Table component.
app.post("/llm", async (req, res) => {
  const { prompt, schema } = req.body;

  if (!prompt || !schema) {
    return res.status(400).json({ error: "prompt and schema are required" });
  }

  const systemPrompt = `
You are a UI column generator for the MGnify metagenomics platform.

Given a user prompt and an API schema, return ONLY valid JSON in this exact shape:
{
  "component": "table",
  "resource": "studies",
  "columns": [
    { "label": "Human-readable label", "field": "dot.notation.path" }
  ]
}

Rules:
- Always include "resource": "studies"
- Include 3 to 6 columns
- Use EXACT field paths from the schema using dot notation
- MGnify uses hyphenated field names like "attributes.samples-count" — use hyphens, not underscores
- For relationship fields use: "relationships.biomes.data.0.id"
- Do not include any explanation or markdown — JSON only

Schema:
${JSON.stringify(schema, null, 2)}

User prompt: ${prompt}
`;

  try {
    // Replace Gemini call in server.js with:
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01"
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: systemPrompt }]
  })
});
const data = await response.json();
const text = data.content[0].text;

    // Guard: LLM API error
    if (data.error) {
      console.warn("LLM API error:", data.error.message);
      return res.json(fallbackDesign());
    }

    // Guard: no candidates returned
    if (!data.candidates?.length) {
      console.warn("LLM returned no candidates");
      return res.json(fallbackDesign());
    }

  

    // Guard: empty response
    if (!text || text.length < 10) {
      console.warn("LLM returned empty text");
      return res.json(fallbackDesign());
    }

    // Strip markdown code fences if present
    text = text.replace(/```json|```/g, "").trim();

    let design;
    try {
      design = JSON.parse(text);
    } catch {
      console.warn("LLM returned invalid JSON — using fallback");
      return res.json(fallbackDesign());
    }

    // Guard: incomplete structure
    if (!design.resource || !Array.isArray(design.columns)) {
      console.warn("LLM output missing required fields");
      return res.json(fallbackDesign());
    }

    // Guard: too few columns
    if (design.columns.length < 2) {
      console.warn("LLM returned too few columns");
      return res.json(fallbackDesign());
    }

    res.json(design);
  } catch (err) {
    console.error("LLM route error:", err);
    res.json(fallbackDesign());
  }
});

// ── Fallback design (used when LLM fails at any stage) ───────────
// Proposal Section 4.5: human control is preserved - system degrades
// gracefully rather than crashing or generating invalid output.
function fallbackDesign() {
  return {
    component: "table",
    resource: "studies",
    columns: [
      { label: "Study ID", field: "id" },
      { label: "Samples", field: "attributes.samples-count" },
      { label: "Biome", field: "relationships.biomes.data.0.id" },
    ],
  };
}

app.listen(3000, () => {
  console.log("MGnify MCP PoC server running on http://localhost:3000");
});