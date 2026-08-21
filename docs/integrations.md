# Integration operations

Set `INTEGRATION_ENCRYPTION_KEY` to a separately managed high-entropy secret before creating webhooks, notification channels, or AI provider configuration. Back up and rotate it through a planned re-encryption procedure; losing it makes encrypted configuration unusable. Never expose it through a `NEXT_PUBLIC_` variable.

Use service accounts for unattended scanners and personal tokens for user-owned CLI agents. Review key last-used time, scope, and expiry regularly. Revoke unused keys and disable a service account during incident response. Audit events record creation, revocation, webhook rotation, AI configuration, scanner ingest, and AI drafts without plaintext secrets.

The MCP server is a first-class integration surface, not an add-on. Stdio (`pnpm mcp` with `DINGODOCS_URL` and `DINGODOCS_API_KEY`) and HTTP (`POST /api/mcp`) share one tool catalog and always call `/api/v1`. Recommended scanner scopes: `engagements:read`, `engagements:write`, `findings:read`, `findings:write`, `evidence:write`, `notes:write`, `imports:write`. `ingest_scanner_results` parses Nuclei, Nmap, Nessus, OpenVAS, ZAP, Burp, CSV, or JSON, creates **draft** findings only, and writes a testing-journal note plus timeline entry. HTTP MCP rejects `filePath` so the application host is not used as a file oracle.

White-label report branding lives on the organisation and on the report template (`branding.whiteLabel`, colours, contact fields, and PNG/JPEG logo data URIs). Exports never fetch remote logo URLs.

Webhook receivers must read the raw request bytes before JSON parsing, enforce the timestamp window, compare HMAC signatures in constant time, and atomically claim the event ID before processing. Make handlers idempotent. Monitor retrying/failed delivery rows and dead-letter background jobs.

Notification provider credentials/URLs are encrypted. Templates intentionally omit domain payloads; recipients follow the relative link and authenticate to view authorised content. SMTP and external webhook endpoints require TLS in production.

AI remains off unless `AI_ENABLED=true` and an organisation administrator enables one provider. External provider terms, retention, region, and training controls must be reviewed before opt-in. Users see the exact transfer confirmation and must treat generated text as an untrusted draft requiring human review.
