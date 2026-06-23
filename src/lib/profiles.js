// Saved sync profiles — the non-secret config that's tedious to re-enter for a
// recurring sync: which tables map to which roles, the column→role and
// slot→field mappings, and the auto-create toggles. The API token is NEVER
// persisted; it stays in component state and must be re-entered each session.

import { TABLE_ORDER } from './sync'

const KEY = 'mergerow.profiles'

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* storage unavailable / quota — non-fatal */
  }
}

export function listProfileNames() {
  return Object.keys(readAll()).sort()
}

// Snapshot the current plan + role mapping into a token-free profile.
export function snapshotProfile(plan, roleByHeader) {
  const tables = {}
  for (const k of TABLE_ORDER) {
    const t = plan.tables[k]
    tables[k] = {
      enabled: t.enabled,
      tableId: t.tableId,
      slots: t.slots || {},
      autoCreate: t.autoCreate || {},
    }
  }
  return { tables, roleByHeader: roleByHeader || {} }
}

export function saveProfile(name, plan, roleByHeader) {
  const all = readAll()
  all[name] = snapshotProfile(plan, roleByHeader)
  writeAll(all)
}

export function loadProfile(name) {
  return readAll()[name] || null
}

export function deleteProfile(name) {
  const all = readAll()
  delete all[name]
  writeAll(all)
}
