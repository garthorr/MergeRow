// Builds a row-by-row diff between the parsed CSV and the rows currently in
// the Baserow table, keyed by the user-chosen match key field.

import { fieldKey } from './baserow'

function normalize(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

// mapping: { [csvHeader]: fieldId }
// matchKeyFieldId: fieldId used as the unique identifier
export function buildDiff({ csvRows, mapping, matchKeyFieldId, baserowRows }) {
  const csvHeaders = Object.keys(mapping)

  // Deduped set of actually-mapped field IDs, computed once. Two CSV columns
  // can point at the same field, and unmapped columns carry an empty value;
  // both would otherwise waste a comparison on every row.
  const mappedFieldIds = [...new Set(Object.values(mapping).filter(Boolean))]

  const toFieldValues = (csvRow) => {
    const values = {}
    for (const header of csvHeaders) {
      const fieldId = mapping[header]
      if (fieldId) values[fieldId] = csvRow[header]
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
      const newValue = normalize(fieldValues[fieldId])
      const oldValue = normalize(baserowRow[fieldKey(fieldId)])
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
