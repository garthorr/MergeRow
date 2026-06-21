// Thin wrapper around the Baserow REST API. All requests go through the
// `/api/` path, which Nginx proxies to https://api.baserow.io in production
// (see nginx.conf) so the browser never has to deal with CORS.

// Baserow's row endpoints key fields as `field_<id>` rather than the bare
// field ID — this keeps every write operation addressed by field ID rather
// than by (renameable) field name.
export function fieldKey(fieldId) {
  return `field_${fieldId}`
}

export function toApiFields(fieldValuesByFieldId) {
  const payload = {}
  for (const [fieldId, value] of Object.entries(fieldValuesByFieldId)) {
    payload[fieldKey(fieldId)] = value
  }
  return payload
}

// Field types that can't be safely written from a flat CSV string value.
// `link_row` is excluded specifically so relationships to other tables (e.g.
// a contact's linked position) are never overwritten by a sync — Baserow
// expects an array of related row IDs for link fields, not raw text, and a
// field that's never offered for mapping is a field that's never touched.
// The rest are server-computed and rejected by the API if written to.
export const UNMAPPABLE_FIELD_TYPES = new Set([
  'link_row',
  'formula',
  'lookup',
  'count',
  'rollup',
  'created_on',
  'last_modified',
])

export function isMappableField(field) {
  return !UNMAPPABLE_FIELD_TYPES.has(field.type)
}

function authHeaders(token) {
  return {
    Authorization: `Token ${token}`,
    'Content-Type': 'application/json',
  }
}

async function parseErrorMessage(response) {
  try {
    const body = await response.json()
    return body.error || body.detail || JSON.stringify(body)
  } catch {
    return response.statusText
  }
}

export async function fetchTableInfo(token, tableId) {
  const response = await fetch(`/api/database/tables/${tableId}/`, {
    headers: authHeaders(token),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch table: ${await parseErrorMessage(response)}`)
  }
  return response.json()
}

export async function fetchTableFields(token, tableId) {
  const response = await fetch(`/api/database/fields/table/${tableId}/`, {
    headers: authHeaders(token),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch fields: ${await parseErrorMessage(response)}`)
  }
  return response.json()
}

export async function fetchAllRows(token, tableId, { pageSize = 100 } = {}) {
  const rows = []
  let page = 1
  while (true) {
    const url = `/api/database/rows/table/${tableId}/?page=${page}&size=${pageSize}&user_field_names=false`
    const response = await fetch(url, { headers: authHeaders(token) })
    if (!response.ok) {
      throw new Error(`Failed to fetch rows: ${await parseErrorMessage(response)}`)
    }
    const data = await response.json()
    rows.push(...data.results)
    if (!data.next) break
    page += 1
  }
  return rows
}

// `fieldValuesByFieldId` is `{ [fieldId]: value }`; it is converted to the
// `field_<id>` keys Baserow expects before being sent.
export async function createRow(token, tableId, fieldValuesByFieldId) {
  const response = await fetch(`/api/database/rows/table/${tableId}/?user_field_names=false`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(toApiFields(fieldValuesByFieldId)),
  })
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }
  return response.json()
}

export async function updateRow(token, tableId, rowId, fieldValuesByFieldId) {
  const response = await fetch(
    `/api/database/rows/table/${tableId}/${rowId}/?user_field_names=false`,
    {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(toApiFields(fieldValuesByFieldId)),
    },
  )
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }
  return response.json()
}

export async function deleteRow(token, tableId, rowId) {
  const response = await fetch(`/api/database/rows/table/${tableId}/${rowId}/`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
  if (!response.ok && response.status !== 204) {
    throw new Error(await parseErrorMessage(response))
  }
}
