import { useMemo, useState } from 'react'
import { collectActions, commitAll } from '../lib/sync'

const STATUS_STYLES = {
  pending: 'text-gray-400',
  running: 'text-blue-600',
  success: 'text-emerald-600',
  error: 'text-red-600',
}

export default function StepCommit({ token, plan, diffs }) {
  const [statuses, setStatuses] = useState({})
  const [errors, setErrors] = useState({})
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  const actions = useMemo(() => (diffs ? collectActions(plan, diffs) : []), [plan, diffs])

  const counts = actions.reduce((acc, a) => {
    acc[a.type] = (acc[a.type] || 0) + 1
    return acc
  }, {})

  const handleCommit = async () => {
    setRunning(true)
    setDone(false)
    setStatuses({})
    setErrors({})
    await commitAll(token, plan, diffs, (idx, status, error) => {
      setStatuses((prev) => ({ ...prev, [idx]: status }))
      if (error) setErrors((prev) => ({ ...prev, [idx]: error }))
    })
    setRunning(false)
    setDone(true)
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

      {actions.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing to commit — no rows are selected.</p>
      ) : (
        <button
          onClick={handleCommit}
          disabled={running}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? `Committing… (${completed}/${actions.length})` : 'Confirm & Commit'}
        </button>
      )}

      {(running || done) && actions.length > 0 && (
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-blue-600 transition-all"
              style={{ width: `${(completed / actions.length) * 100}%` }}
            />
          </div>
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 max-h-96 overflow-auto">
            {actions.map((action, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate">{action.label}</span>
                <span className={`shrink-0 text-xs font-medium ${STATUS_STYLES[statuses[i] || 'pending']}`}>
                  {statuses[i] === 'error' ? `Error: ${errors[i] || 'failed'}` : statuses[i] || 'pending'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {done && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            failed > 0
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}
        >
          {failed > 0
            ? `Sync complete with ${failed} failed action${failed === 1 ? '' : 's'} — see the list above.`
            : 'Sync complete.'}
        </div>
      )}
    </div>
  )
}
