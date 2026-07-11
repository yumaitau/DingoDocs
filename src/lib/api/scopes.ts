export const apiScopes = [
  "engagements:read",
  "engagements:write",
  "clients:read",
  "findings:read",
  "findings:write",
  "reports:read",
  "tasks:read",
  "tasks:write",
  "evidence:write",
  "webhooks:manage",
  "notifications:manage",
] as const;

export type ApiScope = (typeof apiScopes)[number];
