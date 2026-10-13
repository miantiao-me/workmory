# Security Policy

Workmory handles cross-session agent memories, private attachments, and authenticated MCP endpoints. We take security issues seriously and appreciate responsible disclosure.

## Supported versions

Workmory is currently in active `0.x` development. Security updates and patches are provided exclusively for the latest commit on the `main` branch:

| Version | Supported |
|---|---|
| `main` branch (`0.x`) | :white_check_mark: |
| Historical releases / tags | :x: |

We recommend keeping your deployed worker up to date with the latest `main` commit.

## Reporting a vulnerability

If you discover a security vulnerability in Workmory, please report it privately rather than creating a public issue or discussion.

### Private disclosure channel

Submit your report through GitHub Private Vulnerability Reporting:

- Navigate to the repository's **Security** tab and select **Report a vulnerability**, or go directly to:
  `https://github.com/<owner>/workmory/security/advisories/new`

Do not open public GitHub issues, pull requests, or discussion threads for potential vulnerabilities.

### What to include

To help us investigate and resolve the issue quickly, include:

- A clear description of the vulnerability and its potential impact.
- Affected components (for example: authentication middleware, MCP handlers, attachment APIs, or database queries).
- Minimal reproduction steps, request payloads, or a proof of concept (PoC).
- Any proposed remediation or mitigation, if known.

### Response expectations

- **Acknowledgment**: We aim to confirm receipt of your report within 7 days.
- **Triage and assessment**: We will evaluate severity, reproduce the behavior, and discuss a fix within the private advisory.
- **Coordinated disclosure**: Once a patch is merged and released, we will publish the advisory and credit your contribution.

## Scope and critical areas

We prioritize vulnerabilities affecting core security boundaries and tenant guarantees:

- **Authentication bypass**: Circumvention of Cloudflare Access JWT validation or `ROOT_API_KEY` verification.
- **Tenant and owner isolation breakage**: Unauthorized access across isolated owner domains or between Access subjects and root domains.
- **Credential and secret exposure**: Leakage of API tokens, service bindings, or access keys through MCP responses, error messages, or maintenance endpoints.
- **Unauthorized data access**: Bypassing owner scopes to read, mutate, or purge D1 memory records or private R2 attachment objects.
- **Injection vulnerabilities**: Unintended query or command execution in FTS5 search queries, graph index projections, or Markdown conversions.

### Out of scope

The following are generally considered out of scope:

- Volumetric denial-of-service attacks against Cloudflare infrastructure.
- Issues requiring physical access to a developer's local development environment.
- Social engineering attacks targeting project maintainers.
- Automated vulnerability scanner reports without a verifiable proof of concept.

## Responsible disclosure

We ask security researchers to:

- Allow reasonable time for investigation and remediation before disclosing details publicly.
- Make every effort to avoid privacy violations, data loss, or disruption of production services.
- Never access or modify another user's private memory records during testing.

We commit to working cooperatively with researchers acting in good faith.
