# SRE Diagnostic Agent

SRE Diagnostic Agent is a Next.js and LangGraph application for investigating production incidents by combining GitHub issue context, database records, logs, and metrics. It dynamically selects relevant data sources, generates read-only SQL and PromQL through an LLM, executes those queries through MCP adapters, and produces an evidence-backed diagnostic report.

![SRE Diagnostic Agent landing page in light mode](docs/images/landing-light.png)

## Why this project exists

Incident investigation usually requires jumping between multiple systems:

1. Read the GitHub issue and identify the customer, transaction, service, environment, or error code.
2. Search database records for affected entities.
3. Search logs for errors, retries, and related stack traces.
4. Query metrics for error rate, latency, saturation, or availability changes.
5. Reconcile the evidence into a root-cause hypothesis.

Doing that manually is slow and can miss low-volume evidence. SRE Diagnostic Agent automates the repetitive parts while keeping the source evidence visible:

- Fetches GitHub issue context through MCP.
- Extracts identifiers from the incident description.
- Uses an LLM planner to select only relevant enabled sources.
- Queries sources concurrently with bounded parallelism.
- Normalizes success, partial success, and failure into `SourceResult` records.
- Generates a diagnostic report from observed evidence, not speculation alone.
- Provides a datasource health endpoint for enabled/up/down visibility.

The architecture is intentionally extensible. Adding another datasource should require a config entry and adapter implementation, not new LangGraph node topology.

## System overview

```text
Browser UI
  |
  v
POST /api/diagnose (SSE)
  |
  v
LangGraph workflow
  fetch_issue -> extract_identifiers -> investigate_sources -> generate_report
       |                  |                     |                       |
       v                  v                     v                       v
   GitHub MCP        Gemini model        LlmInvestigationPlanner    Report model
                                                  |
                                                  v
                                          DataSourceService
                                                  |
                                                  v
                                    Registry -> Adapter -> MCP session
```

Supported adapters:

| Integration | Type | Source ID | Default | Purpose |
| --- | --- | --- | --- | --- |
| SQLite application DB | `sqlite` | `database` | Enabled | Query application tables through `mcp-sqlite` |
| SQLite log DB | `sqlite` | `logs` | Enabled | Query log records through `mcp-sqlite` |
| PostgreSQL | `postgres` | `postgres` | Disabled | Query relational records through `@modelcontextprotocol/server-postgres` |
| Prometheus | `prometheus` | `metrics` | Disabled | Discover metrics and run PromQL through `prometheus-mcp-server` |
| Sentry | `sentry` | `sentry` | Disabled | Search issues through `@sentry/mcp-server` |
| GitHub | MCP server | built in | Requires token | Fetch issue descriptions |

Adding another datasource is intended to require a config entry and an adapter implementation, not a new graph topology.

## Requirements

- Node.js 22.15 or later
  - `@sentry/mcp-server` requires Node.js 22.15+.
- npm
- Docker and Docker Compose v2 for the local development stack
- `curl` for the helper script and health checks
- GitHub personal access token with access to the repository containing the issue
- Google Generative AI API key
- Optional: real Sentry credentials for live Sentry evidence

## Local development

The local stack starts real PostgreSQL, Prometheus, Pushgateway, and a Sentry-compatible service, then seeds demo data for all of them.

### 1. Install dependencies

```bash
npm ci
```

### 2. Create the application environment

```bash
cp .env.example .env
```

Set the two required application secrets in `.env`:

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=<your GitHub token>
GOOGLE_GENERATIVE_AI_API_KEY=<your Gemini API key>
```

Do not commit a populated `.env`.

### 3. Start the local services and load demo data

```bash
./service.sh test
```

This starts:

| Service | Local URL |
| --- | --- |
| PostgreSQL | `postgresql://sre_agent:sre_agent@localhost:55433/sre_agent` |
| Prometheus | `http://localhost:19092` |
| Pushgateway | `http://localhost:19093` |
| Sentry-compatible service | `http://localhost:19095` |

It also seeds PostgreSQL tables, pushes Prometheus demo metrics, and loads Sentry demo issues.

For subsequent starts without reseeding:

```bash
./service.sh
```

### 4. Point `.env` at the local stack

Recommended:

```bash
./service.sh env --write
```

Or copy the values from [.env.sentry](.env.sentry) and add the database/metrics values manually:

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

`./service.sh env --write` overwrites any existing Sentry credentials in `.env` with the local mock values. Replace them with real credentials when you switch to real Sentry.

### 5. Start the app

```bash
npm run dev
```

Open `http://localhost:3000`.

### 6. Verify the environment

```bash
curl -s http://localhost:3000/api/health | jq
```

Enabled sources should report `"status": "up"`.

You can also verify the local services directly:

```bash
./service.sh status
./service.sh psql
./service.sh logs
```

### 7. Run a diagnosis

Create or choose a GitHub issue that contains an incident description, for example:

```markdown
Title: Payment failures for customer C-1001

Customer C-1001 reports checkout failures since 10:20 UTC.
Affected transactions: TXN-9988, TXN-9989
Error code: card_declined
Service: checkout
```

Then paste an issue reference into the UI:

```text
issue #7 in acme/incident-demo is causing payment failures for customer C-1001
```

The agent streams these stages:

1. Fetch issue
2. Extract identifiers
3. Plan and investigate sources
4. Generate report

The report is available in the Report tab. Source evidence, generated queries, failures, and durations are visible in the UI.

## Local service commands

| Command | Description |
| --- | --- |
| `./service.sh` | Start PostgreSQL, Prometheus, Pushgateway, and Sentry |
| `./service.sh test` | Start everything and load all demo data |
| `./service.sh seed` | Reload demo data into running services |
| `./service.sh status` | Show container status |
| `./service.sh logs` | Follow container logs |
| `./service.sh psql` | Open a PostgreSQL shell |
| `./service.sh env` | Print local-stack `.env` values |
| `./service.sh env --write` | Write local-stack values into `.env` |
| `./service.sh down` | Stop containers, keep volumes |
| `./service.sh reset` | Remove containers and volumes, then reseed |

## Local demo data

### PostgreSQL

- `customers`: `C-1001` and `C-1002`
- `orders`: failed transactions `TXN-9988` and `TXN-9989` with `card_declined`; successful `TXN-9990` and `TXN-9991`
- `payment_attempts`: repeated Stripe attempts with elevated latency

### Prometheus

- `payment_transactions_total`
- `payment_latency_seconds`
- `checkout_errors_total` with `error_code="card_declined"` and `error_code="gateway_timeout"`
- `queue_depth`
- `service_up`

### Sentry

The local Sentry-compatible service is seeded from `seed/sentry/data.json`:

- organization `acme`
- projects `payments` and `checkout`
- `PAY-1`: unresolved card failure for `C-1001`
- `PAY-2`: unresolved settlement timeout for `C-1002`
- `CHK-1`: unresolved checkout 500 for session `S-42`
- `PAY-0`: resolved C-1001 failure for testing `is:unresolved`

This service is a Sentry-compatible API used by the real `@sentry/mcp-server`. It is not a full self-hosted Sentry deployment.

## Production deployment

The development Compose stack is not a production deployment. In production, point the agent at real PostgreSQL, Prometheus, and Sentry services, or disable the ones you do not use.

### 1. Provision real services

Recommended production setup:

- Real PostgreSQL with a read-only user for the agent.
- Real Prometheus with read access to the metrics you need.
- Real Sentry with a read-only auth token.
- A GitHub token that can read the target issues.
- A Gemini API key.

Use least-privilege, read-only credentials. Never use production write tokens unless the adapter requires it.

### 2. Set production environment variables

Set these in your platform, process manager, or secret manager. If you use a file, keep it out of Git.

```bash
NODE_ENV=production
PORT=3000

GITHUB_PERSONAL_ACCESS_TOKEN=<read-only GitHub token>
GOOGLE_GENERATIVE_AI_API_KEY=<Gemini key>

DATABASE_PATH=/var/lib/sre-agent/database.db
LOGS_PATH=/var/lib/sre-agent/logs.db

POSTGRES_URL=postgresql://sre_readonly:password@postgres.example.com:5432/app
PROMETHEUS_URL=https://prometheus.example.com
SENTRY_AUTH_TOKEN=sntryu_<read-only-token>
SENTRY_ORG=<organization-slug>
SENTRY_PROJECT=<optional-project-slug>
SENTRY_HOST=https://sentry.io

ENABLE_DATABASE=true
ENABLE_LOGS=true
ENABLE_POSTGRES=true
ENABLE_PROMETHEUS=true
ENABLE_SENTRY=true
```

Notes:

- `SENTRY_AUTH_TOKEN` should have at least `org:read`, `project:read`, and `event:read`.
- `SENTRY_PROJECT` is optional. Leave it empty to search the whole organization.
- `SENTRY_HOST` must be the base URL only, without `/api/0`.
- `DATABASE_PATH` and `LOGS_PATH` must be writable/persistent if SQLite sources are enabled.
- Disable unused sources with `ENABLE_* = false`.

### 3. Build and start

```bash
npm ci
npm run build
npm start
```

`npm start` runs the production Next.js server. Use your process manager or container platform to keep it running and restart it on failure.

### 4. Put authentication and TLS in front

The application does not include built-in authentication. Do not expose it directly to the public internet.

At minimum, protect both endpoints with your reverse proxy or platform auth:

- `POST /api/diagnose`
- `GET /api/health`

Use HTTPS, network restrictions, and authentication appropriate for your environment.

### Production checklist

- [ ] Node.js 22.15+ is installed.
- [ ] `npm ci` and `npm run build` succeed.
- [ ] Production secrets are stored outside Git.
- [ ] Only required datasources are enabled.
- [ ] Credentials are read-only and scoped to the minimum access needed.
- [ ] `/api/diagnose` and `/api/health` are behind authentication.
- [ ] TLS is terminated by a trusted reverse proxy or platform.
- [ ] SQLite paths are on persistent storage, or SQLite sources are disabled.
- [ ] The process has outbound network access for `npx` MCP packages and external services.
- [ ] `/api/health` is monitored and alerted on.
- [ ] Logs and model usage are monitored for failures and quota exhaustion.

### Container deployment

The repository includes `docker-compose.yml` for local development only. It does not include a production Dockerfile. If you deploy with containers, build an image that runs:

```bash
npm ci
npm run build
npm start
```

Expose port `3000`, inject environment variables through your platform, and configure health checks against `/api/health`.

## Configuration reference

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Yes | GitHub MCP access to fetch issues |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes | Gemini models for extraction, planning, query generation, and reports |
| `DATABASE_PATH` | If `ENABLE_DATABASE=true` | SQLite application database path |
| `LOGS_PATH` | If `ENABLE_LOGS=true` | SQLite logs database path |
| `POSTGRES_URL` | If `ENABLE_POSTGRES=true` | PostgreSQL connection string |
| `PROMETHEUS_URL` | If `ENABLE_PROMETHEUS=true` | Prometheus base URL |
| `SENTRY_AUTH_TOKEN` | If `ENABLE_SENTRY=true` | Sentry read token |
| `SENTRY_ORG` | If `ENABLE_SENTRY=true` | Sentry organization slug |
| `SENTRY_PROJECT` | No | Optional Sentry project slug |
| `SENTRY_HOST` | No | Sentry base URL, default `https://sentry.io` |
| `ENABLE_DATABASE` | No | Default `true` |
| `ENABLE_LOGS` | No | Default `true` |
| `ENABLE_POSTGRES` | No | Default `false` |
| `ENABLE_PROMETHEUS` | No | Default `false` |
| `ENABLE_SENTRY` | No | Default `false` |
| `SOURCE_INVESTIGATION_CONCURRENCY` | No | Max concurrent datasource queries |
| `PORT` | No | Next.js production port, default `3000` |

### Datasource configuration

Datasources are defined in `app/config/datasources.json`. Enablement can be hard-coded or resolved from environment variables. Disabled sources do not require their connection values or credentials during config loading.

## API

### `POST /api/diagnose`

Streams the diagnostic workflow as Server-Sent Events.

```bash
curl -N -X POST http://localhost:3000/api/diagnose \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "issue #1 in myorg/myrepo is causing payment failures for customer C-1001",
    "model": "google:gemini-3.5-flash-lite"
  }'
```

Example events:

```text
data: {"node":"fetch_issue","update":{...}}
data: {"node":"extract_identifiers","update":{...}}
data: {"node":"investigate_sources","update":{...}}
data: {"node":"generate_report","update":{...}}
data: {"node":"done","update":{}}
```

### `GET /api/health`

Returns datasource health.

```bash
curl -s http://localhost:3000/api/health | jq
```

- `200 OK`: every enabled source is reachable.
- `503 Service Unavailable`: at least one enabled source is down, or configuration failed.
- `status: "ok"`: all enabled sources are up.
- `status: "degraded"`: some enabled sources are down.
- `status: "down"`: all enabled sources are down.
- Disabled sources report `status: "disabled"`.

Health checks:

- SQLite: connection file exists and is a regular file.
- PostgreSQL: connection plus `SELECT 1`.
- Prometheus: `/-/healthy`.
- Sentry: organization API endpoint with bearer token.

## Testing

Default tests:

```bash
npm test
```

This includes unit tests and the mocked Sentry MCP integration test. It does not need Docker, network access, or a live Sentry account.

Real integration tests:

```bash
npm run test:real
```

This starts Docker fixtures for PostgreSQL, Prometheus, Pushgateway, and a mock Sentry API, then exercises the real PostgreSQL, Prometheus, and Sentry MCP servers with Gemini. It requires Docker and Gemini API quota.

Static checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## Troubleshooting

### `ENABLE_SENTRY=true` fails at startup

Provide both `SENTRY_AUTH_TOKEN` and `SENTRY_ORG`. `SENTRY_PROJECT` is optional.

### Sentry shows `down`

Check:

- token scopes
- organization slug
- `SENTRY_HOST` base URL
- network access from the app process

Verify manually:

```bash
curl -i -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/organizations/$SENTRY_ORG/"
```

### Sentry MCP warning: `No LLM API key found`

This warning comes from `@sentry/mcp-server`, not from this application.

The Sentry MCP package only recognizes `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `OPENROUTER_API_KEY` for its own optional AI-powered search tools. It does not recognize Gemini.

The warning is harmless because this application:

1. Uses `GOOGLE_GENERATIVE_AI_API_KEY` with Gemini to generate the Sentry query.
2. Calls Sentry's `search_issues` with direct Sentry query syntax.

Sentry issue search still works.

### Prometheus query returns zero or no data

Check:

- metric name exists
- label names actually exist on that metric
- the counter has enough samples for `rate()` or `increase()`
- static Pushgateway demo values are queried directly for absolute counts

Grouping by a label that does not exist silently produces no series.

### PostgreSQL, Prometheus, or Sentry shows `Disabled`

Set the corresponding `ENABLE_*` variable to `true` and restart the app.

### `Health endpoint returns 503`

At least one enabled source is unreachable. Run:

```bash
./service.sh status
./service.sh logs
curl -s http://localhost:3000/api/health | jq
```

### GitHub issue extraction fails

The prompt must include an issue number and repository, for example:

```text
issue #7 in acme/incident-demo
```

Verify `GITHUB_PERSONAL_ACCESS_TOKEN` can read the repository.

### Port conflicts

The local dev stack uses:

- PostgreSQL `55433`
- Prometheus `19092`
- Pushgateway `19093`
- Sentry `19095`

The integration test stack uses:

- PostgreSQL `55432`
- Prometheus `19090`
- Pushgateway `19091`
- Sentry `19094`

Change ports in `docker-compose.yml` and update `.env` if needed.

## Security notes

- Incident text and source results are treated as untrusted data in prompts, not instructions.
- SQL generation is constrained to read-only queries, but production credentials should still be read-only.
- Sentry and GitHub tokens should be read-only and least-privilege.
- The application has no built-in auth. Protect it with a reverse proxy or platform access controls.
- Do not commit `.env` or production secrets.
- MCP servers are launched through `npx -y`. Production environments should allow the required packages or pre-cache them.

## Project structure

```text
app/
  api/diagnose/route.ts          SSE diagnostic endpoint
  api/health/route.ts            Datasource health endpoint
  config/datasources.json         Datasource definitions
  lib/agent.ts                    Agent runtime and CLI workflow setup
  lib/graph.ts                    LangGraph workflow
  lib/utils.ts                    Graph nodes and state
  lib/datasource.config.ts        Datasource config schema and env handling
  lib/datasource-health.ts        Source health checks
  lib/datasource/                 Registry, service, types, and adapters
  lib/investigation/              Planner and report formatter
  lib/mcp/                        MCP session, server config, response parsing
  page.tsx                        Landing page and diagnostic workspace
  components/                     Landing sections, workspace, and UI primitives

data/                             Local SQLite demo/runtime databases
docs/                             Phase architecture and implementation notes
tests/
  integration/                   Docker-backed integration tests and fixtures
  unit/                          Config, adapter, graph, prompt, and seed tests
```

## Current state and limitations

- SQLite database and logs are enabled by default.
- PostgreSQL and Prometheus are disabled by default and must be enabled with `ENABLE_POSTGRES=true` or `ENABLE_PROMETHEUS=true`.
- The PostgreSQL MCP server exposes a read-only `query` tool; schema discovery is implemented with `information_schema`.
- Prometheus health checks use HTTP status; they do not start the MCP server.
- The root page is a marketing landing page plus a live diagnostic workspace backed by `GET /api/health` and `POST /api/diagnose`.
- The real integration suite requires Docker, network access to pull images, and Gemini API quota.
- The repository includes demo SQLite databases in `data/`; PostgreSQL demo data is seeded by the integration fixture SQL.

## Frontend dashboard

The root page (`app/page.tsx`) combines a landing page with the live diagnostic workspace:

- A hero and capability sections explain what the agent does and link into the workspace.
- A live source status section reads `GET /api/health` and shows enabled, up, down, and disabled adapters.
- A workspace with an incident form, a model picker, and streamed investigation results.
- Tabs for the investigation timeline, per-source evidence (query, status, latency, raw data), and the generated report.
- Light, dark, and system themes via `next-themes`. UI primitives follow the shadcn pattern in `app/components/ui`.
- `components.json` is configured for adding more shadcn components.

The diagnose endpoint remains available at `POST /api/diagnose` and streams stages over SSE. The dashboard does not invoke a model until you run a diagnosis.
