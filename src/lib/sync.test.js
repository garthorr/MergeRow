import { describe, it, expect } from 'vitest'
import { autoMapSlots, makeBaserowKeyOf, collectActions, previewCommit, buildAllDiffs } from './sync'

describe('autoMapSlots', () => {
  it('maps Contacts by name, falls back to primary for the key, and never auto-maps Full Name', () => {
    const fields = [
      { id: 1, name: 'Email', type: 'email', primary: true },
      { id: 2, name: 'First Name', type: 'text' },
      { id: 3, name: 'Last Name', type: 'text' },
      { id: 5, name: 'Full Name', type: 'text' }, // present but must stay unmapped
    ]
    const map = autoMapSlots('contacts', fields)
    expect(map).toEqual({ email: '1', firstName: '2', lastName: '3' })
    expect('fullName' in map).toBe(false)
  })

  it('binds Assignment links and scalars, leaving an absent Program unmapped', () => {
    const fields = [
      { id: 11, name: 'Assignment ID', type: 'text', primary: true },
      { id: 12, name: 'Contact', type: 'link_row', link_row_table_id: 1 },
      { id: 13, name: 'Unit', type: 'link_row', link_row_table_id: 2 },
      { id: 14, name: 'Position', type: 'link_row', link_row_table_id: 3 },
      { id: 15, name: 'Direct Contact Leader', type: 'boolean' },
      { id: 16, name: 'Registration Expiration', type: 'date' },
    ]
    const map = autoMapSlots('assignments', fields)
    expect(map).toMatchObject({ contact: '12', unit: '13', position: '14', dcl: '15', regExpDate: '16' })
    expect('program' in map).toBe(false)
  })
})

describe('makeBaserowKeyOf', () => {
  const slots = { contact: '12', unit: '13', position: '14' }
  it('derives the assignment triple from link primary-field text', () => {
    const keyOf = makeBaserowKeyOf('assignments', slots)
    const row = {
      field_12: [{ value: 'jane@x.org' }],
      field_13: [{ value: 'Pack 0084' }],
      field_14: [{ value: 'Cubmaster' }],
    }
    expect(keyOf(row)).toBe('jane@x.org|pack 0084|cubmaster')
  })

  it('keys contacts by email|first last when merging is off', () => {
    const cslots = { email: '1', firstName: '2', lastName: '3' }
    const keyOf = makeBaserowKeyOf('contacts', cslots, { mergeByEmail: false })
    expect(keyOf({ field_1: 'H@x.org', field_2: 'Edward', field_3: 'Hart' })).toBe('h@x.org|edward hart')
  })
})

// ---- Shared fixtures for action/preview tests -------------------------------
const linkFields = [
  { id: 12, name: 'Contact', type: 'link_row', link_row_table_id: 1 },
  { id: 13, name: 'Unit', type: 'link_row', link_row_table_id: 2 },
  { id: 14, name: 'Position', type: 'link_row', link_row_table_id: 3 },
]
const off = { enabled: false, tableId: '', fields: [], slots: {} }
const planWith = (contactsDiff) => ({
  tables: {
    contacts: contactsDiff
      ? { enabled: true, tableId: '1', fields: [{ id: 1, name: 'Email', type: 'email', primary: true }], slots: { email: '1' } }
      : off,
    units: off,
    positions: off,
    assignments: {
      enabled: true, tableId: '9', fields: linkFields,
      slots: { contact: '12', unit: '13', position: '14' },
      autoCreate: { unit: true, position: true, contact: false },
    },
  },
})
const newAsg = (email, unit, pos) => ({
  category: 'new', include: true, markDelete: false,
  key: `${email}|${unit.toLowerCase()}|${pos.toLowerCase()}`,
  item: { label: `${unit} · ${pos}`, values: {}, entity: { email, unitName: unit, positionName: pos } },
})
const missingAsg = (email, unit, pos) => ({
  category: 'missing', include: false, markDelete: true,
  key: `${email}|${unit.toLowerCase()}|${pos.toLowerCase()}`,
  item: null, baserowRow: { id: 7, field_13: [{ value: unit }], field_14: [{ value: pos }] },
})

describe('collectActions role-change pairing', () => {
  it('labels a same-unit create+delete as old → new and keeps them adjacent', () => {
    const diffs = {
      assignments: [
        newAsg('jane@x.org', 'Pack 0084', 'Committee Chair'),
        missingAsg('jane@x.org', 'Pack 0084', 'Scoutmaster'),
        newAsg('bob@x.org', 'Troop 0042', 'Den Leader'),
      ],
    }
    const actions = collectActions(planWith(false), diffs)
    const labels = actions.map((a) => `${a.type}:${a.label}`)
    expect(labels[0]).toBe('create:Contact Assignments: Scoutmaster → Committee Chair · Pack 0084 (create new)')
    expect(labels[1]).toBe('delete:Contact Assignments: Scoutmaster → Committee Chair · Pack 0084 (remove old)')
    expect(labels[2]).toBe('create:Contact Assignments: create Den Leader · Troop 0042')
  })
})

describe('buildAllDiffs scope annotation', () => {
  it('marks Missing assignments in vs out of the roster unit scope', () => {
    const entities = {
      contacts: [{ key: 'a@x.org', email: 'a@x.org', firstName: 'A', lastName: 'B', fullName: 'A B' }],
      units: [{ key: 'pack 0084', name: 'Pack 0084' }],
      positions: [{ key: 'cubmaster', name: 'Cubmaster' }],
      assignments: [
        { key: 'a@x.org|pack 0084|cubmaster', email: 'a@x.org', unitName: 'Pack 0084', positionName: 'Cubmaster', program: '', directContactLeader: 'NO', regExpDate: '' },
      ],
    }
    const plan = {
      tables: {
        contacts: off, units: off, positions: off,
        assignments: { enabled: true, tableId: '9', fields: linkFields, slots: { contact: '12', unit: '13', position: '14' }, autoCreate: {} },
      },
    }
    const link = (v) => [{ value: v }]
    const baserowRowsByTable = {
      assignments: [
        { id: 1, field_12: link('a@x.org'), field_13: link('Pack 0084'), field_14: link('Cubmaster') }, // matches roster -> unchanged
        { id: 2, field_12: link('a@x.org'), field_13: link('Pack 0084'), field_14: link('Den Leader') }, // missing, unit in scope
        { id: 3, field_12: link('a@x.org'), field_13: link('Club 1881'), field_14: link('Associate') }, // missing, unit out of scope
      ],
    }
    const diffs = buildAllDiffs({ entities, plan, baserowRowsByTable })
    const missing = diffs.assignments.filter((r) => r.category === 'missing')
    const byPos = Object.fromEntries(missing.map((r) => [r.key.split('|')[2], r.inScope]))
    expect(byPos['den leader']).toBe(true)
    expect(byPos['associate']).toBe(false)
  })
})

describe('previewCommit predictions', () => {
  it('flags assignments whose contact is absent with auto-create off', () => {
    const diffs = {
      contacts: [
        { category: 'unchanged', include: false, baserowRow: { id: 5, field_1: 'present@x.org' }, key: 'present@x.org', item: { label: 'present', values: {} } },
        { category: 'new', include: true, key: 'willcreate@x.org', item: { label: 'willcreate', values: {}, entity: { email: 'willcreate@x.org' } } },
      ],
      assignments: [
        newAsg('present@x.org', 'Pack 0084', 'Cubmaster'),
        newAsg('willcreate@x.org', 'Troop 0042', 'Scoutmaster'),
        newAsg('missing@x.org', 'Pack 0070', 'Den Leader'),
      ],
    }
    const preview = previewCommit(planWith(true), diffs)
    const asgStatus = preview.filter((p) => p.action.tableKey === 'assignments').map((p) => p.status)
    expect(asgStatus).toEqual(['ok', 'ok', 'fail'])
    const failed = preview.find((p) => p.status === 'fail')
    expect(failed.notes[0]).toMatch(/contact "missing@x.org" not found/)
  })
})
