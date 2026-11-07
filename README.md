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
React UI
  |
  v
POST /api/diagnose (SSE)
  |
  v
LangGraph diagnostic workflow
  fetch_issue -> extract_identifiers -> investigate_sources -> generate_report
       |                  |                     |                       |
       |                  |                     v                       v
       |                  |              LlmInvestigationPlanner    Report formatter
       |                  |                     |
       v                  v                     v
   GitHub MCP          Gemini model       DataSourceService
                                                |
                                                v
                                    Registry -> Adapter -> MCP session
```

`GET /api/health` is a separate operational endpoint. It does not run a diagnostic; it checks configured sources and reports whether each is enabled, up, down, or disabled.

## Diagnostic workflow

1. **Fetch issue**
   - Calls the GitHub MCP `get_issue` tool.
   - Uses the issue number and repository supplied by the operator.

2. **Extract identifiers**
   - Passes issue text to Gemini.
   - Extracts structured identifiers such as `customerId`, `transactionId`, `userId`, `service`, and `errorCode`.

3. **Plan sources**
   - `LlmInvestigationPlanner` receives the issue, identifiers, and enabled datasource configurations.
   - Returns only relevant source IDs.
   - Falls back to all enabled sources if the model response is invalid, empty, or fails after retries/cleanup.

4. **Investigate sources**
   - `DataSourceService` resolves each selected source through `DataSourceRegistry`.
   - Sources are queried concurrently with bounded concurrency.
   - Each source returns a normalized `SourceResult`, so one failing datasource does not prevent other evidence from being returned.

5. **Generate report**
   - The report formatter renders source name, integration type, status, duration, query, evidence, and errors.
   - Gemini synthesizes the evidence into a report.

## Current integrations

| Integration | Type | Configured source | Default state | Purpose |
| --- | --- | --- | --- | --- |
| GitHub | `github` MCP server | Built in by `buildMcpServerConfigs` | Enabled when token is configured | Fetch issue descriptions and issue context |
| Application database | `sqlite` | `database` | Enabled by default | Query application tables through `mcp-sqlite` |
| Log database | `sqlite` | `logs` | Enabled by default | Query log records through `mcp-sqlite` |
| PostgreSQL | `postgres` | `postgres` | Disabled by default | Query relational database records through `@modelcontextprotocol/server-postgres` |
| Prometheus | `prometheus` | `metrics` | Disabled by default | Discover and query runtime metrics through `prometheus-mcp-server` |

### SQLite application database

Configuration: `app/config/datasources.json` → `database`

- MCP package: `mcp-sqlite`
- Tools: `db_query`, `db_list_tables`, `db_get_table_schema`
- Connection source: `DATABASE_PATH`
- Default example path: `data/database.db`
- Schema discovery uses SQLite table and column tools.

### SQLite log database

Configuration: `app/config/datasources.json` → `logs`

- MCP package: `mcp-sqlite`
- Tools: `logs_query`, `logs_list_tables`, `logs_get_table_schema`
- Connection source: `LOGS_PATH`
- Default example path: `data/logs.db`
- Uses the same generic SQL adapter as the application database, with logs-specific tool names.

### PostgreSQL

Configuration: `app/config/datasources.json` → `postgres`

- MCP package: `@modelcontextprotocol/server-postgres`
- Query tool: `query`
- Connection source: `POSTGRES_URL`
- Default example: `postgresql://postgres:postgres@localhost:5432/postgres`
- Disabled by default. Set `ENABLE_POSTGRES=true` in `.env` and provide a valid `POSTGRES_URL` to enable it.
- Schema discovery uses `information_schema` queries when only the read-only `query` tool is available.

### Prometheus

Configuration: `app/config/datasources.json` → `metrics`

- MCP package: `prometheus-mcp-server`
- Tools: `prom_query`, `prom_range`, `prom_discover`
- Prometheus URL: `PROMETHEUS_URL`
- Default example: `http://localhost:9090`
- Disabled by default. Set `ENABLE_PROMETHEUS=true` in `.env` and provide a valid `PROMETHEUS_URL` to enable it.
- Metric discovery returns metric names.
- Queries prefer range queries when `range_tool` is configured, using the configured time range and step.

### GitHub

GitHub is wired through `app/lib/mcp/mcp-servers.ts` and is not represented as a datasource in `app/config/datasources.json`.

- MCP package: `@modelcontextprotocol/server-github`
- Tool used by the graph: `get_issue`
- Token: `GITHUB_PERSONAL_ACCESS_TOKEN`
- The diagnostic endpoint requires a GitHub issue number and repository in the operator prompt.

## Environment variables

Copy `.env.example` to `.env` and fill in local values:

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=
GOOGLE_GENERATIVE_AI_API_KEY=

DATABASE_PATH=data/database.db
LOGS_PATH=data/logs.db
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/postgres
PROMETHEUS_URL=http://localhost:9090

ENABLE_POSTGRES=false
ENABLE_PROMETHEUS=false
ENABLE_DATABASE=true
ENABLE_LOGS=true
```

Environment behavior:

- `GITHUB_PERSONAL_ACCESS_TOKEN` is required to create the GitHub MCP server.
- `GOOGLE_GENERATIVE_AI_API_KEY` is required for identifier extraction, planning, query generation, and report generation.
- `DATABASE_PATH` and `LOGS_PATH` may be relative to the project root or absolute paths.
- `ENABLE_DATABASE` and `ENABLE_LOGS` default to `true` when omitted.
- `ENABLE_POSTGRES` and `ENABLE_PROMETHEUS` default to `false` when omitted.
- A disabled datasource does not require its connection or service env values during config loading.
- Never commit a populated `.env` file.

## Quick start

### Prerequisites

- Node.js
- npm
- Docker and Docker Compose for the optional real integration test suite
- GitHub personal access token
- Google Generative AI API key

### Install and start locally

```bash
npm install
cp .env.example .env
```

Edit `.env` and set:

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=<your GitHub token>
GOOGLE_GENERATIVE_AI_API_KEY=<your Gemini API key>
```

Start the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### Optional: local PostgreSQL and Prometheus

A Docker Compose stack and helper script are included:

```bash
./service.sh          # start PostgreSQL and Prometheus
./service.sh test     # start and load demo data (recommended for first run)
```

Then enable the sources in `.env`:

```bash
POSTGRES_URL=postgresql://sre_agent:sre_agent@localhost:55433/sre_agent
PROMETHEUS_URL=http://localhost:19092
ENABLE_POSTGRES=true
ENABLE_PROMETHEUS=true
```

Or write these keys automatically (other `.env` values are preserved):

```bash
./service.sh env --write
```

See [docs/usage.md](docs/usage.md) for the sample GitHub issue, where to paste it in the UI, seeded data, and troubleshooting.

### Run a diagnostic

Enter an incident description that includes a GitHub issue number and repository:

```text
issue #1 in myorg/myrepo is causing payment failures for customer C-1001
```

The UI streams these stages:

1. Fetching GitHub issue
2. Extracting identifiers
3. Investigating data sources
4. Generating report

### Production build

```bash
npm run build
npm run start
```

## API usage

### `POST /api/diagnose`

Accepts JSON:

```bash
curl -i -X POST http://localhost:3000/api/diagnose \
  -H 'Content-Type: application/json' \
  -d '{"message":"issue #1 in myorg/myrepo is causing payment failures for customer C-1001","model":"google:gemini-3.5-flash-lite"}'
```

The endpoint returns server-sent events:

```text
data: {"node":"fetch_issue","update":{...}}
data: {"node":"extract_identifiers","update":{...}}
data: {"node":"investigate_sources","update":{...}}
data: {"node":"generate_report","update":{...}}
data: {"node":"done","update":{}}
```

### `GET /api/health`

Returns the status of every configured datasource:

```bash
curl -s http://localhost:3000/api/health
```

Response behavior:

- `200 OK` when every enabled source is reachable.
- `503 Service Unavailable` when one or more enabled sources are down.
- Disabled sources return `status: "disabled"`.
- Enabled reachable sources return `status: "up"`.
- Enabled unreachable sources return `status: "down"`.

Check implementations:

- SQLite: connection file exists and is a regular file.
- PostgreSQL: database connection and `SELECT 1`.
- Prometheus: `/-/healthy` endpoint over HTTP.

## Development and tests

Default test suite:

```bash
npm test
```

Real integration tests:

```bash
npm run test:real
```

The real suite uses Docker Compose fixtures to start:

- PostgreSQL 16
- Prometheus 3.5
- Pushgateway

It also uses the actual PostgreSQL and Prometheus MCP servers and a real Gemini API key from `.env`. It verifies:

- PostgreSQL schema discovery
- Prometheus metric discovery
- Real SQL query execution
- Real PromQL range query execution
- Live datasource health checks
- End-to-end diagnostic graph execution

Static checks:

```bash
npm run typecheck
npm run lint
npm run build
```

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
  integration/                    Real Docker-backed integration tests
  integration/fixtures/           Postgres seed, Prometheus config, Compose file
  unit/                           Config, registry, adapter, health, graph tests
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
