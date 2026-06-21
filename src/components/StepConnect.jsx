import { useState } from 'react'
import { fetchTableFields, fetchAllTables, isLinkRowField } from '../lib/baserow'
import { TABLE_ORDER, TABLE_LABELS, autoMapSlots } from '../lib/sync'

const TABLE_HINTS = {
  contacts: 'One row per person. Key: Email.',
  units: 'One row per unit (e.g. "Pack 0070"). Key: Unit name.',
  positions: 'Catalog of role types. Key: Position name.',
  assignments: 'The join — one row per roster line. Links: Contact, Unit, Position.',
}

export default function StepConnect({ token, setToken, plan, updateTable }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleConnect = async () => {
    setError('')
    const active = TABLE_ORDER.filter((k) => plan.tables[k].enabled && plan.tables[k].tableId)
    if (!token) {
      setError('An API token is required.')
      return
    }
    if (active.length === 0) {
      setError('Enable and enter a Table ID for at least one table.')
      return
    }
    setLoading(true)
    try {
      const allTables = await fetchAllTables(token)
      const nameById = new Map(allTables.map((t) => [t.id, t.name]))

      for (const tableKey of active) {
        const fields = await fetchTableFields(token, plan.tables[tableKey].tableId)
        const primary = fields.find((f) => f.primary)

        // Resolve what each link field points at, so the mapping step can show
        // "Contact link matches Contacts' Email" etc.
        const linkedTableInfo = {}
        const linkedIds = [...new Set(fields.filter(isLinkRowField).map((f) => f.link_row_table_id))]
        for (const id of linkedIds) {
          const linkedFields = await fetchTableFields(token, id)
          const lp = linkedFields.find((f) => f.primary)
          linkedTableInfo[id] = {
            name: nameById.get(id) || `Table ${id}`,
            primaryFieldName: lp ? lp.name : 'primary field',
          }
        }

        updateTable(tableKey, {
          fields,
          primaryFieldId: primary ? String(primary.id) : '',
          primaryFieldName: primary ? primary.name : '',
          linkedTableInfo,
          slots: autoMapSlots(tableKey, fields),
          connected: true,
        })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Baserow API Token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste your Baserow database token"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          Kept in memory only — never stored. Enter a Table ID for each table you want to sync this
          run; uncheck any you want to skip.
        </p>
      </div>

      <div className="space-y-3">
        {TABLE_ORDER.map((tableKey) => {
          const t = plan.tables[tableKey]
          return (
            <div key={tableKey} className="rounded-md border border-gray-200 p-3">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={t.enabled}
                  onChange={(e) => updateTable(tableKey, { enabled: e.target.checked, connected: false })}
                />
                <div className="w-44">
                  <p className="text-sm font-semibold text-gray-800">{TABLE_LABELS[tableKey]}</p>
                  <p className="text-xs text-gray-400">{TABLE_HINTS[tableKey]}</p>
                </div>
                <input
                  type="text"
                  value={t.tableId}
                  disabled={!t.enabled}
                  onChange={(e) => updateTable(tableKey, { tableId: e.target.value.trim(), connected: false })}
                  placeholder="Table ID"
                  className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {t.connected && (
                  <span className="text-xs text-emerald-600">
                    ✓ {t.fields.length} fields · primary: <span className="font-medium">{t.primaryFieldName || '—'}</span>
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={handleConnect}
        disabled={loading}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Connecting…' : 'Connect'}
      </button>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {plan.tables.contacts.connected && plan.tables.contacts.primaryFieldName && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          Contacts' primary field is <span className="font-semibold">{plan.tables.contacts.primaryFieldName}</span>.
          {' '}
          {/Email/i.test(plan.tables.contacts.primaryFieldName)
            ? 'The Assignment → Contact link can match on Email directly.'
            : 'Heads up: the Contact link resolves against this field, not Email — confirm the Contact slot in the next step maps to the field that holds the email.'}
        </div>
      )}
    </div>
  )
}
