import { randomUUID } from "node:crypto";

const allowedMediaTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "text/plain",
  "text/csv",
  "application/json",
  "application/xml",
  "application/pdf",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.tcpdump.pcap",
  "application/yaml",
]);

const defaultMaxUploadBytes = 104_857_600;
const absoluteMaxUploadBytes = 1_073_741_824;

export function maxUploadBytes() {
  const raw = process.env.MAX_UPLOAD_BYTES;
  if (raw === undefined || raw === "") return defaultMaxUploadBytes;
  if (!/^[0-9]+$/.test(raw)) throw new Error("MAX_UPLOAD_BYTES is invalid");
  const max = Number(raw);
  if (!Number.isSafeInteger(max) || max < 1 || max > absoluteMaxUploadBytes)
    throw new Error("MAX_UPLOAD_BYTES is invalid");
  return max;
}

export function validateUpload(input: {
  size: number;
  mediaType: string;
  filename: string;
}) {
  const max = maxUploadBytes();
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > max)
    throw new Error(`File must be between 1 byte and ${max} bytes`);
  if (!allowedMediaTypes.has(input.mediaType.toLowerCase()))
    throw new Error("File type is not permitted");
  const safeName = input.filename
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 120);
  return {
    safeName: safeName || "evidence",
    storageKey: `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName || "evidence"}`,
  };
}

export function validateContentSignature(
  bytes: Uint8Array,
  declaredMediaType: string,
) {
  const declared = declaredMediaType.toLowerCase();
  const detected = detectMediaType(bytes);
  const compatible =
    detected === declared ||
    (detected === "application/zip" &&
      (declared === "application/zip" ||
        declared ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document")) ||
    (detected === "text/plain" &&
      ["text/plain", "text/csv", "application/yaml"].includes(declared));
  if (!compatible) {
    throw new Error(
      `File content does not match declared media type ${declaredMediaType}`,
    );
  }
  return detected;
}

export function detectMediaType(bytes: Uint8Array) {
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP")
    return "image/webp";
  if (ascii(bytes, 0, 4) === "%PDF") return "application/pdf";
  if (matches(bytes, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  if (ascii(bytes, 4, 8) === "ftyp") return "video/mp4";
  if (
    matches(bytes, [0xd4, 0xc3, 0xb2, 0xa1]) ||
    matches(bytes, [0xa1, 0xb2, 0xc3, 0xd4]) ||
    matches(bytes, [0x0a, 0x0d, 0x0d, 0x0a])
  )
    return "application/vnd.tcpdump.pcap";

  if (bytes.some((byte) => byte === 0)) return "application/octet-stream";
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "application/octet-stream";
  }
  const trimmed = decoded.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(decoded);
      return "application/json";
    } catch {
      return "text/plain";
    }
  }
  if (trimmed.startsWith("<")) return "application/xml";
  return "text/plain";
}

function matches(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

// Browsers render XML (and anything else markup-like) as an active document,
// so only passive media types are previewed as themselves; the rest is shown
// as plain text. Downloads keep the original type.
const inlinePreviewTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "application/pdf",
]);

export function previewContentType(mediaType: string) {
  return inlinePreviewTypes.has(mediaType)
    ? mediaType
    : "text/plain; charset=utf-8";
}
