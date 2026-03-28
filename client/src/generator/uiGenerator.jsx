//src/generator/uiGenerator.jsx
import Table from "../components/Table"
import { resourceMap } from "../services/resourcemap"
import { isValidField } from "../utils/schemaValidator"

export async function generateComponent(design) {
  const resourceConfig = resourceMap[design.resource]

  if (!resourceConfig) {
    throw new Error(`Unknown resource: ${design.resource}`)
  }

  const { fetcher, schema } = resourceConfig

  try {
    const result = await fetcher()

    // Handle API error
    if (!result || result.error) {
      console.error("API Error:", result?.error)
      return {
        component: () => <div>Failed to load data</div>,
        props: {}
      }
    }

    const data = result.items || result
    const pagination = result.next
      ? { next: result.next, prev: result.prev }
      : null

    // Ensure valid array
    if (!Array.isArray(data)) {
      console.error("Invalid data format:", data)
      return {
        component: () => <div>Invalid data format</div>,
        props: {}
      }
    }

    // Validate fields
    design.columns.forEach(col => {
      if (!isValidField(schema, col.field)) {
        console.warn(`Invalid field: ${col.field}`)
      }
    })

    // Component selection
    if (design.component === "table") {
      return {
        component: Table,
        props: {
          data,
          columns: design.columns
        }
      }
    }

    throw new Error(`Unknown component: ${design.component}`)

  } catch (err) {
    console.error("Generator error:", err)
    return {
      component: () => <div>Something went wrong</div>,
      props: {}
    }
  }
}

