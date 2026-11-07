# Usage: local services, demo data, and running a diagnosis

This guide walks through starting PostgreSQL, Prometheus, and a local Sentry-compatible service, loading demo data, configuring `.env`, and pasting an incident into the UI.

## Prerequisites

- Node.js 20.9+ and npm
- Docker with Docker Compose v2 (`docker compose`)
- `curl`
- A GitHub personal access token with access to the repository containing the issue
- A Google Generative AI API key
- Optional: a real Sentry auth token and organization slug if you want to query a live Sentry account instead of the local dev service

```bash
npm install
cp .env.example .env
```

Set these in `.env`:

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=<your GitHub token>
GOOGLE_GENERATIVE_AI_API_KEY=<your Gemini API key>
```

## 1. Start PostgreSQL, Prometheus, and Sentry

The repository ships a Docker Compose stack and a helper script:

```bash
./service.sh          # start the containers (default command)
./service.sh test     # start the containers and load demo data
```

Use `test` for a first run. It starts PostgreSQL, Prometheus, Pushgateway, and the local Sentry-compatible service, then seeds PostgreSQL, pushes demo metrics, and loads Sentry demo issues.

Ports used by the dev stack:

| Service | URL |
| --- | --- |
| PostgreSQL | `postgresql://sre_agent:sre_agent@localhost:55433/sre_agent` |
| Prometheus | `http://localhost:19092` |
| Pushgateway | `http://localhost:19093` |
| Sentry | `http://localhost:19095` |

The integration test stack uses different ports (`55432`, `19090`, `19091`, `19094`), so `./service.sh` and `npm run test:real` can run without conflicting.

## 2. Configure `.env`

Add the local stack values to `.env`:

```bash
POSTGRES_URL=postgresql://sre_agent:sre_agent@localhost:55433/sre_agent
PROMETHEUS_URL=http://localhost:19092
ENABLE_POSTGRES=true
ENABLE_PROMETHEUS=true
SENTRY_AUTH_TOKEN=sntryu_local_dev
SENTRY_ORG=acme
SENTRY_PROJECT=payments
SENTRY_HOST=http://localhost:19095
ENABLE_SENTRY=true
```

The Sentry values are also available in [.env.sentry](../.env.sentry). `./service.sh env` prints this block for you. `./service.sh env --write` updates these keys in `.env` automatically while preserving your other values. Note that it replaces any existing Sentry credentials in `.env` with the local mock values.

Restart `npm run dev` after changing `.env` — the app reads datasource configuration at startup.

If you leave `ENABLE_POSTGRES`, `ENABLE_PROMETHEUS`, or `ENABLE_SENTRY` as `false`, that source appears as `Disabled` in the UI health panel and is skipped during investigations.

### Sentry: local dev service or real account

The dev stack includes a local Sentry-compatible service. It implements the Sentry API endpoints used by `@sentry/mcp-server` and is seeded from `seed/sentry/data.json`.

```bash
SENTRY_AUTH_TOKEN=sntryu_local_dev
SENTRY_ORG=acme
SENTRY_PROJECT=payments
SENTRY_HOST=http://localhost:19095
ENABLE_SENTRY=true
```

For a real Sentry account, replace those values:

```bash
SENTRY_AUTH_TOKEN=sntryu_...
SENTRY_ORG=my-org
SENTRY_PROJECT=checkout
SENTRY_HOST=https://sentry.io
ENABLE_SENTRY=true
```

- `SENTRY_ORG` is required when Sentry is enabled.
- `SENTRY_PROJECT` is optional; leave it empty to search every project in the organization.
- `SENTRY_HOST` defaults to `https://sentry.io`. For self-hosted Sentry, use the base URL of your instance.
- Restart `npm run dev` after changing `.env`.

The Sentry adapter discovers project slugs with `find_projects`, asks the model to build a Sentry issue search query from the incident identifiers, and executes `search_issues` through `@sentry/mcp-server`. The Sentry source reports `error_tracking` evidence to the report generator. See [phase-5-sentry-integration.md](phase-5-sentry-integration.md) for implementation details.

The real integration suite does not need a Sentry account: it starts a mock Sentry API container and runs the real Sentry MCP server against it.

## 3. Create a GitHub issue and paste the incident

The agent fetches issue context through the GitHub MCP server. The textarea does not accept a full issue body; it needs an issue reference in this format:

```text
issue #<number> in <owner>/<repo>
```

### Option A: create a demo issue in your repository

Create an issue with a title and body similar to this:

```markdown
Title: Payment failures for customer C-1001

Customer C-1001 reports checkout failures since 10:20 UTC.

- Affected transactions: TXN-9988, TXN-9989
- Error code: card_declined
- Service: checkout
- The customer retried and still received "Your card was declined".
```

The issue number is shown after you create it. If it is issue `#7` in `acme/incident-demo`, paste this into the UI:

```text
issue #7 in acme/incident-demo is causing payment failures for customer C-1001 (transactions TXN-9988, TXN-9989, error card_declined)
```

### Where to paste it

1. Open `http://localhost:3000`.
2. Paste the incident text into the **Incident** textarea at the top of the main panel.
3. Click **Run diagnosis**.

The UI streams the workflow:

1. Fetching GitHub issue
2. Extracting identifiers
3. Investigating data sources
4. Generating report

The report tab renders the generated Markdown as formatted headings, lists, tables, and code blocks.

## 4. Demo data

Running `./service.sh test` seeds the following.

### PostgreSQL

Tables created by `seed/postgres/schema.sql`:

- `customers` — `C-1001` (pro), `C-1002` (free)
- `orders` — `TXN-9988` and `TXN-9989` failed with `card_declined`; `TXN-9990` and `TXN-9991` succeeded
- `payment_attempts` — repeated Stripe attempts for `TXN-9988`/`TXN-9989` with elevated latency

Seed rows are written by `seed/postgres/seed.sql`. Re-running `./service.sh seed` is safe: customer and order inserts use `ON CONFLICT DO NOTHING`, and seeded payment attempts are replaced.

### Prometheus

`seed/prometheus/metrics.txt` is pushed to Pushgateway and scraped by Prometheus. It includes:

- `payment_transactions_total` — success and failure counts, including `card_declined`
- `payment_latency_seconds` — p50/p95/p99 latency
- `checkout_errors_total` — error counts by `error_code`
- `queue_depth` — pending settlement jobs
- `service_up` — service availability

### Sentry

`seed/sentry/data.json` is loaded by the local Sentry-compatible service. It includes:

- Organization `acme`
- Projects `payments` and `checkout`
- `PAY-1` — unresolved card failure for `C-1001` with `card_declined`
- `PAY-2` — unresolved settlement timeout for `C-1002`
- `CHK-1` — unresolved checkout 500 for session `S-42`
- `PAY-0` — a resolved `C-1001` card failure, useful for testing `is:unresolved` filtering

Re-running `./service.sh seed` reloads the seed file into the running Sentry service.

## 5. Verify the data

Open a PostgreSQL shell:

```bash
./service.sh psql
```

```sql
SELECT customer_id, transaction_id, status, error_code FROM orders ORDER BY created_at;
SELECT transaction_id, status, error_code, latency_ms FROM payment_attempts ORDER BY created_at;
```

Query Prometheus:

```bash
curl -s 'http://localhost:19092/api/v1/query?query=payment_transactions_total' | jq
curl -s 'http://localhost:19092/api/v1/query?query=checkout_errors_total' | jq
```

Query the local Sentry service:

```bash
curl -s -H 'Authorization: Bearer sntryu_local_dev' \
  'http://localhost:19095/api/0/organizations/acme/issues/?query=C-1001' | jq
```

Check application datasource health:

```bash
curl -s http://localhost:3000/api/health | jq
```

Enabled PostgreSQL, Prometheus, and Sentry sources should report `"status": "up"`.

## Service commands

| Command | What it does |
| --- | --- |
| `./service.sh` | Start PostgreSQL, Prometheus, Pushgateway, and Sentry |
| `./service.sh test` | Start everything and load demo data |
| `./service.sh seed` | Load demo data into running containers |
| `./service.sh status` | Show container status |
| `./service.sh logs` | Follow container logs |
| `./service.sh psql` | Open a psql shell |
| `./service.sh env` | Print the `.env` block for the dev stack |
| `./service.sh env --write` | Update the dev-stack keys in `.env` |
| `./service.sh down` | Stop containers, keep data volumes |
| `./service.sh reset` | Delete containers and volumes, restart with demo data |

## Troubleshooting

**Port already in use**

Change the host ports in `docker-compose.yml` and update `POSTGRES_URL`, `PROMETHEUS_URL`, and `SENTRY_HOST` in `.env` to match.

**Containers are unhealthy or the script waits forever**

```bash
./service.sh logs
./service.sh reset
```

**PostgreSQL, Prometheus, or Sentry shows `Disabled`**

Set `ENABLE_POSTGRES=true`, `ENABLE_PROMETHEUS=true`, and/or `ENABLE_SENTRY=true` in `.env`, then restart `npm run dev`.

**Health endpoint returns 503**

At least one enabled source is unreachable. Run `./service.sh status` and check the server logs.

**Diagnosis fails with an issue extraction error**

The pasted text must include an issue number and repository, for example `issue #7 in acme/incident-demo`. Verify `GITHUB_PERSONAL_ACCESS_TOKEN` can read that repository.

**Using your own PostgreSQL, Prometheus, or Sentry**

Skip `./service.sh`, point `POSTGRES_URL`, `PROMETHEUS_URL`, and `SENTRY_HOST` at your instances, provide the required Sentry token and organization, and set the enable flags to `true`.
