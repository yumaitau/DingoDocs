import { describe, expect, it } from "vitest";
import {
  osaiFileStem,
  osaiReadiness,
  parseReportSections,
  safeReportImage,
} from "./layout";
import { osaiReportTemplate } from "./osai-template";

describe("report layout safety and OSAI preparation", () => {
  it("includes both chains, one shared controller, standalone host and an appendix", () => {
    const template = osaiReportTemplate();
    expect(parseReportSections(template.sections)).toHaveLength(46);
    for (const id of [
      "chain-1-host-3",
      "chain-2-host-3",
      "domain-controller",
      "standalone",
      "appendix",
    ])
      expect(template.sections.some((section) => section.id === id)).toBe(true);
    expect(osaiReadiness(template.sections, "")).toHaveLength(3);
  });
  it("uses the required filename without allowing path or header injection", () => {
    expect(osaiFileStem(" os-123456 ")).toBe("OSAI-OS-123456-Exam-Report");
    for (const value of ["../123", "OS-12345\r\nattachment", "OS-XXXXX"])
      expect(() => osaiFileStem(value)).toThrow();
  });
  it("rejects remote images, executable markup, oversized images and unknown blocks", () => {
    for (const uri of [
      "https://internal/image.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "javascript:alert(1)",
      "data:image/png;base64,iVBORw0KGgo" + "A".repeat(9_000_000),
    ])
      expect(safeReportImage(uri)).toBeUndefined();
    expect(() =>
      parseReportSections([{ id: "one", type: "script" }]),
    ).toThrow();
    expect(() =>
      parseReportSections([
        {
          id: "one",
          type: "image",
          options: { imageDataUri: "https://internal" },
        },
      ]),
    ).toThrow();
    expect(() =>
      parseReportSections([
        { id: "same", type: "prose" },
        { id: "same", type: "prose" },
      ]),
    ).toThrow();
  });
});
