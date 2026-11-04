import { maxScannerImportBytes } from "@/lib/imports/adapters";
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

/** Default cap for JSON API request bodies (1 MiB). */
export const defaultJsonBodyLimit = 1_048_576;

/**
 * Envelope cap for requests that carry scanner source inline (MCP JSON-RPC,
 * the imports API). JSON escaping can roughly double the source, so allow
 * twice the decoded limit plus 64 KiB for the surrounding fields. The decoded
 * content is still validated against maxScannerImportBytes.
 */
export const scannerImportEnvelopeBytes = 2 * maxScannerImportBytes + 65_536;

/** Malformed JSON request body; mapped to 400 by apiError. */
export class InvalidJsonBodyError extends SyntaxError {
  readonly status = 400;

  constructor() {
    super("Request body is not valid JSON");
    this.name = "InvalidJsonBodyError";
  }
}

async function readUtf8WithLimit(request: Request, limit: number) {
  const body = await readBodyWithLimit(request, limit);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new InvalidJsonBodyError();
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidJsonBodyError();
  }
}

/**
 * Reads a UTF-8 JSON body after enforcing the byte limit. Oversized bodies
 * throw RequestBodyTooLargeError (413); malformed JSON, including an empty
 * body, throws InvalidJsonBodyError (400).
 */
export async function jsonWithLimit(
  request: Request,
  limit = defaultJsonBodyLimit,
): Promise<unknown> {
  return parseJson(await readUtf8WithLimit(request, limit));
}

/**
 * As jsonWithLimit, but an empty body is treated as `{}` for endpoints whose
 * body is entirely optional. Malformed JSON is still rejected.
 */
export async function optionalJsonWithLimit(
  request: Request,
  limit = defaultJsonBodyLimit,
): Promise<unknown> {
  const text = await readUtf8WithLimit(request, limit);
  return text.trim() ? parseJson(text) : {};
}

/** Parses multipart/urlencoded form data only after enforcing the byte limit. */
export async function formDataWithLimit(request: Request, limit: number) {
  const body = await readBodyWithLimit(request, limit);
  const contentType = request.headers.get("content-type");
  return new Response(body, {
    headers: contentType ? { "content-type": contentType } : undefined,
  }).formData();
}
