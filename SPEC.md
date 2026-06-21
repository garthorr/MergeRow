# MergeRow rebuild spec

> Paste-ready brief for a fresh session. Goal: normalize a single flat roster
> CSV and sync it into 1–4 related Baserow tables in one pass.

## Before you design anything

Connect to Baserow and read the **Contacts** table's real field schema first —
confirm whether its primary field is **Name** or **Email** — and let that drive
the contact-link approach (see caveat 1 below). Also re-read the sample roster
CSV against real rows before committing to the normalize/dedup logic.

## What it is

A backend-free web app that takes **one** denormalized roster CSV (each row is a
single position-assignment, with the same person/unit/position repeated across
many rows) and reconciles it into the user's existing Baserow database. It's a
full export, so the sync categorizes everything as **New / Changed / Unchanged /
Missing** and lets the user commit creates/updates/deletes.

## The input

One CSV. Real columns:

```
District, Unit, Chartered_Org_Name, First_Name, Middle_Name, Last_Name,
Program, Email, Position, Direct_Contact_Leader, Registration_Expiration_Date
```

One person appears on many rows (multiple roles, multiple units). Unit and
contact attributes repeat on every row (fully denormalized).

## Target Baserow schema (sync into 1 to 4 of these)

- **Contacts** — one row per person. Natural key: **Email**. Fields: First /
  Middle / Last name.
- **Units** — one row per unit. Natural key: **Unit name** (full label, e.g.
  `Pack 0070`, `Crew 0070`, `Troop 0042` — all distinct). Fields: Chartered Org,
  District.
- **Positions** — catalog of role *types* (e.g. "Cubmaster", "Committee Chair").
  Natural key: **Position name**.
- **Contact Assignments** — the join: one row per roster row. Three single-value
  links: Contact, Unit, Position. Scalar fields: Program, Direct Contact Leader
  (YES/NO), Registration Expiration Date. **No natural ID exists** — synthesize a
  stable composite key `Email | Unit | Position`.

## Core transform — normalize one sheet → many tables

From the single uploaded CSV:

1. Project + dedupe each entity: unique Contacts by email, unique Units by name,
   unique Positions by name, one Assignment per row keyed by the synthesized
   triple.
2. Let the user map sheet columns → each target table's fields, and choose which
   of the 1–4 tables to sync this run (they may only want Contacts + Assignments
   some days).
3. Diff each table independently against Baserow (New / Changed / Unchanged /
   Missing), using each table's key (email, unit name, position name, or the
   synthesized assignment triple).
4. Show all diffs together in **one review screen**, organized contact-centrically:
   per person, show their contact-level changes and their assignment/role changes
   side by side, so "Jane moved from Den Leader to Cubmaster in Pack 0084" reads
   as one story even though it's a delete+create at the assignment level.
5. Commit in dependency order in one go: Contacts, Units, Positions first →
   capture newly-created row IDs → then Contact Assignments, resolving each
   Contact/Unit/Position link to a real row ID (pre-existing or just-created). One
   user action; the tool owns the ordering.

## Link resolution & safety rules

- Resolve links client-side before writing (Baserow's API won't create a missing
  linked row, it errors). Match names against the linked table's identifying
  field **case/whitespace-insensitively**.
- Per-link **"Auto-create missing rows"** toggle. Default **on** for
  Units/Positions (catalogs legitimately grow). Default **off** for the Contact
  link on Assignments — an unmatched contact there is a typo, not a new person;
  fail just that row rather than spawn a junk contact. (In practice the Contact
  exists because it was synced from the same sheet moments earlier.)
- Diff link fields by the *set* of linked names, order-insensitive.
- Updates are PATCH with only mapped fields — unmapped fields/links left exactly
  as-is.
- "Missing" rows need an explicit per-row delete check, plus bulk "select all /
  clear all".

## Data-quality cases that must not break the run

- **Blank Unit** → a valid district-level assignment with no Unit link; key
  becomes `Email | (none) | Position`. Don't drop the row, don't create a blank
  Unit.
- **Same email, two different names** (real example in the sample:
  `edward.hart31601@gmail.com` is on both "Edward Hart" and "James Hart")
  → don't silently merge into one mangled contact. Detect it, surface it as a
  warning in the review screen, default to treating email as the contact key but
  flag the conflict.
- Tolerate name casing inconsistencies ("kejin zhou") — normalize for matching,
  preserve original for writes.
- Program can vary across a unit's rows (it's per-assignment, not per-unit) — keep
  it on the Assignment, not the Unit.

## Column → target mapping

Columns marked "(key)" drive a table's identity/dedup; the three relationship
columns do double duty — once to upsert the leaf/catalog row, once as the link
value on the Assignment.

| Sheet column | Target table → field | Role |
|---|---|---|
| `Email` | **Contacts → Email** (key) · **Contact Assignments → Contact** (link) | Dedups contacts; resolves the assignment's Contact link |
| `First_Name` | Contacts → First Name | Contact attribute |
| `Middle_Name` | Contacts → Middle Name | Contact attribute |
| `Last_Name` | Contacts → Last Name | Contact attribute |
| `Unit` | **Units → Name** (key) · **Contact Assignments → Unit** (link) | Dedups units; resolves the assignment's Unit link. **Blank = district-level, no Unit link** |
| `Chartered_Org_Name` | Units → Chartered Org | Unit attribute |
| `District` | Units → District | Unit attribute (constant across this sheet — "Heart of Dallas 24") |
| `Position` | **Positions → Name** (key) · **Contact Assignments → Position** (link) | Dedups the position catalog; resolves the assignment's Position link |
| `Program` | Contact Assignments → Program | Assignment attribute (varies per row even within a unit — keep it here, not on Units) |
| `Direct_Contact_Leader` | Contact Assignments → Direct Contact Leader | Assignment attribute (YES/NO) |
| `Registration_Expiration_Date` | Contact Assignments → Registration Expiration Date | Assignment attribute (date) |
| *(synthesized)* | Contact Assignments → key = `Email \| Unit \| Position` | Not a column — composed in-tool to give each assignment a stable identity |

## Two caveats the builder must resolve, not assume

1. **Contact-link matching field.** Baserow resolves a link against the linked
   table's *primary field*. If Contacts' primary field is a display **Name**, not
   **Email**, the Assignment→Contact link can't match on email out of the box.
   Either make Email the Contacts primary field, or generalize the link resolver
   to match against a **designated** field of the linked table (email) rather than
   always the primary field. The latter is more robust and worth building.
2. **Contact display name.** The sheet has First/Middle/Last separately but no
   composed "Name". If Contacts' primary field is a single Name, compose it
   (`First [Middle] Last`) for that field while still keying/matching on Email.

## Tech / constraints

- React + Vite, **browser-only, no backend**. PapaParse for CSV, Tailwind for UI.
- Baserow **database API token**, data endpoints only (`field_<id>`); page rows
  until no `next`. Token in component state only — never persisted.
- Multi-stage Docker (Node build → Nginx serving static + proxying `/api/` to a
  git-ignored `BASEROW_URL`), Traefik labels for ingress, no `ports:` mapping.
- Reuse the current repo's `src/lib/baserow.js` (field-key/CRUD/paging) and the
  case-insensitive link-resolution logic in `src/lib/linkResolve.js` as starting
  plumbing; expect a near-full rewrite of everything above that (the wizard, the
  normalize/fan-out layer, the multi-table diff, the ordered commit).

## The one assumption to confirm before building

An assignment's identity is `Email + Unit + Position` — i.e. changing someone's
role is modeled as deleting the old assignment and creating a new one, not editing
one in place. Everything downstream depends on this.

---

**First steps:** read the Contacts schema (caveat 1), confirm the assignment-key
assumption, then design the normalize/fan-out data model and the commit-ordering
strategy before building the wizard.
