import { beforeEach, describe, expect, it, vi } from "vitest";
import { maxScannerImportBytes } from "@/lib/imports/adapters";
import { scannerImportEnvelopeBytes } from "@/lib/security/request-body";

const handleMcpJsonRpc = vi.fn(async (payload: { id?: number }) => ({
  jsonrpc: "2.0",
  id: payload.id ?? null,
  result: { isError: false },
}));

vi.mock("@/lib/api/authentication", () => ({
  requireApiBearer: vi.fn(async () => ({
    organisationId: "org",
    apiKeyId: "key",
    scopes: ["imports:write"],
  })),
  bearerToken: () => "dd_pat_abcdefghijklmnopqrstuvwxyz0123456789",
}));
vi.mock("@/mcp/protocol", () => ({
  handleMcpJsonRpc: (payload: { id?: number }) => handleMcpJsonRpc(payload),
  isJsonRpcNotification: (payload: { id?: unknown }) =>
    payload.id === undefined,
  MCP_PROTOCOL_VERSION: "2024-11-05",
  MCP_SERVER_INFO: { name: "dingodocs", version: "test" },
}));

const { POST } = await import("./route");

function envelope(content: string) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "ingest_scanner_results",
      arguments: {
        engagementId: "00000000-0000-4000-8000-000000000001",
        adapter: "json",
        content,
      },
    },
  });
}

function post(body: string) {
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer dd_pat_abcdefghijklmnopqrstuvwxyz0123456789",
        "content-type": "application/json",
      },
      body,
    }),
  );
}

describe("POST /api/mcp body limit", () => {
  beforeEach(() => {
    handleMcpJsonRpc.mockClear();
  });

  it("allows the largest scanner source after JSON escaping", () => {
    // Quotes and backslashes escape to two bytes each.
    const worstCase = envelope('"'.repeat(maxScannerImportBytes));
    expect(new TextEncoder().encode(worstCase).byteLength).toBeLessThanOrEqual(
      scannerImportEnvelopeBytes,
    );
  });

  it("accepts a 1.2 MB scanner envelope", async () => {
    const body = envelope("x".repeat(1_200_000));
    expect(body.length).toBeGreaterThan(1_048_576);
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(handleMcpJsonRpc).toHaveBeenCalledOnce();
  });

  it("returns 413 for an envelope over the cap", async () => {
    const response = await post(
      envelope("x".repeat(scannerImportEnvelopeBytes)),
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "payload_too_large" },
    });
    expect(handleMcpJsonRpc).not.toHaveBeenCalled();
  });
});
