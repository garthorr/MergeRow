# MergeRow

MergeRow is a backend-free web app that takes **one** denormalized roster CSV
(each row is a single position-assignment, with the same person/unit/position
repeated across many rows) and reconciles it into a related set of
[Baserow](https://baserow.io) tables in a single pass. Everything runs in the
browser — Nginx just serves the static build and proxies API calls to Baserow
so there are no CORS issues.

It's a full-export sync: every entity is categorized as **New / Changed /
Unchanged / Missing**, and you commit creates, updates and deletes from one
review screen.

## The data model

The single CSV is normalized (fanned out) into up to four target tables, and
you choose which of them to sync on any given run:

- **Contacts** — one row per person. Key: **Email**.
- **Units** — one row per unit (e.g. `Pack 0070`). Key: **Unit name**.
- **Positions** — catalog of role types. Key: **Position name**.
- **Contact Assignments** — the join: one row per roster line, with single-value
  links to Contact / Unit / Position plus Program, Direct Contact Leader and
  Registration Expiration Date. It has no natural ID, so identity is the
  synthesized composite key **`Email | Unit | Position`** — changing someone's
  role is therefore a delete + create at the assignment level, not an in-place
  edit.

## How it works

A 4-step wizard:

1. **Connect** — enter a Baserow API token and the Table ID for each table you
   want to sync (uncheck any to skip). MergeRow fetches each table's field
   schema and detects its primary field (the Contact link resolves against
   Contacts' primary field — ideally Email).
2. **Map** — upload the roster CSV (parsed client-side with PapaParse). Its
   columns are auto-assigned to roles (Email, Unit, Position, …), and each
   table's fields are auto-mapped from those roles. Per-link **"Auto-create
   missing rows"** toggles default on for Units/Positions (catalogs grow) and
   off for the Contact link (an unmatched contact is a typo, not a new person).
3. **Review** — every enabled table is diffed independently against Baserow by
   its own key, and the results are shown **contact-centrically**: per person,
   their contact-level change and their assignment/role changes side by side,
   so "moved from Den Leader to Cubmaster" reads as one story even though it's a
   delete + create underneath. Data-quality issues are surfaced as warnings
   (e.g. the same email on two different names) without breaking the run.
   Missing rows need an explicit per-row delete check, with bulk select/clear.
4. **Commit** — one action, ordered by the tool: Contacts, Units and Positions
   first, then Contact Assignments, whose Contact/Unit/Position links are
   resolved (case/whitespace-insensitively) against the rows that were just
   written. Watch per-action progress as MergeRow calls the Baserow API.

The API token is kept in React component state only — it is never written
to `localStorage`, cookies, or any backend.

## Code layout

- `src/lib/normalize.js` — the fan-out: dedupes the flat sheet into Contacts /
  Units / Positions / Assignments and collects data-quality warnings.
- `src/lib/diff.js` — the generic, per-table New/Changed/Unchanged/Missing
  engine plus value coercion (booleans, `M/D/YYYY` → ISO dates).
- `src/lib/sync.js` — slot↔field mapping, multi-table diffing, and the
  dependency-ordered commit.
- `src/lib/baserow.js` / `src/lib/linkResolve.js` — the Baserow REST wrapper
  (field-key/CRUD/paging) and the client-side link resolver.

## Local development

```bash
npm install
npm run dev
```

This starts the Vite dev server. Baserow API calls will hit `/api/...`
relative paths, so when developing locally you'll want a dev proxy or to
run the app through Docker (below) to exercise the Nginx proxy.

## Running with Docker

```bash
cp .env.example .env   # then edit .env with your real Baserow URL
docker compose up --build
```

This builds the app with a multi-stage Dockerfile (Node for the Vite build,
Nginx to serve the static output + proxy `/api/` to your Baserow instance)
and starts it as the `mergerow` service.

The Baserow instance is set via the `BASEROW_URL` environment variable,
read from a local `.env` file (`.env` is git-ignored, so your real URL never
ends up in version control — only the placeholder in `.env.example` is
tracked). Compose fails fast with a clear error if `BASEROW_URL` isn't set.
Nginx substitutes it into the proxy config at container start, so switching
instances later is a one-line edit to `.env` — no rebuild needed, just
`docker compose up -d` to recreate the container. Point it at Baserow Cloud
(`https://api.baserow.io`), a self-hosted instance's public hostname, or —
if Baserow runs as another container on the same `traefik` network — an
internal service name/port (e.g. `http://baserow:80`), which also sidesteps
any router NAT hairpin issues that can come up when a container calls back
out to its own public hostname.

By default the compose file expects an external Docker network called
`traefik` and routes traffic through [Traefik](https://traefik.io) using
labels — there's no `ports:` mapping because Traefik is the ingress:

```yaml
networks:
  traefik:
    external: true
```

Create the network once if it doesn't already exist:

```bash
docker network create traefik
```

Traefik is configured (via labels in `docker-compose.yml`) to route
`https://mergerow.home.tastymath.com` to this service on port 80, using the
`websecure` entrypoint and the `le` cert resolver.

If you just want to run the container standalone (no Traefik) for testing,
add a ports mapping, e.g.:

```bash
docker run --rm -p 8080:80 $(docker build -q .)
```

then open http://localhost:8080.

## Getting a Baserow API token and table ID

- Generate a **database token** from your Baserow account settings
  (**Settings → API tokens**). Database tokens only grant access to row and
  field *data* — they can't read or change table/database *structure*
  (renaming a table, etc.), which requires logging in with JWT/session auth
  instead. That's fine here: MergeRow only ever calls the data endpoints
  (list fields, list/create/update/delete rows).
- The table ID is the numeric ID visible in the table's URL, e.g.
  `https://baserow.io/database/123/table/456` → table ID `456`.

## Notes on the Baserow API

- All requests include `Authorization: Token {token}`.
- Row reads/writes use Baserow field **IDs** (sent as `field_<id>`), not
  field names, so renaming a field in Baserow won't break the mapping you
  set up in Step 2.
- Fetching existing rows pages through `GET /api/database/rows/table/{id}/`
  (default page size 100) until there is no `next` page.
- Updates are sent as `PATCH` requests that only include the fields you've
  mapped — any field you don't map (and Baserow's own row metadata) is left
  completely untouched.

## Relationships (link-to-table fields)

Step 2's field dropdown excludes computed/read-only fields (formula,
lookup, count, rollup, created/last-modified) — you can never map a CSV
column onto one. `link_row` (relationship) fields, however, *can* be
mapped: a column whose text matches the linked table's primary field (e.g.
a Unit or Position name) can be used to set that relationship directly from
the import. Step 1 resolves which table and field each link points to (via
Baserow's `link_row_table_id` and that table's primary field), so Step 2's
dropdown labels these as e.g. **"Position (link to Positions — matches
Name)"** rather than a bare field name. Comma-separate multiple values in
one cell to link a row to several rows in the other table.

A few things to know about mapping a link field:

- Baserow's own API matches by exact text against the linked table's
  primary field and does **not** create a new row if the text doesn't
  match anything — the write just fails. MergeRow resolves link fields
  itself before committing instead (see Step 4 above), so by default an
  unmatched name gets created as a new row rather than failing the write.
- Each mapped link field has its own "Auto-create missing rows" checkbox
  in Step 2, on by default. Turn it off for a field where an unmatched
  reference is more likely a typo or formatting mismatch than a real new
  entry (e.g. a Contact link, where a phantom row is costlier than for a
  small Unit/Position catalog) — with it off, an unmatched value fails
  only the row(s) that reference it, surfaced as a per-row error in Step 4,
  rather than creating a near-duplicate.
- Link fields can't be used as the match key (Step 2's "unique identifier"
  dropdown), since a relationship is a set of linked rows, not a single
  scalar value.
- The Diff step (Step 3) compares link fields by the set of linked names,
  ignoring order, so re-importing the same relationships in a different
  order doesn't show up as a spurious change.

For any field — link or otherwise — that you leave unmapped, the
relationship-preservation guarantee still holds: an `update` is a `PATCH`
containing only the fields you mapped, and Baserow leaves every other field
on the row exactly as it was. So if a Contact row is linked to a Position
and you don't map that link field, the contact↔position link is never part
of the request and stays intact.
