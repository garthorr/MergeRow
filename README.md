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
docker compose up --build
```

This builds the app with a multi-stage Dockerfile (Node for the Vite build,
Nginx to serve the static output + proxy `/api/` to `https://api.baserow.io`)
and starts it as the `mergerow` service.

By default the compose file expects an external Docker network called
`homelab` and routes traffic through [Traefik](https://traefik.io) using
labels — there's no `ports:` mapping because Traefik is the ingress:

```yaml
networks:
  homelab:
    external: true
```

Create the network once if it doesn't already exist:

```bash
docker network create homelab
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

- Generate a database token from your Baserow account settings
  (**Settings → API tokens**).
- The table ID is the numeric ID visible in the table's URL, e.g.
  `https://baserow.io/database/123/table/456` → table ID `456`.

## Notes on the Baserow API

- All requests include `Authorization: Token {token}`.
- Row reads/writes use Baserow field **IDs** (sent as `field_<id>`), not
  field names, so renaming a field in Baserow won't break the mapping you
  set up in Step 2.
- Fetching existing rows pages through `GET /api/database/rows/table/{id}/`
  (default page size 100) until there is no `next` page.
