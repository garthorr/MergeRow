import { useState } from 'react'
import { fetchTableFields, fetchAllTables, isLinkRowField } from '../lib/baserow'

export default function StepConnect({ token, tableId, onChange, onConnected }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState(null)

  const handleConnect = async () => {
    setError('')
    setFields(null)
    if (!token || !tableId) {
      setError('Both an API token and a table ID are required.')
      return
    }
    setLoading(true)
    try {
      // Database tokens are scoped to row/field data only — table metadata
      // endpoints (like this table's own display name) require JWT/session
      // auth. `all-tables/` is explicitly token-compatible though, so it can
      // resolve the *other* tables that link_row fields point to.
      const fieldList = await fetchTableFields(token, tableId)
      const tables = await fetchAllTables(token)
      const tableNameById = new Map(tables.map((t) => [t.id, t.name]))

      const linkedTableIds = [
        ...new Set(fieldList.filter(isLinkRowField).map((f) => f.link_row_table_id)),
      ]
      const linkedFieldLists = await Promise.all(
        linkedTableIds.map((id) => fetchTableFields(token, id)),
      )
      const linkedTableInfo = {}
      linkedTableIds.forEach((id, i) => {
        const primaryField = linkedFieldLists[i].find((f) => f.primary)
        linkedTableInfo[id] = {
          name: tableNameById.get(id) || `Table ${id}`,
          primaryFieldName: primaryField ? primaryField.name : 'primary field',
        }
      })

      setFields(fieldList)
      onConnected({ fields: fieldList, linkedTableInfo })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Baserow API Token
        </label>
        <input
          type="password"
          value={token}
          onChange={(e) => onChange({ token: e.target.value })}
          placeholder="Paste your Baserow database token"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Table ID</label>
        <input
          type="text"
          value={tableId}
          onChange={(e) => onChange({ tableId: e.target.value })}
          placeholder="e.g. 1234"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <button
        onClick={handleConnect}
        disabled={loading}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Connecting…' : 'Connect'}
      </button>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {fields && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3">
          <p className="text-sm font-medium text-emerald-800 mb-2">
            Connected — {fields.length} field{fields.length === 1 ? '' : 's'} found
          </p>
          <ul className="text-sm text-emerald-700 space-y-0.5">
            {fields.map((field) => (
              <li key={field.id}>
                {field.name} <span className="text-emerald-500">({field.type})</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-emerald-600">
            Link-to-table fields will show which table and field they match against in Step 2.
          </p>
        </div>
      )}
    </div>
  )
}
