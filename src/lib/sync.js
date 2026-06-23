// Plan/diff/commit glue between the normalized roster entities and the 1–4
// Baserow tables. Knows each table's slot schema, auto-maps slots to fields,
// builds the per-table diffs, and runs the commit in dependency order:
// Contacts / Units / Positions first, then Contact Assignments (whose links
// resolve against the rows just written).

import {
  fieldKey,
  isLinkRowField,
  isMappableField,
  createRow,
  updateRow,
  deleteRow,
} from './baserow'
import { buildTableDiff, coerceForWrite, norm } from './diff'
import { resolveLinkRowValues } from './linkResolve'

export const TABLE_ORDER = ['contacts', 'units', 'positions', 'assignments']

export const TABLE_LABELS = {
  contacts: 'Contacts',
  units: 'Units',
  positions: 'Positions',
  assignments: 'Contact Assignments',
}

// Each table's logical slots. `isKey` slots drive identity (and are excluded
// from Changed detection — a differing key is a different row). `link` slots
// are single-value relationships resolved by name at commit time.
export const TABLE_SLOTS = {
  contacts: [
    { key: 'email', label: 'Email (key)', isKey: true, synonyms: ['email', 'e-mail'] },
    { key: 'firstName', label: 'First Name', synonyms: ['first name', 'first'] },
    { key: 'lastName', label: 'Last Name', synonyms: ['last name', 'last'] },
    { key: 'middleName', label: 'Middle Name', optional: true, synonyms: ['middle name', 'middle'] },
    // Not auto-mapped: the live Contacts "Full Name" is a "Last, First" display
    // field (often a formula); composing "First Middle Last" into it would flag
    // every contact as Changed and clobber the format. Email is the key, so this
    // is opt-in only — map it by hand if you really want to write it.
    { key: 'fullName', label: 'Full / display Name', optional: true, noAuto: true, synonyms: ['full name'] },
  ],
  units: [
    { key: 'name', label: 'Unit Name (key)', isKey: true, synonyms: ['name', 'unit'] },
    { key: 'charteredOrg', label: 'Chartered Org', synonyms: ['chartered org', 'chartered organization', 'chartered org name'] },
    { key: 'district', label: 'District', synonyms: ['district'] },
  ],
  positions: [{ key: 'name', label: 'Position Name (key)', isKey: true, synonyms: ['name', 'position'] }],
  assignments: [
    { key: 'contact', label: 'Contact (link)', link: true, isKey: true, synonyms: ['contact', 'contacts'] },
    { key: 'unit', label: 'Unit (link)', link: true, isKey: true, synonyms: ['unit', 'units'] },
    { key: 'position', label: 'Position (link)', link: true, isKey: true, synonyms: ['position', 'positions'] },
    { key: 'program', label: 'Program', synonyms: ['program'] },
    { key: 'dcl', label: 'Direct Contact Leader', synonyms: ['direct contact leader', 'direct contact'] },
    {
      key: 'regExpDate',
      label: 'Registration Expiration Date',
      synonyms: ['registration expiration date', 'registration expiration', 'expiration'],
    },
  ],
}

// Best-effort slot -> field mapping by name; key slots fall back to the
// table's primary field, link slots only ever bind to link_row fields.
export function autoMapSlots(tableKey, fields) {
  const slots = TABLE_SLOTS[tableKey]
  const primary = fields.find((f) => f.primary)
  const used = new Set()
  const map = {}
  for (const slot of slots) {
    if (slot.noAuto) continue
    let field = null
    if (slot.link) {
      const links = fields.filter((f) => isLinkRowField(f) && !used.has(f.id))
      field = links.find((f) => slot.synonyms.includes(norm(f.name))) || null
    } else {
      const cands = fields.filter(
        (f) => !used.has(f.id) && isMappableField(f) && !isLinkRowField(f),
      )
      field = cands.find((f) => slot.synonyms.includes(norm(f.name))) || null
      if (!field && slot.isKey && primary && !used.has(primary.id)) field = primary
    }
    if (field) {
      map[slot.key] = String(field.id)
      used.add(field.id)
    }
  }
  return map
}

function slotValueForEntity(tableKey, slotKey, entity) {
  if (tableKey === 'contacts') {
    return {
      email: entity.email,
      firstName: entity.firstName,
      lastName: entity.lastName,
      middleName: entity.middleName,
      fullName: entity.fullName,
    }[slotKey]
  }
  if (tableKey === 'units') {
    return { name: entity.name, charteredOrg: entity.charteredOrg, district: entity.district }[slotKey]
  }
  if (tableKey === 'positions') {
    return { name: entity.name }[slotKey]
  }
  // assignments
  return {
    contact: entity.email,
    unit: entity.unitName,
    position: entity.positionName,
    program: entity.program,
    dcl: entity.directContactLeader,
    regExpDate: entity.regExpDate,
  }[slotKey]
}

function itemLabel(tableKey, entity) {
  if (tableKey === 'contacts') return entity.fullName || entity.email
  if (tableKey === 'units') return entity.name
  if (tableKey === 'positions') return entity.name
  return `${entity.unitName || '(district)'} · ${entity.positionName}`
}

// Projects entities into diff "items": `values` keyed by Baserow field ID,
// with link slots carrying a single-element name array ([] when blank, e.g. a
// district-level assignment with no Unit).
export function buildItems(tableKey, entities, slotMap) {
  const slots = TABLE_SLOTS[tableKey]
  return entities.map((entity) => {
    const values = {}
    for (const slot of slots) {
      const fid = slotMap[slot.key]
      if (!fid) continue
      const raw = slotValueForEntity(tableKey, slot.key, entity)
      if (slot.link) {
        const name = String(raw || '').trim()
        values[fid] = name ? [name] : []
      } else {
        values[fid] = raw
      }
    }
    return { key: entity.key, label: itemLabel(tableKey, entity), values, entity }
  })
}

export function compareFieldIds(tableKey, slotMap) {
  return TABLE_SLOTS[tableKey].filter((s) => !s.isKey).map((s) => slotMap[s.key]).filter(Boolean)
}

function linkValue(row, fid) {
  if (!fid) return ''
  const arr = row[fieldKey(fid)]
  if (Array.isArray(arr) && arr.length) {
    const v = arr[0]
    return norm(v && typeof v === 'object' ? v.value : v)
  }
  return ''
}

// Derives the same key the entity uses, from a Baserow row. For assignments
// this reads the three link fields' primary-field text (Contact link's text is
// the contact's Email — its Baserow primary field), matching the synthesized
// `email | unit | position` triple. When merging is off, contacts key on
// `email | first last` so same-email rows stay distinct on both sides.
export function makeBaserowKeyOf(tableKey, slotMap, { mergeByEmail = true } = {}) {
  if (tableKey === 'assignments') {
    const { contact, unit, position } = slotMap
    return (row) =>
      `${linkValue(row, contact)}|${linkValue(row, unit)}|${linkValue(row, position)}`
  }
  if (tableKey === 'contacts' && !mergeByEmail) {
    const { email, firstName, lastName } = slotMap
    const v = (row, fid) => norm(fid ? row[fieldKey(fid)] : '')
    return (row) => `${v(row, email)}|${norm(`${v(row, firstName)} ${v(row, lastName)}`)}`
  }
  const keySlot = TABLE_SLOTS[tableKey].find((s) => s.isKey)
  const fid = slotMap[keySlot.key]
  return (row) => norm(fid ? row[fieldKey(fid)] : '')
}

function enabledTableKeys(plan) {
  return TABLE_ORDER.filter((k) => {
    const t = plan.tables[k]
    return t && t.enabled && t.tableId
  })
}

export function buildAllDiffs({ entities, plan, baserowRowsByTable, mergeByEmail = true }) {
  const diffs = {}
  for (const tableKey of enabledTableKeys(plan)) {
    const t = plan.tables[tableKey]
    const items = buildItems(tableKey, entities[tableKey] || [], t.slots)
    diffs[tableKey] = buildTableDiff({
      items,
      baserowRows: baserowRowsByTable[tableKey] || [],
      baserowKeyOf: makeBaserowKeyOf(tableKey, t.slots, { mergeByEmail }),
      compareFieldIds: compareFieldIds(tableKey, t.slots),
      fields: t.fields,
    })
  }
  return diffs
}

function buildWritePayload(item, fields) {
  const fieldsById = new Map(fields.map((f) => [String(f.id), f]))
  const payload = {}
  for (const [fid, val] of Object.entries(item.values)) {
    const field = fieldsById.get(String(fid))
    if (!field) continue
    payload[fid] = isLinkRowField(field) ? val : coerceForWrite(field, val)
  }
  return payload
}

// position / unit for an assignment diff row, whichever side it came from.
function makeAssignmentDisplay(t) {
  const s = t.slots
  const lv = (row, fid) => {
    const a = fid && row.baserowRow ? row.baserowRow[fieldKey(fid)] : null
    return Array.isArray(a) && a[0] ? a[0].value || '' : ''
  }
  return (row) =>
    row.item
      ? { unit: row.item.entity.unitName || '(district)', position: row.item.entity.positionName }
      : { unit: lv(row, s.unit) || '(district)', position: lv(row, s.position) }
}

// Builds the assignment actions, pairing a create with a delete in the same
// person+unit so a role change reads as one story ("Scoutmaster → Committee
// Chair") across the two operations it really is. Paired actions are kept
// adjacent; each still executes and reports its own status.
function assignmentActions(t, rows) {
  const disp = makeAssignmentDisplay(t)
  const base = (row) => ({ tableKey: 'assignments', tableId: t.tableId, fields: t.fields, row })
  const L = TABLE_LABELS.assignments

  const creates = rows.filter((r) => r.category === 'new' && r.include)
  const updates = rows.filter((r) => r.category === 'changed' && r.include)
  const deletes = rows.filter((r) => r.category === 'missing' && r.markDelete)

  const groupKey = (row) => row.key.split('|').slice(0, 2).join('|') // email | unit
  const delsByGroup = new Map()
  for (const d of deletes) {
    const g = groupKey(d)
    if (!delsByGroup.has(g)) delsByGroup.set(g, [])
    delsByGroup.get(g).push(d)
  }
  const pairedDeleteFor = new Map()
  const pairedDeletes = new Set()
  for (const c of creates) {
    const bucket = delsByGroup.get(groupKey(c))
    if (bucket && bucket.length) {
      const d = bucket.shift()
      pairedDeleteFor.set(c, d)
      pairedDeletes.add(d)
    }
  }

  const out = []
  for (const c of creates) {
    const d = pairedDeleteFor.get(c)
    if (d) {
      const dc = disp(c)
      const story = `${disp(d).position} → ${dc.position} · ${dc.unit}`
      out.push({ ...base(c), type: 'create', payload: buildWritePayload(c.item, t.fields), label: `${L}: ${story} (create new)` })
      out.push({ ...base(d), type: 'delete', payload: null, label: `${L}: ${story} (remove old)` })
    } else {
      const dc = disp(c)
      out.push({ ...base(c), type: 'create', payload: buildWritePayload(c.item, t.fields), label: `${L}: create ${dc.position} · ${dc.unit}` })
    }
  }
  for (const u of updates) {
    const du = disp(u)
    out.push({ ...base(u), type: 'update', payload: buildWritePayload(u.item, t.fields), label: `${L}: update ${du.position} · ${du.unit}` })
  }
  for (const d of deletes) {
    if (pairedDeletes.has(d)) continue
    const dd = disp(d)
    out.push({ ...base(d), type: 'delete', payload: null, label: `${L}: remove ${dd.position} · ${dd.unit}` })
  }
  return out
}

// Flattens the selected diff rows into an ordered action list (creates/updates
// for new/changed rows the user kept, deletes for missing rows checked for
// deletion). Order follows TABLE_ORDER so dependencies are satisfied.
export function collectActions(plan, diffs) {
  const actions = []
  for (const tableKey of enabledTableKeys(plan)) {
    const t = plan.tables[tableKey]
    const rows = diffs[tableKey] || []
    if (tableKey === 'assignments') {
      actions.push(...assignmentActions(t, rows))
      continue
    }
    for (const row of rows) {
      const base = { tableKey, tableId: t.tableId, fields: t.fields, row }
      if (row.category === 'new' && row.include) {
        actions.push({ ...base, type: 'create', payload: buildWritePayload(row.item, t.fields), label: `${TABLE_LABELS[tableKey]}: create ${row.item.label}` })
      } else if (row.category === 'changed' && row.include) {
        actions.push({ ...base, type: 'update', payload: buildWritePayload(row.item, t.fields), label: `${TABLE_LABELS[tableKey]}: update ${row.item.label}` })
      } else if (row.category === 'missing' && row.markDelete) {
        actions.push({ ...base, type: 'delete', payload: null, label: `${TABLE_LABELS[tableKey]}: delete ${row.key}` })
      }
    }
  }
  return actions
}

// Executes the actions in order. Assignment link names are resolved to row IDs
// just before that table's writes — after Contacts/Units/Positions have been
// committed — so links can bind to freshly created rows. The Contact link does
// not auto-create (an unmatched contact is a typo): only that row fails.
export async function commitAll(token, plan, diffs, onProgress) {
  const actions = collectActions(plan, diffs)
  let i = 0
  while (i < actions.length) {
    const tableKey = actions[i].tableKey
    let j = i
    while (j < actions.length && actions[j].tableKey === tableKey) j += 1
    const slice = actions.slice(i, j)

    if (tableKey === 'assignments') {
      const t = plan.tables.assignments
      const ac = {}
      if (t.slots.unit) ac[t.slots.unit] = t.autoCreate?.unit !== false
      if (t.slots.position) ac[t.slots.position] = t.autoCreate?.position !== false
      if (t.slots.contact) ac[t.slots.contact] = t.autoCreate?.contact === true
      const shaped = slice.map((a) => ({
        ...a,
        row: { fieldValues: a.payload ? { ...a.payload } : {}, key: a.row.key, baserowRow: a.row.baserowRow },
      }))
      const resolved = await resolveLinkRowValues(token, t.fields, shaped, ac)
      resolved.forEach((r, k) => {
        slice[k].payload = r.row.fieldValues
        slice[k].resolveError = r.resolveError
      })
    }

    for (let k = 0; k < slice.length; k += 1) {
      const action = slice[k]
      const idx = i + k
      if (onProgress) onProgress(idx, 'running')
      try {
        if (action.resolveError) throw new Error(action.resolveError)
        if (action.type === 'create') {
          const created = await createRow(token, action.tableId, action.payload)
          if (onProgress) onProgress(idx, 'success', null, { id: created?.id })
        } else if (action.type === 'update') {
          await updateRow(token, action.tableId, action.row.baserowRow.id, action.payload)
          if (onProgress) onProgress(idx, 'success', null, { id: action.row.baserowRow.id })
        } else if (action.type === 'delete') {
          await deleteRow(token, action.tableId, action.row.baserowRow.id)
          if (onProgress) onProgress(idx, 'success', null, { id: action.row.baserowRow.id })
        }
      } catch (err) {
        if (onProgress) onProgress(idx, 'error', err.message)
      }
    }
    i = j
  }
}

// Predicts each action's outcome WITHOUT writing, using only the diffs: which
// linked rows already exist (have a Baserow row) or will be created this run
// (new + included). Lets the Commit step offer a dry run and flag assignment
// rows whose Contact/Unit/Position link won't resolve before anything is sent.
function linkNameSets(plan, diffs) {
  const collect = (tableKey, keyFn) => {
    const set = new Set()
    let present = false
    if (plan.tables[tableKey]?.enabled && diffs[tableKey]) {
      present = true
      for (const row of diffs[tableKey]) {
        if (row.baserowRow) set.add(keyFn(row))
        else if (row.category === 'new' && row.include) set.add(keyFn(row))
      }
    }
    return { set, present }
  }
  return {
    contacts: collect('contacts', (r) => r.key.split('|')[0]),
    units: collect('units', (r) => r.key),
    positions: collect('positions', (r) => r.key),
  }
}

export function previewCommit(plan, diffs) {
  const actions = collectActions(plan, diffs)
  const sets = linkNameSets(plan, diffs)
  const ac = plan.tables.assignments?.autoCreate || {}

  return actions.map((action) => {
    if (action.tableKey !== 'assignments' || action.type === 'delete') {
      return { action, status: 'ok', notes: [] }
    }
    const e = action.row.item.entity
    const notes = []
    let status = 'ok'
    const check = (name, kind, autoOn, label) => {
      const key = norm(name)
      if (!key) return
      const { set, present } = sets[kind]
      if (!present || set.has(key)) return // resolves against existing/just-created, or table not synced
      if (autoOn) notes.push(`${label} "${name}" will be auto-created`)
      else {
        notes.push(`${label} "${name}" not found — row will fail`)
        status = 'fail'
      }
    }
    check(e.email, 'contacts', ac.contact === true, 'contact')
    check(e.unitName, 'units', ac.unit !== false, 'unit')
    check(e.positionName, 'positions', ac.position !== false, 'position')
    return { action, status, notes }
  })
}
