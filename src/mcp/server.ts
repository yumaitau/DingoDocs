import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DingoDocsApiClient } from "./client";
import { MCP_SERVER_INFO } from "./protocol";
import { mcpTools } from "./tools";

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function withErrors(
  handler: (input: Record<string, unknown>) => Promise<unknown>,
) {
  return async (input: Record<string, unknown>) => {
    try {
      return textResult(await handler(input));
    } catch (error) {
      console.error(error);
      return {
        content: [
          {
            type: "text" as const,
            text:
              error instanceof Error
                ? error.message
                : "DingoDocs MCP request failed",
          },
        ],
        isError: true,
      };
    }
  };
}

const api = DingoDocsApiClient.fromEnvironment();
const server = new McpServer({
  name: MCP_SERVER_INFO.name,
  version: MCP_SERVER_INFO.version,
});

for (const tool of mcpTools) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema.shape,
      annotations: tool.annotations,
    },
    withErrors((input) => tool.call(api, input)),
  );
}

async function main() {
  await server.connect(new StdioServerTransport());
}

void main();
