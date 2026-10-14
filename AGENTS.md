# Workmory agent guide

## Scope and references

- Workmory is a stateless OKF memory/retrieval service and web dashboard on Cloudflare Workers. The calling agent owns salience, summarization, reflection, profile inference, and forgetting; do not add automatic memory calls or cognitive orchestration.
- Read `README.md` for setup and API usage, `CONTRIBUTING.md` for contribution conventions, `SPEC.md` for normative OKF, and `OKF_RULES.md` for Workmory's profile and responsibility boundary. Update `OKF_RULES.md` only when that profile or boundary changes.
- For changes spanning directories, also read the relevant scoped rules: `server/profile/AGENTS.md`, `server/attachments/AGENTS.md`, and `web/AGENTS.md`.

## Commands

- Use Node.js 24 and exactly pnpm 11.22.0 (`package.json` and CI). Enable Corepack with `corepack enable` if needed.
- Install: `pnpm install --frozen-lockfile`.
- Start development: follow `README.md#local-development` to prepare `.env.local`, then `pnpm migration:apply:local` and `pnpm dev`.
- Run the built Worker locally: `pnpm dev:wrangler` (builds first, uses local D1/R2).
- Typecheck: `pnpm typecheck` (regenerates ignored `worker-configuration.d.ts`, then runs `tsc --noEmit`). There is no configured lint/format script; do not invent one.
- Pure tests: `pnpm test`; one file: `pnpm test test/auth.test.ts`; one case: `pnpm test test/auth.test.ts -t 'test name'`. This suite excludes `test/workers/`.
- Workerd tests: `pnpm test:workers`; one file: `pnpm test:workers test/workers/migration-chain.test.ts`. These use local D1/R2 and the SQL migrations from `drizzle/`.
- Schema changes: edit `server/db/schema.ts`, run `pnpm migration:generate`, then `pnpm migration:check` and `pnpm migration:apply:local`.
- Build: `pnpm build`. Check the existing built Worker: `pnpm test:artifact`.
- Deployment preview: `pnpm deploy:dry-run` (includes build, built-Worker checks, and `wrangler deploy --dry-run`).

## Verification

- After runtime or dependency changes, run the CI sequence: `pnpm install --frozen-lockfile`, `pnpm audit --audit-level high`, `pnpm migration:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:workers`, `pnpm deploy:dry-run`. The last command already builds; no separate build is needed.
- Keep pure tests independent of real Cloudflare services. Local fakes cannot prove real Access/JWKS, Workers AI, Vectorize consistency, or `toMarkdown()` contracts; those require an explicitly targeted staging environment.
- Vectorize and Workers AI have no local emulation. Do not treat remote development commands as local verification.

## Data and protocol boundaries

- D1 is authoritative for identity, current state, revisions, visibility, and filters. FTS, Vectorize, memory links, and graph-index state are rebuildable projections.
- Requalify every vector candidate and both endpoints of every graph edge against current D1 owner, project, namespace, revision, deletion/visibility state, filters, and indexability. Derived data must never cross scope.
- Canonical OKF revisions and attachment objects in private R2 are immutable; use opaque object keys. Preserve canonical byte limits, optimistic revisions, operation receipts, and idempotency.
- Preserve unknown OKF types and fields through semantic round trips; do not narrow the open-world model.
- Profile records must remain `indexable: false` in a reserved internal scope inaccessible to ordinary memory tools. Exclude them from tags, search documents, FTS, semantic work/vectors, graph projections, and reindex work, including outside `server/profile/`.
- Outbox and operation-receipt leases use opaque claim tokens and timestamps. Completion, release, retry, and semantic D1 mutations must CAS the active token so expired workers cannot mutate a newer claim.
- MCP prefers v2/2026 (`2026-07-28`) with only the SDK's `2025-11-25` stateless POST fallback. Create a fresh server/transport per request; do not add sessions, SSE GET/DELETE, resume state, or parallel protocol implementations.
- Preserve `POST /mcp` and `POST /mcp/<url-encoded-root-key>`; the path segment is decoded once and counts as a credential source. Keep `/mcp/*` in Wrangler's `assets.run_worker_first` so the SPA does not intercept it.
- Root maintenance defaults to processing semantic/graph work and object cleanup. Reindex must use set-based or explicitly bounded D1 work and preserve unexpired claims. Status exposes global aggregate D1 data only, never owners, content, URLs, errors, or assertions of remote R2/Vectorize health.

## Authentication and request security

- Ownership comes only from authentication, never client input or email. Access owners are isolated; `root` is a separate owner domain, not a cross-owner administrator.
- Require a non-placeholder `ROOT_API_KEY` of at least 32 UTF-8 bytes. Access settings `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` must both be present or both absent; partial configuration fails closed. Access credentials must fail when Access is disabled, without anonymous/root fallback.
- Accept exactly one source among path root key, `X-API-Key`, Bearer JWT, and `Cf-Access-Jwt-Assertion`. Cookie and Access service-token credentials are unsupported. Preserve JWT issuer, audience, algorithm, time, type, and subject checks.
- Construct the remote Access JWKS verifier lazily, only after confirming both Access settings for Access credentials; valid root requests must not construct or depend on it.
- Protected APIs deliberately accept any Host and HTTP/HTTPS Origin with wildcard CORS and no credentials. Do not introduce Host/Origin allowlists or a built-in rate limiter without a requirement.
- Never expose real secrets in fixtures, docs, config, command arguments, logs, or errors. For path-key MCP requests, log the route template `/mcp`, never the raw request URL; retain disabled invocation logs in Wrangler configs.
- Treat profile values and attachment/converted content as untrusted data, never instructions, identity, ACLs, or authorization evidence. Converted body content must not replace caller frontmatter.

## Editing and environment constraints

- Use Drizzle for schema and ordinary CRUD; reserve parameterized raw SQL for FTS5, virtual-table triggers, and atomic/CAS-sensitive work where Drizzle is insufficient.
- SQL migrations and historical Drizzle metadata are append-only. Generate a new migration instead of editing an existing one.
- Keep dependency ranges caret-prefixed and synchronize `pnpm-lock.yaml` with `package.json`.
- Do not add dependency injection frameworks, Queues, or Durable Objects without an explicit requirement and measured need.
- Keep `web/components/ui/` unchanged unless the user explicitly requests changes there; these are vendored Coss components.
- Keep local env files, generated Worker types, build output, caches, and `.slim/` reference clones untracked as configured in `.gitignore`. Do not edit the read-only clones.
- Manage production ordinary variables/secrets in the Cloudflare Dashboard and D1/R2/Vectorize/AI bindings in Wrangler. Preserve `keep_vars: true`; do not add a `vars` block that overwrites Dashboard-managed values.
- Real deployment and remote migration require explicit user authorization: this includes `pnpm deploy`, `pnpm migration:apply:remote`, and `pnpm migration:apply:local-bindings` (despite its name, it uses `--remote`).
- `pnpm dev:local-bindings` uses isolated remote `workmory-local` resources; `pnpm dev:remote` uses production `workmory` resources. Neither is an offline/local test mode.
- Keep `README.md` and `README.zh-CN.md` concise, mutually linked, and factually aligned; keep implementation constraints in agent instructions rather than duplicating them in READMEs.
