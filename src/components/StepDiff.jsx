import { useEffect, useState } from 'react'
import { fetchAllRows, fieldKey } from '../lib/baserow'
import { buildDiff, findDuplicateBaserowKeys, formatFieldValue } from '../lib/diff'

const CATEGORY_STYLES = {
  new: 'bg-emerald-50',
  changed: 'bg-amber-50',
  unchanged: 'bg-white',
  missing: 'bg-red-50',
}

const CATEGORY_LABELS = {
  new: 'New',
  changed: 'Changed',
  unchanged: 'Unchanged',
  missing: 'Missing',
}

function findField(fields, fieldId) {
  return fields.find((f) => String(f.id) === String(fieldId))
}

function fieldName(fields, fieldId) {
  const field = findField(fields, fieldId)
  return field ? field.name : fieldId
}

export default function StepDiff({
  token,
  tableId,
  fields,
  mapping,
  matchKeyFieldId,
  csvRows,
  diffRows,
  setDiffRows,
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [duplicateKeys, setDuplicateKeys] = useState([])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError('')
      try {
        const baserowRows = await fetchAllRows(token, tableId)
        if (cancelled) return
        setDuplicateKeys(findDuplicateBaserowKeys(baserowRows, matchKeyFieldId))
        const rows = buildDiff({ csvRows, mapping, matchKeyFieldId, baserowRows, fields })
        setDiffRows(rows)
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

  const toggleInclude = (index) => {
    setDiffRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, include: !row.include } : row)),
    )
  }

  const toggleDelete = (index) => {
    setDiffRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, markDelete: !row.markDelete } : row)),
    )
  }

  const mappedFieldIds = Object.values(mapping).filter(Boolean)

  if (loading) {
    return <p className="text-sm text-gray-500">Fetching existing rows from Baserow…</p>
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {duplicateKeys.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Warning:</span> {duplicateKeys.length} duplicate match-key
          value{duplicateKeys.length === 1 ? '' : 's'} found in Baserow (e.g.{' '}
          <span className="font-mono">{duplicateKeys.slice(0, 3).join(', ')}</span>
          {duplicateKeys.length > 3 ? ', …' : ''}). Rows sharing a key are collapsed, so the diff
          and any deletions may not reflect every row. Pick a unique field as the match key.
        </div>
      )}

      <div className="flex gap-4 text-xs">
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-sm border border-gray-300 ${CATEGORY_STYLES[key]}`} />
            {label}
          </span>
        ))}
      </div>

      <div className="overflow-auto rounded-md border border-gray-200 max-h-[28rem]">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase sticky top-0">
            <tr>
              <th className="px-3 py-2">Include</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {diffRows.map((row, index) => (
              <tr key={`${row.category}-${row.key}-${index}`} className={CATEGORY_STYLES[row.category]}>
                <td className="px-3 py-2 align-top">
                  {row.category === 'missing' ? (
                    <label className="flex items-center gap-1.5 text-xs text-red-700">
                      <input
                        type="checkbox"
                        checked={row.markDelete}
                        onChange={() => toggleDelete(index)}
                      />
                      Delete
                    </label>
                  ) : (
                    <input
                      type="checkbox"
                      checked={row.include}
                      disabled={row.category === 'unchanged'}
                      onChange={() => toggleInclude(index)}
                    />
                  )}
                </td>
                <td className="px-3 py-2 align-top font-medium">{CATEGORY_LABELS[row.category]}</td>
                <td className="px-3 py-2 align-top font-mono text-xs">{row.key || '—'}</td>
                <td className="px-3 py-2 align-top">
                  {row.category === 'changed' ? (
                    <ul className="space-y-0.5">
                      {Object.entries(row.changes).map(([fieldId, { oldValue, newValue }]) => (
                        <li key={fieldId} className="text-xs">
                          <span className="font-medium">{fieldName(fields, fieldId)}:</span>{' '}
                          <span className="text-red-600 line-through">{oldValue || '∅'}</span>{' '}
                          →{' '}
                          <span className="text-emerald-700">{newValue || '∅'}</span>
                        </li>
                      ))}
                    </ul>
                  ) : row.category === 'missing' ? (
                    <span className="text-xs text-gray-600">
                      {mappedFieldIds
                        .map((fieldId) =>
                          formatFieldValue(findField(fields, fieldId), row.baserowRow[fieldKey(fieldId)]),
                        )
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-600">
                      {mappedFieldIds
                        .map((fieldId) => formatFieldValue(findField(fields, fieldId), row.fieldValues[fieldId]))
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
