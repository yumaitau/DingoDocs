import { describe, expect, it } from "vitest";

const { POST } = await import("./route");

describe("POST /api/v1/findings", () => {
  it("rejects a bad credential before reading the body", async () => {
    const request = new Request("http://localhost/api/v1/findings", {
      method: "POST",
      headers: {
        authorization: "Bearer short",
        "content-type": "application/json",
      },
      body: "{not json",
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });
});
