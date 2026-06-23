import { describe, it, expect } from 'vitest'
import { autoDetectRoles, normalizeRoster, composeFullName } from './normalize'

const HEADERS = [
  'District', 'Unit', 'Chartered_Org_Name', 'First_Name', 'Middle_Name', 'Last_Name',
  'Program', 'Email', 'Position', 'Direct_Contact_Leader', 'Registration_Expiration_Date',
]
const roles = autoDetectRoles(HEADERS)

function row(over) {
  return {
    District: 'Heart of Dallas 24', Unit: '', Chartered_Org_Name: '', First_Name: '', Middle_Name: '',
    Last_Name: '', Program: '', Email: '', Position: '', Direct_Contact_Leader: 'NO',
    Registration_Expiration_Date: '', ...over,
  }
}

describe('autoDetectRoles', () => {
  it('maps every real roster header to a role', () => {
    expect(roles).toMatchObject({
      District: 'district', Unit: 'unit', Chartered_Org_Name: 'charteredOrg',
      First_Name: 'firstName', Middle_Name: 'middleName', Last_Name: 'lastName',
      Program: 'program', Email: 'email', Position: 'position',
      Direct_Contact_Leader: 'directContactLeader', Registration_Expiration_Date: 'regExpDate',
    })
  })
})

describe('composeFullName', () => {
  it('joins present parts and drops blanks', () => {
    expect(composeFullName({ firstName: 'Edward', middleName: 'T', lastName: 'Hart' })).toBe('Edward T Hart')
    expect(composeFullName({ firstName: 'Jo', middleName: '', lastName: 'Welles' })).toBe('Jo Welles')
  })
})

describe('normalizeRoster fan-out', () => {
  const rows = [
    row({ Email: 'a@x.org', First_Name: 'Ann', Last_Name: 'Lee', Unit: 'Pack 0070', Chartered_Org_Name: 'Org', Position: 'Cubmaster' }),
    row({ Email: 'a@x.org', First_Name: 'Ann', Last_Name: 'Lee', Position: 'Merit Badge Counselor' }), // blank unit
    row({ Email: 'b@x.org', First_Name: 'Bob', Last_Name: 'Roy', Unit: 'Pack 0070', Position: 'Cubmaster' }),
  ]

  it('dedupes each entity by its key', () => {
    const e = normalizeRoster(rows, roles)
    expect(e.contacts.map((c) => c.email).sort()).toEqual(['a@x.org', 'b@x.org'])
    expect(e.units.map((u) => u.name)).toEqual(['Pack 0070']) // one unit, deduped
    expect(e.positions.map((p) => p.name).sort()).toEqual(['Cubmaster', 'Merit Badge Counselor'])
    expect(e.assignments).toHaveLength(3)
  })

  it('keeps a blank unit as a district-level assignment and makes no blank Unit', () => {
    const e = normalizeRoster(rows, roles)
    const district = e.assignments.find((a) => a.key === 'a@x.org||merit badge counselor')
    expect(district).toBeTruthy()
    expect(district.unitName).toBe('')
    expect(e.units.some((u) => u.name === '')).toBe(false)
  })

  it('collapses identical Email|Unit|Position triples and warns', () => {
    const dup = [...rows, row({ Email: 'a@x.org', First_Name: 'Ann', Last_Name: 'Lee', Unit: 'Pack 0070', Position: 'Cubmaster' })]
    const e = normalizeRoster(dup, roles)
    expect(e.assignments).toHaveLength(3) // unchanged: the 4th row is a duplicate triple
    expect(e.warnings.find((w) => w.type === 'duplicate-assignments').count).toBe(1)
  })

  it('skips blank-email rows with a warning', () => {
    const e = normalizeRoster([row({ Email: '', First_Name: 'No', Last_Name: 'Email', Position: 'X' })], roles)
    expect(e.contacts).toHaveLength(0)
    expect(e.warnings.find((w) => w.type === 'blank-email').count).toBe(1)
  })
})

describe('same email, different names', () => {
  const conflict = [
    row({ Email: 'h@x.org', First_Name: 'Edward', Middle_Name: 'T', Last_Name: 'Hart', Position: 'A' }),
    row({ Email: 'h@x.org', First_Name: 'James', Last_Name: 'Hart', Position: 'B' }),
  ]

  it('merges into one contact by default and flags the conflict', () => {
    const e = normalizeRoster(conflict, roles, { mergeByEmail: true })
    expect(e.contacts).toHaveLength(1)
    const w = e.warnings.find((x) => x.type === 'email-name-conflict')
    expect(w.email).toBe('h@x.org')
    expect(w.names).toEqual(['Edward T Hart', 'James Hart'])
  })

  it('keeps separate contacts (keyed email|first last) when merging is off', () => {
    const e = normalizeRoster(conflict, roles, { mergeByEmail: false })
    expect(e.contacts).toHaveLength(2)
    expect(e.contacts.map((c) => c.key).sort()).toEqual([
      'h@x.org|edward hart',
      'h@x.org|james hart',
    ])
    // still reported as a conflict
    expect(e.warnings.some((w) => w.type === 'email-name-conflict')).toBe(true)
  })
})
