import { describe, expect, it, vi } from "vitest";
import { authClient } from "./client";

describe("OAuth sign-in client", () => {
  it.each(["google", "github", "microsoft-entra-id", "corporate-sso"])(
    "sends %s through the social endpoint",
    async (provider) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            url: "https://id.example/authorize",
            redirect: false,
          }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
      );

      const result = await authClient.signIn.social(
        {
          provider,
          callbackURL: "/dashboard",
        },
        { customFetchImpl: fetch, baseURL: "http://localhost:3000/api/auth" },
      );

      expect(result.error).toBeNull();
      const [url, options] = fetch.mock.calls[0];
      expect(String(url)).toMatch(/\/sign-in\/social$/);
      expect(JSON.parse(options.body)).toMatchObject({
        provider,
        callbackURL: "/dashboard",
      });
    },
  );
});
