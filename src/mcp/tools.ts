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
      attackMappings: z.string().trim().max(2_000).optional(),
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
          attackMappings?: string;
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
  {
    name: "list_templates",
    title: "List finding templates",
    description:
      "List finding templates in the organisation library. Read-only; does not create or approve templates.",
    requiredScopes: ["findings:read"],
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({
      q: z.string().trim().max(200).optional(),
      approvedOnly: z.boolean().optional(),
    }),
    call: (api, input) =>
      api.listTemplates(
        input as { q?: string; approvedOnly?: boolean },
      ),
  },
  {
    name: "get_template",
    title: "Get a finding template",
    description: "Read one finding template by id from the organisation library.",
    requiredScopes: ["findings:read"],
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({ templateId: z.string().uuid() }),
    call: (api, input) => api.getTemplate(String(input.templateId)),
  },
  {
    name: "create_finding_from_template",
    title: "Create a finding from a template",
    description:
      "Create a draft finding from an approved template. Does not publish or approve the finding.",
    requiredScopes: ["findings:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      templateId: z.string().uuid(),
      identifier: z.string().trim().min(1).max(80),
      assetIds: z.array(z.string().uuid()).max(100).optional(),
    }),
    call: (api, input) =>
      api.createFindingFromTemplate(
        input as {
          engagementId: string;
          templateId: string;
          identifier: string;
          assetIds?: string[];
        },
      ),
  },
  {
    name: "create_report",
    title: "Create a report",
    description:
      "Create a draft report for an engagement from a report template. Does not publish or approve the report.",
    requiredScopes: ["findings:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      title: z.string().trim().min(2).max(240),
      templateId: z.string().uuid(),
      kind: z.string().trim().min(1).max(80).optional(),
    }),
    call: (api, input) =>
      api.createReport(
        input as {
          engagementId: string;
          title: string;
          templateId: string;
          kind?: string;
        },
      ),
  },
  {
    name: "transition_report",
    title: "Transition a report",
    description:
      "Move a report to another workflow status. Publishing and archival require report:publish; review gates require finding:approve.",
    requiredScopes: ["findings:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      reportId: z.string().uuid(),
      status: z.enum([
        "draft",
        "internal_review",
        "changes_requested",
        "qa_approved",
        "client_review",
        "approved",
        "published",
        "superseded",
        "archived",
      ]),
    }),
    call: (api, input) =>
      api.transitionReport(String(input.reportId), String(input.status)),
  },
  {
    name: "export_report",
    title: "Export a report",
    description:
      "Return export metadata for a report format (key, media type, download path). Queues generation when the export is missing. Does not return file bytes.",
    requiredScopes: ["reports:read"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      reportId: z.string().uuid(),
      format: z.enum(["pdf", "docx", "html", "markdown", "json"]),
    }),
    call: (api, input) =>
      api.exportReport(String(input.reportId), String(input.format)),
  },
  {
    name: "list_tasks",
    title: "List tasks",
    description: "List engagement tasks, optionally limited to one engagement.",
    requiredScopes: ["tasks:read"],
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({ engagementId: z.string().uuid().optional() }),
    call: (api, input) =>
      api.listTasks(
        typeof input.engagementId === "string" ? input.engagementId : undefined,
      ),
  },
  {
    name: "create_task",
    title: "Create a task",
    description:
      "Create an engagement task for tracking work. Does not complete or cancel existing tasks.",
    requiredScopes: ["tasks:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      title: z.string().trim().min(2).max(200),
      description: z.string().trim().max(10_000).optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      assigneeId: z.string().uuid().optional(),
      dueAt: z.string().datetime().optional(),
      assetIds: z.array(z.string().uuid()).max(100).optional(),
    }),
    call: (api, input) =>
      api.createTask(
        input as {
          engagementId: string;
          title: string;
          description?: string;
          priority?: "low" | "normal" | "high" | "urgent";
          assigneeId?: string;
          dueAt?: string;
          assetIds?: string[];
        },
      ),
  },
  {
    name: "transition_finding",
    title: "Transition a finding",
    description:
      "Move a finding to another workflow status with an optional reason. Approval and publish statuses require finding:approve. Does not delete findings.",
    requiredScopes: ["findings:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      findingId: z.string().uuid(),
      status: z.enum([
        "draft",
        "in_progress",
        "ready_for_review",
        "changes_requested",
        "peer_reviewed",
        "qa_approved",
        "published",
        "remediation_in_progress",
        "ready_for_retest",
        "retested",
        "resolved",
        "risk_accepted",
        "closed",
      ]),
      reason: z.string().trim().max(4_000).optional(),
    }),
    call: (api, input) => {
      const { findingId, status, reason } = input as {
        findingId: string;
        status: string;
        reason?: string;
      };
      return api.transitionFinding(findingId, { status, reason });
    },
  },
  {
    name: "request_retest",
    title: "Request a retest",
    description:
      "Open a retest attempt against a finding with optional notes. Does not complete or schedule the retest.",
    requiredScopes: ["findings:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      findingId: z.string().uuid(),
      notes: z.string().trim().max(10_000).optional(),
    }),
    call: (api, input) =>
      api.requestRetest(
        String(input.findingId),
        typeof input.notes === "string" ? input.notes : undefined,
      ),
  },
  {
    name: "complete_runbook_step",
    title: "Complete a runbook step",
    description:
      "Update an engagement runbook step status (defaults to completed) with optional notes and links. Does not delete runbooks.",
    requiredScopes: ["engagements:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      stepId: z.string().uuid(),
      status: z
        .enum([
          "not_started",
          "in_progress",
          "completed",
          "blocked",
          "not_applicable",
        ])
        .optional(),
      notes: z.string().trim().max(10_000).optional(),
      findingId: z.string().uuid().nullable().optional(),
      evidenceId: z.string().uuid().nullable().optional(),
      taskId: z.string().uuid().nullable().optional(),
    }),
    call: (api, input) =>
      api.completeRunbookStep(
        input as {
          engagementId: string;
          stepId: string;
          status?: string;
          notes?: string;
          findingId?: string | null;
          evidenceId?: string | null;
          taskId?: string | null;
        },
      ),
  },
  {
    name: "log_time",
    title: "Log time",
    description:
      "Record a billable or non-billable time entry against an engagement. Does not edit or delete prior entries.",
    requiredScopes: ["engagements:write"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      category: z.string().trim().min(2).max(80),
      hours: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/),
      description: z.string().trim().max(10_000).optional(),
      startedAt: z.string().datetime(),
      billable: z.boolean().optional(),
    }),
    call: (api, input) =>
      api.logTime(
        input as {
          engagementId: string;
          category: string;
          hours: string;
          description?: string;
          startedAt: string;
          billable?: boolean;
        },
      ),
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
