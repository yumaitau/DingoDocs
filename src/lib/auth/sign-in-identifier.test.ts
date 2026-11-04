import { describe, expect, it } from "vitest";
import { emailIdentifier, isEmailSignInPath } from "./sign-in-identifier";

const url = "http://localhost:3000/api/auth/sign-in/email";

function request(body: BodyInit | null, contentType?: string) {
  return new Request(url, {
    method: "POST",
    headers: contentType ? { "content-type": contentType } : {},
    body,
  });
}

describe("emailIdentifier", () => {
  it("ignores endpoints other than email sign-in", async () => {
    expect(
      await emailIdentifier(
        new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
          method: "POST",
          body: "{}",
        }),
      ),
    ).toBeUndefined();
    expect(isEmailSignInPath("/api/auth/sign-in/email/")).toBe(true);
  });

  it("reads a JSON body", async () => {
    expect(
      await emailIdentifier(
        request(
          JSON.stringify({ email: " Person@Example.com ", password: "x" }),
          "application/json",
        ),
      ),
    ).toBe("person@example.com");
  });

  it("reads a form-encoded body so the lockout cannot be bypassed", async () => {
    expect(
      await emailIdentifier(
        request(
          new URLSearchParams({ email: "Person@Example.com", password: "x" }),
          "application/x-www-form-urlencoded",
        ),
      ),
    ).toBe("person@example.com");
  });

  it("reads a multipart body", async () => {
    const form = new FormData();
    form.set("email", "person@example.com");
    form.set("password", "x");
    const multipart = new Request(url, { method: "POST", body: form });
    expect(await emailIdentifier(multipart)).toBe("person@example.com");
  });

  it("leaves the original body readable", async () => {
    const original = request(
      new URLSearchParams({ email: "person@example.com" }),
      "application/x-www-form-urlencoded",
    );
    await emailIdentifier(original);
    expect((await original.formData()).get("email")).toBe("person@example.com");
  });

  it("returns null when the identifier cannot be extracted", async () => {
    expect(await emailIdentifier(request("email=a", "text/plain"))).toBeNull();
    expect(await emailIdentifier(request("{}", undefined))).toBeNull();
    expect(
      await emailIdentifier(request("{not json", "application/json")),
    ).toBeNull();
    expect(
      await emailIdentifier(request(JSON.stringify(null), "application/json")),
    ).toBeNull();
    expect(
      await emailIdentifier(
        request(JSON.stringify({ email: ["a@b.c"] }), "application/json"),
      ),
    ).toBeNull();
    expect(
      await emailIdentifier(
        request(JSON.stringify({ email: "   " }), "application/json"),
      ),
    ).toBeNull();
  });
});
