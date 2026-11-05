import { afterEach, describe, expect, it } from "vitest";
import { apiError } from "@/lib/api/responses";
import {
  formDataWithLimit,
  InvalidJsonBodyError,
  jsonWithLimit,
  maxUploadRequestBytes,
  optionalJsonWithLimit,
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

function jsonRequest(body: BodyInit | null, headers?: HeadersInit) {
  return new Request("http://localhost/api/v1/findings", {
    method: "POST",
    body,
    headers,
  });
}

describe("jsonWithLimit", () => {
  it("parses UTF-8 JSON within the limit", async () => {
    await expect(
      jsonWithLimit(jsonRequest(JSON.stringify({ title: "Café" }))),
    ).resolves.toEqual({ title: "Café" });
  });

  it("rejects a body over the default 1 MiB limit with 413", async () => {
    const body = JSON.stringify({ text: "x".repeat(1_048_576) });
    const error = await jsonWithLimit(jsonRequest(body)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(RequestBodyTooLargeError);
    const response = apiError(error, "req-1");
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "payload_too_large" },
      requestId: "req-1",
    });
  });

  it("rejects an oversized streamed body without content-length", async () => {
    const chunks = Array.from({ length: 10 }, () =>
      new TextEncoder().encode('"aaaa'),
    );
    const { request, pulledCount } = streamedRequest(chunks);
    await expect(jsonWithLimit(request, 12)).rejects.toMatchObject({
      status: 413,
    });
    expect(pulledCount()).toBeLessThan(chunks.length);
  });

  it("honours a custom limit and declared content-length", async () => {
    const request = jsonRequest('{"a":1}', { "content-length": "4000000" });
    await expect(jsonWithLimit(request, 3 * 1_048_576)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
    expect(request.bodyUsed).toBe(false);
  });

  it("maps malformed, empty and non-UTF-8 bodies to 400", async () => {
    for (const body of [
      "{not json",
      "",
      new Uint8Array([0x7b, 0xff, 0x7d]),
    ] as BodyInit[]) {
      const error = await jsonWithLimit(jsonRequest(body)).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(InvalidJsonBodyError);
      expect(error).toBeInstanceOf(SyntaxError);
      const response = apiError(error);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_json" },
      });
    }
  });

  it("treats an empty optional body as an empty object", async () => {
    await expect(optionalJsonWithLimit(jsonRequest(null))).resolves.toEqual({});
    await expect(
      optionalJsonWithLimit(jsonRequest('{"notes":"x"}')),
    ).resolves.toEqual({ notes: "x" });
    await expect(
      optionalJsonWithLimit(jsonRequest("{bad")),
    ).rejects.toBeInstanceOf(InvalidJsonBodyError);
  });
});
