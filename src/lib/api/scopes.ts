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
  "notes:write",
  "imports:write",
  "webhooks:manage",
  "notifications:manage",
] as const;

export type ApiScope = (typeof apiScopes)[number];

export const mcpRecommendedScopes: readonly ApiScope[] = [
  "engagements:read",
  "engagements:write",
  "findings:read",
  "findings:write",
  "evidence:write",
  "notes:write",
  "imports:write",
];
