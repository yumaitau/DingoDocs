import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DingoDocsApiClient,
  type FindingWriteUp,
  type FindingWriteUpPatch,
} from "./client";

const severity = z.enum(["informational", "low", "medium", "high", "critical"]);
const classification = z.enum(["internal", "restricted", "client_visible"]);
const optionalText = z.string().trim().min(1).max(20_000).optional();
const mappings = z
  .array(
    z.object({
      framework: z.string().trim().min(1).max(160),
      reference: z.string().trim().min(1).max(240),
      title: z.string().trim().min(1).max(240).optional(),
    }),
  )
  .max(100)
  .optional();

const findingWriteUp = {
  engagementId: z.string().uuid(),
  identifier: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2).max(240),
  severity,
  likelihood: z.string().trim().min(1).max(120).optional(),
  impact: z.string().trim().min(1).max(120).optional(),
  cvssVector: z.string().trim().min(1).max(180).optional(),
  cvssScore: z
    .string()
    .regex(/^\d{1,2}(\.\d)?$/)
    .optional(),
  executiveSummary: optionalText,
  technicalDetail: optionalText,
  reproductionSteps: optionalText,
  proofOfConcept: optionalText,
  businessImpact: optionalText,
  technicalImpact: optionalText,
  remediation: optionalText,
  verificationGuidance: optionalText,
  references: z.array(z.string().trim().url().max(2_000)).max(100).optional(),
  mappings,
  clientOwner: z.string().trim().min(1).max(240).optional(),
  dueAt: z.string().date().optional(),
  assetIds: z.array(z.string().uuid()).max(100).optional(),
};

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function withErrors<T extends Record<string, z.ZodTypeAny>>(
  handler: (input: z.infer<z.ZodObject<T>>) => Promise<unknown>,
) {
  return async (input: z.infer<z.ZodObject<T>>) => {
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
const server = new McpServer({ name: "dingodocs", version: "0.1.0" });

server.registerTool(
  "list_engagements",
  {
    title: "List DingoDocs engagements",
    description:
      "List the engagements accessible to this scoped DingoDocs credential.",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  withErrors(() => api.listEngagements()),
);

server.registerTool(
  "list_findings",
  {
    title: "List DingoDocs findings",
    description: "List findings, optionally limited to one engagement.",
    inputSchema: { engagementId: z.string().uuid().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  withErrors((input) =>
    api.listFindings((input as { engagementId?: string }).engagementId),
  ),
);

server.registerTool(
  "create_finding_write_up",
  {
    title: "Create a finding write-up",
    description:
      "Create an auditable draft finding from the current testing work. It never publishes or approves a finding.",
    inputSchema: findingWriteUp,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  withErrors((input) => api.createFinding(input as FindingWriteUp)),
);

server.registerTool(
  "update_finding_write_up",
  {
    title: "Update a finding write-up",
    description:
      "Apply a partial write-up update to a draft or in-progress finding and record a required change summary.",
    inputSchema: {
      findingId: z.string().uuid(),
      changeSummary: z.string().trim().min(3).max(500),
      title: findingWriteUp.title.optional(),
      severity: severity.optional(),
      likelihood: findingWriteUp.likelihood,
      impact: findingWriteUp.impact,
      cvssVector: findingWriteUp.cvssVector,
      cvssScore: findingWriteUp.cvssScore,
      executiveSummary: optionalText,
      technicalDetail: optionalText,
      reproductionSteps: optionalText,
      proofOfConcept: optionalText,
      businessImpact: optionalText,
      technicalImpact: optionalText,
      remediation: optionalText,
      verificationGuidance: optionalText,
      references: findingWriteUp.references,
      mappings,
      clientOwner: findingWriteUp.clientOwner,
      dueAt: findingWriteUp.dueAt,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  withErrors((input) => {
    const { findingId, ...patch } = input as {
      findingId: string;
    } & FindingWriteUpPatch;
    return api.updateFinding(findingId, patch);
  }),
);

server.registerTool(
  "capture_evidence",
  {
    title: "Capture CLI evidence",
    description:
      "Store terminal output or one local file as evidence through DingoDocs' validated evidence pipeline. Provide exactly one of content or filePath.",
    inputSchema: {
      engagementId: z.string().uuid(),
      classification: classification.default("restricted"),
      content: z.string().min(1).max(1_000_000).optional(),
      filePath: z.string().min(1).max(4_096).optional(),
      filename: z.string().trim().min(1).max(240).optional(),
      mediaType: z.string().trim().min(1).max(160).optional(),
      restrictionReason: z.string().trim().min(1).max(2_000).optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  withErrors((input) =>
    api.captureEvidence(
      input as Parameters<DingoDocsApiClient["captureEvidence"]>[0],
    ),
  ),
);

server.registerTool(
  "attach_evidence_to_finding",
  {
    title: "Attach evidence to a finding",
    description: "Link existing evidence to a finding in the same engagement.",
    inputSchema: {
      findingId: z.string().uuid(),
      evidenceIds: z.array(z.string().uuid()).min(1).max(100),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  withErrors((input) => {
    const { findingId, evidenceIds } = input as {
      findingId: string;
      evidenceIds: string[];
    };
    return api.linkEvidence(findingId, evidenceIds);
  }),
);

async function main() {
  await server.connect(new StdioServerTransport());
}

void main();
