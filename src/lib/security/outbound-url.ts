import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup as defaultLookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from "undici";

export class OutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundUrlError";
  }
}

/** A non-2xx reply from an outbound destination, keeping only the status. */
export class OutboundHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OutboundHttpError";
  }
}

export type HostLookup = (
  host: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

export type OutboundUrlOptions = {
  allowHttp?: boolean;
  allowLoopback?: boolean;
  lookup?: HostLookup;
};

const blockedHosts = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.internal",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

export const outboundFetchInit = { redirect: "error" as const };

export async function assertPublicHttpUrl(
  value: string,
  options: OutboundUrlOptions = {},
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundUrlError("URL is invalid");
  }
  if (url.username || url.password)
    throw new OutboundUrlError("URL must not include credentials");
  if (url.protocol === "http:") {
    if (!options.allowHttp) throw new OutboundUrlError("URL must use HTTPS");
  } else if (url.protocol !== "https:") {
    throw new OutboundUrlError("URL must use HTTP or HTTPS");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allowLoopback = options.allowLoopback ?? false;
  if (isLoopbackHost(host)) {
    if (!allowLoopback)
      throw new OutboundUrlError("URL cannot target a private network");
  } else if (
    blockedHosts.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new OutboundUrlError("URL cannot target a private network");
  }

  const literal = literalIp(host);
  const addresses = literal
    ? [literal]
    : await resolveAddresses(
        host,
        options.lookup ?? (defaultLookup as HostLookup),
      );
  for (const address of addresses) {
    if (isBlockedAddress(address, allowLoopback))
      throw new OutboundUrlError("URL cannot target a private network");
  }
  return url.toString();
}

export type OutboundRequestInit = Omit<
  UndiciRequestInit,
  "dispatcher" | "redirect"
>;

/**
 * Validates the URL, then fetches it through an agent whose connect-time DNS
 * lookup re-checks every resolved address. Checking only before the request
 * leaves a DNS rebinding window: a short-TTL record can answer the check with
 * a public address and the connection with a private one. The socket is
 * pinned to the addresses validated at connect time; TLS SNI and the Host
 * header still use the URL hostname. Redirects are always refused.
 */
export async function outboundFetch(
  value: string,
  init: OutboundRequestInit = {},
  options: OutboundUrlOptions = {},
): Promise<Response> {
  const url = await assertPublicHttpUrl(value, options);
  try {
    const response = await undiciFetch(url, {
      ...init,
      redirect: "error",
      dispatcher: outboundAgent(options),
    });
    return response as unknown as Response;
  } catch (error) {
    // Surface a connect-time rejection as the same error the pre-check uses.
    const blocked = findCause(error, OutboundUrlError);
    if (blocked) throw blocked;
    throw error;
  }
}

/**
 * A stable, generic description of an outbound failure that is safe to store
 * and show to tenants. Raw error names and messages (ECONNREFUSED versus a
 * timeout, for example) would let a tenant probe internal ports.
 */
export function outboundErrorCategory(error: unknown) {
  const http = findCause(error, OutboundHttpError);
  if (http) return `HTTP ${http.status}`;
  if (findCause(error, OutboundUrlError)) return "Destination blocked";
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    const { name, code } = current as { name?: unknown; code?: unknown };
    if (
      name === "TimeoutError" ||
      name === "AbortError" ||
      code === "ETIMEDOUT" ||
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      code === "UND_ERR_HEADERS_TIMEOUT" ||
      code === "UND_ERR_BODY_TIMEOUT"
    )
      return "Request timed out";
    current = (current as { cause?: unknown }).cause;
  }
  return "Connection failed";
}

function findCause<T extends Error>(
  error: unknown,
  type: new (...args: never[]) => T,
): T | null {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (current instanceof type) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

const sharedAgents = new Map<boolean, Agent>();

function outboundAgent(options: OutboundUrlOptions) {
  const allowLoopback = options.allowLoopback ?? false;
  // An injected lookup is per-call (tests); the default agents are shared so
  // connections can be reused.
  if (options.lookup) return createOutboundAgent(options.lookup, allowLoopback);
  let agent = sharedAgents.get(allowLoopback);
  if (!agent) {
    agent = createOutboundAgent(defaultLookup as HostLookup, allowLoopback);
    sharedAgents.set(allowLoopback, agent);
  }
  return agent;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function createOutboundAgent(lookupFn: HostLookup, allowLoopback: boolean) {
  const lookup = (
    hostname: string,
    lookupOptions: LookupOptions,
    callback: LookupCallback,
  ) => {
    resolveAddresses(hostname, lookupFn)
      .then((addresses) => {
        // Reject the host outright if any record is private, so a mixed
        // answer cannot be raced onto the private address.
        for (const address of addresses) {
          if (isBlockedAddress(address, allowLoopback))
            throw new OutboundUrlError("URL cannot target a private network");
        }
        const records = addresses
          .map((address) => ({ address, family: isIPv4(address) ? 4 : 6 }))
          .filter(
            (record) =>
              !lookupOptions.family ||
              lookupOptions.family === record.family ||
              (lookupOptions.family === "IPv4" && record.family === 4) ||
              (lookupOptions.family === "IPv6" && record.family === 6),
          );
        if (!records.length)
          throw new OutboundUrlError("URL host could not be resolved");
        if (lookupOptions.all) callback(null, records);
        else callback(null, records[0].address, records[0].family);
      })
      .catch((error: NodeJS.ErrnoException) => callback(error, ""));
  };
  return new Agent({ connect: { lookup } });
}

async function resolveAddresses(host: string, lookupFn: HostLookup) {
  try {
    const records = await lookupFn(host, { all: true, verbatim: true });
    const addresses = records.map((record) => record.address);
    if (!addresses.length)
      throw new OutboundUrlError("URL host could not be resolved");
    return addresses;
  } catch (error) {
    if (error instanceof OutboundUrlError) throw error;
    throw new OutboundUrlError("URL host could not be resolved");
  }
}

function literalIp(host: string) {
  if (isIPv4(host) || isIPv6(host)) return host;
  if (/^\d+$/.test(host)) {
    const value = Number(host);
    if (value >= 0 && value <= 0xffffffff)
      return [
        (value >>> 24) & 255,
        (value >>> 16) & 255,
        (value >>> 8) & 255,
        value & 255,
      ].join(".");
  }
  if (/^0x[0-9a-f]+$/i.test(host)) {
    const value = Number.parseInt(host, 16);
    if (value >= 0 && value <= 0xffffffff)
      return [
        (value >>> 24) & 255,
        (value >>> 16) & 255,
        (value >>> 8) & 255,
        value & 255,
      ].join(".");
  }
  return null;
}

function isLoopbackHost(host: string) {
  return (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    isLoopbackIPv4(host)
  );
}

function isLoopbackIPv4(ip: string) {
  if (!isIPv4(ip)) return false;
  return ip.split(".").map(Number)[0] === 127;
}

function isBlockedAddress(address: string, allowLoopback: boolean): boolean {
  if (isIPv4(address)) {
    if (isLoopbackIPv4(address)) return !allowLoopback;
    return isPrivateIPv4(address);
  }
  const groups = parseIPv6(address);
  if (!groups) return true;
  // Unspecified (::) and loopback (::1) both reach the local host.
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] <= 1)
    return !allowLoopback;
  const embedded = embeddedIPv4(groups);
  if (embedded) return isBlockedAddress(embedded, allowLoopback);
  return isPrivateIPv6(groups);
}

function isPrivateIPv4(ip: string) {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 192.0.0.0/24 (IETF protocol assignments) and 192.0.2.0/24 (TEST-NET-1).
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  // TEST-NET-2 and TEST-NET-3.
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  // Multicast (224.0.0.0/4) and reserved (240.0.0.0/4).
  return a >= 224;
}

function isPrivateIPv6(groups: number[]) {
  const [first, second, third, fourth] = groups;
  // Unique local fc00::/7, link-local fe80::/10, site-local fec0::/10,
  // multicast ff00::/8.
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true;
  if ((first & 0xff00) === 0xff00) return true;
  // Documentation 2001:db8::/32 and Teredo 2001::/32.
  if (first === 0x2001 && (second === 0x0db8 || second === 0)) return true;
  // Discard-only 100::/64.
  if (first === 0x0100 && second === 0 && third === 0 && fourth === 0)
    return true;
  // Local-use NAT64 64:ff9b:1::/48.
  if (first === 0x64 && second === 0xff9b && third === 1) return true;
  // Anything else in the reserved ::/16 block is not a public destination.
  return first === 0;
}

/**
 * Returns the IPv4 address carried inside an IPv6 transition address, so it
 * can be checked against the IPv4 rules: IPv4-mapped ::ffff:0:0/96,
 * SIIT ::ffff:0:0:0/96, IPv4-compatible ::/96, NAT64 64:ff9b::/96 and
 * 6to4 2002::/16.
 */
function embeddedIPv4(groups: number[]) {
  const zeros = (from: number, to: number) =>
    groups.slice(from, to).every((group) => group === 0);
  if (zeros(0, 5) && (groups[5] === 0xffff || groups[5] === 0))
    return toIPv4(groups[6], groups[7]);
  if (zeros(0, 4) && groups[4] === 0xffff && groups[5] === 0)
    return toIPv4(groups[6], groups[7]);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6))
    return toIPv4(groups[6], groups[7]);
  if (groups[0] === 0x2002) return toIPv4(groups[1], groups[2]);
  return null;
}

function toIPv4(high: number, low: number) {
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

/** Expands an IPv6 address into its eight 16-bit groups. */
function parseIPv6(ip: string) {
  let value = ip.toLowerCase();
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);
  if (!isIPv6(value)) return null;
  const lastColon = value.lastIndexOf(":");
  const last = value.slice(lastColon + 1);
  if (last.includes(".")) {
    const [a, b, c, d] = last.split(".").map(Number);
    value = `${value.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = value.split("::");
  const headGroups = head ? head.split(":") : [];
  let groups = headGroups;
  if (tail !== undefined) {
    const tailGroups = tail ? tail.split(":") : [];
    const missing = 8 - headGroups.length - tailGroups.length;
    groups = [
      ...headGroups,
      ...Array<string>(missing).fill("0"),
      ...tailGroups,
    ];
  }
  if (groups.length !== 8) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}
