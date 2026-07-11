# API and automation

The REST API is versioned under `/api/v1`; the OpenAPI 3.1 document at `/api/openapi` is the source of truth for paths, query parameters, bodies, errors, and authentication. List resources use `page`, `pageSize` (maximum 100), documented filtering/sorting, and a consistent `{ data, pagination, requestId }` envelope. Errors use `{ error: { code, message, details? }, requestId }`.

Create personal access tokens or service-account keys under **Integrations**. Select the minimum scopes and an expiry. Plaintext beginning `dd_pat_` or `dd_svc_` is displayed once; only its prefix and SHA-256 hash are stored. Send it as `Authorization: Bearer <token>`. Personal keys stop working when their owner leaves the organisation, service keys stop when the service account is disabled, and revoked/expired credentials are rejected. Resource queries always derive the organisation from the credential and ignore client-supplied tenant identifiers.

```bash
curl -H "Authorization: Bearer $DINGODOCS_API_KEY" \
  'https://dingodocs.example/api/v1/findings?page=1&pageSize=25&severity=high'
```

Webhook deliveries have a unique `X-DingoDocs-Event-Id`, Unix `X-DingoDocs-Timestamp`, and `X-DingoDocs-Signature: v1=<hex HMAC-SHA256>`. Verify the signature over `<timestamp>.<raw body>` with constant-time comparison, reject timestamps more than five minutes old, and persist event IDs to reject replay. During the 24-hour rotation window the previous secret signature is also sent as `X-DingoDocs-Signature-Previous`. Non-2xx deliveries retry with exponential backoff and appear in the Integrations failure count.

Notification channels support in-app, SMTP, Teams, Slack, Discord, and generic webhooks. Their encrypted configuration and background deliveries use a restricted template containing only event type, short title, recipient, and relative DingoDocs link—never finding detail, evidence, credentials, or report content.

AI providers are disabled by default at deployment and organisation levels. Enabling Ollama, OpenAI, or Anthropic stores credentials encrypted with `INTEGRATION_ENCRYPTION_KEY`; every request also requires the exact data-transfer confirmation. Prompts are hashed for audit, outputs are marked `untrusted_draft`, and no draft is applied automatically. The OpenAI adapter uses the server-side [Responses API create endpoint](https://developers.openai.com/api/reference/resources/responses/methods/create) with `store: false`.
