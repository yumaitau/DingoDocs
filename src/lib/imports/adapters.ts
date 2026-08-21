import { createHash } from "node:crypto";

export const importAdapterNames = [
  "nmap",
  "nessus",
  "openvas",
  "zap",
  "burp",
  "nuclei",
  "csv",
  "json",
] as const;
export type ImportAdapterName = (typeof importAdapterNames)[number];
export type NormalizedImportItem = {
  externalId?: string;
  title: string;
  description?: string;
  remediation?: string;
  severity: "informational" | "low" | "medium" | "high" | "critical";
  assetIdentifier?: string;
  port?: number;
  protocol?: string;
  cvssScore?: number;
  references?: string[];
  fingerprint: string;
};

export function parseScannerImport(
  adapter: ImportAdapterName,
  bytes: Uint8Array,
) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!source.trim()) throw new Error("Import source is empty");
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("XML entities and document types are not permitted");
  let items: Omit<NormalizedImportItem, "fingerprint">[];
  if (adapter === "csv") items = parseCsv(source);
  else if (adapter === "json") items = parseJson(source);
  else if (adapter === "nuclei") items = parseNuclei(source);
  else if (adapter === "nmap") items = parseNmap(source);
  else if (adapter === "nessus") items = parseNessus(source);
  else if (adapter === "openvas")
    items = parseBlocks(source, "result", {
      title: "name",
      description: "description",
      remediation: "solution",
      severity: "threat",
      host: "host",
      externalId: "nvt oid",
    });
  else if (adapter === "burp")
    items = parseBlocks(source, "issue", {
      title: "name",
      description: "issueDetail",
      remediation: "remediationDetail",
      severity: "severity",
      host: "host",
      externalId: "serialNumber",
    });
  else
    items = source.trimStart().startsWith("{")
      ? parseZapJson(source)
      : parseBlocks(source, "alertitem", {
          title: "alert",
          description: "desc",
          remediation: "solution",
          severity: "riskdesc",
          host: "uri",
          externalId: "pluginid",
        });
  if (!items.length)
    throw new Error(`No supported ${adapter} records were found`);
  if (items.length > 10_000)
    throw new Error("Import contains more than 10,000 records");
  return items.map((item) => ({
    ...item,
    fingerprint: fingerprint(adapter, item),
  }));
}

function parseNuclei(source: string) {
  return parseNucleiRecords(source).map((raw, index) => {
    const info =
      raw.info && typeof raw.info === "object" && !Array.isArray(raw.info)
        ? (raw.info as Record<string, unknown>)
        : {};
    const title = string(
      info.name ?? raw.name ?? raw["template-id"] ?? raw.template_id,
    );
    if (!title) throw new Error(`Nuclei record ${index + 1} has no title`);
    const references = Array.isArray(info.reference)
      ? info.reference.map(string).filter(Boolean)
      : string(info.reference)
        ? [string(info.reference)]
        : Array.isArray(raw.references)
          ? raw.references.map(string).filter(Boolean)
          : undefined;
    return {
      externalId: string(
        raw["template-id"] ?? raw.template_id ?? raw["template-path"] ?? index,
      ),
      title,
      description: string(
        info.description ?? raw.description ?? raw["extracted-results"],
      ),
      remediation: string(info.remediation ?? info.recommendation),
      severity: mapSeverity(info.severity ?? raw.severity),
      assetIdentifier: cleanHost(
        string(
          raw.host ?? raw.ip ?? raw["matched-at"] ?? raw.matched_at ?? raw.url,
        ),
      ),
      port: number(raw.port),
      protocol: string(raw.type ?? raw.protocol),
      cvssScore: number(
        info.cvss_score ?? info.cvssScore ?? info["cvss-score"],
      ),
      references: references?.length ? references : undefined,
    };
  });
}

function parseNucleiRecords(source: string) {
  const trimmed = source.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.filter(isRecord);
    if (parsed && typeof parsed === "object") {
      const value = parsed as Record<string, unknown>;
      if (Array.isArray(value.results)) return value.results.filter(isRecord);
      if (Array.isArray(value.findings)) return value.findings.filter(isRecord);
      return [value];
    }
  } catch {
    const rows: Record<string, unknown>[] = [];
    for (const [index, line] of trimmed.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`Nuclei JSONL line ${index + 1} is not valid JSON`);
      }
      if (!isRecord(parsed))
        throw new Error(`Nuclei JSONL line ${index + 1} is not an object`);
      rows.push(parsed);
    }
    return rows;
  }
  throw new Error("Nuclei output must be JSON, JSONL, or a results array");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNmap(xml: string) {
  requireRoot(xml, "nmaprun");
  const items: Omit<NormalizedImportItem, "fingerprint">[] = [];
  for (const hostBlock of blocks(xml, "host")) {
    const host =
      attr(firstTag(hostBlock, "address"), "addr") ||
      text(hostBlock, "hostname");
    for (const portBlock of blocks(hostBlock, "port")) {
      if (attr(firstTag(portBlock, "state"), "state") !== "open") continue;
      const port = Number(attr(firstTag(portBlock, "port"), "portid"));
      const protocol = attr(firstTag(portBlock, "port"), "protocol");
      const service =
        attr(firstTag(portBlock, "service"), "name") || "unknown service";
      items.push({
        externalId: `${host}:${port}/${protocol}`,
        title: `Open ${service} service on ${port}/${protocol}`,
        description: `Nmap reported ${service} reachable on ${host}.`,
        severity: "informational",
        assetIdentifier: host,
        port,
        protocol,
      });
    }
  }
  return items;
}

function parseNessus(xml: string) {
  requireRoot(xml, "NessusClientData_v2");
  const items: Omit<NormalizedImportItem, "fingerprint">[] = [];
  for (const reportHost of blocks(xml, "ReportHost")) {
    const host = attr(firstTag(reportHost, "ReportHost"), "name");
    for (const item of blocks(reportHost, "ReportItem")) {
      const tag = firstTag(item, "ReportItem");
      items.push({
        externalId: attr(tag, "pluginID"),
        title: attr(tag, "pluginName") || "Nessus finding",
        description: text(item, "description"),
        remediation: text(item, "solution"),
        severity: mapSeverity(
          attr(tag, "severity") || text(item, "risk_factor"),
        ),
        assetIdentifier: host,
        port: number(attr(tag, "port")),
        protocol: attr(tag, "protocol"),
        cvssScore: number(
          text(item, "cvss3_base_score") || text(item, "cvss_base_score"),
        ),
        references: blocks(item, "see_also")
          .map((value) => decodeXml(value.replace(/<[^>]+>/g, "").trim()))
          .filter(Boolean),
      });
    }
  }
  return items;
}

function parseBlocks(
  xml: string,
  block: string,
  fields: {
    title: string;
    description: string;
    remediation: string;
    severity: string;
    host: string;
    externalId: string;
  },
) {
  if (!xml.trimStart().startsWith("<")) throw new Error("Expected XML source");
  return blocks(xml, block).map((item) => ({
    externalId:
      text(item, fields.externalId) ||
      attr(
        firstTag(item, fields.externalId.split(" ")[0]),
        fields.externalId.split(" ")[1] || "id",
      ),
    title: text(item, fields.title) || `${block} finding`,
    description: text(item, fields.description),
    remediation: text(item, fields.remediation),
    severity: mapSeverity(text(item, fields.severity)),
    assetIdentifier: cleanHost(text(item, fields.host)),
    port: number(text(item, "port")),
    cvssScore: number(text(item, "cvss_base")),
  }));
}

function parseZapJson(source: string) {
  const value = JSON.parse(source) as { site?: Array<{ alerts?: unknown[] }> };
  return parseJson(
    JSON.stringify(value.site?.flatMap((site) => site.alerts ?? []) ?? []),
  );
}

function parseJson(source: string) {
  const value = JSON.parse(source) as unknown;
  const list = Array.isArray(value)
    ? value
    : typeof value === "object" && value
      ? ((value as Record<string, unknown>).findings ??
        (value as Record<string, unknown>).vulnerabilities ??
        (value as Record<string, unknown>).alerts)
      : null;
  if (!Array.isArray(list))
    throw new Error(
      "JSON must contain an array of findings, vulnerabilities, or alerts",
    );
  return list.map((raw, index) => {
    if (!raw || typeof raw !== "object")
      throw new Error(`JSON record ${index + 1} is not an object`);
    const item = raw as Record<string, unknown>;
    const title = string(item.title ?? item.name ?? item.alert);
    if (!title) throw new Error(`JSON record ${index + 1} has no title`);
    return {
      externalId: string(item.id ?? item.pluginId ?? item.pluginid),
      title,
      description: string(item.description ?? item.desc),
      remediation: string(item.remediation ?? item.solution),
      severity: mapSeverity(item.severity ?? item.risk),
      assetIdentifier: cleanHost(
        string(item.asset ?? item.host ?? item.url ?? item.uri),
      ),
      port: number(item.port),
      protocol: string(item.protocol),
      cvssScore: number(item.cvssScore ?? item.cvss),
      references: Array.isArray(item.references)
        ? item.references.map(string).filter(Boolean)
        : undefined,
    };
  });
}

function parseCsv(source: string) {
  const rows = csvRows(source);
  const headers =
    rows.shift()?.map((value) => value.trim().toLowerCase()) ?? [];
  if (!headers.includes("title") && !headers.includes("name"))
    throw new Error("CSV requires a title or name column");
  return rows
    .filter((row) => row.some(Boolean))
    .map((row, index) => {
      const item = Object.fromEntries(
        headers.map((header, column) => [header, row[column] ?? ""]),
      );
      const title = item.title || item.name;
      if (!title) throw new Error(`CSV row ${index + 2} has no title`);
      return {
        externalId: item.id || item.external_id,
        title,
        description: item.description || item.detail,
        remediation: item.remediation || item.solution,
        severity: mapSeverity(item.severity || item.risk),
        assetIdentifier: cleanHost(item.asset || item.host || item.url),
        port: number(item.port),
        protocol: item.protocol,
        cvssScore: number(item.cvss || item.cvss_score),
      };
    });
}

function csvRows(source: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
function blocks(xml: string, tag: string) {
  return [
    ...xml.matchAll(
      new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "gi"),
    ),
  ].map((match) => match[0]);
}
function firstTag(xml: string, tag: string) {
  return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`, "i"))?.[0] ?? "";
}
function text(xml: string, tag: string) {
  const match = xml.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "").trim()) : "";
}
function attr(tag: string, name: string) {
  const match = tag.match(
    new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return decodeXml(match?.[1] ?? match?.[2] ?? "");
}
function decodeXml(value: string) {
  return value.replace(
    /&(?:lt|gt|amp|quot|apos);/g,
    (entity) =>
      ({
        "&lt;": "<",
        "&gt;": ">",
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
      })[entity] ?? entity,
  );
}
function requireRoot(xml: string, root: string) {
  if (!new RegExp(`<${root}(?:\\s|>)`, "i").test(xml))
    throw new Error(`Expected ${root} XML document`);
}
function cleanHost(value?: string) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return value.replace(/^https?:\/\//, "").split(/[/:]/)[0] || undefined;
  }
}
function mapSeverity(value: unknown): NormalizedImportItem["severity"] {
  const raw = String(value ?? "").toLowerCase();
  if (["4", "critical", "very high"].some((v) => raw.includes(v)))
    return "critical";
  if (["3", "high"].some((v) => raw.includes(v))) return "high";
  if (["2", "medium", "moderate"].some((v) => raw.includes(v))) return "medium";
  if (["1", "low"].some((v) => raw.includes(v))) return "low";
  return "informational";
}
function fingerprint(
  adapter: string,
  item: Omit<NormalizedImportItem, "fingerprint">,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        adapter,
        item.externalId ?? "",
        item.assetIdentifier ?? "",
        item.port ?? "",
        item.title.toLowerCase(),
      ]),
    )
    .digest("hex");
}
function string(value: unknown) {
  return value == null ? "" : String(value).trim();
}
function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
