import { useMemo, useState } from 'react'
import { previewCommit, commitAll } from '../lib/sync'

const STATUS_STYLES = {
  pending: 'text-gray-400',
  running: 'text-blue-600',
  success: 'text-emerald-600',
  error: 'text-red-600',
}

function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function StepCommit({ token, plan, diffs }) {
  const [statuses, setStatuses] = useState({})
  const [errors, setErrors] = useState({})
  const [rowIds, setRowIds] = useState({})
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const previewRows = useMemo(() => (diffs ? previewCommit(plan, diffs) : []), [plan, diffs])
  const actions = previewRows.map((p) => p.action)

  const counts = actions.reduce((acc, a) => {
    acc[a.type] = (acc[a.type] || 0) + 1
    return acc
  }, {})
  const willFail = previewRows.filter((p) => p.status === 'fail').length
  const willAutoCreate = previewRows.filter((p) => p.status === 'ok' && p.notes.length > 0).length

  const handleCommit = async () => {
    setRunning(true)
    setDone(false)
    setStatuses({})
    setErrors({})
    setRowIds({})
    await commitAll(token, plan, diffs, (idx, status, error, info) => {
      setStatuses((prev) => ({ ...prev, [idx]: status }))
      if (error) setErrors((prev) => ({ ...prev, [idx]: error }))
      if (info?.id) setRowIds((prev) => ({ ...prev, [idx]: info.id }))
    })
    setRunning(false)
    setDone(true)
  }

  const handleReport = () => {
    const header = ['#', 'table', 'type', 'key', 'label', 'predicted', 'predicted_notes', 'status', 'error', 'row_id']
    const body = previewRows.map(({ action, status, notes }, i) => [
      i + 1,
      action.tableKey,
      action.type,
      action.row.key,
      action.label,
      status,
      notes.join('; '),
      statuses[i] || (done || running ? 'pending' : ''),
      errors[i] || '',
      rowIds[i] || '',
    ])
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    downloadCsv(`mergerow-${done ? 'commit' : 'dryrun'}-${stamp}.csv`, [header, ...body])
  }

  const completed = Object.values(statuses).filter((s) => s === 'success' || s === 'error').length
  const failed = Object.values(statuses).filter((s) => s === 'error').length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3">
          <p className="text-2xl font-semibold text-emerald-700">{counts.create || 0}</p>
          <p className="text-xs text-emerald-600">Creates</p>
        </div>
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-2xl font-semibold text-amber-700">{counts.update || 0}</p>
          <p className="text-xs text-amber-600">Updates</p>
        </div>
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-2xl font-semibold text-red-700">{counts.delete || 0}</p>
          <p className="text-xs text-red-600">Deletes</p>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Committed in dependency order — Contacts, Units and Positions first, then Contact Assignments
        (whose Contact / Unit / Position links resolve against the rows just written). One action;
        the tool owns the ordering.
      </p>

      {/* Preflight: surfaced before anything is written */}
      {willFail > 0 && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          <span className="font-semibold">Preflight:</span> {willFail} assignment row{willFail === 1 ? '' : 's'} will
          fail — the linked contact isn't in Contacts and auto-create is off. Run a dry run for details, or enable
          Contact auto-create / sync Contacts this run.
        </div>
      )}
      {willAutoCreate > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
          <span className="font-semibold">{willAutoCreate}</span> assignment row{willAutoCreate === 1 ? '' : 's'} will
          auto-create a missing Unit or Position link.
        </div>
      )}

      {actions.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing to commit — no rows are selected.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowPreview(true)}
            disabled={running}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Dry run (no writes)
          </button>
          <button
            onClick={handleCommit}
            disabled={running}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? `Committing… (${completed}/${actions.length})` : 'Confirm & Commit'}
          </button>
          {(showPreview || done) && (
            <button
              onClick={handleReport}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Download report (CSV)
            </button>
          )}
        </div>
      )}

      {showPreview && !done && (
        <p className="text-xs text-gray-500">
          Dry run — predicted outcomes below. Nothing has been written. {willFail === 0 ? 'No rows are expected to fail.' : ''}
        </p>
      )}

      {(running || done) && actions.length > 0 && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div className="h-2 rounded-full bg-blue-600 transition-all" style={{ width: `${(completed / actions.length) * 100}%` }} />
        </div>
      )}

      {(showPreview || running || done) && actions.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 max-h-96 overflow-auto">
          {previewRows.map(({ action, status: predicted, notes }, i) => {
            const live = statuses[i]
            return (
              <li key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="truncate">{action.label}</span>
                  {!live && notes.length > 0 && (
                    <span className={`ml-2 text-xs ${predicted === 'fail' ? 'text-red-600' : 'text-amber-600'}`}>
                      {notes.join('; ')}
                    </span>
                  )}
                  {live && rowIds[i] && <span className="ml-2 text-xs text-gray-400">row {rowIds[i]}</span>}
                </div>
                <span className={`shrink-0 text-xs font-medium ${live ? STATUS_STYLES[live] : predicted === 'fail' ? 'text-red-600' : 'text-gray-400'}`}>
                  {live
                    ? live === 'error'
                      ? `Error: ${errors[i] || 'failed'}`
                      : live
                    : predicted === 'fail'
                      ? 'will fail'
                      : 'will ' + action.type}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {done && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            failed > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}
        >
          {failed > 0
            ? `Sync complete with ${failed} failed action${failed === 1 ? '' : 's'} — see the list above or the downloaded report.`
            : 'Sync complete.'}
        </div>
      )}
    </div>
  )
}
