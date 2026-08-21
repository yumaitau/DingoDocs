import type { DingoDocsApiClient } from "./client";
import { getMcpTool, mcpToolJsonSchema, mcpTools } from "./tools";

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_SERVER_INFO = {
  name: "dingodocs",
  version: "0.1.0",
} as const;

export type McpJsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type McpJsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type McpPrincipal = { scopes: string[] };

export function isJsonRpcNotification(value: McpJsonRpcRequest) {
  return value.id === undefined;
}

export async function handleMcpJsonRpc(
  request: McpJsonRpcRequest,
  api: DingoDocsApiClient,
  principal: McpPrincipal,
  options: { allowFilePath?: boolean } = {},
): Promise<McpJsonRpcResponse | null> {
  const id = request.id ?? null;
  if (request.jsonrpc !== "2.0" || !request.method) {
    return error(id, -32600, "Invalid Request");
  }
  if (isJsonRpcNotification(request)) {
    if (request.method === "notifications/initialized" || request.method === "initialized")
      return null;
    return null;
  }
  try {
    if (request.method === "initialize") {
      return result(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          "DingoDocs MCP is a facade over the tenant-scoped REST API. Scanner ingest creates draft findings, testing-journal notes, and timeline events. Findings are never auto-published.",
      });
    }
    if (request.method === "ping") return result(id, {});
    if (request.method === "tools/list") {
      return result(id, {
        tools: mcpTools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: mcpToolJsonSchema(tool.inputSchema),
          annotations: tool.annotations,
        })),
      });
    }
    if (request.method === "tools/call") {
      const name = String(request.params?.name ?? "");
      const tool = getMcpTool(name);
      if (!tool) return error(id, -32601, `Unknown tool: ${name}`);
      const missing = tool.requiredScopes.filter((scope) => !principal.scopes.includes(scope));
      if (missing.length)
        return result(id, textResult(`API key does not grant ${missing.join(", ")}`, true));
      const rawArgs =
        request.params?.arguments && typeof request.params.arguments === "object"
          ? (request.params.arguments as Record<string, unknown>)
          : {};
      if (!options.allowFilePath && typeof rawArgs.filePath === "string")
        return result(
          id,
          textResult(
            "filePath is only supported on the stdio MCP server running beside the scanner",
            true,
          ),
        );
      const parsed = tool.inputSchema.safeParse(rawArgs);
      if (!parsed.success)
        return result(
          id,
          textResult(
            parsed.error.issues.map((issue) => issue.message).join("; ") ||
              "Invalid tool arguments",
            true,
          ),
        );
      const data = await tool.call(api, parsed.data);
      return result(id, textResult(data, false));
    }
    return error(id, -32601, `Method not found: ${request.method}`);
  } catch (cause) {
    return result(
      id,
      textResult(cause instanceof Error ? cause.message : "DingoDocs MCP request failed", true),
    );
  }
}

export function textResult(data: unknown, isError: boolean) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

function result(id: string | number | null, value: unknown): McpJsonRpcResponse {
  return { jsonrpc: "2.0", id, result: value };
}

function error(id: string | number | null, code: number, message: string): McpJsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
