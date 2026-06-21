import { useState } from 'react'
import Papa from 'papaparse'
import { isMappableField, isLinkRowField } from '../lib/baserow'

function autoMatch(headers, fields) {
  const mapping = {}
  for (const header of headers) {
    const match = fields.find((field) => field.name.toLowerCase() === header.toLowerCase())
    if (match) mapping[header] = match.id
  }
  return mapping
}

function linkFieldLabel(field, linkedTableInfo) {
  const info = linkedTableInfo[field.link_row_table_id]
  if (!info) return `${field.name} (link to table)`
  return `${field.name} (link to ${info.name} — matches ${info.primaryFieldName})`
}

export default function StepUploadMap({
  fields,
  linkedTableInfo = {},
  csvHeaders,
  csvRows,
  mapping,
  matchKeyFieldId,
  onChange,
}) {
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')

  const mappableFields = fields.filter(isMappableField)
  const skippedFields = fields.filter((f) => !isMappableField(f))

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
        const newMapping = autoMatch(headers, mappableFields)
        onChange({
          csvHeaders: headers,
          csvRows: results.data,
          mapping: newMapping,
          matchKeyFieldId: matchKeyFieldId || newMapping[headers[0]] || '',
        })
      },
      error: (err) => setError(err.message),
    })
  }

  const handleMappingChange = (header, fieldId) => {
    onChange({ mapping: { ...mapping, [header]: fieldId } })
  }

  const mappedFieldIds = Object.values(mapping).filter(Boolean)
  // A link_row field's value is a set of related rows, not a single scalar,
  // so it can't double as the unique identifier the diff matches rows by.
  const matchKeyCandidateIds = mappedFieldIds.filter((fieldId) => {
    const field = fields.find((f) => String(f.id) === String(fieldId))
    return field && !isLinkRowField(field)
  })

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">CSV File</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="block w-full text-sm text-gray-700 border border-gray-300 rounded-md cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium hover:file:bg-blue-100"
        />
        {fileName && <p className="mt-1 text-xs text-gray-500">Loaded {fileName} — {csvRows.length} rows</p>}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {csvHeaders.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">Map CSV columns to Baserow fields</p>
          {skippedFields.length > 0 && (
            <p className="text-xs text-gray-500">
              Not available for mapping: {skippedFields.map((f) => f.name).join(', ')}. These are
              computed by Baserow and can't be written to.
            </p>
          )}
          <p className="text-xs text-gray-500">
            Fields labeled <span className="font-medium">(link to …)</span> are relationships to
            another table — map a column to one to set links by name (comma-separate multiple
            names). The label shows which table and which field of that table the name has to
            match. A name with no match fails at commit time rather than creating a new row.
            Leave a link field unmapped to keep its existing links untouched.
          </p>
          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2">CSV Column</th>
                  <th className="px-4 py-2">Baserow Field</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {csvHeaders.map((header) => (
                  <tr key={header}>
                    <td className="px-4 py-2 font-medium text-gray-800">{header}</td>
                    <td className="px-4 py-2">
                      <select
                        value={mapping[header] || ''}
                        onChange={(e) => handleMappingChange(header, e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">— Do not map —</option>
                        {mappableFields.map((field) => (
                          <option key={field.id} value={field.id}>
                            {isLinkRowField(field) ? linkFieldLabel(field, linkedTableInfo) : field.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Match key (unique identifier)
            </label>
            <select
              value={matchKeyFieldId}
              onChange={(e) => onChange({ matchKeyFieldId: e.target.value })}
              className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select a field —</option>
              {matchKeyCandidateIds.map((fieldId) => {
                const field = fields.find((f) => String(f.id) === String(fieldId))
                return (
                  <option key={fieldId} value={fieldId}>
                    {field ? field.name : fieldId}
                  </option>
                )
              })}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
