# Attachment rules

- These rules apply to `server/attachments/`. Read this file too when changing attachment HTTP handlers or memory attachment ingestion elsewhere.
- Remote import has no hostname allowlist. Accept only HTTPS on the default port without userinfo; validate the initial URL and every redirect, with at most three redirects.
- Fetch with explicit outbound headers; never forward caller credentials, cookies, Access assertions, or root keys. Persist only source origin/path, excluding query and fragment values.
- Preserve the 20-second network/body cap, 45-second AI conversion cap, and absolute 60-second whole-import deadline. Individual steps must respect the remaining overall time.
- Preserve the 8 MiB attachment and 900 KiB converted-Markdown limits (`types.ts`), including bounded streaming reads; the canonical OKF limit still applies after assembling memory frontmatter and body.
- Converted attachments are body content, including any frontmatter-looking text. They cannot overwrite caller metadata or automatically create verification claims.
- Keep original/converted R2 objects private and immutable under opaque keys; preserve staging, idempotency, and cleanup safeguards.
- Validate pure format/conversion behavior with `pnpm test test/attachments.test.ts`; remote-import changes also require `pnpm test:workers test/workers/attachment-remote.test.ts` and the root verification sequence. Real Workers AI conversion still needs staging validation.
