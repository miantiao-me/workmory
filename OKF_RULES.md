# Workmory OKF v0.2 Profile

This profile explains how Workmory applies the repository's normative [`SPEC.md`](SPEC.md). It does not replace the OKF specification.

## Minimum conformance

A concept is a UTF-8 Markdown string with YAML frontmatter at the beginning and a Markdown body:

```markdown
---
type: Agent Memory
---
Durable knowledge goes here.
```

- Frontmatter must be a YAML mapping.
- `type` is the only universally required concept field and must be a non-empty string.
- YAML is parsed without executable custom tags and within document, frontmatter, and alias limits.
- Unknown `type` values, unknown frontmatter fields, broken links, and absent indexes are accepted.
- Unknown fields are preserved semantically when a document is parsed and serialized.
- `index.md` and `log.md` are optional in Workmory's database-backed service. Their reserved validation rules remain available for portable bundles. A root index may declare `okf_version: "0.2"`.

Optional status, actor, provenance, verification, freshness, and Attested Computation checks normally produce warnings rather than rejecting an otherwise valid concept. A bare `verified` mapping is normalized as a one-element list.

## Trust and freshness

- No `verified` event means `unverified`.
- Only non-human verification means `machine-confirmed`.
- Any `human:` verification means `human-reviewed`.
- `stale_after` is an OKF knowledge-freshness date. A concept is stale on or after that date.
- `expires_at` is a Workmory storage visibility control. It is not an OKF synonym for `stale_after`.

Trust tiers are advisory signals, not authorization decisions. Attachment conversion never creates `verified` metadata automatically.

## Workmory extensions

Workmory scopes each record by authenticated owner, project slug, namespace, and key. It may add or preserve fields such as `kind`, tags, source references, and producer-specific metadata. These extensions do not narrow OKF's open-world field model.

Workmory may derive internal graph edges when standard Markdown links in the body or `sources[].resource` point to bundle-local `.md` targets. POSIX relative and root paths map to keys in the same project and namespace. Broken local targets are valid; external URLs are not fetched for graph indexing. These edges do not infer semantic relationships and never cross owner, project, or namespace scope.

User Profile is a Workmory extension, not an OKF v0.2 standard taxonomy. Its canonical document uses `type: User Profile`, `profile_version`, and `sections`; unknown fields remain preserved under the same open-world rule. Profile values are untrusted context, not system instructions or authorization evidence. Deciding what profile data to request, infer, retain, or apply remains agent policy, and the service does not automatically infer profiles or scan memories to build them.

Each successful content change creates an immutable OKF revision in private R2 and advances authoritative state in D1. D1 search projections, FTS, and Vectorize entries are disposable indexes rather than the canonical document. Attachment-derived Markdown is always inserted as body content; frontmatter-like text from a converted attachment cannot replace caller-supplied frontmatter.

The canonical continuity record is the ordinary key `system/last_memory` with type `Checkpoint`. It has no separate session table.

## Memory responsibilities

Workmory is a persistence and retrieval substrate. It is responsible for durable records, isolation, revision checks, provenance surfaces, and retrieval evidence. It is not responsible for deciding what an agent should believe, which transient reasoning to retain, or how an agent manages its cognitive strategy.

Agents and services should:

- strongly consider `memory_get_last` and `memory_search` when starting durable project work;
- store stable outcomes rather than secrets, temporary chain-of-thought, or untrusted instructions presented as policy;
- use `memory_store` and `memory_update_last` at meaningful milestones or task completion;
- skip memory operations when the user disables them, no stable project exists, or there is no durable content.

These are workflow recommendations, not automatic calls or MCP protocol guarantees.
