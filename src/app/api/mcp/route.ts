import { NextResponse } from "next/server";
import { bearerToken, requireApiBearer } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { DingoDocsApiClient } from "@/mcp/client";
import {
  handleMcpJsonRpc,
  isJsonRpcNotification,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  type McpJsonRpcRequest,
} from "@/mcp/protocol";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ...MCP_SERVER_INFO,
    transport: "jsonrpc",
    protocolVersion: MCP_PROTOCOL_VERSION,
    endpoint: "/api/mcp",
    authentication: "Bearer dd_pat_ or dd_svc_ API key",
  });
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const principal = await requireApiBearer(request);
    const token = bearerToken(request);
    if (!token) throw new Error("Bearer API key is required");
    const api = DingoDocsApiClient.fromRequest(request, token);
    const payload = (await request.json()) as McpJsonRpcRequest;
    const response = await handleMcpJsonRpc(payload, api, principal, {
      allowFilePath: false,
    });
    if (response === null || isJsonRpcNotification(payload))
      return new NextResponse(null, { status: 202 });
    return NextResponse.json(response);
  } catch (error) {
    return apiError(error, requestId);
  }
}
