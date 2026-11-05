import { createServer, type Server } from "node:http";
import { type AddressInfo, isIPv6 } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertPublicHttpUrl,
  OutboundHttpError,
  outboundErrorCategory,
  outboundFetch,
  OutboundUrlError,
} from "./outbound-url";

const publicLookup = vi.fn(async () => [
  { address: "93.184.216.34", family: 4 },
]);

describe("assertPublicHttpUrl", () => {
  it("accepts public HTTPS hosts after DNS resolution", async () => {
    await expect(
      assertPublicHttpUrl("https://hooks.example.test/dingodocs", {
        lookup: publicLookup,
      }),
    ).resolves.toBe("https://hooks.example.test/dingodocs");
  });

  it("rejects private literals, metadata hosts, and credentials", async () => {
    await expect(
      assertPublicHttpUrl("https://127.0.0.1/"),
    ).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(
      assertPublicHttpUrl("https://169.254.169.254/latest/meta-data/"),
    ).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(
      assertPublicHttpUrl("https://10.1.2.3/hook"),
    ).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(
      assertPublicHttpUrl("https://2130706433/"),
    ).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(
      assertPublicHttpUrl("https://user:pass@example.com/"),
    ).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(
      assertPublicHttpUrl("https://metadata.google.internal/"),
    ).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(
      assertPublicHttpUrl("http://example.com/"),
    ).rejects.toBeInstanceOf(OutboundUrlError);
  });

  it("allows loopback HTTP only when explicitly requested", async () => {
    await expect(
      assertPublicHttpUrl("http://127.0.0.1:11434", {
        allowHttp: true,
        allowLoopback: true,
      }),
    ).resolves.toBe("http://127.0.0.1:11434/");
    await expect(
      assertPublicHttpUrl("http://127.0.0.1:11434", { allowHttp: true }),
    ).rejects.toBeInstanceOf(OutboundUrlError);
  });

  it("rejects hosts that resolve to a private address", async () => {
    await expect(
      assertPublicHttpUrl("https://evil.example/", {
        lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      }),
    ).rejects.toBeInstanceOf(OutboundUrlError);
  });
});

describe("address blocklist", () => {
  const blocked = [
    "https://[64:ff9b::a9fe:a9fe]/",
    "https://[64:ff9b::7f00:1]/",
    "https://[::a9fe:a9fe]/",
    "https://[::169.254.169.254]/",
    "https://[::ffff:169.254.169.254]/",
    "https://[::ffff:a9fe:a9fe]/",
    "https://[::ffff:0:a9fe:a9fe]/",
    "https://[2002:a9fe:a9fe::1]/",
    "https://[2002:0a00:0001::]/",
    "https://[fec0::1]/",
    "https://[fe80::1]/",
    "https://[fd00::1]/",
    "https://[ff02::1]/",
    "https://[2001:db8::1]/",
    "https://[100::1]/",
    "https://[::]/",
    "https://[::1]/",
    "https://[0:0:0:0:0:0:0:1]/",
    "https://192.0.0.170/",
    "https://192.0.2.10/",
    "https://198.51.100.7/",
    "https://203.0.113.9/",
    "https://240.0.0.1/",
    "https://255.255.255.255/",
    "https://100.64.0.1/",
  ];

  it.each(blocked)("rejects %s", async (value) => {
    await expect(assertPublicHttpUrl(value)).rejects.toBeInstanceOf(
      OutboundUrlError,
    );
  });

  it.each([
    "https://8.8.8.8/",
    "https://1.1.1.1/",
    "https://[2606:4700::1111]/",
    "https://[2001:4860:4860::8888]/",
    "https://[64:ff9b::808:808]/",
    "https://[2002:808:808::1]/",
    "https://192.0.1.1/",
    "https://203.0.114.1/",
  ])("allows public %s", async (value) => {
    await expect(assertPublicHttpUrl(value)).resolves.toBe(value);
  });

  it("rejects hostnames resolving to embedded private IPv4", async () => {
    await expect(
      assertPublicHttpUrl("https://evil.example/", {
        lookup: async () => [{ address: "64:ff9b::a9fe:a9fe", family: 6 }],
      }),
    ).rejects.toBeInstanceOf(OutboundUrlError);
  });
});

describe("outboundFetch", () => {
  let server: Server;
  let port: number;
  let hostHeader: string | undefined;

  beforeAll(async () => {
    server = createServer((request, response) => {
      hostHeader = request.headers.host;
      response.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function rebindingLookup(second: string) {
    let calls = 0;
    return vi.fn(async () => {
      calls += 1;
      return [
        calls === 1
          ? { address: "93.184.216.34", family: 4 }
          : { address: second, family: isIPv6(second) ? 6 : 4 },
      ];
    });
  }

  it.each(["127.0.0.1", "169.254.169.254", "::ffff:127.0.0.1"])(
    "refuses a host that rebinds to %s at connect time",
    async (address) => {
      const lookup = rebindingLookup(address);
      await expect(
        outboundFetch(
          `http://rebind.example:${port}/`,
          {},
          { allowHttp: true, lookup },
        ),
      ).rejects.toBeInstanceOf(OutboundUrlError);
      // Once for the pre-check, once when the socket connects.
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(hostHeader).toBeUndefined();
    },
  );

  it("refuses when any connect-time record is private", async () => {
    let calls = 0;
    const lookup = async () => {
      calls += 1;
      return calls === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [
            { address: "93.184.216.34", family: 4 },
            { address: "10.0.0.5", family: 4 },
          ];
    };
    await expect(
      outboundFetch(
        `http://rebind.example:${port}/`,
        {},
        { allowHttp: true, lookup },
      ),
    ).rejects.toBeInstanceOf(OutboundUrlError);
  });

  it("connects to the validated address and keeps the hostname", async () => {
    const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
    const response = await outboundFetch(
      `http://ollama.example:${port}/api`,
      { method: "POST", body: "{}" },
      { allowHttp: true, allowLoopback: true, lookup },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(hostHeader).toBe(`ollama.example:${port}`);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("refuses redirects", async () => {
    const redirecting = createServer((_request, response) => {
      response.writeHead(302, { location: "http://169.254.169.254/" });
      response.end();
    });
    await new Promise<void>((resolve) =>
      redirecting.listen(0, "127.0.0.1", resolve),
    );
    const redirectPort = (redirecting.address() as AddressInfo).port;
    try {
      await expect(
        outboundFetch(
          `http://127.0.0.1:${redirectPort}/`,
          {},
          { allowHttp: true, allowLoopback: true },
        ),
      ).rejects.toThrow();
    } finally {
      await new Promise((resolve) => redirecting.close(resolve));
    }
  });
});

describe("outboundErrorCategory", () => {
  it("never echoes raw error detail", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1"), {
      code: "ECONNREFUSED",
    });
    expect(
      outboundErrorCategory(new TypeError("fetch failed", { cause: refused })),
    ).toBe("Connection failed");
    expect(
      outboundErrorCategory(
        new DOMException("The operation timed out", "TimeoutError"),
      ),
    ).toBe("Request timed out");
    expect(
      outboundErrorCategory(new OutboundUrlError("URL cannot target")),
    ).toBe("Destination blocked");
    expect(outboundErrorCategory(new OutboundHttpError(503, "x"))).toBe(
      "HTTP 503",
    );
  });
});
