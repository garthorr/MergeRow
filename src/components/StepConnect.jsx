import { useState } from 'react'
import { fetchTableFields, fetchAllTables, isLinkRowField } from '../lib/baserow'
import { TABLE_ORDER, TABLE_LABELS, autoMapSlots } from '../lib/sync'
import { listProfileNames, saveProfile, loadProfile, deleteProfile } from '../lib/profiles'

const TABLE_HINTS = {
  contacts: 'One row per person. Key: Email.',
  units: 'One row per unit (e.g. "Pack 0070"). Key: Unit name.',
  positions: 'Catalog of role types. Key: Position name.',
  assignments: 'The join — one row per roster line. Links: Contact, Unit, Position.',
}

// Used to pre-select a table for each role from the fetched table list.
const NAME_HINT = {
  contacts: /contact/i,
  units: /unit/i,
  positions: /position/i,
  assignments: /assign/i,
}

export default function StepConnect({ token, setToken, plan, updateTable, roleByHeader, setRoleByHeader }) {
  const [loading, setLoading] = useState(false)
  const [loadingTables, setLoadingTables] = useState(false)
  const [error, setError] = useState('')
  const [availableTables, setAvailableTables] = useState([])
  const [profiles, setProfiles] = useState(listProfileNames())
  const [profileName, setProfileName] = useState('')

  const loadTables = async () => {
    setError('')
    if (!token) {
      setError('Enter an API token first.')
      return
    }
    setLoadingTables(true)
    try {
      const tables = await fetchAllTables(token)
      setAvailableTables(tables)
      // Pre-fill any unset role with a name-matched table.
      for (const tableKey of TABLE_ORDER) {
        if (plan.tables[tableKey].tableId) continue
        const match = tables.find((t) => NAME_HINT[tableKey].test(t.name))
        if (match) updateTable(tableKey, { tableId: String(match.id), connected: false })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingTables(false)
    }
  }

  const handleConnect = async () => {
    setError('')
    const active = TABLE_ORDER.filter((k) => plan.tables[k].enabled && plan.tables[k].tableId)
    if (!token) return setError('An API token is required.')
    if (active.length === 0) return setError('Enable and choose a table for at least one role.')
    setLoading(true)
    try {
      const allTables = availableTables.length ? availableTables : await fetchAllTables(token)
      const nameById = new Map(allTables.map((t) => [t.id, t.name]))

      for (const tableKey of active) {
        const fields = await fetchTableFields(token, plan.tables[tableKey].tableId)
        const primary = fields.find((f) => f.primary)

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
          // Preserve any slots from a loaded profile / manual edit; auto-map fills gaps.
          slots: { ...autoMapSlots(tableKey, fields), ...(plan.tables[tableKey].slots || {}) },
          connected: true,
        })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const applyProfile = (name) => {
    const p = loadProfile(name)
    if (!p) return
    for (const tableKey of TABLE_ORDER) {
      const t = p.tables?.[tableKey]
      if (!t) continue
      updateTable(tableKey, {
        enabled: t.enabled,
        tableId: t.tableId,
        slots: t.slots || {},
        autoCreate: t.autoCreate || {},
        connected: false,
      })
    }
    if (p.roleByHeader) setRoleByHeader(p.roleByHeader)
    setProfileName(name)
  }

  const handleSave = () => {
    const name = (profileName || '').trim()
    if (!name) return setError('Name the profile before saving.')
    saveProfile(name, plan, roleByHeader)
    setProfiles(listProfileNames())
  }

  const handleDelete = () => {
    if (!profileName) return
    deleteProfile(profileName)
    setProfiles(listProfileNames())
    setProfileName('')
  }

  const tableSelect = (tableKey) => {
    const t = plan.tables[tableKey]
    if (availableTables.length === 0) {
      return (
        <input
          type="text"
          value={t.tableId}
          disabled={!t.enabled}
          onChange={(e) => updateTable(tableKey, { tableId: e.target.value.trim(), connected: false })}
          placeholder="Table ID"
          className="w-40 rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )
    }
    return (
      <select
        value={t.tableId}
        disabled={!t.enabled}
        onChange={(e) => updateTable(tableKey, { tableId: e.target.value, connected: false })}
        className="w-56 rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">— choose a table —</option>
        {availableTables.map((tbl) => (
          <option key={tbl.id} value={String(tbl.id)}>
            {tbl.name} (#{tbl.id})
          </option>
        ))}
      </select>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Baserow API Token</label>
        <div className="flex gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your Baserow database token"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={loadTables}
            disabled={loadingTables}
            className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingTables ? 'Loading…' : 'Load tables'}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Kept in memory only — never stored. Load tables to pick by name, or type IDs directly.
        </p>
      </div>

      {/* Profiles */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
        <span className="text-xs font-medium text-gray-500">Profile:</span>
        <select
          value={profiles.includes(profileName) ? profileName : ''}
          onChange={(e) => e.target.value && applyProfile(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">— load saved —</option>
          {profiles.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          placeholder="Name to save as"
          className="w-40 rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={handleSave} className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
          Save
        </button>
        {profiles.includes(profileName) && (
          <button onClick={handleDelete} className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
            Delete
          </button>
        )}
        <span className="text-xs text-gray-400">Tables &amp; mappings only — never the token.</span>
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
                {tableSelect(tableKey)}
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
