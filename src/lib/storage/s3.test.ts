import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachmentDisposition,
  downloadContentType,
  S3StorageProvider,
} from "./s3";

describe("S3 download headers", () => {
  beforeEach(() => {
    vi.stubEnv("S3_BUCKET", "evidence-test");
    vi.stubEnv("S3_REGION", "ap-southeast-2");
    vi.stubEnv("S3_ACCESS_KEY_ID", "AKIAEXAMPLE");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "example-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves only passive image types with their stored type", () => {
    expect(downloadContentType("image/png")).toBe("image/png");
    expect(downloadContentType("IMAGE/JPEG; charset=binary")).toBe(
      "image/jpeg",
    );
    for (const type of [
      "application/pdf",
      "text/html",
      "image/svg+xml",
      "application/xml",
      undefined,
    ])
      expect(downloadContentType(type)).toBe("application/octet-stream");
  });

  it("encodes filenames so they cannot break the header", () => {
    expect(attachmentDisposition()).toBe("attachment");
    expect(attachmentDisposition('a"b\r\nx.png')).toBe(
      `attachment; filename="a_b_x.png"; filename*=UTF-8''a%22b%0D%0Ax.png`,
    );
    expect(attachmentDisposition("résumé (1).pdf")).toBe(
      `attachment; filename="r_sum_ (1).pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%281%29.pdf`,
    );
  });

  it("presigns downloads as attachments with a safe content type", async () => {
    const provider = new S3StorageProvider("s3");
    const signed = new URL(
      await provider.createDownloadUrl("org/evidence/1", 120, {
        filename: "report.pdf",
        contentType: "application/pdf",
      }),
    );
    expect(signed.searchParams.get("response-content-disposition")).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
    expect(signed.searchParams.get("response-content-type")).toBe(
      "application/octet-stream",
    );
  });
});
