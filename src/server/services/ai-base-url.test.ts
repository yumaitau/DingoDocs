import { afterEach, describe, expect, it, vi } from "vitest";
import { providerBaseUrl } from "./ai";

describe("providerBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows loopback HTTP Ollama outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(
      providerBaseUrl("ollama", "http://127.0.0.1:11434/"),
    ).resolves.toBe("http://127.0.0.1:11434");
  });

  it("rejects tenant-supplied loopback or HTTP Ollama URLs in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OLLAMA_BASE_URL", "");
    await expect(
      providerBaseUrl("ollama", "http://127.0.0.1:6379"),
    ).rejects.toThrow();
    await expect(
      providerBaseUrl("ollama", "http://127.0.0.1:11434/?x=1"),
    ).resolves.toBe("http://127.0.0.1:11434");
    await expect(providerBaseUrl("ollama", "http://1.1.1.1")).rejects.toThrow(
      "HTTPS",
    );
    await expect(
      providerBaseUrl("ollama", "https://10.0.0.5:11434"),
    ).rejects.toThrow("private network");
  });

  it("allows the operator-configured Ollama origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OLLAMA_BASE_URL", "http://10.0.0.5:11434");
    await expect(
      providerBaseUrl("ollama", "http://10.0.0.5:11434/"),
    ).resolves.toBe("http://10.0.0.5:11434");
    await expect(providerBaseUrl("ollama")).resolves.toBe(
      "http://10.0.0.5:11434",
    );
    await expect(
      providerBaseUrl("ollama", "http://10.0.0.6:11434"),
    ).rejects.toThrow();
  });

  it("trusts the standard local Ollama origin in production by default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OLLAMA_BASE_URL", "");
    await expect(providerBaseUrl("ollama")).resolves.toBe(
      "http://127.0.0.1:11434",
    );
    await expect(
      providerBaseUrl("ollama", "http://localhost:11434"),
    ).resolves.toBe("http://localhost:11434");
  });

  it("keeps public HTTPS rules for production Ollama URLs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(providerBaseUrl("ollama", "https://1.1.1.1/")).resolves.toBe(
      "https://1.1.1.1",
    );
  });
});
