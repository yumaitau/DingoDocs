import { afterEach, describe, expect, it } from "vitest";
import {
  formDataWithLimit,
  maxUploadRequestBytes,
  readBodyWithLimit,
  RequestBodyTooLargeError,
} from "./request-body";

function streamedRequest(chunks: Uint8Array[], headers?: HeadersInit) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulled++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  const request = new Request("http://localhost/upload", {
    method: "POST",
    body: stream,
    headers,
    duplex: "half",
  } as RequestInit);
  return { request, pulledCount: () => pulled };
}

describe("readBodyWithLimit", () => {
  afterEach(() => {
    delete process.env.MAX_UPLOAD_REQUEST_BYTES;
    delete process.env.MAX_UPLOAD_BYTES;
  });

  it("accepts a body exactly at the limit", async () => {
    const { request } = streamedRequest([new Uint8Array(6), new Uint8Array(4)]);
    const body = await readBodyWithLimit(request, 10);
    expect(body.byteLength).toBe(10);
  });

  it("aborts a streamed body without content-length once over the limit", async () => {
    const chunks = Array.from({ length: 10 }, () => new Uint8Array(4));
    const { request, pulledCount } = streamedRequest(chunks);
    expect(request.headers.get("content-length")).toBeNull();
    await expect(readBodyWithLimit(request, 10)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
    expect(pulledCount()).toBeLessThan(chunks.length);
  });

  it("rejects an oversized content-length before reading", async () => {
    const { request } = streamedRequest([new Uint8Array(1)], {
      "content-length": "11",
    });
    await expect(readBodyWithLimit(request, 10)).rejects.toMatchObject({
      status: 413,
    });
    expect(request.bodyUsed).toBe(false);
  });

  it("parses form data within the limit", async () => {
    const form = new FormData();
    form.set("classification", "internal");
    form.set("files", new File(["hello"], "a.txt", { type: "text/plain" }));
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: form,
    });
    const parsed = await formDataWithLimit(request, 10_000);
    expect(parsed.get("classification")).toBe("internal");
    expect((parsed.get("files") as File).size).toBe(5);
  });

  it("derives the aggregate cap from MAX_UPLOAD_BYTES unless overridden", () => {
    process.env.MAX_UPLOAD_BYTES = "1000";
    expect(maxUploadRequestBytes()).toBe(1000 + 1_048_576);
    process.env.MAX_UPLOAD_REQUEST_BYTES = "5000";
    expect(maxUploadRequestBytes()).toBe(5000);
    process.env.MAX_UPLOAD_REQUEST_BYTES = "nope";
    expect(() => maxUploadRequestBytes()).toThrow();
  });
});
