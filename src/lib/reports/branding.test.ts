import { describe, expect, it } from "vitest";
import { logoBytes, safeLogoDataUri } from "./branding";

describe("report branding logos", () => {
  it("accepts compact PNG data URIs and rejects remote URLs", () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    expect(safeLogoDataUri(png)).toBe(png);
    expect(logoBytes(png)?.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(safeLogoDataUri("https://evil.example/logo.png")).toBeUndefined();
    expect(safeLogoDataUri("data:image/svg+xml;base64,PHN2Zz4=")).toBeUndefined();
  });
});
