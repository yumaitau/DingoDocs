# Agent workflows

DingoDocs treats automated scanners and CLI agents as first-class authors of **draft** findings. Humans keep review, approval, and publish. Nothing is auto-published to the client.

## Scanner → draft → review → publish

1. **Ingest.** An agent or scanner calls `ingest_scanner_results` (or `preview_scanner_import` first). Supported adapters include Nuclei, Nmap, Nessus, OpenVAS, ZAP, Burp, CSV, and JSON. Ingest creates draft findings, a testing-journal note, and a timeline entry.
2. **Draft write-up.** The agent enriches or creates findings with `create_finding_write_up` / `update_finding_write_up`, attaches evidence (`capture_evidence`, `attach_evidence_to_finding`), and records activity (`add_testing_note`, `add_timeline_entry`).
3. **Human review.** Reviewers move findings through the status machine in the UI (or upcoming `transition_finding`). Peer review and QA stay separate from the author.
4. **Publish.** Only after approval do findings become client-visible and land in reports (`create_report` upcoming). Retest and remediation continue in the client portal.

## MCP tools

**Available today:** `list_engagements`, `get_engagement`, `list_findings`, `get_finding`, `create_finding_write_up`, `update_finding_write_up`, `add_testing_note`, `list_notes`, `add_timeline_entry`, `list_timeline`, `list_assets`, `create_asset`, `list_scope`, `ingest_scanner_results`, `preview_scanner_import`, `capture_evidence`, `attach_evidence_to_finding`.

**Being added:** `list_templates`, `transition_finding`, `create_report`.

Connect with stdio (`pnpm mcp` + `DINGODOCS_URL` / `DINGODOCS_API_KEY`) or HTTP JSON-RPC (`POST /api/mcp`).

## CI gate

Export findings to a simple YAML document stream and fail the pipeline when severity exceeds a threshold:

```bash
pnpm dingodocs export-findings --engagement <uuid> --out findings.yaml
pnpm dingodocs gate --file findings.yaml --max-severity high
```

Set `DINGODOCS_API_URL` and `DINGODOCS_API_KEY` for `/api/v1` access, or `DATABASE_URL` for a direct local export. Prefer HTTP when both are available.

## Free tier (Apache-2.0)

The free, self-hosted tier includes review separation of duties, SSO, audit log, multi-org, client portal, and retest. Local AI via Ollama is supported alongside optional cloud providers — keep assessment data on your own hardware when you need it.
