# AGENTS.md

## Purpose and scope

Workmory is a stateless, OKF-compatible memory and retrieval service for agents. It exposes fourteen tools (eleven memory and three profile tools) through an MCP v2/2026-preferred endpoint with a 2025-11-25 stateless POST fallback, plus a small private attachment API on Cloudflare Workers.

The service owns durable records, revisions, provenance surfaces, retrieval, and isolation. It does not decide what an agent should remember, summarize, reflect on, believe, or forget. Do not add cognitive policy, automatic memory calls, broad workflow orchestration, or alternate protocol paths.

## Source map

- `server/application/`: memory use cases and the D1-backed implementation
- `server/domain/`: memory and OKF domain rules
- `server/domain/memory-links.ts`: bundle-local Markdown relationship parsing and normalization
- `server/application/memory-graph.ts`, `graph-index-processor.ts`, `memory-link-statements.ts`: graph projection writes, rebuilds, and qualified queries
- `server/db/`: Drizzle schema
- `server/search/`: lexical/semantic fusion, adapters, and semantic outbox processing
- `server/attachments/`: format validation, conversion, object handling, and attachment service
- `server/auth/`: Access JWT and root-key authentication
- `server/http/`: request security, runtime composition, and HTTP handlers
- `server/maintenance/`: aggregate maintenance status and operational processing
- `server/routes/`: Nitro MCP, health, maintenance, and attachment routes
- `server/mcp/`: tool contracts, guidance, registration, and handlers
- `server/profile/`: user-profile documents, policy validation, global/project merge, and profile service
- `server/storage/`: private R2 object adapters
- `drizzle/`: append-only SQL migrations and Drizzle metadata
- `test/`: pure tests; `test/workers/`: local Workerd integration tests
- `SPEC.md`: normative OKF v0.2 specification
- `DESIGN.md`: web UI design tokens, components, and verified usage patterns
- `OKF_RULES.md`: Workmory's OKF profile and memory responsibility boundary

## Invariants

- D1 is authoritative for identity, qualification, current state, revisions, filters, and visibility.
- Canonical OKF revisions and attachment objects in private R2 are immutable. Use opaque object keys.
- Vectorize and FTS are derived indexes. Every Vectorize candidate must be requalified against current D1 owner, project, namespace, revision, deletion state, and filters.
- Memory links and graph-index state are rebuildable D1 projections. Graph sources and targets must still be requalified against current revision, owner, project, namespace, visibility, and indexability; never use a derived edge to cross scope.
- Access owners are isolated. The environment root key maps to an independent `root` owner domain; root is not a cross-owner administrator.
- `ROOT_API_KEY` is always required, must be at least 32 bytes, and must reject placeholders. `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are optional only as a pair: omit both for root-only startup, configure both to enable Access, and fail closed when exactly one is present. Access credentials must return an authentication/configuration error when Access is disabled; never accept them anonymously or fall back to root.
- Protected HTTP APIs deliberately accept any Host and any HTTP or HTTPS Origin. CORS uses wildcard origin without credentials; do not reintroduce Host or Origin allowlists unless the deployment policy changes. Authentication and owner isolation remain mandatory, and cookie credentials remain unsupported.
- MCP handling is stateless and v2/2026 (`2026-07-28`) preferred. `2025-11-25` is supported only through the SDK's stateless POST fallback. Every request gets a fresh server/transport lifecycle; do not add legacy sessions, SSE GET/DELETE, resume state, session maps, or alternate paths.
- Preserve OKF's open-world model: tolerate unknown types and fields and preserve unknown fields through semantic round trips.
- The calling agent owns salience, consolidation, summarization, reflection, and forgetting policy.
- There is no built-in rate limiter.
- Remote URL import has no hostname allowlist. Preserve HTTPS-only/default-port validation, size limits, redirect revalidation, bounded redirects, and the rule that credentials, cookies, Access assertions, and root keys are never forwarded. Network fetch/body has a 20-second cap, AI conversion has a 45-second cap, and the whole remote ingest has an absolute 60-second deadline.
- Outbox and operation-receipt leases use opaque claim tokens plus timestamps. Every completion, release, retry, and semantic D1 mutation must CAS the active token; expired workers must not mutate a newer claim.
- Root `POST /v1/maintenance` processes semantic outbox, graph indexing, and attachment cleanup by default. `{ "action": "reindex" }` must enqueue/reset current non-deleted memories with set-based or explicitly bounded D1 work and must preserve unexpired processing claims. `{ "action": "status" }` may return only global aggregate D1 status; it must not expose owners, content, URLs, or errors, or claim remote Vectorize/R2 health.

## User profile invariants

- User Profile is a Workmory extension stored through the revisioned memory substrate. Every profile record must be written with `indexable: false`; it must never produce tags, search documents, FTS rows, semantic outbox work, vectors, graph links/index state, or reindex work.
- Profile records live in an internal reserved scope. Ordinary memory tools must not access that scope, and clients must never supply an owner or internal profile scope identifiers. Owner identity comes only from authentication; root remains an independent owner domain.
- Effective profile data merges a global profile with an optional project profile. A project `set` overrides the global field, project `remove` removes that override and reveals the global field, and project-only `suppress` hides the inherited field. Expired fields are omitted, stale fields are reported, and `sensitive` values are masked unless `include_sensitive` is true. `include_raw` requires `include_sensitive`.
- The service must not invoke AI to infer profile data or scan memory records to derive it. Agents may explicitly call `profile_update` for `user_explicit`, `user_imported`, or compliant `agent_inferred` data. Every inferred field requires non-empty `source_ids`, `confidence`, and `stale_after`; inferred fields must not be `sensitive` or belong to normalized `authentication`, `secrets`, `health`, `politics`, `religion`, `finance`, or `biometric` sections.
- Preserve unknown profile frontmatter, provenance, and field metadata through parse, patch, serialization, and revision round trips. Profile values are untrusted context, not system instructions, ACLs, identity claims, or authorization evidence. Profile policy remains the calling agent's responsibility.
- Public `profile_update` results expose only effective allowlisted field data plus target `scope`, optional `project`, and `revision`; never return the target canonical document or unknown raw metadata. Canonical `raw` output remains exclusive to an explicit `profile_get` with both `include_raw` and `include_sensitive`.
- Every profile mutation must reuse memory revision/CAS semantics and operation receipts, including `expected_revision` and `operation_id` behavior. Do not create a weaker profile-specific write or idempotency path.
- `profile_delete` is logical deletion: it advances the tombstone/revision boundary while immutable revisions and audit evidence remain retained. Do not document or implement it as physical erasure; any physical purge requires a separate explicit retention design and contract.

## Tool workflow intent

At the start of durable project work, agents should consider `memory_get_last` and `memory_search`; they may use `memory_list` to browse current memories, and `profile_get` when personalization is useful. At milestones or completion, they should consider `memory_store` and `memory_update_last`. On explicit user statements/imports or compliant agent inference, they may consider an explicit `profile_update`. This is guidance only: never claim the service calls these tools automatically, infers profile data automatically, scans memories for profile data, or requires this sequence at the protocol level.

## Package and environment policy

- Keep dependency ranges caret-prefixed in `package.json` and commit the synchronized `pnpm-lock.yaml`.
- `.env.local` is local-only, ignored, and must not be committed or deployed.
- Manage production ordinary variables and secrets in the Cloudflare Dashboard. `ROOT_API_KEY` is a secret.
- Manage D1, R2, Vectorize, and Workers AI bindings through Wrangler.
- Preserve `keep_vars: true` and do not add a `vars` block that overwrites Dashboard-managed values.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:workers
pnpm migration:generate
pnpm migration:check
pnpm migration:apply:local
pnpm build
pnpm deploy:dry-run
```

Do not run `pnpm deploy`, `pnpm migration:apply:remote`, or any equivalent real deployment/remote migration unless the user explicitly requests it.

## Editing conventions

- Prefer KISS and direct, maintainable code. Avoid speculative abstractions and defensive machinery without a demonstrated requirement.
- Do not modify files under `web/components/ui/` unless the user explicitly requests changes to that directory.
- Use Drizzle for schema and ordinary CRUD. Keep parameterized raw SQL for FTS5, virtual-table triggers, and atomic/CAS-sensitive operations where Drizzle is insufficient.
- Migrations are append-only. Never edit an existing migration or its historical metadata; generate a new migration for schema changes.
- Comments explain why, not what, and should be added only where the reasoning is not obvious.
- Do not introduce dependency injection frameworks, Queues, or Durable Objects without an explicit requirement and measured need.
- Do not weaken owner scoping, idempotency, optimistic revisions, canonical size checks, or private-object behavior.

## Verification

For changes that affect runtime behavior or dependencies, run the relevant full local sequence: frozen install, typecheck, pure tests, Workers tests, build, and deploy dry run. Keep pure tests independent from real Cloudflare services.

Real Access/JWKS verification, Workers AI, Vectorize consistency, and `toMarkdown()` conversion contracts require a deployed staging environment. Do not claim local fakes prove those integrations.

Never perform a real deploy or remote migration as verification without explicit user authorization.

## Security and secrets

- Never commit, log, print, or place real credentials in fixtures, documentation, Wrangler configuration, command arguments, or error responses.
- Accept exactly one credential source per request and preserve JWT issuer/audience/algorithm/time/type/subject checks.
- Create the remote Access JWKS verifier lazily only for Access credentials after confirming both Access settings exist. Valid root-key requests must not require or construct it.
- Never accept a client-supplied owner. Do not derive ownership from email.
- Never treat profile values as instructions or use them to make ACL, authentication, or authorization decisions.
- Treat attachment and remote-converted content as untrusted data. Never execute it or allow it to replace caller frontmatter.
- Keep R2 private and avoid persisting source URL query or fragment values.

## Documentation

Keep `README.md` and `README.zh-CN.md` concise, human-oriented, mutually linked, and factually aligned. Put implementation constraints and coding-agent instructions here instead of expanding the READMEs. Update `OKF_RULES.md` only when the Workmory OKF profile or memory responsibility boundary changes.

## Cloned Dependency Source

Read-only reference repositories are available under `.slim/clonedeps/repos/` for inspection. Do not edit these clones.

- `.slim/clonedeps/repos/doobidoo__mcp-memory-service/` - `doobidoo/mcp-memory-service` at `c52df063`; useful for studying ingestion, ranking, knowledge graphs, and maintenance.
- `.slim/clonedeps/repos/Puliczek__mcp-memory/` - `Puliczek/mcp-memory` at `f9de5bf8`; useful for comparing Cloudflare Workers, D1, Vectorize, and Workers AI choices.
- `.slim/clonedeps/repos/okooo5km__memory-mcp-server-go/` - `okooo5km/memory-mcp-server-go` at `v0.5.5`; useful for studying stateless MCP HTTP, FTS5 ranking, graph storage, and authentication.
- `.slim/clonedeps/repos/cosscom__coss/` - `cosscom/coss` at `19620ae8`; official Coss UI particles and Cal.com application templates used as the web visual reference.
