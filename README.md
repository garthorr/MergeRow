# MergeRow

MergeRow (a.k.a. BaserowSync) is a small, backend-free web app that syncs a
CSV file into a [Baserow](https://baserow.io) table. Everything runs in the
browser — Nginx just serves the static build and proxies API calls to
Baserow so there are no CORS issues.

## How it works

A 4-step wizard:

1. **Connect** — enter a Baserow API token and table ID, fetch the table's
   field schema.
2. **Upload & Map** — upload a CSV (parsed client-side with PapaParse), map
   each CSV column to a Baserow field (auto-matched by name), and choose a
   match key field that uniquely identifies a row.
3. **Diff** — fetch every existing row from Baserow and compare it against
   the CSV by match key. Rows are categorized as **New**, **Changed**,
   **Unchanged**, or **Missing** (present in Baserow but absent from the
   CSV). Each row can be included/excluded from the commit; missing rows
   require an explicit checkbox before they're queued for deletion (or use
   "Select all for deletion" / "Clear all" to do that in bulk).
4. **Commit** — review a summary of pending creates/updates/deletes, confirm,
   and watch per-row progress as MergeRow calls the Baserow API. Any mapped
   link-to-table column is resolved client-side first: a name is matched
   case/whitespace-insensitively against the linked table's existing rows,
   and if nothing matches, a new row is created there before the link is
   written — this is different from Baserow's own API, which errors out
   instead of creating the missing row.

The API token is kept in React component state only — it is never written
to `localStorage`, cookies, or any backend.

## Syncing related tables (e.g. a Contacts ↔ Assignments join table)

If your CSV export is itself a join table — each row links one record from
table A to one from table B (for example a `Contact Assignments` export
where each row references a `Contact` by email and a `Unit`/`Position` by
name) — run the wizard once per CSV/table pair rather than trying to do it
in one pass:

1. Sync the "leaf" table(s) first (e.g. `Contacts.csv` → the Contacts
   table), matched by a stable key like email. Leave any column that's
   really just a reverse lookup of the join table unmapped — Baserow
   derives it automatically once the join rows point at it.
2. Sync the join-table CSV itself (e.g. `Contact_Assignments.csv` → the
   Contact Assignments table) matched by its own stable key (e.g. an
   `Assignment ID` column), mapping each relationship column to its
   `link_row` field. New/changed/removed assignments fall out of the normal
   diff categorization, and any Unit/Position name not yet in Baserow gets
   created automatically as described above.

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

- Baserow matches by exact text against the linked table's primary field.
  It does **not** create a new row if the text doesn't match anything —
  the write fails and that error surfaces per-row in Step 4, so a typo
  never silently creates a duplicate Unit or Position.
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
