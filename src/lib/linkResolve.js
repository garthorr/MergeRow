// Baserow's row-write API resolves a link_row field's text values against the
// linked table's primary field, but it does so with an exact (case-sensitive)
// match and errors out the whole write if a value doesn't match any row —
// it never creates the missing row. For a recurring CSV sync where the
// linked table (e.g. a Units or Positions catalog) can legitimately grow a
// new entry between imports, that's too strict: this resolves link_row
// values client-side instead, matching case/whitespace-insensitively and
// creating the linked row when nothing matches, before substituting real
// row IDs in place of the original name strings.

import { fetchTableFields, fetchAllRows, fieldKey, createRow, isLinkRowField } from './baserow'

function normalize(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim().toLowerCase()
}

// `actions` is the list built by StepCommit (`{ type, index, row, label }`)
// for the rows actually queued to create/update. Returns a new array with
// each link_row field's name array replaced by an array of row IDs — the
// input is left untouched so the diff step's state isn't mutated underneath
// the user's feet.
export async function resolveLinkRowValues(token, fields, actions) {
  const fieldsById = new Map(fields.map((f) => [String(f.id), f]))

  const linkFieldIdsUsed = new Set()
  for (const { row } of actions) {
    if (!row.fieldValues) continue
    for (const fieldId of Object.keys(row.fieldValues)) {
      const field = fieldsById.get(String(fieldId))
      if (field && isLinkRowField(field)) linkFieldIdsUsed.add(String(fieldId))
    }
  }

  const resolved = actions.map((action) => ({
    ...action,
    row: {
      ...action.row,
      fieldValues: action.row.fieldValues ? { ...action.row.fieldValues } : action.row.fieldValues,
    },
  }))

  if (linkFieldIdsUsed.size === 0) return resolved

  // Multiple link_row fields could point at the same linked table, so group
  // by table rather than resolving (and possibly re-creating) names once per
  // field.
  const fieldIdsByTable = new Map()
  for (const fieldId of linkFieldIdsUsed) {
    const tableId = fieldsById.get(fieldId).link_row_table_id
    if (!fieldIdsByTable.has(tableId)) fieldIdsByTable.set(tableId, [])
    fieldIdsByTable.get(tableId).push(fieldId)
  }

  for (const [linkedTableId, fieldIds] of fieldIdsByTable.entries()) {
    const linkedFields = await fetchTableFields(token, linkedTableId)
    const primaryField = linkedFields.find((f) => f.primary)
    if (!primaryField) continue

    const linkedRows = await fetchAllRows(token, linkedTableId)
    const idByName = new Map()
    for (const linkedRow of linkedRows) {
      idByName.set(normalize(linkedRow[fieldKey(primaryField.id)]), linkedRow.id)
    }

    // Each unique missing name should only be created once, even if it's
    // referenced by many rows in this commit.
    const pendingCreates = new Map()
    for (const { row } of resolved) {
      for (const fieldId of fieldIds) {
        const names = row.fieldValues?.[fieldId]
        if (!Array.isArray(names)) continue
        for (const name of names) {
          const key = normalize(name)
          if (!key || idByName.has(key) || pendingCreates.has(key)) continue
          pendingCreates.set(key, String(name).trim())
        }
      }
    }

    for (const [key, originalName] of pendingCreates.entries()) {
      const created = await createRow(token, linkedTableId, { [primaryField.id]: originalName })
      idByName.set(key, created.id)
    }

    for (const { row } of resolved) {
      for (const fieldId of fieldIds) {
        const names = row.fieldValues?.[fieldId]
        if (!Array.isArray(names)) continue
        row.fieldValues[fieldId] = names.map((name) => idByName.get(normalize(name)))
      }
    }
  }

  return resolved
}
