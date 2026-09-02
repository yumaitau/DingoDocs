import { describe, expect, it, vi } from "vitest";
import { DingoDocsApiClient } from "./client";
import { handleMcpJsonRpc, MCP_PROTOCOL_VERSION } from "./protocol";
import { mcpTools } from "./tools";

function client() {
  return {
    listEngagements: vi.fn(async () => [{ id: "eng-1" }]),
    ingestScannerResults: vi.fn(async (input: { mode?: string }) => ({
      mode: input.mode,
      publication: "draft",
    })),
  } as unknown as DingoDocsApiClient;
}

describe("MCP JSON-RPC protocol", () => {
  it("lists the live-testing tool catalog", async () => {
    const response = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      client(),
      { scopes: ["engagements:read"] },
    );
    expect(response?.result).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "ingest_scanner_results" }),
        expect.objectContaining({ name: "add_testing_note" }),
        expect.objectContaining({ name: "add_timeline_entry" }),
      ]),
    });
    expect(mcpTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_engagements",
        "create_finding_write_up",
        "ingest_scanner_results",
      ]),
    );
  });

  it("initializes and enforces tool scopes without publishing findings", async () => {
    const api = client();
    const init = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      api,
      { scopes: [] },
    );
    expect(init?.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: "dingodocs" },
    });
    const denied = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "ingest_scanner_results",
          arguments: {
            engagementId: "00000000-0000-4000-8000-000000000001",
            adapter: "nuclei",
            content: "{}",
          },
        },
      },
      api,
      { scopes: ["findings:write"] },
    );
    expect(denied?.result).toMatchObject({ isError: true });
    const allowed = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "ingest_scanner_results",
          arguments: {
            engagementId: "00000000-0000-4000-8000-000000000001",
            adapter: "nuclei",
            content: '{"info":{"name":"x","severity":"low"}}',
          },
        },
      },
      api,
      { scopes: ["imports:write"] },
      { allowFilePath: false },
    );
    expect(allowed?.result).toMatchObject({ isError: false });
    expect(api.ingestScannerResults).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "ingest" }),
    );
  });

  it("rejects server-side filePath on HTTP MCP", async () => {
    const response = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "ingest_scanner_results",
          arguments: {
            engagementId: "00000000-0000-4000-8000-000000000001",
            adapter: "nuclei",
            filePath: "/etc/passwd",
          },
        },
      },
      client(),
      { scopes: ["imports:write"] },
      { allowFilePath: false },
    );
    expect(response?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(response)).toContain("filePath is only supported");
  });
});
