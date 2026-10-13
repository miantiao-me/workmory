# Contributing to Workmory

Thank you for contributing to Workmory. This guide outlines how to set up your environment, follow our development workflow, and submit changes.

## Development environment

Workmory runs on Cloudflare Workers and requires:

- **Node.js**: `^24.0.0`
- **pnpm**: `11.x` managed via Corepack

Enable Corepack and install dependencies:

```bash
corepack enable
pnpm install --frozen-lockfile
```

For environment configuration, D1 database initialization, and local emulation, follow the [Local development](README.md#local-development) section in `README.md`.

## Workflow and contributions

1. **Fork and branch**: Create a descriptive feature branch from `main`.
2. **Implement changes**: Keep modifications concise, targeted, and focused on a single concern.
3. **Validate locally**: Run the test and typecheck suite before creating a pull request.
4. **Submit a pull request**: Describe what the change enables, reference relevant issues, and ensure all checks pass.

### Commit conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: add memory graph edge filtering`
- `fix: preserve frontmatter metadata during profile patch`
- `docs: update deployment prerequisites in README`
- `test: add worker integration tests for access assertion`

Keep commit messages descriptive, imperative, and focused on why the change is made.

## Validation commands

Run this verification suite locally before submitting a pull request:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:workers
pnpm migration:check
pnpm build
pnpm deploy:dry-run
```

Do not run `pnpm deploy` or remote migrations (`pnpm migration:apply:remote`) during local development.

## Coding guidelines

- **KISS and directness**: Favor simple, readable solutions over speculative abstractions or unnecessary wrappers.
- **Explain why, not what**: Add comments only where intent, edge cases, or trade-offs are not obvious from the code.
- **Append-only migrations**: Never alter existing SQL migrations or historical Drizzle metadata. Generate new migrations with `pnpm migration:generate`.
- **Test behavior**: Write tests that verify externally visible outcomes and edge cases rather than internal implementation details. Keep unit tests independent of real Cloudflare services.
- **Protected UI paths**: Do not modify files in `web/components/ui/` unless explicitly requested, as they are vendored from Coss.

## Architecture and constraints

Before modifying core behavior, review [AGENTS.md](AGENTS.md) for architectural invariants, including:

- Multi-tenant owner isolation across Cloudflare Access and root domains.
- Stateless MCP lifecycle (supporting MCP v2/2026 with stateless `2025-11-25` fallback).
- D1 as authoritative state for metadata and FTS5, with immutable OKF revisions stored in R2.
- The boundary between storage retrieval and agent cognitive policy.

## Security

- Never commit real credentials, access keys, or `.env.local` files.
- Report security vulnerabilities privately following [SECURITY.md](SECURITY.md). Do not open public GitHub issues for sensitive disclosures.
