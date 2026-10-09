<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## DingoDocs agent pack

1. Scanners and CLI agents author **draft** findings only — never auto-publish.
2. Flow: ingest scanner results → draft write-up → human review → publish.
3. Use MCP: `ingest_scanner_results`, `preview_scanner_import`, `create_finding_write_up`,
   `update_finding_write_up`, `capture_evidence`, `attach_evidence_to_finding`,
   `add_testing_note`, `add_timeline_entry`, `list_timeline`, plus list/get helpers.
4. Upcoming MCP: `list_templates`, `transition_finding`, `create_report`.
5. Humans own peer review, QA, and client visibility; agents stay on drafts.
6. CI: `pnpm dingodocs export-findings` then `pnpm dingodocs gate --max-severity high`.
7. Prefer `DINGODOCS_API_URL` + `DINGODOCS_API_KEY` against `/api/v1`; else `DATABASE_URL`.
8. Free tier (Apache-2.0): SoD review, SSO, audit log, multi-org, portal, retest.
9. Local AI via Ollama is supported for on-prem write-up assistance.
10. See `docs/agent-workflows.md` for the full scanner → publish path.
