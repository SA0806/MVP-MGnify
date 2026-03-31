import { fetchStudies } from "./api";

export const resourceMap = {
  studies: {
    fetcher: fetchStudies,

    // Compact typed schema — mirrors what get_endpoint_schema() returns.

    schema: {
      id: "string",
      type: "string",
      attributes: {
        accession: "string",
        "bioproject-title": "string",
        "samples-count": "number",
        "last-update": "string",
        "is-public": "boolean",
        "study-abstract": "string",
      },
      relationships: {
        biomes: {
          data: [{ id: "string", type: "string" }],
        },
        samples: {
          data: [{ id: "string", type: "string" }],
        },
      },
    },

    // Pagination strategy - mirrors what get_pagination_info() returns.
    
    pagination: {
      type: "cursor",
      nextField: "links.next",
      prevField: "links.prev",
    },

    // Relationship map - helps the LLM understand how to traverse related resources.
    relationMap: {
      biomes: {
        type: "biome",
        path: "relationships.biomes.data",
        idField: "id",
      },
      samples: {
        type: "sample",
        path: "relationships.samples.data",
        idField: "id",
      },
    },
  },

  // Stub for future extension - demonstrates the pattern is resource-agnostic
  samples: {
    fetcher: async () => ({ items: [], next: null, prev: null }),
    schema: {
      id: "string",
      attributes: {
        accession: "string",
        "sample-name": "string",
        biome: "string",
      },
    },
    pagination: { type: "cursor", nextField: "links.next", prevField: "links.prev" },
    relationMap: {},
  },
};