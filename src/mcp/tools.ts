import { z } from "zod";
import type { ApiScope } from "../lib/api/scopes";
import {
  DingoDocsApiClient,
  type FindingWriteUp,
  type FindingWriteUpPatch,
} from "./client";

const severity = z.enum(["informational", "low", "medium", "high", "critical"]);
const classification = z.enum(["internal", "restricted", "client_visible"]);
const optionalText = z.string().trim().min(1).max(20_000).optional();
const adapter = z.enum([
  "nmap",
  "nessus",
  "openvas",
  "zap",
  "burp",
  "nuclei",
  "csv",
  "json",
]);
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

const findingWriteUp = z.object({
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
});

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  requiredScopes: ApiScope[];
  annotations: {
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    openWorldHint: boolean;
  };
  inputSchema: z.ZodObject<z.ZodRawShape>;
  call: (
    api: DingoDocsApiClient,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
};

export const mcpTools: McpToolDefinition[] = [
  {
    name: "list_engagements",
    title: "List engagements",
    description:
      "List the engagements accessible to this scoped DingoDocs credential.",
    requiredScopes: ["engagements:read"],
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({}),
    call: (api) => api.listEngagements(),
  },
  {
    name: "get_engagement",
    title: "Get an engagement",
    description:
      "Read one engagement by id, including current status and dates.",
    requiredScopes: ["engagements:read"],
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({ engagementId: z.string().uuid() }),
    call: (api, input) => api.getEngagement(String(input.engagementId)),
  },
  {
    name: "list_findings",
    title: "List findings",
    description: "List findings, optionally limited to one engagement.",
    requiredScopes: ["findings:read"],
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({ engagementId: z.string().uuid().optional() }),
    call: (api, input) =>
      api.listFindings(
        typeof input.engagementId === "string" ? input.engagementId : undefined,
      ),
  },
  {
    name: "get_finding",
    title: "Get a finding",
    description: "Read one finding write-up by id.",
    requiredScopes: ["findings:read"],
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({ findingId: z.string().uuid() }),
    call: (api, input) => api.getFinding(String(input.findingId)),
  },
  {
    name: "create_finding_write_up",
    title: "Create a finding write-up",
    description:
      "Create an auditable draft finding from the current testing work. It never publishes or approves a finding.",
    requiredScopes: ["findings:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: findingWriteUp,
    call: (api, input) => api.createFinding(input as FindingWriteUp),
  },
  {
    name: "update_finding_write_up",
    title: "Update a finding write-up",
    description:
      "Apply a partial write-up update to a draft or in-progress finding and record a required change summary.",
    requiredScopes: ["findings:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: findingWriteUp
      .omit({ engagementId: true, identifier: true, assetIds: true })
      .partial()
      .extend({
        findingId: z.string().uuid(),
        changeSummary: z.string().trim().min(3).max(500),
      }),
    call: (api, input) => {
      const { findingId, ...patch } = input as {
        findingId: string;
      } & FindingWriteUpPatch;
      return api.updateFinding(findingId, patch);
    },
  },
  {
    name: "add_testing_note",
    title: "Add a testing note",
    description:
      "Record a live testing-journal note against an engagement. Notes are team-visible by default and never published to the client portal.",
    requiredScopes: ["notes:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      title: z.string().trim().min(1).max(240),
      body: z.string().trim().min(1).max(20_000),
      kind: z.enum(["note", "testing_journal"]).optional(),
      visibility: z.enum(["private", "team", "client"]).optional(),
      assetIds: z.array(z.string().uuid()).max(100).optional(),
    }),
    call: (api, input) =>
      api.addNote(
        input as {
          engagementId: string;
          title: string;
          body: string;
          kind?: "note" | "testing_journal";
          visibility?: "private" | "team" | "client";
          assetIds?: string[];
        },
      ),
  },
  {
    name: "list_notes",
    title: "List testing notes",
    description: "List notes and testing-journal entries for an engagement.",
    requiredScopes: ["engagements:read"],
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({ engagementId: z.string().uuid() }),
    call: (api, input) => api.listNotes(String(input.engagementId)),
  },
  {
    name: "add_timeline_entry",
    title: "Add a timeline entry",
    description:
      "Record what happened during testing. Timeline entries default to internal and are not client-visible.",
    requiredScopes: ["notes:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      phase: z.string().trim().min(1).max(120),
      description: z.string().trim().min(1).max(20_000),
      occurredAt: z.string().datetime().optional(),
      commands: z.string().trim().min(1).max(20_000).optional(),
      clientVisible: z.boolean().optional(),
    }),
    call: (api, input) =>
      api.addTimelineEntry(
        input as {
          engagementId: string;
          phase: string;
          description: string;
          occurredAt?: string;
          commands?: string;
          clientVisible?: boolean;
        },
      ),
  },
  {
    name: "list_timeline",
    title: "List timeline entries",
    description: "List testing timeline events for an engagement.",
    requiredScopes: ["engagements:read"],
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({ engagementId: z.string().uuid() }),
    call: (api, input) => api.listTimeline(String(input.engagementId)),
  },
  {
    name: "list_assets",
    title: "List assets",
    description: "List assets discovered or recorded on an engagement.",
    requiredScopes: ["engagements:read"],
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({ engagementId: z.string().uuid() }),
    call: (api, input) => api.listAssets(String(input.engagementId)),
  },
  {
    name: "create_asset",
    title: "Create an asset",
    description: "Record a host, application, or other asset on an engagement.",
    requiredScopes: ["engagements:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      name: z.string().trim().min(1).max(240),
      type: z.string().trim().min(1).max(80),
      identifier: z.string().trim().min(1).max(500),
      environment: z.string().trim().min(1).max(80).optional(),
      owner: z.string().trim().min(1).max(240).optional(),
      criticality: z.string().trim().min(1).max(80).optional(),
    }),
    call: (api, input) =>
      api.createAsset(
        input as {
          engagementId: string;
          name: string;
          type: string;
          identifier: string;
          environment?: string;
          owner?: string;
          criticality?: string;
        },
      ),
  },
  {
    name: "list_scope",
    title: "List approved scope",
    description: "Read the current scope version and items for an engagement.",
    requiredScopes: ["engagements:read"],
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({ engagementId: z.string().uuid() }),
    call: (api, input) => api.listScope(String(input.engagementId)),
  },
  {
    name: "ingest_scanner_results",
    title: "Ingest scanner results",
    description:
      "Parse Nuclei, Nmap, Nessus, OpenVAS, ZAP, Burp, CSV, or JSON output, create draft findings and assets for new records, and write a testing-journal note plus timeline entry. Findings stay draft and are never auto-published. Provide exactly one of content or filePath.",
    requiredScopes: ["imports:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      adapter,
      filename: z.string().trim().min(1).max(240).optional(),
      content: z.string().min(1).max(2_000_000).optional(),
      filePath: z.string().min(1).max(4_096).optional(),
    }),
    call: (api, input) =>
      api.ingestScannerResults({
        ...(input as {
          engagementId: string;
          adapter:
            | "nmap"
            | "nessus"
            | "openvas"
            | "zap"
            | "burp"
            | "nuclei"
            | "csv"
            | "json";
          filename?: string;
          content?: string;
          filePath?: string;
        }),
        mode: "ingest",
      }),
  },
  {
    name: "preview_scanner_import",
    title: "Preview scanner import",
    description:
      "Parse scanner output and return the preview without creating findings. Provide exactly one of content or filePath.",
    requiredScopes: ["imports:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      adapter,
      filename: z.string().trim().min(1).max(240).optional(),
      content: z.string().min(1).max(2_000_000).optional(),
      filePath: z.string().min(1).max(4_096).optional(),
    }),
    call: (api, input) =>
      api.ingestScannerResults({
        ...(input as {
          engagementId: string;
          adapter:
            | "nmap"
            | "nessus"
            | "openvas"
            | "zap"
            | "burp"
            | "nuclei"
            | "csv"
            | "json";
          filename?: string;
          content?: string;
          filePath?: string;
        }),
        mode: "preview",
      }),
  },
  {
    name: "capture_evidence",
    title: "Capture CLI evidence",
    description:
      "Store terminal output or one local file as evidence through DingoDocs' validated evidence pipeline. Provide exactly one of content or filePath.",
    requiredScopes: ["evidence:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      classification: classification.default("restricted"),
      content: z.string().min(1).max(1_000_000).optional(),
      filePath: z.string().min(1).max(4_096).optional(),
      filename: z.string().trim().min(1).max(240).optional(),
      mediaType: z.string().trim().min(1).max(160).optional(),
      restrictionReason: z.string().trim().min(1).max(2_000).optional(),
    }),
    call: (api, input) =>
      api.captureEvidence(
        input as Parameters<DingoDocsApiClient["captureEvidence"]>[0],
      ),
  },
  {
    name: "attach_evidence_to_finding",
    title: "Attach evidence to a finding",
    description: "Link existing evidence to a finding in the same engagement.",
    requiredScopes: ["findings:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      findingId: z.string().uuid(),
      evidenceIds: z.array(z.string().uuid()).min(1).max(100),
    }),
    call: (api, input) => {
      const { findingId, evidenceIds } = input as {
        findingId: string;
        evidenceIds: string[];
      };
      return api.linkEvidence(findingId, evidenceIds);
    },
  },
];

export function getMcpTool(name: string) {
  return mcpTools.find((tool) => tool.name === name);
}

export function mcpToolJsonSchema(schema: z.ZodObject<z.ZodRawShape>) {
  const converted = z.toJSONSchema(schema) as {
    $schema?: string;
    [key: string]: unknown;
  };
  delete converted.$schema;
  return converted;
}
