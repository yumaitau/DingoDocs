import { describe, expect, it } from "vitest";
import { validateContentSignature, validateUpload } from "./upload";

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
