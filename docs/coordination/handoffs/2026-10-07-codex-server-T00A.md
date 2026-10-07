# Handoff: T00A — static server dependency security update
- Agent: codex-server   Date: 2026-10-07   Branch: agent/codex/T00A

## What changed
- Updated packages/server/package.json from @fastify/static ^8.0.0 to ^10.1.5 to remove the known path traversal and route guard bypass advisory range.
- Preserved server implementation and static root / SPA fallback configuration.
- No new dependency was introduced; this is an existing dependency upgrade for security fixes.

## Contracts touched
None.

## How to verify
- Ops integration owner runs npm install to refresh the lockfile, then npm audit, npm run typecheck, npm test, npm run build and production static serving smoke checks.
- Check a built asset, a screen route using the index.html fallback, and an unknown /api path returning 404.
- Delegate verified npm registry metadata and the tagged upstream documentation; installation and application checks remain with the integration owner.

## Gotchas / decisions
- The [tagged upstream compatibility table](https://github.com/fastify/fastify-static/blob/v10.1.5/README.md#compatibility) explicitly maps plugin >=8.x to Fastify ^5.x, covering the current Fastify ^5.2.0 manifest.
- The [case-folding advisory](https://github.com/fastify/fastify-static/security/advisories/GHSA-r799-r9gc-m956) affects versions <10.1.4; the selected 10.1.5 includes that patch and subsequent fixes. 8.x does not cover this advisory.
- Registry metadata: npm view @fastify/static@10.1.5 version engines dependencies --json reports glob ^13.0.0, fastify-plugin ^6.0.0, @fastify/send ^4.0.0 and content-disposition ^3.0.0. content-disposition@3.0.0 requires Node >=22; glob@13.0.0 requires Node 20 or >=22. **Ops must align runtime requirements to Node >=22 before shipping this dependency update.**
- Security hardening rejects non-canonical and differently cased static paths with 403, including on Windows. Normal generated asset URLs and sendFile('index.html') remain documented APIs; no source change identified from inspection.

## Follow-ups
- R2 manifest request completed. Integration owner retains lockfile installation, runtime documentation alignment and full verification ownership.
