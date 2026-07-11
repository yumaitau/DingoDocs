import { describe, expect, it } from "vitest";
import { validateUpload } from "./upload";

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
});
