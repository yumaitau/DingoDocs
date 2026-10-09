import { createHash } from "node:crypto";

export const importAdapterNames = [
  "nmap",
  "nessus",
  "openvas",
  "zap",
  "burp",
  "nuclei",
  "sarif",
  "trivy",
  "grype",
  "nikto",
  "wpscan",
  "testssl",
  "prowler",
  "scoutsuite",
  "bloodhound",
  "plextrac",
  "dradis",
  "ghostwriter",
  "sysreptor",
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

type RawItem = Omit<NormalizedImportItem, "fingerprint">;

export function parseScannerImport(
  adapter: ImportAdapterName,
  bytes: Uint8Array,
) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!source.trim()) throw new Error("Import source is empty");
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("XML entities and document types are not permitted");
  let items: RawItem[];
  switch (adapter) {
    case "csv":
      items = parseCsv(source);
      break;
    case "json":
      items = parseJson(source);
      break;
    case "nuclei":
      items = parseNuclei(source);
      break;
    case "nmap":
      items = parseNmap(source);
      break;
    case "nessus":
      items = parseNessus(source);
      break;
    case "openvas":
      items = parseBlocks(source, "result", {
        title: "name",
        description: "description",
        remediation: "solution",
        severity: "threat",
        host: "host",
        externalId: "nvt oid",
      });
      break;
    case "burp":
      items = parseBlocks(source, "issue", {
        title: "name",
        description: "issueDetail",
        remediation: "remediationDetail",
        severity: "severity",
        host: "host",
        externalId: "serialNumber",
      });
      break;
    case "zap":
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
      break;
    case "sarif":
      items = parseSarif(source);
      break;
    case "trivy":
      items = parseTrivy(source);
      break;
    case "grype":
      items = parseGrype(source);
      break;
    case "nikto":
      items = parseNikto(source);
      break;
    case "wpscan":
      items = parseWpscan(source);
      break;
    case "testssl":
      items = parseTestssl(source);
      break;
    case "prowler":
      items = parseProwler(source);
      break;
    case "scoutsuite":
      items = parseScoutsuite(source);
      break;
    case "bloodhound":
      items = parseBloodhound(source);
      break;
    case "plextrac":
    case "dradis":
    case "ghostwriter":
    case "sysreptor":
      items = parseGenericFindings(source, adapter);
      break;
    default: {
      const _exhaustive: never = adapter;
      throw new Error(`Unsupported adapter: ${_exhaustive}`);
    }
  }
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

function parseSarif(source: string) {
  const value = JSON.parse(source) as {
    runs?: Array<{ results?: unknown[] }>;
  };
  const results = value.runs?.flatMap((run) => run.results ?? []) ?? [];
  const items: RawItem[] = [];
  for (const [index, raw] of results.entries()) {
    if (!isRecord(raw)) continue;
    const message =
      raw.message && isRecord(raw.message) ? raw.message : undefined;
    const title =
      string(raw.ruleId) ||
      string(message?.text) ||
      `SARIF result ${index + 1}`;
    const location = Array.isArray(raw.locations)
      ? raw.locations.find(isRecord)
      : undefined;
    const physical =
      location?.physicalLocation && isRecord(location.physicalLocation)
        ? location.physicalLocation
        : undefined;
    const artifact =
      physical?.artifactLocation && isRecord(physical.artifactLocation)
        ? physical.artifactLocation
        : undefined;
    const logical = Array.isArray(location?.logicalLocations)
      ? location.logicalLocations.find(isRecord)
      : Array.isArray(raw.logicalLocations)
        ? raw.logicalLocations.find(isRecord)
        : undefined;
    const asset =
      string(artifact?.uri) ||
      string(logical?.fullyQualifiedName) ||
      string(logical?.name);
    items.push({
      externalId: string(raw.ruleId ?? raw.guid ?? index),
      title,
      description: string(message?.text),
      severity: mapSarifLevel(raw.level),
      assetIdentifier: asset || undefined,
    });
  }
  return items;
}

function mapSarifLevel(value: unknown): NormalizedImportItem["severity"] {
  const level = string(value).toLowerCase();
  if (level === "error") return "high";
  if (level === "warning") return "medium";
  if (level === "note") return "low";
  return "informational";
}

function parseTrivy(source: string) {
  const value = JSON.parse(source) as {
    Results?: Array<Record<string, unknown>>;
  };
  const items: RawItem[] = [];
  for (const result of value.Results ?? []) {
    if (!isRecord(result)) continue;
    const target = string(result.Target ?? result.TargetName);
    const vulns = Array.isArray(result.Vulnerabilities)
      ? result.Vulnerabilities.filter(isRecord)
      : [];
    for (const vuln of vulns) {
      const title =
        string(vuln.Title) ||
        string(vuln.VulnerabilityID) ||
        "Trivy vulnerability";
      items.push({
        externalId: string(vuln.VulnerabilityID ?? vuln.PkgID ?? title),
        title,
        description: string(vuln.Description),
        remediation: string(vuln.FixedVersion)
          ? `Upgrade to ${string(vuln.FixedVersion)}`
          : undefined,
        severity: mapSeverity(vuln.Severity),
        assetIdentifier: target || string(vuln.PkgName) || undefined,
        references: string(vuln.PrimaryURL)
          ? [string(vuln.PrimaryURL)]
          : undefined,
      });
    }
    const misconfigs = Array.isArray(result.Misconfigurations)
      ? result.Misconfigurations.filter(isRecord)
      : [];
    for (const mis of misconfigs) {
      const title =
        string(mis.Title) || string(mis.ID) || "Trivy misconfiguration";
      items.push({
        externalId: string(mis.ID ?? title),
        title,
        description: string(mis.Description ?? mis.Message),
        remediation: string(mis.Resolution),
        severity: mapSeverity(mis.Severity),
        assetIdentifier: target || undefined,
      });
    }
  }
  return items;
}

function parseGrype(source: string) {
  const value = JSON.parse(source) as { matches?: unknown[] };
  const items: RawItem[] = [];
  for (const [index, match] of (value.matches ?? []).entries()) {
    if (!isRecord(match)) continue;
    const vuln = isRecord(match.vulnerability) ? match.vulnerability : {};
    const artifact = isRecord(match.artifact) ? match.artifact : {};
    const title =
      string(vuln.id) || string(vuln.dataSource) || `Grype match ${index + 1}`;
    const urls = Array.isArray(vuln.urls)
      ? vuln.urls.map(string).filter(Boolean)
      : undefined;
    items.push({
      externalId: string(vuln.id ?? index),
      title,
      description: string(vuln.description),
      severity: mapSeverity(vuln.severity),
      assetIdentifier:
        [string(artifact.name), string(artifact.version)]
          .filter(Boolean)
          .join("@") || undefined,
      cvssScore: number(
        Array.isArray(vuln.cvss) && isRecord(vuln.cvss[0])
          ? isRecord(vuln.cvss[0].metrics)
            ? vuln.cvss[0].metrics.baseScore
            : undefined
          : undefined,
      ),
      references: urls?.length ? urls : undefined,
    });
  }
  return items;
}

function parseNikto(source: string) {
  requireRoot(source, "niktoscan");
  const items: RawItem[] = [];
  for (const details of blocks(source, "scandetails")) {
    const detailsTag = firstTag(details, "scandetails");
    const host =
      attr(detailsTag, "targethostname") ||
      attr(detailsTag, "targetip") ||
      attr(detailsTag, "sitename");
    for (const item of blocks(details, "item")) {
      const id = attr(firstTag(item, "item"), "id") || text(item, "id");
      const description =
        text(item, "description") || text(item, "namelink") || "Nikto finding";
      items.push({
        externalId: id || undefined,
        title: description.slice(0, 200),
        description,
        severity: "informational",
        assetIdentifier: cleanHost(host || text(item, "uri")),
      });
    }
  }
  return items;
}

function parseWpscan(source: string) {
  const value = JSON.parse(source) as Record<string, unknown>;
  const items: RawItem[] = [];
  const target = string(value.target_url ?? value.target);

  const pushVuln = (
    vuln: Record<string, unknown>,
    fallbackTitle: string,
    asset?: string,
  ) => {
    const title = string(vuln.title) || string(vuln.to_s) || fallbackTitle;
    const refs = collectWpscanRefs(vuln.references);
    items.push({
      externalId: string(vuln.id ?? refs[0] ?? title),
      title,
      description: string(vuln.description ?? vuln.to_s),
      remediation: string(vuln.fixed_in)
        ? `Fixed in ${string(vuln.fixed_in)}`
        : undefined,
      severity: mapSeverity(vuln.severity ?? "medium"),
      assetIdentifier: cleanHost(asset || target) || undefined,
      references: refs.length ? refs : undefined,
    });
  };

  if (Array.isArray(value.interesting_findings)) {
    for (const [index, raw] of value.interesting_findings.entries()) {
      if (!isRecord(raw)) continue;
      const title =
        string(raw.to_s) ||
        string(raw.type) ||
        `Interesting finding ${index + 1}`;
      items.push({
        externalId: string(raw.type ?? index),
        title,
        description: Array.isArray(raw.interesting_entries)
          ? raw.interesting_entries.map(string).filter(Boolean).join("\n")
          : string(raw.to_s),
        severity: "informational",
        assetIdentifier: cleanHost(string(raw.url) || target),
      });
    }
  }

  collectWpscanVulnBuckets(value, pushVuln);
  return items;
}

function collectWpscanVulnBuckets(
  value: Record<string, unknown>,
  pushVuln: (
    vuln: Record<string, unknown>,
    fallbackTitle: string,
    asset?: string,
  ) => void,
) {
  const walkVulns = (vulns: unknown, fallback: string, asset?: string) => {
    if (Array.isArray(vulns)) {
      for (const [index, vuln] of vulns.entries()) {
        if (isRecord(vuln)) pushVuln(vuln, `${fallback} ${index + 1}`, asset);
      }
    } else if (isRecord(vulns)) {
      for (const [key, vuln] of Object.entries(vulns)) {
        if (isRecord(vuln)) pushVuln(vuln, key, asset);
      }
    }
  };

  walkVulns(
    value.vulnerabilities,
    "WPScan vulnerability",
    string(value.target_url),
  );

  if (isRecord(value.version)) {
    walkVulns(
      value.version.vulnerabilities,
      "WordPress version vulnerability",
      string(value.target_url),
    );
  }

  for (const bucket of ["plugins", "themes"] as const) {
    const group = value[bucket];
    if (!isRecord(group)) continue;
    for (const [name, entry] of Object.entries(group)) {
      if (!isRecord(entry)) continue;
      walkVulns(
        entry.vulnerabilities,
        `${name} vulnerability`,
        string(value.target_url),
      );
    }
  }
}

function collectWpscanRefs(references: unknown): string[] {
  if (!references) return [];
  if (Array.isArray(references)) return references.map(string).filter(Boolean);
  if (!isRecord(references)) return [];
  const out: string[] = [];
  for (const value of Object.values(references)) {
    if (Array.isArray(value)) out.push(...value.map(string).filter(Boolean));
    else if (value) out.push(string(value));
  }
  return out;
}

function parseTestssl(source: string) {
  const value = JSON.parse(source) as unknown;
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.findings)
      ? value.findings
      : null;
  if (!list) throw new Error("testssl JSON must be an array of findings");
  const items: RawItem[] = [];
  for (const [index, raw] of list.entries()) {
    if (!isRecord(raw)) continue;
    const id = string(raw.id);
    const finding = string(raw.finding);
    const title = id || finding || `testssl finding ${index + 1}`;
    if (!id && !finding) continue;
    items.push({
      externalId: id || String(index),
      title,
      description: finding || undefined,
      severity: mapSeverity(raw.severity),
      assetIdentifier: cleanHost(string(raw.ip ?? raw.host ?? raw.fqdn)),
      port: number(raw.port),
    });
  }
  return items;
}

function parseProwler(source: string) {
  const value = JSON.parse(source) as unknown;
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.findings)
      ? value.findings
      : null;
  if (!list) throw new Error("Prowler JSON must be a findings array");
  const items: RawItem[] = [];
  for (const [index, raw] of list.entries()) {
    if (!isRecord(raw)) continue;
    const status = string(raw.Status ?? raw.status).toUpperCase();
    if (status === "PASS" || status === "INFO") continue;
    const title =
      string(raw.CheckTitle ?? raw.check_title ?? raw.FindingUniqueId) ||
      `Prowler finding ${index + 1}`;
    const remediation = isRecord(raw.Remediation)
      ? string(
          raw.Remediation.Recommendation &&
            isRecord(raw.Remediation.Recommendation)
            ? raw.Remediation.Recommendation.Text
            : raw.Remediation,
        )
      : string(raw.Remediation ?? raw.remediation);
    items.push({
      externalId: string(
        raw.FindingUniqueId ?? raw.CheckID ?? raw.check_id ?? index,
      ),
      title,
      description: string(
        raw.Description ?? raw.description ?? raw.StatusExtended,
      ),
      remediation: remediation || undefined,
      severity: mapSeverity(raw.Severity ?? raw.severity),
      assetIdentifier: string(
        raw.ResourceId ?? raw.resource_id ?? raw.ResourceUid ?? raw.AccountId,
      ),
    });
  }
  return items;
}

function parseScoutsuite(source: string) {
  const value = JSON.parse(source) as Record<string, unknown>;
  const services = isRecord(value.services) ? value.services : null;
  if (!services)
    throw new Error("ScoutSuite JSON must contain services.*.findings");
  const items: RawItem[] = [];
  for (const [serviceName, service] of Object.entries(services)) {
    if (!isRecord(service) || !isRecord(service.findings)) continue;
    for (const [findingId, finding] of Object.entries(service.findings)) {
      if (!isRecord(finding)) continue;
      const description = string(finding.description);
      const level = string(finding.level);
      if (!description && !level) continue;
      items.push({
        externalId: findingId,
        title: description || findingId,
        description: description || undefined,
        severity: mapScoutsuiteLevel(level),
        assetIdentifier: serviceName,
      });
    }
  }
  return items;
}

function mapScoutsuiteLevel(value: string): NormalizedImportItem["severity"] {
  const level = value.toLowerCase();
  if (level === "danger" || level === "critical") return "critical";
  if (level === "warning") return "medium";
  if (level === "warningish" || level === "low") return "low";
  if (level === "high") return "high";
  if (level === "medium") return "medium";
  return "informational";
}

function parseBloodhound(source: string) {
  const value = JSON.parse(source) as Record<string, unknown>;
  const data = Array.isArray(value.data) ? value.data : null;
  if (!data) throw new Error("BloodHound JSON must contain a data array");
  const items: RawItem[] = [];
  for (const [index, raw] of data.entries()) {
    if (!isRecord(raw)) continue;
    const name = string(raw.name ?? raw.ObjectIdentifier ?? raw.label);
    if (!name) continue;
    const type = string(raw.type ?? raw.kind);
    items.push({
      externalId: string(raw.ObjectIdentifier ?? raw.id ?? index),
      title: name,
      description: type ? `BloodHound ${type} asset` : "BloodHound asset",
      severity: "informational",
      assetIdentifier: name,
    });
  }
  return items;
}

function parseGenericFindings(source: string, adapter: string) {
  const value = JSON.parse(source) as unknown;
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.findings)
      ? value.findings
      : null;
  if (!list) throw new Error(`${adapter} JSON must contain a findings array`);
  return list.map((raw, index) => {
    if (!isRecord(raw))
      throw new Error(`${adapter} record ${index + 1} is not an object`);
    const title = string(raw.title ?? raw.name);
    if (!title) throw new Error(`${adapter} record ${index + 1} has no title`);
    return {
      externalId: string(raw.id ?? raw.externalId ?? index),
      title,
      description: string(raw.description ?? raw.detail),
      remediation: string(
        raw.remediation ?? raw.recommendation ?? raw.solution,
      ),
      severity: mapSeverity(raw.severity ?? raw.risk),
      assetIdentifier: cleanHost(
        string(raw.asset ?? raw.host ?? raw.url ?? raw.affected_asset),
      ),
      port: number(raw.port),
      protocol: string(raw.protocol),
      cvssScore: number(raw.cvssScore ?? raw.cvss),
      references: Array.isArray(raw.references)
        ? raw.references.map(string).filter(Boolean)
        : undefined,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNmap(xml: string) {
  requireRoot(xml, "nmaprun");
  const items: RawItem[] = [];
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
  const items: RawItem[] = [];
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
      severity: mapSeverity(
        item.severity ?? item.riskdesc ?? item.riskcode ?? item.risk,
      ),
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
  if (!match) return "";
  const plain = match[1]
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/g)
    .map((part) =>
      part.startsWith("<![CDATA[") && part.endsWith("]]>")
        ? part.slice(9, -3)
        : part.replace(/<[^>]+>/g, ""),
    )
    .join("");
  return decodeXml(plain.trim());
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
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  const lead = raw.match(/^(?:very\s+high|\d+|[a-z]+)/)?.[0] ?? "";
  if (lead === "4" || lead === "critical" || lead === "very high")
    return "critical";
  if (lead === "3" || lead === "high") return "high";
  if (lead === "2" || lead === "medium" || lead === "moderate") return "medium";
  if (lead === "1" || lead === "low") return "low";
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
