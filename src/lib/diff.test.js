import { describe, it, expect } from 'vitest'
import { toBool, toISODate, coerceForCompare, buildTableDiff, summarizeDiff } from './diff'

describe('value coercion', () => {
  it('normalizes booleans across YES/NO and true/false', () => {
    expect(toBool('YES')).toBe(true)
    expect(toBool('no')).toBe(false)
    expect(toBool(true)).toBe(true)
    expect(coerceForCompare({ type: 'boolean' }, 'YES')).toBe(coerceForCompare({ type: 'boolean' }, true))
  })

  it('folds M/D/YYYY and ISO to the same day', () => {
    expect(toISODate('1/31/2027')).toBe('2027-01-31')
    expect(toISODate('2027-01-31')).toBe('2027-01-31')
    expect(coerceForCompare({ type: 'date' }, '12/31/2026')).toBe(
      coerceForCompare({ type: 'date' }, '2026-12-31T00:00:00Z'),
    )
  })
})

describe('buildTableDiff', () => {
  const fields = [
    { id: 1, name: 'Email', type: 'email', primary: true },
    { id: 2, name: 'First', type: 'text' },
    { id: 3, name: 'Exp', type: 'date' },
    { id: 4, name: 'Units', type: 'link_row', link_row_table_id: 9 },
  ]
  const baserowKeyOf = (row) => String(row.field_1 || '').trim().toLowerCase()
  const run = (items, baserowRows, compareFieldIds = ['2', '3']) =>
    buildTableDiff({ items, baserowRows, baserowKeyOf, compareFieldIds, fields })

  it('classifies new / unchanged / changed / missing', () => {
    const items = [
      { key: 'a@x.org', label: 'a', values: { 2: 'Ann', 3: '12/31/2026' } }, // date format differs only
      { key: 'b@x.org', label: 'b', values: { 2: 'Bob' } }, // not in Baserow
      { key: 'c@x.org', label: 'c', values: { 2: 'Carl' } }, // First changed
    ]
    const baserowRows = [
      { id: 10, field_1: 'a@x.org', field_2: 'Ann', field_3: '2026-12-31' },
      { id: 12, field_1: 'c@x.org', field_2: 'Cara', field_3: null },
      { id: 13, field_1: 'd@x.org', field_2: 'Deb' }, // not in roster
    ]
    const out = run(items, baserowRows)
    const byKey = Object.fromEntries(out.map((r) => [r.key, r]))
    expect(byKey['a@x.org'].category).toBe('unchanged') // date coercion prevents a false change
    expect(byKey['b@x.org'].category).toBe('new')
    expect(byKey['c@x.org'].category).toBe('changed')
    expect(byKey['c@x.org'].changes['2']).toEqual({ oldValue: 'Cara', newValue: 'Carl' })
    expect(byKey['d@x.org'].category).toBe('missing')
  })

  it('compares link fields as an order-insensitive set', () => {
    const items = [{ key: 'a@x.org', label: 'a', values: { 4: ['Pack 0070', 'Troop 0042'] } }]
    const baserowRows = [
      { id: 1, field_1: 'a@x.org', field_4: [{ id: 2, value: 'Troop 0042' }, { id: 1, value: 'Pack 0070' }] },
    ]
    const out = run(items, baserowRows, ['4'])
    expect(out[0].category).toBe('unchanged')
  })

  it('summarizeDiff counts only included/marked rows', () => {
    const rows = [
      { category: 'new', include: true },
      { category: 'changed', include: false },
      { category: 'missing', markDelete: true },
      { category: 'unchanged' },
    ]
    expect(summarizeDiff(rows)).toMatchObject({ new: 1, changed: 0, unchanged: 1, missing: 1, deletions: 1 })
  })
})
