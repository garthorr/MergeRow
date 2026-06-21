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
   require an explicit checkbox before they're queued for deletion.
4. **Commit** — review a summary of pending creates/updates/deletes, confirm,
   and watch per-row progress as MergeRow calls the Baserow API.

The API token is kept in React component state only — it is never written
to `localStorage`, cookies, or any backend.

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

## Relationships (link-to-table fields) are preserved

Step 2's field dropdown deliberately excludes `link_row` (relationship)
fields, along with computed/read-only fields (formula, lookup, count,
rollup, created/last-modified). You can never map a CSV column onto one.

That matters because an `update` is a `PATCH` containing only the fields you
mapped — Baserow leaves every other field on the row exactly as it was. So
if, say, a Contact row is linked to a Position, and the new CSV shows that
contact as otherwise unchanged, the contact↔position link is never part of
the request and stays intact. The same is true for any field you simply
choose not to map: it's just never sent.
