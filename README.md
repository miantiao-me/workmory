# Workmory

[简体中文](README.zh-CN.md) · [OKF v0.2 specification](SPEC.md) · [Workmory OKF profile](OKF_RULES.md)

Workmory gives your AI agents durable, cross-session memory and hybrid retrieval—helping you persist project context, working checkpoints, and user preferences with full revision history.

Built as a stateless service on Cloudflare Workers, Workmory exposes 11 memory tools and 3 profile tools through standard Model Context Protocol (MCP) endpoints, alongside a private HTTP attachment API.

- **Durable cross-session context**: Frees agents from single-session context limits by recalling past checkpoints at startup and saving milestones upon completion.
- **Accurate hybrid retrieval**: Combines exact key lookup, tag filtering, full-text search (FTS5), and vector embeddings to surface relevant memories quickly.
- **Verifiable revisions**: Built on the immutable [OKF v0.2 specification](SPEC.md). Every update or deletion creates an audit-ready revision that can be inspected and restored.
- **Cloud-native serverless stack**: Runs on Cloudflare D1, R2, Vectorize, and Workers AI with strict multi-tenant owner isolation and no databases to manage.

## Connect

Workmory exposes its MCP endpoint at `POST /mcp` over Streamable HTTP (supporting MCP v2/2026 with stateless `2025-11-25` fallback).

### Agent configuration

Add Workmory to your agent's MCP client configuration:

```json
{
  "mcpServers": {
    "workmory": {
      "url": "https://memory.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <access-application-jwt>"
      }
    }
  }
}
```

### Authentication

Protected requests support these credentials:

- **Cloudflare Access JWT**: Pass via `Authorization: Bearer <jwt>` or `Cf-Access-Jwt-Assertion: <jwt>`. Each Access subject gets an isolated owner domain.
- **Root API Key**: Pass via `X-API-Key: <key>`. Maps to a separate `root` domain, ideal for automated pipelines and maintenance tasks.

For MCP clients without custom headers, use `https://memory.example.com/mcp/<url-encoded-root-key>`. Encode the actual `ROOT_API_KEY` with `encodeURIComponent`; this URL requires no additional authentication headers.

A present `X-API-Key` header takes priority over all other sources. An empty or incorrect key fails authentication without falling back to JWT or the path key. Without that header, provide exactly one path key, Bearer JWT, or assertion; Access service-token headers are unsupported. Cookies may accompany a credential, but are never read as credentials, including `CF_Authorization`.

Access API calls require a valid application JWT. The dashboard currently supports root-key login only. Its API client omits browser credentials when a key is set and uses same-origin credentials without a key. If Cloudflare Access protects the API paths at the edge, its policy must allow requests with omitted browser credentials to reach the Worker; application code cannot bypass that edge policy.

### Discover the memory skill

The public [Agent Skills Discovery RFC](https://github.com/cloudflare/agent-skills-discovery-rfc) Draft v0.2.0 index is available at `https://memory.example.com/.well-known/agent-skills/index.json` without authentication. Download `workmory-memory` from the entry’s `url` (relative to that origin), then compare the SHA-256 of the downloaded raw bytes with its `digest` before installing it in your agent’s skill directory. The self-contained Chinese skill explains how to check whether past experience applies and save reusable outcomes with user authorization. It does not install itself or enable automatic memory calls.

## Tools

Workmory provides 14 standard MCP tools. Memory tools use `project` as the workspace boundary (`namespace` defaults to `default`), while profile tools manage global and project-specific preferences.

### Memory tools

| Tool | What it helps an agent do |
|---|---|
| `memory_store` | Store or update a memory from plain text, Markdown, uploaded files, or remote URLs |
| `memory_retrieve` | Read the current record for an exact key |
| `memory_search` | Search memories across exact keys, tags, full text (FTS5), and semantic vectors |
| `memory_list` | Browse memories with optional filters by kind, status, or tags |
| `memory_get_last` | Retrieve the latest progress checkpoint (`system/last_memory`) to resume context |
| `memory_update_last` | Save a new progress checkpoint at milestones or step completion |
| `memory_history` | Review revision history and audit trails for a record |
| `memory_retrieve_revision` | Inspect a specific historical revision or deletion tombstone |
| `memory_restore` | Restore a historical snapshot as the current active revision |
| `memory_graph` | Explore relationships and one-hop connections between memory nodes |
| `memory_delete` | Logically delete a memory while preserving its immutable revision audit trail |

`memory_search` returns `snippet` excerpts; use `memory_retrieve` for full content. `max_response_chars` defaults to 16000 (integer range 2000–100000), measuring `JSON.stringify(SearchResult).length` in UTF-16 code units, including metadata and excluding transport envelopes. Results retain a complete ranked prefix; `responseBudget.omittedItems` counts budget omissions within the requested `limit`, not total matches. An oversized first result can leave `items` empty with omissions; narrow the query or raise the budget.

### User profile tools

| Tool | What it helps an agent do |
|---|---|
| `profile_get` | Read the effective profile (automatically merging global fields with project overrides) |
| `profile_update` | Update preferences with explicit, imported, or confidence-rated inferred values |
| `profile_delete` | Logically delete an entire global profile or project profile |

### Recommended agent workflow

1. **Task start**: Call `memory_get_last` to resume previous context and `memory_search` to recall relevant facts; call `profile_get` when personalization is needed.
2. **Milestones and completion**: Call `memory_store` to persist conclusions or documentation, and `memory_update_last` to update checkpoints; call `profile_update` when preferences change.

## Attachments and import

Beyond text, Workmory allows agents to ingest external documents and web pages:

- **Private attachment API**: Upload files (images, PDFs, documents) via `POST /v1/projects/:project/attachments`. The service converts them to Markdown, stores originals and derived text in private R2, and returns an attachment ID for `memory_store`. Download content via `GET .../:id/content/original` and `GET .../:id/content/markdown`.
- **Remote web import**: Provide an HTTPS URL directly to `memory_store` to fetch and convert public web pages automatically.

## Local development

Requires Node.js 24 and pnpm.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

Edit `.env.local`: replace `ROOT_API_KEY` with a random secret of at least 32 bytes (generate with `openssl rand -hex 32`) and set `VECTOR_INDEX_VERSION` to a version identifier (e.g., `v1`).

```bash
pnpm migration:apply:local
pnpm dev
```

`pnpm dev` starts the Vite dashboard and the Nitro API server with local D1 and R2 emulation. Note that Cloudflare Vectorize and Workers AI have no local emulation; vector search and AI features require remote Cloudflare services.

### Dev modes

| Command | Purpose |
|---|---|
| `pnpm dev` | Vite dev server + Nitro with local D1/R2 emulation (Vectorize and Workers AI require remote services) |
| `pnpm dev:wrangler` | Local Worker runtime via `wrangler.jsonc` (`--local`, local D1/R2 emulation) |
| `pnpm dev:local-bindings` | Remote Worker runtime via `wrangler.local.jsonc` (`--remote`, isolated `workmory-local` resources) |
| `pnpm dev:remote` | Remote Worker runtime via `wrangler.production.jsonc` (`--remote`, production `workmory` resources) |

### Environment variables

| Variable | Description |
|---|---|
| `ROOT_API_KEY` | Required random secret (minimum 32 bytes) |
| `ACCESS_TEAM_DOMAIN` | Optional Cloudflare Access team domain (used with `ACCESS_AUD`) |
| `ACCESS_AUD` | Optional Cloudflare Access application audience |
| `EMBEDDING_MODEL` | Required Workers AI embedding model, e.g. `@cf/qwen/qwen3-embedding-0.6b` |
| `EMBEDDING_DIMENSIONS` | Required embedding vector dimensions, e.g. `1024` |
| `VECTOR_INDEX_VERSION` | Version identifier for the rebuildable vector index |

For a root-only setup, omit both Access variables. When enabling Access, configure both.

## Deployment and operations

Workmory deploys to Cloudflare Workers using bindings for D1, R2, Vectorize, and Workers AI.

### Prerequisites

1. **Create Cloudflare resources**:
   - D1: `pnpm wrangler d1 create workmory`
   - R2: `pnpm wrangler r2 bucket create workmory`
   - Vectorize: `pnpm wrangler vectorize create workmory --dimensions 1024 --metric cosine` (dimension must match `EMBEDDING_DIMENSIONS`)
2. **Update configuration**: In `wrangler.jsonc`, replace `database_id`, bucket name, and index name with your created resource values. (For isolated remote testing with `pnpm dev:local-bindings`, configure separate dev resources in `wrangler.local.jsonc`.)
3. **Configure secrets and variables**: Set `ROOT_API_KEY` via `pnpm wrangler secret put ROOT_API_KEY` (or the Cloudflare Dashboard) alongside other required variables (`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `VECTOR_INDEX_VERSION`, and optional Access credentials).

### Deploy

```bash
pnpm migration:apply:remote
pnpm build
pnpm deploy:dry-run
pnpm deploy
```

- **Maintenance**: Root operators can call `POST /v1/maintenance` to process background indexing and clean up unused attachments.
- **Queue status**: Call `POST /v1/maintenance` with `{ "action": "status" }` to inspect processing backlogs.

## Architecture and standards

- **Storage separation**: D1 serves as authoritative state for metadata, revisions, and FTS5; R2 stores immutable OKF documents and attachments; Vectorize provides semantic vector search.
- **Open Knowledge Format**: Follows [OKF v0.2](SPEC.md), organizing knowledge in human- and agent-readable Markdown with YAML frontmatter without vendor lock-in.
- **Web UI**: Access `/` for a lightweight browser-based dashboard with memory search and graph visualization (`/graph`).

## License

[AGPL-3.0-or-later](LICENSE) © 2026 Workmory contributors.

### Third-party attributions

- [`web/coss-globals.css`](web/coss-globals.css), [`web/components/app/`](web/components/app/), [`web/components/shared/`](web/components/shared/), [`web/components/settings/`](web/components/settings/), [`web/components/list-item.tsx`](web/components/list-item.tsx), [`web/components/mobile-header.tsx`](web/components/mobile-header.tsx), [`web/hooks/use-scroll-hide.ts`](web/hooks/use-scroll-hide.ts): vendored/adapted from [Coss](https://github.com/cosscom/coss) Cal.com example at commit `19620ae8`, upstream license AGPL-3.0-or-later (see file headers).
- [`web/components/ui/`](web/components/ui/): vendored from [Coss](https://github.com/cosscom/coss) `apps/ui/registry/` (MIT exception in upstream LICENSING).
- [`SPEC.md`](SPEC.md): adapted from [GoogleCloudPlatform/open-knowledge-format](https://github.com/GoogleCloudPlatform/open-knowledge-format), upstream license [Apache-2.0](licenses/OKF-LICENSE-Apache-2.0.md).
