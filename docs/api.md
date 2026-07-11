# API

The REST API is versioned under `/api/v1`. JSON responses use `data` plus pagination metadata. Errors use a stable `error.code`, a safe message, optional validation details, and a request identifier.

The machine-readable OpenAPI document is served from `/api/openapi`. The initial engagement listing endpoint supports page, page size, status, sorting, and ordering while always deriving organisation scope from the authenticated session.

Personal access tokens and service-account keys are stored only as hashes; plaintext values are shown once at creation. Route implementations must require both authentication and declared scopes before calling tenant-aware services.
