import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "DingoDocs API",
      version: "1.0.0",
      description:
        "Tenant-scoped API for penetration testing engagements and reporting.",
    },
    servers: [{ url: "/api/v1" }],
    paths: {
      "/engagements": {
        get: {
          summary: "List engagements",
          parameters: [
            {
              name: "page",
              in: "query",
              schema: { type: "integer", minimum: 1 },
            },
            {
              name: "pageSize",
              in: "query",
              schema: { type: "integer", maximum: 100 },
            },
            { name: "status", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Paginated engagement list" },
            "401": { description: "Authentication required" },
            "403": { description: "Permission denied" },
          },
        },
      },
    },
  });
}
