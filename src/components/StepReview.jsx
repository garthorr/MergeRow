import { useEffect, useMemo, useState } from 'react'
import { fetchAllRows, fieldKey } from '../lib/baserow'
import { normalizeRoster } from '../lib/normalize'
import { buildAllDiffs, TABLE_ORDER, makeBaserowKeyOf } from '../lib/sync'
import { findDuplicateBaserowKeys, formatFieldValue } from '../lib/diff'

const CAT_BADGE = {
  new: 'bg-emerald-100 text-emerald-700',
  changed: 'bg-amber-100 text-amber-700',
  unchanged: 'bg-gray-100 text-gray-500',
  missing: 'bg-red-100 text-red-700',
}
const CAT_LABEL = { new: 'New', changed: 'Changed', unchanged: 'Unchanged', missing: 'Missing' }

function Badge({ category }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${CAT_BADGE[category]}`}>
      {CAT_LABEL[category]}
    </span>
  )
}

function fieldName(table, fid) {
  const f = table.fields.find((x) => String(x.id) === String(fid))
  return f ? f.name : fid
}

function ChangeList({ table, changes }) {
  return (
    <ul className="mt-0.5 space-y-0.5">
      {Object.entries(changes).map(([fid, { oldValue, newValue }]) => (
        <li key={fid} className="text-xs">
          <span className="font-medium">{fieldName(table, fid)}:</span>{' '}
          <span className="text-red-600 line-through">{oldValue || '∅'}</span> →{' '}
          <span className="text-emerald-700">{newValue || '∅'}</span>
        </li>
      ))}
    </ul>
  )
}

export default function StepReview({ token, plan, csvRows, roleByHeader, diffs, setDiffs }) {
  const [loading, setLoading] = useState(!diffs)
  const [error, setError] = useState('')
  const [dupAssignmentKeys, setDupAssignmentKeys] = useState([])

  const entities = useMemo(() => normalizeRoster(csvRows, roleByHeader), [csvRows, roleByHeader])
  const activeKeys = TABLE_ORDER.filter(
    (k) => plan.tables[k].enabled && plan.tables[k].tableId && plan.tables[k].connected,
  )

  useEffect(() => {
    if (diffs) return
    let cancelled = false
    async function run() {
      setLoading(true)
      setError('')
      try {
        const baserowRowsByTable = {}
        await Promise.all(
          activeKeys.map(async (k) => {
            baserowRowsByTable[k] = await fetchAllRows(token, plan.tables[k].tableId)
          }),
        )
        if (cancelled) return
        if (baserowRowsByTable.assignments && plan.tables.assignments.slots) {
          setDupAssignmentKeys(
            findDuplicateBaserowKeys(
              baserowRowsByTable.assignments,
              makeBaserowKeyOf('assignments', plan.tables.assignments.slots),
            ),
          )
        }
        setDiffs(buildAllDiffs({ entities, plan, baserowRowsByTable }))
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleInclude = (tableKey, index) =>
    setDiffs((prev) => ({
      ...prev,
      [tableKey]: prev[tableKey].map((r, i) => (i === index ? { ...r, include: !r.include } : r)),
    }))
  const toggleDelete = (tableKey, index) =>
    setDiffs((prev) => ({
      ...prev,
      [tableKey]: prev[tableKey].map((r, i) => (i === index ? { ...r, markDelete: !r.markDelete } : r)),
    }))
  const setAllMissing = (tableKey, value) =>
    setDiffs((prev) => ({
      ...prev,
      [tableKey]: prev[tableKey].map((r) => (r.category === 'missing' ? { ...r, markDelete: value } : r)),
    }))

  if (loading) return <p className="text-sm text-gray-500">Fetching existing rows and diffing…</p>
  if (error)
    return <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
  if (!diffs) return null

  // ---- Contact-centric grouping --------------------------------------------
  const contactRows = (diffs.contacts || []).map((row, index) => ({ row, index }))
  const assignmentRows = (diffs.assignments || []).map((row, index) => ({ row, index }))

  const people = new Map()
  const personFor = (email) => {
    if (!people.has(email)) people.set(email, { email, name: '', contact: null, assignments: [] })
    return people.get(email)
  }
  for (const entry of contactRows) {
    const p = personFor(entry.row.key)
    p.contact = entry
    p.name = entry.row.item?.label || entry.row.key
  }
  for (const entry of assignmentRows) {
    const email = entry.row.key.split('|')[0]
    const p = personFor(email)
    if (entry.row.item?.entity?.contactName && !p.name) p.name = entry.row.item.entity.contactName
    p.assignments.push(entry)
  }
  const peopleList = [...people.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))

  const assignTable = plan.tables.assignments
  const assignmentDisplay = (row) => {
    if (row.item) return { unit: row.item.entity.unitName || '(district)', position: row.item.entity.positionName }
    const s = assignTable.slots
    const lv = (fid) => {
      const a = fid && row.baserowRow ? row.baserowRow[fieldKey(fid)] : null
      return Array.isArray(a) && a[0] ? a[0].value || '' : ''
    }
    return { unit: lv(s.unit) || '(district)', position: lv(s.position) }
  }

  // A role change is a delete (old position) + create (new position) within the
  // same unit. Pair those up per unit so it reads as one story —
  // "Scoutmaster → Committee Chair" — while keeping the two underlying toggles.
  const buildAssignmentView = (assignments) => {
    const byUnit = new Map()
    for (const entry of assignments) {
      const uk = entry.row.key.split('|')[1]
      if (!byUnit.has(uk)) byUnit.set(uk, [])
      byUnit.get(uk).push(entry)
    }
    const out = []
    const byPos = (a, b) => assignmentDisplay(a.row).position.localeCompare(assignmentDisplay(b.row).position)
    for (const entries of byUnit.values()) {
      const news = entries.filter((e) => e.row.category === 'new').sort(byPos)
      const missings = entries.filter((e) => e.row.category === 'missing').sort(byPos)
      const others = entries.filter((e) => e.row.category === 'changed' || e.row.category === 'unchanged')
      const paired = Math.min(news.length, missings.length)
      for (let i = 0; i < paired; i += 1) {
        out.push({
          kind: 'pair',
          oldEntry: missings[i],
          newEntry: news[i],
          oldPos: assignmentDisplay(missings[i].row).position,
          newPos: assignmentDisplay(news[i].row).position,
          unit: assignmentDisplay(news[i].row).unit,
        })
      }
      for (let i = paired; i < news.length; i += 1) out.push({ kind: 'single', entry: news[i] })
      for (let i = paired; i < missings.length; i += 1) out.push({ kind: 'single', entry: missings[i] })
      for (const entry of others) out.push({ kind: 'single', entry })
    }
    return out
  }

  const conflictEmails = new Set(
    entities.warnings.filter((w) => w.type === 'email-name-conflict').map((w) => w.email.toLowerCase()),
  )

  // ---- Catalog (Units / Positions) -----------------------------------------
  const catalogSection = (tableKey, title) => {
    if (!diffs[tableKey]) return null
    const rows = diffs[tableKey].map((row, index) => ({ row, index })).filter((e) => e.row.category !== 'unchanged')
    const table = plan.tables[tableKey]
    const missingCount = rows.filter((e) => e.row.category === 'missing').length
    if (rows.length === 0)
      return (
        <section>
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          <p className="text-xs text-gray-400">No changes.</p>
        </section>
      )
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          {missingCount > 0 && (
            <div className="flex items-center gap-2 text-xs text-red-700">
              <span>{missingCount} missing</span>
              <button onClick={() => setAllMissing(tableKey, true)} className="rounded border border-red-300 px-2 py-0.5 hover:bg-red-100">
                Select all for deletion
              </button>
              <button onClick={() => setAllMissing(tableKey, false)} className="rounded border border-gray-300 px-2 py-0.5 text-gray-600 hover:bg-gray-100">
                Clear
              </button>
            </div>
          )}
        </div>
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {rows.map(({ row, index }) => (
            <li key={index} className="flex items-start justify-between gap-3 px-3 py-2">
              <div>
                <div className="flex items-center gap-2">
                  <Badge category={row.category} />
                  <span className="text-sm text-gray-800">{row.item ? row.item.label : row.key}</span>
                </div>
                {row.category === 'changed' && <ChangeList table={table} changes={row.changes} />}
              </div>
              {row.category === 'missing' ? (
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-red-700">
                  <input type="checkbox" checked={row.markDelete} onChange={() => toggleDelete(tableKey, index)} />
                  Delete
                </label>
              ) : (
                <input type="checkbox" className="mt-1" checked={row.include} onChange={() => toggleInclude(tableKey, index)} />
              )}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      {/* Warnings */}
      {entities.warnings.length > 0 && (
        <div className="space-y-2">
          {entities.warnings.map((w, i) => (
            <div key={i} className="rounded-md bg-amber-50 border border-amber-300 px-4 py-2 text-sm text-amber-800">
              {w.type === 'email-name-conflict' && (
                <>
                  <span className="font-semibold">Same email, different names:</span> {w.email} appears as{' '}
                  {w.names.join(' / ')}. Kept as one contact (keyed on email) — verify it isn't two people.
                </>
              )}
              {w.type === 'duplicate-assignments' && (
                <>
                  <span className="font-semibold">{w.count}</span> roster row{w.count === 1 ? '' : 's'} collapsed —
                  identical Email · Unit · Position triples map to one assignment.
                </>
              )}
              {w.type === 'blank-email' && (
                <>
                  <span className="font-semibold">{w.count}</span> row{w.count === 1 ? '' : 's'} skipped for a blank
                  email ({w.sample.join(', ')}
                  {w.count > w.sample.length ? ', …' : ''}).
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {dupAssignmentKeys.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-300 px-4 py-2 text-sm text-amber-800">
          <span className="font-semibold">Warning:</span> {dupAssignmentKeys.length} duplicate assignment key
          {dupAssignmentKeys.length === 1 ? '' : 's'} already in Baserow — diffs for those collapse to one row.
        </div>
      )}

      {/* Summary */}
      <div className="flex flex-wrap gap-2 text-xs">
        {activeKeys.map((k) => {
          const counts = (diffs[k] || []).reduce((acc, r) => {
            acc[r.category] = (acc[r.category] || 0) + 1
            return acc
          }, {})
          return (
            <span key={k} className="rounded-md border border-gray-200 px-2 py-1 text-gray-600">
              <span className="font-semibold text-gray-800">{plan.tables[k].name}</span> · {counts.new || 0} new ·{' '}
              {counts.changed || 0} changed · {counts.missing || 0} missing
            </span>
          )
        })}
      </div>

      {/* People */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">People ({peopleList.length})</h3>
        <div className="space-y-2 max-h-[32rem] overflow-auto pr-1">
          {peopleList.map((p) => {
            const hasNew = p.assignments.some((e) => e.row.category === 'new')
            const hasMissing = p.assignments.some((e) => e.row.category === 'missing')
            return (
              <div key={p.email} className="rounded-md border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{p.name || p.email}</span>
                    <span className="text-xs text-gray-400">{p.email}</span>
                    {conflictEmails.has(p.email) && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                        name conflict
                      </span>
                    )}
                  </div>
                  {hasNew && hasMissing && (
                    <span className="text-[11px] text-gray-400">role change (delete + create)</span>
                  )}
                </div>

                {/* Contact-level */}
                {p.contact && p.contact.row.category !== 'unchanged' && (
                  <div className="mt-1 flex items-start justify-between gap-3 rounded bg-gray-50 px-2 py-1">
                    <div>
                      <Badge category={p.contact.row.category} /> <span className="text-xs text-gray-600">contact</span>
                      {p.contact.row.category === 'changed' && (
                        <ChangeList table={plan.tables.contacts} changes={p.contact.row.changes} />
                      )}
                    </div>
                    {p.contact.row.category === 'missing' ? (
                      <label className="flex shrink-0 items-center gap-1.5 text-xs text-red-700">
                        <input
                          type="checkbox"
                          checked={p.contact.row.markDelete}
                          onChange={() => toggleDelete('contacts', p.contact.index)}
                        />
                        Delete
                      </label>
                    ) : (
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={p.contact.row.include}
                        onChange={() => toggleInclude('contacts', p.contact.index)}
                      />
                    )}
                  </div>
                )}

                {/* Assignment-level — role changes paired as old → new */}
                {p.assignments.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {buildAssignmentView(p.assignments).map((view, i) => {
                      if (view.kind === 'pair') {
                        return (
                          <li key={i} className="flex items-start justify-between gap-3 text-sm">
                            <div className="flex items-start gap-2">
                              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">
                                Role change
                              </span>
                              <span className="text-gray-700">
                                <span className="text-red-600 line-through">{view.oldPos}</span>{' '}
                                <span className="text-gray-400">→</span>{' '}
                                <span className="font-medium text-emerald-700">{view.newPos}</span>
                                <span className="text-gray-400"> · {view.unit}</span>
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-3 text-xs">
                              <label className="flex items-center gap-1 text-emerald-700">
                                <input
                                  type="checkbox"
                                  checked={view.newEntry.row.include}
                                  onChange={() => toggleInclude('assignments', view.newEntry.index)}
                                />
                                create new
                              </label>
                              <label className="flex items-center gap-1 text-red-700">
                                <input
                                  type="checkbox"
                                  checked={view.oldEntry.row.markDelete}
                                  onChange={() => toggleDelete('assignments', view.oldEntry.index)}
                                />
                                remove old
                              </label>
                            </div>
                          </li>
                        )
                      }
                      const { row, index } = view.entry
                      const d = assignmentDisplay(row)
                      return (
                        <li key={i} className="flex items-start justify-between gap-3 text-sm">
                          <div className="flex items-start gap-2">
                            <Badge category={row.category} />
                            <span className={row.category === 'unchanged' ? 'text-gray-400' : 'text-gray-700'}>
                              {d.position} <span className="text-gray-400">·</span> {d.unit}
                              {row.category === 'changed' && <ChangeList table={assignTable} changes={row.changes} />}
                            </span>
                          </div>
                          {row.category === 'missing' ? (
                            <label className="flex shrink-0 items-center gap-1.5 text-xs text-red-700">
                              <input type="checkbox" checked={row.markDelete} onChange={() => toggleDelete('assignments', index)} />
                              Delete
                            </label>
                          ) : row.category !== 'unchanged' ? (
                            <input type="checkbox" className="mt-1" checked={row.include} onChange={() => toggleInclude('assignments', index)} />
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {diffs.units && catalogSection('units', 'Units')}
      {diffs.positions && catalogSection('positions', 'Positions')}
    </div>
  )
}
