// Builds a row-by-row diff between the parsed CSV and the rows currently in
// the Baserow table, keyed by the user-chosen match key field.

import { fieldKey, isLinkRowField } from './baserow'

function normalize(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

// CSV cells mapped to a link_row field are split on commas so a single
// column can populate a multi-link relationship (e.g. "Alpha Co, Bravo Co").
function splitLinkRowText(value) {
  if (value === null || value === undefined) return []
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function namesEqual(a, b) {
  if (a.length !== b.length) return false
  const normA = a.map((s) => s.toLowerCase()).sort()
  const normB = b.map((s) => s.toLowerCase()).sort()
  return normA.every((v, i) => v === normB[i])
}

// Renders a field's value for display, whichever shape it's in: a plain CSV
// string, an array of names (CSV side of a mapped link_row field), or
// Baserow's API shape for link_row fields — an array of `{ id, value }`
// objects where `value` is the linked row's primary-field text.
export function formatFieldValue(field, rawValue) {
  if (field && isLinkRowField(field) && Array.isArray(rawValue)) {
    return rawValue
      .map((item) => (item && typeof item === 'object' ? normalize(item.value) : normalize(item)))
      .filter(Boolean)
      .join(', ')
  }
  return normalize(rawValue)
}

// mapping: { [csvHeader]: fieldId }
// matchKeyFieldId: fieldId used as the unique identifier
// fields: the table's field schema, needed to know which mapped fields are
// link_row fields (their CSV text and Baserow API values both need special
// handling instead of a plain string comparison).
export function buildDiff({ csvRows, mapping, matchKeyFieldId, baserowRows, fields = [] }) {
  const csvHeaders = Object.keys(mapping)
  const fieldsById = new Map(fields.map((field) => [String(field.id), field]))
  const isLinkField = (fieldId) => isLinkRowField(fieldsById.get(String(fieldId)) || {})

  // Deduped set of actually-mapped field IDs, computed once. Two CSV columns
  // can point at the same field, and unmapped columns carry an empty value;
  // both would otherwise waste a comparison on every row.
  const mappedFieldIds = [...new Set(Object.values(mapping).filter(Boolean))]

  const toFieldValues = (csvRow) => {
    const values = {}
    for (const header of csvHeaders) {
      const fieldId = mapping[header]
      if (!fieldId) continue
      values[fieldId] = isLinkField(fieldId) ? splitLinkRowText(csvRow[header]) : csvRow[header]
    }
    return values
  }

  const baserowByKey = new Map()
  for (const row of baserowRows) {
    const key = normalize(row[fieldKey(matchKeyFieldId)])
    baserowByKey.set(key, row)
  }

  const matchedBaserowKeys = new Set()
  const diffRows = []

  for (const csvRow of csvRows) {
    const fieldValues = toFieldValues(csvRow)
    const key = normalize(fieldValues[matchKeyFieldId])
    const baserowRow = baserowByKey.get(key)

    if (!baserowRow) {
      diffRows.push({
        category: 'new',
        key,
        fieldValues,
        baserowRow: null,
        include: true,
        markDelete: false,
      })
      continue
    }

    matchedBaserowKeys.add(key)
    const changes = {}
    let hasChange = false
    for (const fieldId of mappedFieldIds) {
      const oldRawValue = baserowRow[fieldKey(fieldId)]
      if (isLinkField(fieldId)) {
        const newNames = fieldValues[fieldId]
        const oldNames = Array.isArray(oldRawValue)
          ? oldRawValue.map((item) => normalize(item && item.value))
          : []
        if (!namesEqual(newNames, oldNames)) {
          hasChange = true
          changes[fieldId] = { oldValue: oldNames.join(', '), newValue: newNames.join(', ') }
        }
        continue
      }
      const newValue = normalize(fieldValues[fieldId])
      const oldValue = normalize(oldRawValue)
      if (newValue !== oldValue) {
        hasChange = true
        changes[fieldId] = { oldValue, newValue }
      }
    }

    diffRows.push({
      category: hasChange ? 'changed' : 'unchanged',
      key,
      fieldValues,
      baserowRow,
      changes,
      include: hasChange,
      markDelete: false,
    })
  }

  for (const [key, baserowRow] of baserowByKey.entries()) {
    if (matchedBaserowKeys.has(key)) continue
    diffRows.push({
      category: 'missing',
      key,
      fieldValues: null,
      baserowRow,
      include: false,
      markDelete: false,
    })
  }

  return diffRows
}

// Returns the set of match-key values that appear on more than one Baserow
// row. Because the diff pairs rows by key, duplicates are collapsed and a
// shadowed row can be mislabeled "missing" (and then deleted) — so the UI
// warns before any destructive commit.
export function findDuplicateBaserowKeys(baserowRows, matchKeyFieldId) {
  const seen = new Set()
  const duplicates = new Set()
  for (const row of baserowRows) {
    const key = normalize(row[fieldKey(matchKeyFieldId)])
    if (seen.has(key)) duplicates.add(key)
    else seen.add(key)
  }
  return [...duplicates]
}

export function summarizeDiff(diffRows) {
  const summary = { new: 0, changed: 0, unchanged: 0, missing: 0, deletions: 0 }
  for (const row of diffRows) {
    if (row.category === 'new' && row.include) summary.new += 1
    else if (row.category === 'changed' && row.include) summary.changed += 1
    else if (row.category === 'unchanged') summary.unchanged += 1
    else if (row.category === 'missing') {
      summary.missing += 1
      if (row.markDelete) summary.deletions += 1
    }
  }
  return summary
}
