import { describe, expect, it } from "vitest";
import {
  previewContentType,
  validateContentSignature,
  validateUpload,
} from "./upload";

describe("upload validation", () => {
  it("normalises filenames and creates an opaque key", () => {
    const result = validateUpload({
      size: 12,
      mediaType: "image/png",
      filename: " proof (final).png ",
    });
    expect(result.safeName).toBe("-proof-final-.png-");
    expect(result.storageKey).not.toContain("..");
  });

  it("rejects a non-numeric MAX_UPLOAD_BYTES override", () => {
    const previous = process.env.MAX_UPLOAD_BYTES;
    process.env.MAX_UPLOAD_BYTES = "unlimited";
    try {
      expect(() =>
        validateUpload({
          size: 12,
          mediaType: "image/png",
          filename: "proof.png",
        }),
      ).toThrow("MAX_UPLOAD_BYTES is invalid");
    } finally {
      if (previous === undefined) delete process.env.MAX_UPLOAD_BYTES;
      else process.env.MAX_UPLOAD_BYTES = previous;
    }
  });

  it("rejects executable and oversized content", () => {
    expect(() =>
      validateUpload({
        size: 12,
        mediaType: "application/x-msdownload",
        filename: "payload.exe",
      }),
    ).toThrow("not permitted");
    expect(() =>
      validateUpload({
        size: 200_000_000,
        mediaType: "image/png",
        filename: "huge.png",
      }),
    ).toThrow("between");
  });

  it("rejects a file whose signature does not match its media type", () => {
    expect(() =>
      validateContentSignature(
        new TextEncoder().encode("not an image"),
        "image/png",
      ),
    ).toThrow("does not match");
  });

  it("accepts JSON and common image signatures", () => {
    expect(
      validateContentSignature(
        new TextEncoder().encode('{"finding":"WEB-001"}'),
        "application/json",
      ),
    ).toBe("application/json");
    expect(
      validateContentSignature(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png",
      ),
    ).toBe("image/png");
  });
});

describe("previewContentType", () => {
  it("keeps passive media types and renders everything else as text", () => {
    expect(previewContentType("image/png")).toBe("image/png");
    expect(previewContentType("application/pdf")).toBe("application/pdf");
    for (const type of ["application/xml", "application/json", "text/csv"])
      expect(previewContentType(type)).toBe("text/plain; charset=utf-8");
  });
});
