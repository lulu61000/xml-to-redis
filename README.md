# XML → Redis exporter

A small Python app that reads `config.xml` and writes its data to Redis, run with Docker Compose (one container for the app, one for Redis).

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/YOUR_GITHUB_USERNAME/xml-to-redis)

## Try it in the browser (no install)

1. Click **Open in GitHub Codespaces** above and wait for the environment to start (Docker is included).
2. In the terminal:

```bash
./export.sh -v config.xml   # export and print every saved key
python -m unittest -v       # run the unit tests
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
| `subdomains` | JSON list of every `<subdomain>`, in file order, e.g. `["http://secureline.tools.avast.com", ...]` |
| `cookie:<name>:<host>` | text of each `<cookie>`, e.g. `cookie:dlp-avast:amazon` → `mmm_amz_dlp_777_ppc_m` |

For the supplied `config.xml` that is 47 keys: `subdomains` (38 entries) plus 46 cookie keys.

## Files

```
export.py            the app: parse XML → build keys → save to Redis → print (-v)
test_export.py       unit tests (standard-library unittest, fake Redis client)
requirements.txt     Python dependency: the redis client library
Dockerfile           python:3.12-slim image for the app
docker-compose.yml   redis (with healthcheck) + app
export.sh            entry point: starts Redis, runs the app container with the XML mounted read-only
```

## Design notes

- **One script, four steps:** `parse_config` → `build_entries` → `save_to_redis` → `main`. The first two only work with data passed in (no files, no Redis), so they are tested directly; the Redis client is passed in, so tests replace it with an in-memory fake.
- **All keys are written in one transaction** (`MULTI`/`EXEC`), so a run saves everything or nothing.
- **Values are stored exactly as in the XML.** Whitespace is trimmed, but nothing is converted to numbers and case is preserved (note `cookie:dlp-avg:filehippo` is `Mmm_fhp_dlp_779_ppc_m` with a capital M in the source).
- **The file is checked before connecting to Redis**: malformed XML, a root other than `<config>`, or a cookie without `name`/`host` stops the run with a clear error.
- Re-running overwrites keys with the same values (idempotent).
- Redis is reached via `REDIS_URL` (default `redis://localhost:6379`), so the script also runs without Docker: `pip install -r requirements.txt && python export.py -v config.xml`.
