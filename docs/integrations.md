# Integration operations

Set `INTEGRATION_ENCRYPTION_KEY` to a separately managed high-entropy secret before creating webhooks, notification channels, or AI provider configuration. Back up and rotate it through a planned re-encryption procedure; losing it makes encrypted configuration unusable. Never expose it through a `NEXT_PUBLIC_` variable.

Use service accounts for unattended systems and personal tokens for user-owned scripts. Review key last-used time, scope, and expiry regularly. Revoke unused keys and disable a service account during incident response. Audit events record creation, revocation, webhook rotation, AI configuration, and AI drafts without plaintext secrets.

Webhook receivers must read the raw request bytes before JSON parsing, enforce the timestamp window, compare HMAC signatures in constant time, and atomically claim the event ID before processing. Make handlers idempotent. Monitor retrying/failed delivery rows and dead-letter background jobs.

Notification provider credentials/URLs are encrypted. Templates intentionally omit domain payloads; recipients follow the relative link and authenticate to view authorised content. SMTP and external webhook endpoints require TLS in production.

AI remains off unless `AI_ENABLED=true` and an organisation administrator enables one provider. External provider terms, retention, region, and training controls must be reviewed before opt-in. Users see the exact transfer confirmation and must treat generated text as an untrusted draft requiring human review.
