// Generic, table-agnostic diff engine plus the value-coercion helpers that
// keep scalar comparisons honest across Baserow field types.
//
// The roster is denormalized into several entity sets (contacts, units,
// positions, assignments) by normalize.js; each set is diffed against its own
// Baserow table here. A diff pairs an entity to a Baserow row by a *key*
// function (email, unit name, position name, or the synthesized assignment
// triple) and classifies it New / Changed / Unchanged / Missing.

import { fieldKey, isLinkRowField } from './baserow'

export function norm(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim().toLowerCase()
}

export function toBool(value) {
  if (typeof value === 'boolean') return value
  if (value === null || value === undefined) return false
  return ['true', 'yes', 'y', '1', 'x', '✓'].includes(String(value).trim().toLowerCase())
}

// Roster dates arrive as M/D/YYYY; Baserow date fields read back as ISO
// (sometimes with a time component). Fold both to YYYY-MM-DD so the same
// calendar day compares equal regardless of source formatting.
export function toISODate(value) {
  if (value === null || value === undefined || value === '') return ''
  const s = String(value).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return s
}

// Normalizes a scalar value to a comparable string honoring the field's type,
// so e.g. "YES" vs a boolean `true`, or "1/31/2027" vs "2027-01-31", don't
// register as spurious changes.
export function coerceForCompare(field, value) {
  if (value === null || value === undefined) return ''
  const t = field && field.type
  if (t === 'boolean') return toBool(value) ? 'true' : 'false'
  if (t === 'date') return toISODate(value)
  if (typeof value === 'object') return ''
  return String(value).trim().toLowerCase()
}

// Coerces a value into the shape Baserow's write API expects for the field's
// type. Link fields are handled separately (resolved to row IDs in
// linkResolve.js) and never passed here.
export function coerceForWrite(field, value) {
  const t = field && field.type
  if (t === 'boolean') return toBool(value)
  if (t === 'date') return toISODate(value) || null
  if (t === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export function splitLinkRowText(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean)
  if (value === null || value === undefined) return []
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function namesEqual(a, b) {
  if (a.length !== b.length) return false
  const na = a.map((s) => norm(s)).sort()
  const nb = b.map((s) => norm(s)).sort()
  return na.every((v, i) => v === nb[i])
}

// Renders any field value (plain scalar, CSV name-array, or Baserow's
// `[{ id, value }]` link shape) as a short human string for the review screen.
export function formatFieldValue(field, rawValue) {
  if (field && isLinkRowField(field) && Array.isArray(rawValue)) {
    return rawValue
      .map((item) => (item && typeof item === 'object' ? item.value : item))
      .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
      .filter(Boolean)
      .join(', ')
  }
  if (field && field.type === 'date') return toISODate(rawValue)
  if (field && field.type === 'boolean') return toBool(rawValue) ? 'YES' : 'NO'
  if (rawValue === null || rawValue === undefined) return ''
  if (typeof rawValue === 'object') return ''
  return String(rawValue).trim()
}

function linkNamesFromBaserow(rawValue) {
  if (!Array.isArray(rawValue)) return []
  return rawValue
    .map((item) => (item && typeof item === 'object' ? item.value : item))
    .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
    .filter(Boolean)
}

// items: [{ key, label, values: { [fieldId]: scalar | string[] }, entity }]
//   - `values` holds the roster side; link fields carry an array of names.
// baserowRows: rows from the target table (user_field_names=false shape).
// baserowKeyOf(row): derives the same key the entity uses, from a Baserow row.
// compareFieldIds: the field IDs to inspect for Changed detection (the key /
//   primary / link fields are excluded — a differing key is a different row,
//   surfaced as New + Missing, never an in-place change).
export function buildTableDiff({ items, baserowRows, baserowKeyOf, compareFieldIds, fields }) {
  const fieldsById = new Map(fields.map((f) => [String(f.id), f]))

  const byKey = new Map()
  for (const row of baserowRows) byKey.set(baserowKeyOf(row), row)

  const matched = new Set()
  const out = []

  for (const item of items) {
    const baserowRow = byKey.get(item.key)
    if (!baserowRow) {
      out.push({ category: 'new', key: item.key, item, baserowRow: null, changes: {}, include: true, markDelete: false })
      continue
    }
    matched.add(item.key)

    const changes = {}
    let changed = false
    for (const fid of compareFieldIds) {
      if (!fid) continue
      const field = fieldsById.get(String(fid))
      if (!field) continue
      const newVal = item.values[fid]
      const oldRaw = baserowRow[fieldKey(fid)]
      if (isLinkRowField(field)) {
        const newNames = splitLinkRowText(newVal)
        const oldNames = linkNamesFromBaserow(oldRaw)
        if (!namesEqual(newNames, oldNames)) {
          changed = true
          changes[fid] = { oldValue: oldNames.join(', '), newValue: newNames.join(', ') }
        }
        continue
      }
      if (coerceForCompare(field, newVal) !== coerceForCompare(field, oldRaw)) {
        changed = true
        changes[fid] = { oldValue: formatFieldValue(field, oldRaw), newValue: formatFieldValue(field, newVal) }
      }
    }

    out.push({
      category: changed ? 'changed' : 'unchanged',
      key: item.key,
      item,
      baserowRow,
      changes,
      include: changed,
      markDelete: false,
    })
  }

  for (const [key, baserowRow] of byKey.entries()) {
    if (matched.has(key)) continue
    out.push({ category: 'missing', key, item: null, baserowRow, changes: {}, include: false, markDelete: false })
  }

  return out
}

// Keys that resolve to more than one Baserow row — the diff collapses these,
// so a shadowed row can be mislabeled Missing. Surfaced as a warning.
export function findDuplicateBaserowKeys(baserowRows, baserowKeyOf) {
  const seen = new Set()
  const dups = new Set()
  for (const row of baserowRows) {
    const key = baserowKeyOf(row)
    if (!key) continue
    if (seen.has(key)) dups.add(key)
    else seen.add(key)
  }
  return [...dups]
}

export function summarizeDiff(diffRows) {
  const s = { new: 0, changed: 0, unchanged: 0, missing: 0, deletions: 0 }
  for (const row of diffRows) {
    if (row.category === 'new' && row.include) s.new += 1
    else if (row.category === 'changed' && row.include) s.changed += 1
    else if (row.category === 'unchanged') s.unchanged += 1
    else if (row.category === 'missing') {
      s.missing += 1
      if (row.markDelete) s.deletions += 1
    }
  }
  return s
}
