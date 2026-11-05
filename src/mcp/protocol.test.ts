import { describe, expect, it, vi } from "vitest";
import { DingoDocsApiClient } from "./client";
import { handleMcpJsonRpc, MCP_PROTOCOL_VERSION } from "./protocol";
import { findingTransitionPermission } from "../server/services/findings";
import { reportTransitionPermission } from "../lib/reports/transition-permission";
import { findingStatusEnum, reportStatusEnum } from "../db/schema/enums";
import {
  agentFindingTransitionTargets,
  agentReportTransitionTargets,
  getMcpTool,
  mcpToolJsonSchema,
  mcpTools,
} from "./tools";

const uuid = "00000000-0000-4000-8000-000000000009";

function client() {
  return {
    listEngagements: vi.fn(async () => [{ id: "eng-1" }]),
    ingestScannerResults: vi.fn(async (input: { mode?: string }) => ({
      mode: input.mode,
      publication: "draft",
    })),
    transitionFinding: vi.fn(async () => ({ ok: true })),
    transitionReport: vi.fn(async () => ({ ok: true })),
  } as unknown as DingoDocsApiClient;
}

describe("MCP JSON-RPC protocol", () => {
  it("lists the live-testing tool catalog", async () => {
    const response = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      client(),
      {
        scopes: [
          "engagements:read",
          "engagements:write",
          "findings:write",
          "notes:write",
          "imports:write",
        ],
      },
    );
    expect(response?.result).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "ingest_scanner_results" }),
        expect.objectContaining({ name: "add_testing_note" }),
        expect.objectContaining({ name: "add_timeline_entry" }),
      ]),
    });
    const limited = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      client(),
      { scopes: ["engagements:read"] },
    );
    const names = (
      limited?.result as { tools: Array<{ name: string }> } | undefined
    )?.tools.map((tool) => tool.name);
    expect(names).toContain("list_engagements");
    expect(names).not.toContain("ingest_scanner_results");
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

  it("only offers agents authoring transition targets", () => {
    for (const status of agentFindingTransitionTargets)
      expect(findingTransitionPermission(status)).toBe("finding:create");
    for (const status of findingStatusEnum.enumValues)
      if (findingTransitionPermission(status) === "finding:create")
        expect(agentFindingTransitionTargets).toContain(status);
    for (const status of agentReportTransitionTargets)
      expect(reportTransitionPermission(status)).toBe("finding:create");
    for (const status of reportStatusEnum.enumValues)
      if (reportTransitionPermission(status) === "finding:create")
        expect(agentReportTransitionTargets).toContain(status);

    const findingSchema = mcpToolJsonSchema(
      getMcpTool("transition_finding")!.inputSchema,
    ) as { properties: { status: { enum: string[] } } };
    expect(findingSchema.properties.status.enum).toEqual([
      ...agentFindingTransitionTargets,
    ]);
    const reportSchema = mcpToolJsonSchema(
      getMcpTool("transition_report")!.inputSchema,
    ) as { properties: { status: { enum: string[] } } };
    expect(reportSchema.properties.status.enum).toEqual([
      ...agentReportTransitionTargets,
    ]);
  });

  it.each([
    ["transition_finding", { findingId: uuid, status: "published" }],
    ["transition_finding", { findingId: uuid, status: "closed" }],
    ["transition_finding", { findingId: uuid, status: "qa_approved" }],
    ["transition_report", { reportId: uuid, status: "published" }],
    ["transition_report", { reportId: uuid, status: "approved" }],
    ["transition_report", { reportId: uuid, status: "qa_approved" }],
  ])("rejects %s to a human decision for any key type", async (name, args) => {
    const api = client();
    const response = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name, arguments: args },
      },
      api,
      { scopes: ["findings:write"] },
    );
    expect(response?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(response)).toContain(
      "Approval and publication are human decisions; use the DingoDocs UI",
    );
    expect(api.transitionFinding).not.toHaveBeenCalled();
    expect(api.transitionReport).not.toHaveBeenCalled();
  });

  it("passes authoring transitions through to the REST API", async () => {
    const api = client();
    const response = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "transition_finding",
          arguments: { findingId: uuid, status: "ready_for_review" },
        },
      },
      api,
      { scopes: ["findings:write"] },
    );
    expect(response?.result).toMatchObject({ isError: false });
    expect(api.transitionFinding).toHaveBeenCalledWith(uuid, {
      status: "ready_for_review",
      reason: undefined,
    });
  });

  it("rejects human decisions in the tool handler used by the stdio server", async () => {
    const api = client();
    await expect(
      getMcpTool("transition_report")!.call(api, {
        reportId: uuid,
        status: "published",
      }),
    ).rejects.toThrow("Approval and publication are human decisions");
    expect(api.transitionReport).not.toHaveBeenCalled();
  });
});
