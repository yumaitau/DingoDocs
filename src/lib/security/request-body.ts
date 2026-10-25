import { maxUploadBytes } from "./upload";

/** Allowance for multipart boundaries, part headers and small text fields. */
const multipartOverheadBytes = 1_048_576;

export class RequestBodyTooLargeError extends Error {
  readonly status = 413;

  constructor(readonly limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Aggregate cap for one upload request: MAX_UPLOAD_REQUEST_BYTES when set,
 * otherwise MAX_UPLOAD_BYTES plus multipart overhead.
 */
export function maxUploadRequestBytes() {
  const raw = process.env.MAX_UPLOAD_REQUEST_BYTES;
  if (raw === undefined || raw === "")
    return maxUploadBytes() + multipartOverheadBytes;
  const max = Number(raw);
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(max) || max < 1)
    throw new Error("MAX_UPLOAD_REQUEST_BYTES is invalid");
  return max;
}

/**
 * Reads the request body, counting streamed bytes, and aborts as soon as the
 * limit is exceeded. A declared Content-Length over the limit is rejected
 * before any bytes are read.
 */
export async function readBodyWithLimit(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    /^[0-9]+$/.test(declared) &&
    Number(declared) > limit
  )
    throw new RequestBodyTooLargeError(limit);
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError(limit);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Parses multipart/urlencoded form data only after enforcing the byte limit. */
export async function formDataWithLimit(request: Request, limit: number) {
  const body = await readBodyWithLimit(request, limit);
  const contentType = request.headers.get("content-type");
  return new Response(body, {
    headers: contentType ? { "content-type": contentType } : undefined,
  }).formData();
}
