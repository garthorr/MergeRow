// The normalize / fan-out layer: takes the single denormalized roster sheet
// (one row per position-assignment, with person/unit/position repeated across
// rows) and projects it into the four entity sets the sync targets.
//
// Identity rules (confirmed before build):
//   Contacts   — keyed by Email (case/whitespace-insensitive)
//   Units      — keyed by full Unit name; blank Unit => district-level, no Unit
//   Positions  — keyed by Position name
//   Assignment — one per roster row, keyed by the synthesized triple
//                `email | unit | position`. A role change is therefore a
//                delete + create at the assignment level, never an edit.

import { norm } from './diff'

// Semantic roster columns. The sheet's headers are matched to these so the
// rest of the pipeline never depends on exact header spelling.
export const ROSTER_ROLES = [
  'email',
  'firstName',
  'middleName',
  'lastName',
  'unit',
  'charteredOrg',
  'district',
  'program',
  'position',
  'directContactLeader',
  'regExpDate',
]

export const ROLE_LABELS = {
  email: 'Email',
  firstName: 'First name',
  middleName: 'Middle name',
  lastName: 'Last name',
  unit: 'Unit',
  charteredOrg: 'Chartered org',
  district: 'District',
  program: 'Program',
  position: 'Position',
  directContactLeader: 'Direct contact leader',
  regExpDate: 'Registration expiration date',
}

const HEADER_SYNONYMS = {
  email: ['email', 'e-mail'],
  firstName: ['first_name', 'first name', 'first'],
  middleName: ['middle_name', 'middle name', 'middle'],
  lastName: ['last_name', 'last name', 'last'],
  unit: ['unit'],
  charteredOrg: ['chartered_org_name', 'chartered org', 'chartered organization', 'chartered_org'],
  district: ['district'],
  program: ['program'],
  position: ['position'],
  directContactLeader: ['direct_contact_leader', 'direct contact leader'],
  regExpDate: [
    'registration_expiration_date',
    'registration expiration date',
    'registration expiration',
    'expiration',
  ],
}

// Best-effort header -> role guess; the user can correct it in the wizard.
export function autoDetectRoles(headers) {
  const roleByHeader = {}
  for (const header of headers) {
    const hn = norm(header)
    for (const role of ROSTER_ROLES) {
      if (HEADER_SYNONYMS[role].includes(hn)) {
        roleByHeader[header] = role
        break
      }
    }
  }
  return roleByHeader
}

export function composeFullName({ firstName, middleName, lastName }) {
  return [firstName, middleName, lastName].map((s) => (s || '').trim()).filter(Boolean).join(' ')
}

// roleByHeader: { [csvHeader]: role }. Returns the four entity arrays plus a
// list of data-quality warnings that should be surfaced but must not abort.
//
// mergeByEmail (default true): collapse every row sharing an email into one
// contact (keyed on email). When false, each distinct email+name is kept as a
// separate contact (keyed `email | first last`) — so two people who share an
// email aren't fused into one. Either way the conflict is reported as a
// warning.
export function normalizeRoster(csvRows, roleByHeader, { mergeByEmail = true } = {}) {
  const headerByRole = {}
  for (const [header, role] of Object.entries(roleByHeader)) {
    if (role && !headerByRole[role]) headerByRole[role] = header
  }
  const get = (row, role) => {
    const header = headerByRole[role]
    const v = header ? row[header] : ''
    return v === null || v === undefined ? '' : String(v).trim()
  }

  const contacts = new Map()
  const namesByEmail = new Map()
  const units = new Map()
  const positions = new Map()
  const assignments = new Map()

  let collapsedAssignments = 0
  const blankEmailRows = []

  for (const row of csvRows) {
    const email = get(row, 'email')
    const emailKey = norm(email)
    const firstName = get(row, 'firstName')
    const middleName = get(row, 'middleName')
    const lastName = get(row, 'lastName')
    const unit = get(row, 'unit')
    const unitKey = norm(unit)
    const position = get(row, 'position')
    const positionKey = norm(position)
    const charteredOrg = get(row, 'charteredOrg')
    const district = get(row, 'district')
    const program = get(row, 'program')
    const directContactLeader = get(row, 'directContactLeader')
    const regExpDate = get(row, 'regExpDate')
    const displayName = composeFullName({ firstName, middleName, lastName })

    // No email => no stable contact/assignment key. Don't guess; flag it.
    if (!emailKey) {
      if (position || unit || displayName) blankEmailRows.push(displayName || position || '(blank row)')
      continue
    }

    const contactKey = mergeByEmail ? emailKey : `${emailKey}|${norm(`${firstName} ${lastName}`)}`
    if (!contacts.has(contactKey)) {
      contacts.set(contactKey, {
        key: contactKey,
        email,
        firstName,
        middleName,
        lastName,
        fullName: displayName,
      })
    }
    if (!namesByEmail.has(emailKey)) namesByEmail.set(emailKey, { email, names: new Set() })
    if (displayName) namesByEmail.get(emailKey).names.add(displayName)

    // Blank unit is a valid district-level assignment — never materialize a
    // blank Unit row.
    if (unitKey && !units.has(unitKey)) {
      units.set(unitKey, { key: unitKey, name: unit, charteredOrg, district })
    }
    if (positionKey && !positions.has(positionKey)) {
      positions.set(positionKey, { key: positionKey, name: position })
    }

    const assignKey = `${emailKey}|${unitKey}|${positionKey}`
    if (assignments.has(assignKey)) {
      collapsedAssignments += 1
      continue
    }
    assignments.set(assignKey, {
      key: assignKey,
      email,
      contactName: displayName,
      unitName: unit,
      positionName: position,
      program,
      directContactLeader,
      regExpDate,
    })
  }

  const warnings = []
  for (const { email, names } of namesByEmail.values()) {
    const distinct = [...names]
    if (distinct.length > 1) {
      warnings.push({ type: 'email-name-conflict', email, names: distinct })
    }
  }
  if (collapsedAssignments > 0) {
    warnings.push({ type: 'duplicate-assignments', count: collapsedAssignments })
  }
  if (blankEmailRows.length > 0) {
    warnings.push({ type: 'blank-email', count: blankEmailRows.length, sample: blankEmailRows.slice(0, 5) })
  }

  return {
    contacts: [...contacts.values()],
    units: [...units.values()],
    positions: [...positions.values()],
    assignments: [...assignments.values()],
    warnings,
  }
}
