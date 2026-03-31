// Communicates with Claude Desktop over stdio using the MCP protocol.
// This is the core deliverable described in proposal Section 4.2.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({
  name: "mgnify-poc",
  version: "0.1.0",
});

// ── Helper: extract compact schema from raw API response ──────────
// Returns field names mapped to types — not raw data.
// Keeps tool responses under ~2KB as described in proposal Section 4.3.
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

// ── Helper: load local data files ────────────────────────────────
function loadJSON(filename) {
  const filePath = path.join(__dirname, "data", filename);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// TOOL CATEGORY 1: API SCHEMA TOOLS
// These answer "what data is available and in what shape?"

server.tool(
  "list_api_resources",
  "Returns all available MGnify API endpoints grouped by resource type. " +
  "Call this first to understand what data resources exist before fetching schemas.",
  {},
  async () => {
    const resources = {
      studies: {
        list: "/studies",
        detail: "/studies/{accession}",
        related: ["/studies/{accession}/samples", "/studies/{accession}/analyses"],
      },
      samples: {
        list: "/samples",
        detail: "/samples/{accession}",
      },
      analyses: {
        list: "/analyses",
        detail: "/analyses/{accession}",
      },
      runs: {
        list: "/runs",
        detail: "/runs/{accession}",
      },
      biomes: {
        list: "/biomes",
        detail: "/biomes/{lineage}",
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(resources, null, 2) }],
    };
  }
);

server.tool(
  "get_endpoint_schema",
  "Fetches and returns a compact typed schema for a given MGnify API endpoint. " +
  "Use this before generating any component to understand available fields, " +
  "data types, and nesting structure. Field names use MGnify's hyphenated " +
  "convention e.g. 'bioproject-title', not 'bioproject_title'.",
  {
    path: z.string().describe("API path e.g. /studies or /studies/MGYS00001234"),
  },
  async ({ path: apiPath }) => {
    try {
      const url = `https://www.ebi.ac.uk/metagenomics/api/v1${apiPath}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "MGnify-MCP-PoC/0.1" },
      });

      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Error: API returned ${res.status} for ${apiPath}` }],
        };
      }

      const data = await res.json();
      // Use first item for list endpoints, data directly for detail endpoints
      const sample = Array.isArray(data.data) ? data.data[0] : data.data;

      if (!sample) {
        return {
          content: [{ type: "text", text: `No data returned for ${apiPath}` }],
        };
      }

      const schema = extractSchema(sample);
      return {
        content: [{ type: "text", text: JSON.stringify(schema, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to fetch schema: ${err.message}` }],
      };
    }
  }
);

server.tool(
  "get_pagination_info",
  "Returns the pagination strategy for a given MGnify resource. " +
  "MGnify uses JSON:API cursor-based pagination — not simple page offsets. " +
  "Call this when generating any list or results component.",
  {
    resource: z.string().describe("Resource name e.g. studies, samples, analyses"),
  },
  async ({ resource }) => {
    const info = {
      type: "cursor",
      description: "MGnify uses JSON:API cursor-based pagination",
      params: {
        "page[before]": "cursor for previous page",
        "page[after]": "cursor for next page",
        "page[size]": "number of results per page (default 20, max 100)",
      },
      responseFields: {
        "links.next": "URL for next page, null if on last page",
        "links.prev": "URL for previous page, null if on first page",
        "meta.pagination.page": "current page number",
        "meta.pagination.pages": "total number of pages",
        "meta.pagination.count": "total number of results",
      },
      example: `fetch('/studies?page[size]=10') 
// then use data.links.next to get next page URL`,
      resource,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
    };
  }
);

// TOOL CATEGORY 2: FIGMA TOOLS
// These answer "what should this component look like?"
// In PoC: reads local mock JSON. In production: calls Figma REST API.

server.tool(
  "get_design_tokens",
  "Returns MGnify design system tokens: colours, spacing, typography, and " +
  "border styles from the Figma Visual Framework Assets. Use these values " +
  "when generating component styles to ensure visual consistency. " +
  "NOTE: In this PoC, tokens are loaded from a local mock file. " +
  "In production, this calls the Figma REST API.",
  {},
  async () => {
    try {
      const tokens = loadJSON("figma-tokens.json");
      return {
        content: [{ type: "text", text: JSON.stringify(tokens, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to load design tokens: ${err.message}` }],
      };
    }
  }
);

server.tool(
  "get_component_spec",
  "Returns the Figma specification for a named MGnify UI component: " +
  "its props, layout rules, spacing, and design token usage. " +
  "Call this before generating JSX to ensure layout matches the design system. " +
  "NOTE: In this PoC, specs are loaded from a local mock file. " +
  "In production, this traverses the Figma node tree.",
  {
    name: z.string().describe("Component name e.g. StudyCard, DataTable, MetadataPanel"),
  },
  async ({ name }) => {
    try {
      const tokens = loadJSON("figma-tokens.json");
      const spec = tokens.components?.[name];

      if (!spec) {
        const available = Object.keys(tokens.components || {}).join(", ");
        return {
          content: [{
            type: "text",
            text: `Component '${name}' not found. Available: ${available}`,
          }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(spec, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to load component spec: ${err.message}` }],
      };
    }
  }
);

server.tool(
  "list_figma_components",
  "Returns all available MGnify UI components defined in the Figma " +
  "Visual Framework Assets. Call this to discover what components exist " +
  "before deciding which to use in a generated page.",
  {},
  async () => {
    try {
      const tokens = loadJSON("figma-tokens.json");
      const components = Object.entries(tokens.components || {}).map(([name, spec]) => ({
        name,
        description: spec.description || "",
        variants: spec.variants || [],
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(components, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to list components: ${err.message}` }],
      };
    }
  }
);

// TOOL CATEGORY 3: CONVENTION TOOLS
// These answer "how does MGnify's frontend write code?"

server.tool(
  "get_fetch_pattern",
  "Returns the standard MGnify frontend pattern for fetching data from " +
  "a given resource type. Use this as the template for any data-fetching " +
  "hook or component — do not invent a new pattern.",
  {
    resource: z.string().describe("Resource type e.g. study, sample, analysis"),
  },
  async ({ resource }) => {
    try {
      const patterns = loadJSON("patterns.json");
      const pattern = patterns[resource] || patterns["default"];
      return {
        content: [{ type: "text", text: pattern }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to load pattern: ${err.message}` }],
      };
    }
  }
);

server.tool(
  "get_component_conventions",
  "Returns MGnify frontend conventions: file naming rules, where hooks " +
  "live relative to components, how props are declared, and which " +
  "utility libraries are preferred. Follow these exactly in generated code.",
  {},
  async () => {
    const conventions = {
      fileNaming: "PascalCase for components (StudyCard.jsx), camelCase for hooks (useStudy.js)",
      hooksLocation: "src/hooks/ for shared hooks, co-located for component-specific hooks",
      propsPattern: "Destructure props inline: function StudyCard({ accession, title })",
      fetchLibrary: "SWR for data fetching — import useSWR from 'swr'",
      stylingApproach: "Inline styles using design tokens from get_design_tokens()",
      errorHandling: "Always handle loading, error, and empty states explicitly",
      fieldNames: "Use exact API field names — MGnify uses hyphens e.g. 'bioproject-title'",
      importPaths: "Use @/ alias for src/ e.g. import { fetcher } from '@/utils/api'",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(conventions, null, 2) }],
    };
  }
);

server.tool(
  "list_shared_hooks",
  "Returns reusable hooks already available in the MGnify frontend codebase. " +
  "Always check this before generating a new hook — use an existing one if available.",
  {},
  async () => {
    const hooks = [
      { name: "useStudy(accession)", file: "src/hooks/useStudy.js", returns: "{ study, isLoading, error }" },
      { name: "useSamples(studyAccession)", file: "src/hooks/useSamples.js", returns: "{ samples, isLoading, error, next, prev }" },
      { name: "useAnalyses(studyAccession)", file: "src/hooks/useAnalyses.js", returns: "{ analyses, isLoading, error }" },
      { name: "useBiomes()", file: "src/hooks/useBiomes.js", returns: "{ biomes, isLoading, error }" },
    ];
    return {
      content: [{ type: "text", text: JSON.stringify(hooks, null, 2) }],
    };
  }
);

// ── Start server ─────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MGnify MCP PoC server running — connected to Claude Desktop");