import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAllRows, fieldKey } from '../lib/baserow'
import { normalizeRoster } from '../lib/normalize'
import { buildAllDiffs, TABLE_ORDER, makeBaserowKeyOf } from '../lib/sync'
import { findDuplicateBaserowKeys } from '../lib/diff'

const CAT_BADGE = {
  new: 'bg-emerald-100 text-emerald-700',
  changed: 'bg-amber-100 text-amber-700',
  unchanged: 'bg-gray-100 text-gray-500',
  missing: 'bg-red-100 text-red-700',
}
const CAT_LABEL = { new: 'New', changed: 'Changed', unchanged: 'Unchanged', missing: 'Missing' }
const CATS = ['new', 'changed', 'missing', 'unchanged']

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
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [dupAssignmentKeys, setDupAssignmentKeys] = useState([])
  const [refreshedAt, setRefreshedAt] = useState(null)

  // Filters + bulk: which categories to show, a free-text query, and whether
  // same-email rows are merged into one contact. Unchanged is hidden by default.
  const [showCats, setShowCats] = useState({ new: true, changed: true, missing: true, unchanged: false })
  const [query, setQuery] = useState('')
  const [mergeByEmail, setMergeByEmail] = useState(true)

  // Cache the fetched Baserow rows so toggling Merge re-diffs without refetching.
  const baserowRef = useRef(null)

  const entities = useMemo(
    () => normalizeRoster(csvRows, roleByHeader, { mergeByEmail }),
    [csvRows, roleByHeader, mergeByEmail],
  )
  const activeKeys = TABLE_ORDER.filter(
    (k) => plan.tables[k].enabled && plan.tables[k].tableId && plan.tables[k].connected,
  )

  const fetchRows = async () => {
    const out = {}
    await Promise.all(
      activeKeys.map(async (k) => {
        out[k] = await fetchAllRows(token, plan.tables[k].tableId)
      }),
    )
    return out
  }
  const buildFromRows = (rows) => {
    baserowRef.current = rows
    if (rows.assignments && plan.tables.assignments.slots) {
      setDupAssignmentKeys(
        findDuplicateBaserowKeys(
          rows.assignments,
          makeBaserowKeyOf('assignments', plan.tables.assignments.slots),
        ),
      )
    }
    setDiffs(buildAllDiffs({ entities, plan, baserowRowsByTable: rows, mergeByEmail }))
    setRefreshedAt(new Date())
  }

  // Re-pull the latest Baserow rows and rebuild the diff — picks up changes made
  // in Baserow since the page loaded. Resets row selections, since the diff
  // itself may change.
  const refresh = async () => {
    setRefreshing(true)
    setError('')
    try {
      buildFromRows(await fetchRows())
    } catch (err) {
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (diffs) return
    let cancelled = false
    async function run() {
      setLoading(true)
      setError('')
      try {
        const rows = await fetchRows()
        if (cancelled) return
        buildFromRows(rows)
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

  // Re-diff from cached rows when Merge is toggled (entities is already fresh).
  useEffect(() => {
    if (!baserowRef.current) return
    setDiffs(buildAllDiffs({ entities, plan, baserowRowsByTable: baserowRef.current, mergeByEmail }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeByEmail])

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

  if (loading) return <p className="text-sm text-gray-500">Fetching existing rows and diffing…</p>
  if (error)
    return <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
  if (!diffs) return null

  const q = query.trim().toLowerCase()
  const catActive = (c) => showCats[c]

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
  const assignmentText = (row) => {
    const d = assignmentDisplay(row)
    const name = row.item?.entity?.contactName || ''
    return `${d.position} ${d.unit} ${name}`.toLowerCase()
  }

  // ---- Contact-centric grouping (keyed by email; a person may have >1 contact
  // row when merging is off) -------------------------------------------------
  const contactRows = (diffs.contacts || []).map((row, index) => ({ row, index }))
  const assignmentRows = (diffs.assignments || []).map((row, index) => ({ row, index }))

  const people = new Map()
  const personFor = (email) => {
    if (!people.has(email)) people.set(email, { email, name: '', contacts: [], assignments: [] })
    return people.get(email)
  }
  for (const entry of contactRows) {
    const email = entry.row.key.split('|')[0]
    const p = personFor(email)
    p.contacts.push(entry)
    if (!p.name && entry.row.item?.label) p.name = entry.row.item.label
  }
  for (const entry of assignmentRows) {
    const email = entry.row.key.split('|')[0]
    const p = personFor(email)
    if (!p.name && entry.row.item?.entity?.contactName) p.name = entry.row.item.entity.contactName
    p.assignments.push(entry)
  }
  const peopleList = [...people.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))

  // A role change is delete(old) + create(new) in the same unit; pair them so
  // it reads as "Scoutmaster → Committee Chair".
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

  // Person passes the text query if their name/email or any of their
  // assignments/contacts match; category chips then filter individual rows.
  const personMatches = (p) =>
    !q ||
    (p.name || '').toLowerCase().includes(q) ||
    p.email.includes(q) ||
    p.assignments.some((e) => assignmentText(e.row).includes(q)) ||
    p.contacts.some((c) => (c.row.item?.label || c.row.key || '').toLowerCase().includes(q))

  const viewVisible = (v) =>
    v.kind === 'pair' ? catActive('new') || catActive('missing') : catActive(v.entry.row.category)

  const shownPeople = peopleList
    .map((p) => ({
      ...p,
      visibleContacts: p.contacts.filter((c) => catActive(c.row.category)),
      viewItems: buildAssignmentView(p.assignments).filter(viewVisible),
    }))
    .filter((p) => personMatches(p) && (p.visibleContacts.length > 0 || p.viewItems.length > 0))

  const visibleEmails = new Set(shownPeople.map((p) => p.email))

  const labelText = (row) => (row.item?.label || row.key || '').toLowerCase()
  const inScope = (tableKey, row) => {
    if (!catActive(row.category)) return false
    if (tableKey === 'contacts' || tableKey === 'assignments') {
      return visibleEmails.has(row.key.split('|')[0])
    }
    return !q || labelText(row).includes(q)
  }

  // Bulk toggles, scoped to the rows currently shown (filters compose).
  const bulkInclude = (value) =>
    setDiffs((prev) => {
      const next = { ...prev }
      for (const tk of Object.keys(prev)) {
        next[tk] = prev[tk].map((row) =>
          (row.category === 'new' || row.category === 'changed') && inScope(tk, row)
            ? { ...row, include: value }
            : row,
        )
      }
      return next
    })
  const bulkDelete = (value) =>
    setDiffs((prev) => {
      const next = { ...prev }
      for (const tk of Object.keys(prev)) {
        next[tk] = prev[tk].map((row) =>
          row.category === 'missing' && inScope(tk, row) ? { ...row, markDelete: value } : row,
        )
      }
      return next
    })

  const conflictEmails = new Set(
    entities.warnings.filter((w) => w.type === 'email-name-conflict').map((w) => w.email.toLowerCase()),
  )

  // ---- Catalog (Units / Positions) -----------------------------------------
  const catalogSection = (tableKey, title) => {
    if (!diffs[tableKey]) return null
    const table = plan.tables[tableKey]
    const rows = diffs[tableKey]
      .map((row, index) => ({ row, index }))
      .filter((e) => catActive(e.row.category) && (!q || labelText(e.row).includes(q)))
    const missingCount = rows.filter((e) => e.row.category === 'missing').length
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            {title} <span className="text-xs font-normal text-gray-400">({rows.length})</span>
          </h3>
          {missingCount > 0 && (
            <span className="text-xs text-red-700">{missingCount} missing shown</span>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400">No rows match the current filters.</p>
        ) : (
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
                ) : row.category !== 'unchanged' ? (
                  <input type="checkbox" className="mt-1" checked={row.include} onChange={() => toggleInclude(tableKey, index)} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  const contactBlock = (c, showName) => (
    <div className="mt-1 flex items-start justify-between gap-3 rounded bg-gray-50 px-2 py-1">
      <div>
        <Badge category={c.row.category} />{' '}
        <span className="text-xs text-gray-600">{showName ? c.row.item?.label || 'contact' : 'contact'}</span>
        {c.row.category === 'changed' && <ChangeList table={plan.tables.contacts} changes={c.row.changes} />}
      </div>
      {c.row.category === 'missing' ? (
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-red-700">
          <input type="checkbox" checked={c.row.markDelete} onChange={() => toggleDelete('contacts', c.index)} />
          Delete
        </label>
      ) : c.row.category !== 'unchanged' ? (
        <input type="checkbox" className="mt-0.5" checked={c.row.include} onChange={() => toggleInclude('contacts', c.index)} />
      ) : null}
    </div>
  )

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
                  {w.names.join(' / ')}.{' '}
                  {mergeByEmail
                    ? 'Merged into one contact (keyed on email) — uncheck "Merge contacts sharing an email" to keep them separate.'
                    : 'Kept as separate contacts (keyed on email + name). The assignment Contact link still resolves by email, so it may bind to either.'}
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

      {/* Toolbar: merge toggle, filters, bulk */}
      <div className="space-y-3 rounded-md border border-gray-200 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={mergeByEmail} onChange={(e) => setMergeByEmail(e.target.checked)} />
            Merge contacts sharing an email
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, email, unit or position…"
            className="min-w-[14rem] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={refresh}
            disabled={refreshing}
            title="Re-pull the latest rows from Baserow and rebuild the diff"
            className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
        {refreshedAt && (
          <p className="text-[11px] text-gray-400">Baserow data as of {refreshedAt.toLocaleTimeString()}.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">Show:</span>
          {CATS.map((c) => (
            <button
              key={c}
              onClick={() => setShowCats((s) => ({ ...s, [c]: !s[c] }))}
              className={`rounded-full border px-2.5 py-0.5 font-medium ${
                showCats[c] ? `${CAT_BADGE[c]} border-transparent` : 'border-gray-200 bg-white text-gray-400'
              }`}
            >
              {CAT_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">Bulk (shown rows):</span>
          <button onClick={() => bulkInclude(true)} className="rounded border border-emerald-300 px-2 py-0.5 text-emerald-700 hover:bg-emerald-50">
            Select all creates/updates
          </button>
          <button onClick={() => bulkInclude(false)} className="rounded border border-gray-300 px-2 py-0.5 text-gray-600 hover:bg-gray-100">
            Deselect all
          </button>
          <button onClick={() => bulkDelete(true)} className="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50">
            Mark all missing for deletion
          </button>
          <button onClick={() => bulkDelete(false)} className="rounded border border-gray-300 px-2 py-0.5 text-gray-600 hover:bg-gray-100">
            Clear deletions
          </button>
        </div>
      </div>

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
        <h3 className="text-sm font-semibold text-gray-700">
          People <span className="text-xs font-normal text-gray-400">({shownPeople.length} of {peopleList.length})</span>
        </h3>
        <div className="max-h-[32rem] space-y-2 overflow-auto pr-1">
          {shownPeople.map((p) => {
            const hasNew = p.viewItems.some((v) => v.kind === 'pair' || v.entry?.row.category === 'new')
            const hasMissing = p.viewItems.some(
              (v) => v.kind === 'pair' || v.entry?.row.category === 'missing',
            )
            return (
              <div key={p.email} className="rounded-md border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{p.name || p.email}</span>
                    <span className="text-xs text-gray-400">{p.email}</span>
                    {conflictEmails.has(p.email) && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                        {mergeByEmail ? 'merged' : 'shared email'}
                      </span>
                    )}
                  </div>
                  {hasNew && hasMissing && (
                    <span className="text-[11px] text-gray-400">role change (delete + create)</span>
                  )}
                </div>

                {p.visibleContacts.map((c) => (
                  <div key={c.index}>{contactBlock(c, p.contacts.length > 1)}</div>
                ))}

                {p.viewItems.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {p.viewItems.map((view, i) => {
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
          {shownPeople.length === 0 && (
            <p className="text-sm text-gray-400">No people match the current filters.</p>
          )}
        </div>
      </section>

      {diffs.units && catalogSection('units', 'Units')}
      {diffs.positions && catalogSection('positions', 'Positions')}
    </div>
  )
}
