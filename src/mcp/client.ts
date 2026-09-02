import { basename } from "node:path";
import { readFile } from "node:fs/promises";

type ApiEnvelope<T> = { data: T };

export type FindingWriteUp = {
  engagementId: string;
  identifier: string;
  title: string;
  severity: "informational" | "low" | "medium" | "high" | "critical";
  likelihood?: string;
  impact?: string;
  cvssVector?: string;
  cvssScore?: string;
  executiveSummary?: string;
  technicalDetail?: string;
  reproductionSteps?: string;
  proofOfConcept?: string;
  businessImpact?: string;
  technicalImpact?: string;
  remediation?: string;
  verificationGuidance?: string;
  references?: string[];
  mappings?: Array<{ framework: string; reference: string; title?: string }>;
  clientOwner?: string;
  dueAt?: string;
  assetIds?: string[];
};

export type FindingWriteUpPatch = Omit<
  Partial<FindingWriteUp>,
  "engagementId" | "identifier" | "assetIds"
> & {
  changeSummary: string;
};

export type ScannerAdapter =
  "nmap" | "nessus" | "openvas" | "zap" | "burp" | "nuclei" | "csv" | "json";

export class DingoDocsApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  static fromEnvironment() {
    const baseUrl = process.env.DINGODOCS_URL?.replace(/\/+$/, "");
    const apiKey = process.env.DINGODOCS_API_KEY;
    if (!baseUrl) throw new Error("DINGODOCS_URL is required");
    if (!apiKey) throw new Error("DINGODOCS_API_KEY is required");
    return new DingoDocsApiClient(baseUrl, apiKey);
  }

  static fromRequest(request: Request, apiKey: string) {
    return new DingoDocsApiClient(new URL(request.url).origin, apiKey);
  }

  listEngagements() {
    return this.request<unknown[]>("engagements?pageSize=100");
  }

  getEngagement(engagementId: string) {
    return this.request<unknown>(`engagements/${engagementId}`);
  }

  listFindings(engagementId?: string) {
    const query = new URLSearchParams({ pageSize: "100" });
    if (engagementId) query.set("engagementId", engagementId);
    return this.request<unknown[]>(`findings?${query}`);
  }

  getFinding(findingId: string) {
    return this.request<unknown>(`findings/${findingId}`);
  }

  createFinding(input: FindingWriteUp) {
    return this.request<unknown>("findings", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateFinding(findingId: string, input: FindingWriteUpPatch) {
    return this.request<unknown>(`findings/${findingId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  listNotes(engagementId: string) {
    return this.request<unknown[]>(`engagements/${engagementId}/notes`);
  }

  addNote(input: {
    engagementId: string;
    title: string;
    body: string;
    kind?: "note" | "testing_journal";
    visibility?: "private" | "team" | "client";
    assetIds?: string[];
  }) {
    const { engagementId, ...body } = input;
    return this.request<unknown>(`engagements/${engagementId}/notes`, {
      method: "POST",
      body: JSON.stringify({
        kind: "testing_journal",
        visibility: "team",
        ...body,
      }),
    });
  }

  listTimeline(engagementId: string) {
    return this.request<unknown[]>(`engagements/${engagementId}/timeline`);
  }

  addTimelineEntry(input: {
    engagementId: string;
    phase: string;
    description: string;
    occurredAt?: string;
    commands?: string;
    clientVisible?: boolean;
  }) {
    const { engagementId, ...body } = input;
    return this.request<unknown>(`engagements/${engagementId}/timeline`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  listAssets(engagementId: string) {
    return this.request<unknown[]>(`engagements/${engagementId}/assets`);
  }

  createAsset(input: {
    engagementId: string;
    name: string;
    type: string;
    identifier: string;
    environment?: string;
    owner?: string;
    criticality?: string;
  }) {
    const { engagementId, ...body } = input;
    return this.request<unknown>(`engagements/${engagementId}/assets`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  listScope(engagementId: string) {
    return this.request<unknown>(`engagements/${engagementId}/scope`);
  }

  async ingestScannerResults(input: {
    engagementId: string;
    adapter: ScannerAdapter;
    filename?: string;
    content?: string;
    filePath?: string;
    mode?: "preview" | "ingest";
  }) {
    if (Boolean(input.content) === Boolean(input.filePath))
      throw new Error("Provide exactly one of content or filePath");
    const content = input.filePath
      ? await readFile(input.filePath, "utf8")
      : (input.content ?? "");
    const filename =
      input.filename ??
      (input.filePath ? basename(input.filePath) : "scanner-output.txt");
    return this.request<unknown>(`engagements/${input.engagementId}/imports`, {
      method: "POST",
      body: JSON.stringify({
        adapter: input.adapter,
        filename,
        content,
        mode: input.mode ?? "ingest",
      }),
    });
  }

  async captureEvidence(input: {
    engagementId: string;
    classification: "internal" | "restricted" | "client_visible";
    content?: string;
    filePath?: string;
    filename?: string;
    mediaType?: string;
    restrictionReason?: string;
  }) {
    if (Boolean(input.content) === Boolean(input.filePath))
      throw new Error("Provide exactly one of content or filePath");
    const form = new FormData();
    const filename =
      input.filename ??
      (input.filePath ? basename(input.filePath) : "terminal-output.txt");
    const mediaType = input.mediaType ?? "text/plain";
    const bytes = input.filePath
      ? await readFile(input.filePath)
      : Buffer.from(input.content ?? "", "utf8");
    form.append("files", new File([bytes], filename, { type: mediaType }));
    form.set("classification", input.classification);
    if (input.restrictionReason)
      form.set("restrictionReason", input.restrictionReason);
    return this.request<unknown>(`engagements/${input.engagementId}/evidence`, {
      method: "POST",
      body: form,
    });
  }

  linkEvidence(findingId: string, evidenceIds: string[]) {
    return this.request<unknown>(`findings/${findingId}/evidence`, {
      method: "POST",
      body: JSON.stringify({ evidenceIds }),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    headers.set("X-DingoDocs-Source", "mcp");
    if (init.body && !(init.body instanceof FormData))
      headers.set("Content-Type", "application/json");
    const response = await fetch(`${this.baseUrl}/api/v1/${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => null)) as
      ApiEnvelope<T> | { error?: { message?: string } } | null;
    if (!response.ok)
      throw new Error(
        body && "error" in body && body.error?.message
          ? body.error.message
          : `DingoDocs API request failed with ${response.status}`,
      );
    if (!body || !("data" in body))
      throw new Error("DingoDocs API returned an invalid response");
    return body.data;
  }
}
