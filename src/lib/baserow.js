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

// Field types that are server-computed and rejected by the API if written to.
// (`link_row` used to be excluded here too, but Baserow's row-write API
// accepts an array of primary-field text values for link fields — matched
// against the linked table's rows — so it's safe to offer for mapping.)
export const UNMAPPABLE_FIELD_TYPES = new Set([
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

export function isLinkRowField(field) {
  return field.type === 'link_row'
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
