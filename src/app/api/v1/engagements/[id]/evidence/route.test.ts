import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadEvidence = vi.fn();

vi.mock("@/lib/api/authentication", () => ({
  apiWriteContext: vi.fn(async () => ({
    organisationId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    apiKeyId: "key",
    scopes: ["evidence:write"],
  })),
}));
vi.mock("@/lib/api/responses", () => ({
  apiError: (error: unknown) =>
    Response.json({ error: String(error) }, { status: 500 }),
  resolveRequestId: (id?: string | null) => id || "req",
}));
vi.mock("@/server/services/evidence", () => ({
  EvidenceDuplicateError: class extends Error {},
  scopedEvidenceActor: vi.fn(),
  uploadEvidence: (...args: unknown[]) => uploadEvidence(...args),
}));

const { POST } = await import("./route");

const engagementId = "00000000-0000-4000-8000-000000000003";
const params = { params: Promise.resolve({ id: engagementId }) };

async function multipart(fileBytes: number) {
  const form = new FormData();
  form.set("classification", "internal");
  form.set(
    "files",
    new File([new Uint8Array(fileBytes)], "a.txt", { type: "text/plain" }),
  );
  const encoded = new Request("http://localhost", {
    method: "POST",
    body: form,
  });
  return {
    body: new Uint8Array(await encoded.arrayBuffer()),
    contentType: encoded.headers.get("content-type")!,
  };
}

function streamed(body: Uint8Array, headers: Record<string, string>) {
  const chunkSize = 64;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= body.byteLength) return controller.close();
      controller.enqueue(body.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Request(`http://localhost/api/v1/engagements/${engagementId}`, {
    method: "POST",
    body: stream,
    headers,
    duplex: "half",
  } as RequestInit);
}

describe("POST /api/v1/engagements/[id]/evidence body limits", () => {
  beforeEach(() => {
    uploadEvidence.mockReset();
    uploadEvidence.mockResolvedValue({
      id: "e1",
      originalFilename: "a.txt",
      sha256: "x",
      version: 1,
    });
  });
  afterEach(() => {
    delete process.env.MAX_UPLOAD_REQUEST_BYTES;
  });

  it("returns 413 for an oversized streamed body without content-length", async () => {
    process.env.MAX_UPLOAD_REQUEST_BYTES = "1024";
    const { body, contentType } = await multipart(4096);
    const response = await POST(
      streamed(body, { "content-type": contentType }),
      params,
    );
    expect(response.status).toBe(413);
    expect(uploadEvidence).not.toHaveBeenCalled();
  });

  it("accepts a body exactly at the aggregate cap", async () => {
    const { body, contentType } = await multipart(100);
    process.env.MAX_UPLOAD_REQUEST_BYTES = String(body.byteLength);
    const response = await POST(
      streamed(body, { "content-type": contentType }),
      params,
    );
    expect(response.status).toBe(201);
    expect(uploadEvidence).toHaveBeenCalledOnce();
  });

  it("rejects an oversized content-length before reading the body", async () => {
    process.env.MAX_UPLOAD_REQUEST_BYTES = "1024";
    const { body, contentType } = await multipart(100);
    const request = streamed(body, {
      "content-type": contentType,
      "content-length": "999999",
    });
    const response = await POST(request, params);
    expect(response.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });
});
