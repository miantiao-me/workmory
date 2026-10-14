# Web rules

- Read `../DESIGN.md` before visual changes. Its Coss composition, semantic tokens, spacing, responsive behavior, and accessibility requirements are the visual contract; keep business/API behavior separate from visual adaptation.
- Reuse existing Coss primitives and particles. Do not recreate their surfaces with arbitrary colors, borders, radii, or shadows; retain upstream license headers on vendored/adapted code.
- `components/ui/` is vendored Coss code; edits require an explicit user request. Use existing components and business-level wrappers elsewhere.
- The `@/` import alias resolves to `web/` in both TypeScript and Vite.
- Keep English and Simplified Chinese translation keys aligned under `locales/en/` and `locales/zh-CN/`; verify locale changes with `pnpm test test/web-i18n.test.ts`.
- Use `pnpm dev` for Vite/Nitro development and the root verification sequence for runtime changes. Theme and API-client checks are `pnpm test test/web-theme.test.ts test/web-api-client.test.ts`.
