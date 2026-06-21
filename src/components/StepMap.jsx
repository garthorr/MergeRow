import { useState } from 'react'
import Papa from 'papaparse'
import { isLinkRowField, isMappableField } from '../lib/baserow'
import { autoDetectRoles, ROSTER_ROLES, ROLE_LABELS } from '../lib/normalize'
import { TABLE_ORDER, TABLE_LABELS, TABLE_SLOTS } from '../lib/sync'

export default function StepMap({
  plan,
  updateTable,
  csvHeaders,
  csvRows,
  roleByHeader,
  onCsv,
  setRoleByHeader,
}) {
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setFileName(file.name)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || []
        if (headers.length === 0) {
          setError('No columns detected in this CSV.')
          return
        }
        onCsv({ headers, rows: results.data, roles: autoDetectRoles(headers) })
      },
      error: (err) => setError(err.message),
    })
  }

  const setRole = (header, role) => setRoleByHeader({ ...roleByHeader, [header]: role })

  const setSlot = (tableKey, slotKey, fieldId) =>
    updateTable(tableKey, { slots: { ...plan.tables[tableKey].slots, [slotKey]: fieldId } })

  const setAutoCreate = (slotKey, checked) =>
    updateTable('assignments', {
      autoCreate: { ...plan.tables.assignments.autoCreate, [slotKey]: checked },
    })

  const activeTableKeys = TABLE_ORDER.filter(
    (k) => plan.tables[k].enabled && plan.tables[k].tableId && plan.tables[k].connected,
  )

  const linkLabel = (table, field) => {
    const info = table.linkedTableInfo[field.link_row_table_id]
    return info ? `${field.name} → ${info.name} (matches ${info.primaryFieldName})` : field.name
  }

  return (
    <div className="space-y-8">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Roster CSV</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="block w-full text-sm text-gray-700 border border-gray-300 rounded-md cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium hover:file:bg-blue-100"
        />
        {fileName && <p className="mt-1 text-xs text-gray-500">Loaded {fileName} — {csvRows.length} rows</p>}
        {error && (
          <div className="mt-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </div>

      {csvHeaders.length > 0 && (
        <>
          <section className="space-y-2">
            <p className="text-sm font-medium text-gray-700">1 · Roster columns → roles</p>
            <p className="text-xs text-gray-500">
              Each roster column is assigned a role. These feed the per-table mappings below (e.g.{' '}
              <span className="font-medium">Email</span> dedups contacts and resolves the assignment's
              Contact link). Auto-detected — adjust if a header didn't match.
            </p>
            <div className="overflow-hidden rounded-md border border-gray-200">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {csvHeaders.map((header) => (
                    <tr key={header}>
                      <td className="px-4 py-1.5 font-medium text-gray-800 w-1/2">{header}</td>
                      <td className="px-4 py-1.5">
                        <select
                          value={roleByHeader[header] || ''}
                          onChange={(e) => setRole(header, e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">— ignore —</option>
                          {ROSTER_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4">
            <p className="text-sm font-medium text-gray-700">2 · Target tables → fields</p>
            {activeTableKeys.map((tableKey) => {
              const table = plan.tables[tableKey]
              const fieldOptions = (slot) =>
                table.fields.filter((f) =>
                  slot.link ? isLinkRowField(f) : isMappableField(f) && !isLinkRowField(f),
                )
              return (
                <div key={tableKey} className="rounded-md border border-gray-200">
                  <div className="bg-gray-50 px-4 py-2 text-xs font-semibold uppercase text-gray-500">
                    {TABLE_LABELS[tableKey]}
                  </div>
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-100">
                      {TABLE_SLOTS[tableKey].map((slot) => (
                        <tr key={slot.key}>
                          <td className="px-4 py-1.5 text-gray-700 w-1/2">
                            {slot.label}
                            {slot.optional && <span className="ml-1 text-xs text-gray-400">(optional)</span>}
                          </td>
                          <td className="px-4 py-1.5">
                            <select
                              value={table.slots[slot.key] || ''}
                              onChange={(e) => setSlot(tableKey, slot.key, e.target.value)}
                              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">— not mapped —</option>
                              {fieldOptions(slot).map((f) => (
                                <option key={f.id} value={String(f.id)}>
                                  {slot.link ? linkLabel(table, f) : f.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {tableKey === 'assignments' && (
                    <div className="border-t border-gray-100 px-4 py-2 space-y-1">
                      <p className="text-xs text-gray-500">
                        Auto-create a linked row when a name has no match. On for catalogs that
                        legitimately grow; off for Contact (an unmatched contact is a typo — fail
                        that row instead of spawning a junk contact).
                      </p>
                      {[
                        ['unit', 'Auto-create missing Units'],
                        ['position', 'Auto-create missing Positions'],
                        ['contact', 'Auto-create missing Contacts'],
                      ].map(([slotKey, label]) => (
                        <label key={slotKey} className="flex items-center gap-1.5 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={table.autoCreate?.[slotKey] === true}
                            onChange={(e) => setAutoCreate(slotKey, e.target.checked)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        </>
      )}
    </div>
  )
}
