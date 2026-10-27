# XML → Redis exporter

A small Node.js app that reads `config.xml` and writes its data to Redis, run with Docker Compose (one container for the app, one for Redis).

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/YOUR_GITHUB_USERNAME/xml-to-redis)

## Try it in the browser (no install)

1. Click **Open in GitHub Codespaces** above and wait for the environment to start (Docker is included).
2. In the terminal:

```bash
./export.sh -v config.xml   # export and print every saved key
npm test                    # run the unit tests
```

The **Actions** tab also shows CI running the unit tests and the full `./export.sh -v config.xml` in Docker on every push, then checking the keys in Redis.

## Run locally

Requires Docker with Compose v2.

```bash
./export.sh -v /path/to/config.xml   # prints all keys saved to Redis
./export.sh /path/to/config.xml      # prints only a summary line
```

Inspect the result:

```bash
docker compose exec redis redis-cli GET subdomains
docker compose exec redis redis-cli GET cookie:dlp-avast:amazon
```

Stop everything with `docker compose down -v`.

## What is written to Redis

| Key | Value |
|---|---|
| `subdomains` | JSON array of every `<subdomain>`, in file order, e.g. `["http://secureline.tools.avast.com", ...]` |
| `cookie:<name>:<host>` | text of each `<cookie>`, e.g. `cookie:dlp-avast:amazon` → `mmm_amz_dlp_777_ppc_m` |

For the supplied `config.xml` that is 47 keys: `subdomains` (38 entries) plus 46 cookie keys.

## Project layout

```
export.sh            entry point: starts Redis, runs the app container with the XML mounted read-only
docker-compose.yml   redis (with healthcheck) + app
Dockerfile           node:20-alpine image for the app
src/parser.js        XML → { subdomains, cookies }   (pure, no I/O)
src/exporter.js      data → Redis key/value pairs; writes them in one MULTI/EXEC transaction
src/cli.js           argument parsing (-v), file reading, Redis connection
test/                unit tests (Node's built-in test runner, fake Redis client)
```

## Design notes

- **Pure parsing and key-building are separated from I/O**, so the logic is unit-tested without a Redis server; the Redis client is injected and replaced by an in-memory fake in tests.
- **All keys are written in one `MULTI`/`EXEC` transaction**, so a run saves everything or nothing.
- **Values are stored exactly as in the XML.** Whitespace is trimmed, but nothing is converted to numbers and case is preserved (note `cookie:dlp-avg:filehippo` is `Mmm_fhp_dlp_779_ppc_m` with a capital M in the source).
- **Input is validated before connecting to Redis**: malformed XML, a missing `<config>` root, or a cookie without `name`/`host` stops the run with a clear error.
- `-v` may come before or after the path. Re-running overwrites keys with the same values (idempotent).
- Redis is reached via `REDIS_URL` (defaults to `redis://localhost:6379`), so the app also runs outside Docker: `REDIS_URL=redis://localhost:6379 node src/cli.js -v config.xml`.
