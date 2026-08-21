import { NextResponse } from "next/server";
import { apiScopes } from "@/lib/api/scopes";

const paginationParameters = [
  {
    name: "page",
    in: "query",
    schema: { type: "integer", minimum: 1, default: 1 },
  },
  {
    name: "pageSize",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
  },
];
const standardResponses = {
  "400": { $ref: "#/components/responses/ValidationError" },
  "401": { $ref: "#/components/responses/AuthenticationError" },
  "403": { $ref: "#/components/responses/PermissionError" },
};
const paginated = (
  resource: string,
  scope: string,
  parameters: object[] = [],
) => ({
  summary: `List ${resource}`,
  security: [{ bearerAuth: [scope] }, { cookieAuth: [] }],
  parameters: [...paginationParameters, ...parameters],
  responses: {
    "200": {
      description: `Tenant-scoped paginated ${resource} list`,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/PaginatedResponse" },
        },
      },
    },
    ...standardResponses,
  },
});

export function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "DingoDocs API",
      version: "1.0.0",
      description:
        "Versioned, tenant-scoped API. Bearer credentials are shown once, hashed at rest, and restricted to explicit scopes.",
    },
    servers: [{ url: "/api/v1" }],
    paths: {
      "/clients": {
        get: paginated("clients", "clients:read", [
          {
            name: "q",
            in: "query",
            schema: { type: "string", maxLength: 100 },
          },
          {
            name: "sort",
            in: "query",
            schema: { enum: ["name", "createdAt"] },
          },
          { name: "order", in: "query", schema: { enum: ["asc", "desc"] } },
        ]),
      },
      "/engagements": {
        get: paginated("engagements", "engagements:read", [
          { name: "status", in: "query", schema: { type: "string" } },
          {
            name: "sort",
            in: "query",
            schema: { enum: ["name", "createdAt"] },
          },
          { name: "order", in: "query", schema: { enum: ["asc", "desc"] } },
        ]),
        post: {
          summary: "Create an engagement",
          security: [{ bearerAuth: ["engagements:write"] }, { cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateEngagement" },
              },
            },
          },
          responses: {
            "201": { description: "Engagement created" },
            "404": { description: "Client not found in the active tenant" },
            ...standardResponses,
          },
        },
      },
      "/findings": {
        get: paginated("findings", "findings:read", [
          {
            name: "engagementId",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
          { name: "status", in: "query", schema: { type: "string" } },
          {
            name: "severity",
            in: "query",
            schema: {
              enum: ["informational", "low", "medium", "high", "critical"],
            },
          },
        ]),
      },
      "/reports": {
        get: paginated("reports", "reports:read", [
          {
            name: "engagementId",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
          { name: "status", in: "query", schema: { type: "string" } },
        ]),
      },
      "/tasks": {
        get: paginated("tasks", "tasks:read", [
          {
            name: "engagementId",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
          { name: "status", in: "query", schema: { type: "string" } },
          {
            name: "sort",
            in: "query",
            schema: { enum: ["createdAt", "dueAt", "priority"] },
          },
        ]),
      },
      "/engagements/{id}": {
        get: {
          summary: "Get an engagement",
          security: [{ bearerAuth: ["engagements:read"] }, { cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Engagement" },
            "404": { description: "Engagement not found in the active tenant" },
            ...standardResponses,
          },
        },
      },
      "/engagements/{id}/notes": {
        get: {
          summary: "List engagement notes",
          security: [{ bearerAuth: ["engagements:read"] }, { cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: { "200": { description: "Notes" }, ...standardResponses },
        },
        post: {
          summary: "Create a testing-journal note",
          security: [{ bearerAuth: ["notes:write"] }, { cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "201": { description: "Note created" },
            ...standardResponses,
          },
        },
      },
      "/engagements/{id}/timeline": {
        get: {
          summary: "List testing timeline events",
          security: [{ bearerAuth: ["engagements:read"] }, { cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Timeline" },
            ...standardResponses,
          },
        },
        post: {
          summary: "Record a testing timeline event",
          security: [{ bearerAuth: ["notes:write"] }, { cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "201": { description: "Timeline entry created" },
            ...standardResponses,
          },
        },
      },
      "/engagements/{id}/assets": {
        get: {
          summary: "List engagement assets",
          security: [{ bearerAuth: ["engagements:read"] }, { cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: { "200": { description: "Assets" }, ...standardResponses },
        },
        post: {
          summary: "Create an engagement asset",
          security: [{ bearerAuth: ["engagements:write"] }, { cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "201": { description: "Asset created" },
            ...standardResponses,
          },
        },
      },
      "/engagements/{id}/scope": {
        get: {
          summary: "Read the current scope version and items",
          security: [{ bearerAuth: ["engagements:read"] }, { cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: { "200": { description: "Scope" }, ...standardResponses },
        },
      },
      "/engagements/{id}/imports": {
        post: {
          summary:
            "Preview or ingest scanner output as draft findings, a testing-journal note, and a timeline event",
          security: [{ bearerAuth: ["imports:write"] }, { cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ScannerIngest" },
              },
            },
          },
          responses: {
            "201": { description: "Scanner output ingested as drafts" },
            ...standardResponses,
          },
        },
      },
      "/findings/{id}": {
        get: {
          summary: "Get a finding",
          security: [{ bearerAuth: ["findings:read"] }, { cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Finding" },
            "404": { description: "Finding not found in the active tenant" },
            ...standardResponses,
          },
        },
      },
      "/engagements/{id}/evidence": {
        post: {
          summary: "Upload validated evidence",
          security: [{ bearerAuth: ["evidence:write"] }, { cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["files"],
                  properties: {
                    files: {
                      type: "array",
                      maxItems: 25,
                      items: { type: "string", format: "binary" },
                    },
                    classification: {
                      enum: ["internal", "restricted", "client_visible"],
                    },
                    retentionUntil: { type: "string", format: "date" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Evidence created" },
            "207": { description: "Partial batch success" },
            ...standardResponses,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "dd_pat or dd_svc",
          description: `Available scopes: ${apiScopes.join(", ")}`,
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
        },
      },
      schemas: {
        CreateEngagement: {
          type: "object",
          additionalProperties: false,
          required: ["clientId", "name", "reference", "type"],
          properties: {
            clientId: { type: "string", format: "uuid" },
            name: { type: "string", minLength: 2, maxLength: 200 },
            reference: { type: "string", minLength: 2, maxLength: 80 },
            type: { type: "string", minLength: 2, maxLength: 120 },
            startDate: { type: "string", format: "date" },
            endDate: { type: "string", format: "date" },
            objectives: { type: "string", maxLength: 10000 },
          },
        },
        ScannerIngest: {
          type: "object",
          additionalProperties: false,
          required: ["adapter", "content"],
          properties: {
            adapter: {
              enum: [
                "nmap",
                "nessus",
                "openvas",
                "zap",
                "burp",
                "nuclei",
                "csv",
                "json",
              ],
            },
            filename: { type: "string", maxLength: 240 },
            content: { type: "string", maxLength: 2000000 },
            mode: { enum: ["preview", "ingest"], default: "ingest" },
          },
        },
        PaginatedResponse: {
          type: "object",
          required: ["data", "pagination"],
          properties: {
            data: { type: "array", items: { type: "object" } },
            pagination: {
              type: "object",
              required: ["page", "pageSize", "total"],
              properties: {
                page: { type: "integer" },
                pageSize: { type: "integer" },
                total: { type: "integer" },
              },
            },
            requestId: { type: ["string", "null"] },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: { type: "array" },
              },
            },
            requestId: { type: ["string", "null"] },
          },
        },
      },
      responses: {
        ValidationError: {
          description: "Zod validation failed",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        AuthenticationError: {
          description: "Session or API key required",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        PermissionError: {
          description: "Permission or API scope denied",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
      },
    },
  });
}
