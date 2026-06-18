import { useState } from 'react'
import { createRow, updateRow, deleteRow } from '../lib/baserow'
import { summarizeDiff } from '../lib/diff'

const STATUS_STYLES = {
  pending: 'text-gray-400',
  running: 'text-blue-600',
  success: 'text-emerald-600',
  error: 'text-red-600',
}

function buildActions(diffRows) {
  const actions = []
  diffRows.forEach((row, index) => {
    if (row.category === 'new' && row.include) {
      actions.push({ type: 'create', index, row, label: `Create ${row.key}` })
    } else if (row.category === 'changed' && row.include) {
      actions.push({ type: 'update', index, row, label: `Update ${row.key}` })
    } else if (row.category === 'missing' && row.markDelete) {
      actions.push({ type: 'delete', index, row, label: `Delete ${row.key}` })
    }
  })
  return actions
}

export default function StepCommit({ token, tableId, diffRows, mapping }) {
  const [statuses, setStatuses] = useState({})
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  const summary = summarizeDiff(diffRows)
  const actions = buildActions(diffRows)

  const handleCommit = async () => {
    setRunning(true)
    setDone(false)
    const initial = {}
    actions.forEach((_, i) => {
      initial[i] = 'pending'
    })
    setStatuses(initial)

    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i]
      setStatuses((prev) => ({ ...prev, [i]: 'running' }))
      try {
        if (action.type === 'create') {
          await createRow(token, tableId, action.row.fieldValues)
        } else if (action.type === 'update') {
          await updateRow(token, tableId, action.row.baserowRow.id, action.row.fieldValues)
        } else if (action.type === 'delete') {
          await deleteRow(token, tableId, action.row.baserowRow.id)
        }
        setStatuses((prev) => ({ ...prev, [i]: 'success' }))
      } catch (err) {
        setStatuses((prev) => ({ ...prev, [i]: 'error', [`${i}-error`]: err.message }))
      }
    }

    setRunning(false)
    setDone(true)
  }

  const completedCount = Object.values(statuses).filter(
    (s) => s === 'success' || s === 'error',
  ).length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3">
          <p className="text-2xl font-semibold text-emerald-700">{summary.new}</p>
          <p className="text-xs text-emerald-600">New rows</p>
        </div>
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-2xl font-semibold text-amber-700">{summary.changed}</p>
          <p className="text-xs text-amber-600">Updates</p>
        </div>
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-2xl font-semibold text-red-700">{summary.deletions}</p>
          <p className="text-xs text-red-600">Deletions</p>
        </div>
      </div>

      {actions.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing to commit — no rows are selected.</p>
      ) : (
        <button
          onClick={handleCommit}
          disabled={running}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? `Committing… (${completedCount}/${actions.length})` : 'Confirm & Commit'}
        </button>
      )}

      {(running || done) && actions.length > 0 && (
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-blue-600 transition-all"
              style={{ width: `${(completedCount / actions.length) * 100}%` }}
            />
          </div>
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 max-h-80 overflow-auto">
            {actions.map((action, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{action.label}</span>
                <span className={`text-xs font-medium ${STATUS_STYLES[statuses[i] || 'pending']}`}>
                  {statuses[i] === 'error'
                    ? `Error: ${statuses[`${i}-error`] || 'failed'}`
                    : statuses[i] || 'pending'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {done && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          Sync complete.
        </div>
      )}
    </div>
  )
}
