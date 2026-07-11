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

export function validateUpload(input: {
  size: number;
  mediaType: string;
  filename: string;
}) {
  const max = Number(process.env.MAX_UPLOAD_BYTES ?? 104_857_600);
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
