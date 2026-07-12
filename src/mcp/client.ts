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

  listEngagements() {
    return this.request<unknown[]>("engagements?pageSize=100");
  }

  listFindings(engagementId?: string) {
    const query = new URLSearchParams({ pageSize: "100" });
    if (engagementId) query.set("engagementId", engagementId);
    return this.request<unknown[]>(`findings?${query}`);
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
