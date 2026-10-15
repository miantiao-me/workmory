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

### Small retrieval evaluation

Run `pnpm eval:retrieval` for a manually maintained synthetic corpus and independent relevance judgments against local D1/R2, with fixed timestamps, `semanticWeight: 0`, and no Workers AI or Vectorize calls. This is a local lexical baseline: lexical cases require Recall@5 = 1 for every query and macro MRR@5 ≥ 0.85; negative cases must return no results; response budget omissions must be zero. English and Chinese paraphrase cases and the hard ranking group are observations without a pass threshold and do not enter the lexical gate. The hard group labels plausible wrong answers, including obsolete but still searchable guidance, similar operational terms, negation, and cross-language questions.

The report shows ranked keys and per-query Recall@5/MRR@5, plus separate lexical/paraphrase/hard and overall positive macro averages. Recall@1/3/5 is the fraction of judged relevant keys found in each prefix; MRR@5 is the reciprocal rank of the first relevant key within five results (zero if absent); binary nDCG@5 divides discounted gain (`relevance / log2(rank + 1)`, ranks starting at one) by the ideal gain for up to five relevant keys. Empty-gold negatives are excluded from positive averages and reported as a negative query count and a count of queries returning any false positive. Formula and fixture checks run with `pnpm test test/retrieval-metrics.test.ts`.

Judgments score the separately recorded task intent, rather than exhaustively labeling every document related to the query text. Existing queries and gold remain fixed as the corpus grows: broad queries such as `离线`, `overlap window`, and `catalog cache invalidation` do not explicitly name the Cedar, Ember, or Atlas project assumed by their intents. New notes can therefore be reasonable topical matches yet receive no relevance credit for those tasks; interpret cross-group comparisons with this ambiguity in mind.

These small synthetic results cannot establish real semantic model quality or agent task success rates. To keep generated reports outside version control, create the ignored directory before redirecting stdout: `mkdir -p .cache` followed by `pnpm eval:retrieval > .cache/retrieval-evaluation.log`.

### Authorized remote semantic comparison

Run `pnpm eval:retrieval:remote` only against an explicitly authorized environment; Workers AI, Vectorize, and storage requests incur external costs. Set `RETRIEVAL_BASE_URL` to an HTTPS staging origin or an explicitly ported `http://127.0.0.1:<port>` / `http://localhost:<port>` proxy for the authorized `workmory-local` resources, and put `ROOT_API_KEY` in `.env.local`. The command requires Node.js 24 and reads `.env.local`; the origin must have no credentials, path, query, or fragment. Optional `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` values are reported as environment labels, not verified remote configuration. Stdout is JSON and progress goes to stderr; use `mkdir -p .cache` then `pnpm --silent eval:retrieval:remote > .cache/retrieval-remote.json` to retain an ignored report.

Each run writes the shared synthetic corpus to a random project and the `benchmark` namespace. It waits up to 180 seconds by default for complete D1 projection coverage and semantic-ranked Vectorize candidates covering the entire corpus; set `RETRIEVAL_INDEX_TIMEOUT_SECONDS` to an integer from 30 to 900 when the remote index needs a longer bounded wait. Progress reports visible candidate counts. Incomplete or degraded semantic service fails the run. Store requests normally defer indexing. Set `RETRIEVAL_ALLOW_MAINTENANCE=1` only with explicit authorization for global default maintenance processing; this option calls `process`, never reindex, and can process unrelated pending work. No migration or deployment is performed.

The core comparison reports lexical (weight 0), hybrid (0.5), and a semantic ranking view: weight 1 requests all candidates, then orders candidates with `semanticRank` by that rank before taking five. This view observes the API's semantic candidates without exact-key boosts or lexical-only candidates; it does not change server ranking. `semanticApi` separately reports the original weight 1 API top five, which can retain exact-key boosts. The corpus is limited to 50 documents so the full candidate request cannot truncate it. Reports include hard-case distractor hits, per-group metrics, and negative false-positive query counts. Without a similarity threshold, negative questions can return nearest neighbors; this alone is not evidence of a semantic malfunction. Do not change production ranking or thresholds to chase these small synthetic scores.

Finally, the script attempts logical deletion of every key whose store was attempted, including requests with uncertain completion, checks that active listings are empty, and checks for no qualified semantic results in its scope. Revision and audit history remain; this does not prove physical R2 or Vectorize erasure. Cleanup failures produce a nonzero exit and remain in the JSON report. These observations still do not establish general model quality or agent task success.

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
