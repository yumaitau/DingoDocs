#!/usr/bin/env node
/**
 * DingoDocs CLI — findings/templates YAML export-import and severity gates.
 * Prefer HTTP (DINGODOCS_API_URL + DINGODOCS_API_KEY) against /api/v1.
 * Fall back to DATABASE_URL via the installed `postgres` package.
 * No YAML dependency: key: value docs separated by ---.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import postgres from "postgres";

const SEVERITY_RANK = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const FINDING_FIELDS = [
  "id",
  "engagementId",
  "identifier",
  "title",
  "severity",
  "status",
  "likelihood",
  "impact",
  "cvssVector",
  "cvssScore",
  "executiveSummary",
  "technicalDetail",
  "reproductionSteps",
  "proofOfConcept",
  "businessImpact",
  "technicalImpact",
  "remediation",
  "verificationGuidance",
  "cwe",
  "owasp",
  "cve",
];

const TEMPLATE_FIELDS = [
  "id",
  "stableKey",
  "version",
  "title",
  "summary",
  "severity",
  "technicalDescription",
  "remediation",
  "reviewStatus",
];

function usage(exitCode = 1) {
  const text = `dingodocs — findings YAML tooling for CI and agents

Usage:
  dingodocs export-findings --engagement <id> --out <file.yaml>
  dingodocs import-findings --file <file.yaml>
  dingodocs export-templates --out <file.yaml>
  dingodocs gate --file <file.yaml> --max-severity <level>

Severity order: informational < low < medium < high < critical

Transport (pick one):
  DINGODOCS_API_URL + DINGODOCS_API_KEY  → HTTP /api/v1 (preferred)
  DATABASE_URL                          → direct postgres
`;
  process.stderr.write(text);
  process.exit(exitCode);
}

function die(message, code = 1) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function yamlEscape(value) {
  if (value == null) return "";
  const text = String(value);
  if (
    text === "" ||
    /[:#\n\r]/.test(text) ||
    text.trim() !== text ||
    text === "true" ||
    text === "false" ||
    text === "null"
  ) {
    return JSON.stringify(text);
  }
  return text;
}

function serializeDocs(docs, fields) {
  return docs
    .map((doc) =>
      fields
        .filter((field) => doc[field] != null && doc[field] !== "")
        .map((field) => `${field}: ${yamlEscape(doc[field])}`)
        .join("\n"),
    )
    .filter(Boolean)
    .join("\n---\n");
}

function parseYamlDocs(text) {
  const chunks = text
    .split(/^\s*---\s*$/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.map((chunk) => {
    const doc = {};
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let raw = line.slice(idx + 1).trim();
      if (
        (raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))
      ) {
        raw = raw.slice(1, -1);
      }
      doc[key] = raw;
    }
    return doc;
  });
}

function pickFinding(row) {
  const out = {};
  for (const field of FINDING_FIELDS) {
    const value = row[field] ?? row[toSnake(field)];
    if (value != null && value !== "") out[field] = String(value);
  }
  return out;
}

function pickTemplate(row) {
  const out = {};
  for (const field of TEMPLATE_FIELDS) {
    const value = row[field] ?? row[toSnake(field)];
    if (value != null && value !== "") out[field] = String(value);
  }
  return out;
}

function toSnake(value) {
  return value.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

function resolveTransport() {
  const apiUrl = process.env.DINGODOCS_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.DINGODOCS_API_KEY;
  if (apiUrl && apiKey) {
    return { kind: "http", apiUrl, apiKey };
  }
  if (process.env.DATABASE_URL) {
    return { kind: "db", databaseUrl: process.env.DATABASE_URL };
  }
  die(
    "DINGODOCS_API_URL is required. Set DINGODOCS_API_URL and DINGODOCS_API_KEY for HTTP /api/v1 access, or DATABASE_URL for direct postgres.",
  );
}

async function httpRequest(transport, path, init = {}) {
  const url = `${transport.apiUrl}/api/v1/${path.replace(/^\//, "")}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${transport.apiKey}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const detail =
      body?.error?.message || body?.message || text || response.statusText;
    die(`HTTP ${response.status} ${path}: ${detail}`);
  }
  return body;
}

function openSql(transport) {
  return postgres(transport.databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
  });
}

async function exportFindings(args) {
  const engagementId = args.engagement;
  const out = args.out;
  if (!engagementId || !out) usage();
  const transport = resolveTransport();
  let docs = [];
  if (transport.kind === "http") {
    const body = await httpRequest(
      transport,
      `findings?engagementId=${encodeURIComponent(engagementId)}&pageSize=100`,
    );
    const rows = Array.isArray(body?.data) ? body.data : [];
    docs = rows.map(pickFinding);
  } else {
    const sql = openSql(transport);
    try {
      const rows = await sql`
        select id, engagement_id, identifier, title, severity, status,
               likelihood, impact, cvss_vector, cvss_score,
               executive_summary, technical_detail, reproduction_steps,
               proof_of_concept, business_impact, technical_impact,
               remediation, verification_guidance, cwe, owasp, cve
        from findings
        where engagement_id = ${engagementId}
          and deleted_at is null
        order by created_at asc
      `;
      docs = rows.map(pickFinding);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }
  const payload = serializeDocs(docs, FINDING_FIELDS);
  await writeFile(resolve(out), payload ? `${payload}\n` : "", "utf8");
  process.stdout.write(`exported ${docs.length} finding(s) → ${out}\n`);
}

async function importFindings(args) {
  const file = args.file;
  if (!file) usage();
  const docs = parseYamlDocs(await readFile(resolve(file), "utf8"));
  if (!docs.length) die("no finding documents in file");
  const transport = resolveTransport();
  let created = 0;
  if (transport.kind === "http") {
    for (const doc of docs) {
      if (!doc.engagementId || !doc.identifier || !doc.title || !doc.severity) {
        die(
          "each finding needs engagementId, identifier, title, and severity",
        );
      }
      const body = {
        engagementId: doc.engagementId,
        identifier: doc.identifier,
        title: doc.title,
        severity: doc.severity,
      };
      for (const field of FINDING_FIELDS) {
        if (
          field === "id" ||
          field === "status" ||
          field === "engagementId" ||
          field === "identifier" ||
          field === "title" ||
          field === "severity"
        )
          continue;
        if (doc[field]) body[field] = doc[field];
      }
      await httpRequest(transport, "findings", {
        method: "POST",
        body: JSON.stringify(body),
      });
      created += 1;
    }
  } else {
    die(
      "import-findings over DATABASE_URL is not supported; set DINGODOCS_API_URL and DINGODOCS_API_KEY so drafts go through /api/v1 (audit + RBAC).",
    );
  }
  process.stdout.write(`imported ${created} finding(s)\n`);
}

async function exportTemplates(args) {
  const out = args.out;
  if (!out) usage();
  const transport = resolveTransport();
  let docs = [];
  if (transport.kind === "http") {
    const body = await httpRequest(transport, "templates");
    const rows = Array.isArray(body?.data) ? body.data : [];
    docs = rows.map(pickTemplate);
  } else {
    const sql = openSql(transport);
    try {
      const rows = await sql`
        select id, stable_key, version, title, summary, severity,
               technical_description, remediation, review_status
        from finding_templates
        where superseded_at is null
        order by stable_key asc, version asc
      `;
      docs = rows.map(pickTemplate);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }
  const payload = serializeDocs(docs, TEMPLATE_FIELDS);
  await writeFile(resolve(out), payload ? `${payload}\n` : "", "utf8");
  process.stdout.write(`exported ${docs.length} template(s) → ${out}\n`);
}

async function gate(args) {
  const file = args.file;
  const maxSeverity = String(args["max-severity"] ?? "").toLowerCase();
  if (!file || !maxSeverity) usage();
  if (!(maxSeverity in SEVERITY_RANK)) {
    die(
      `unknown max severity "${maxSeverity}". Use: informational|low|medium|high|critical`,
    );
  }
  const docs = parseYamlDocs(await readFile(resolve(file), "utf8"));
  const maxRank = SEVERITY_RANK[maxSeverity];
  const offenders = [];
  for (const doc of docs) {
    const severity = String(doc.severity ?? "").toLowerCase();
    if (!(severity in SEVERITY_RANK)) {
      die(`finding "${doc.identifier ?? doc.title ?? "?"}" has unknown severity "${doc.severity}"`);
    }
    if (SEVERITY_RANK[severity] > maxRank) {
      offenders.push(
        `${doc.identifier ?? doc.id ?? "?"} ${severity} — ${doc.title ?? ""}`.trim(),
      );
    }
  }
  if (offenders.length) {
    process.stderr.write(
      `gate failed: ${offenders.length} finding(s) above ${maxSeverity}\n`,
    );
    for (const line of offenders) process.stderr.write(`  - ${line}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `gate passed: ${docs.length} finding(s) ≤ ${maxSeverity}\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help || args.h) usage(command ? 1 : 0);
  switch (command) {
    case "export-findings":
      await exportFindings(args);
      break;
    case "import-findings":
      await importFindings(args);
      break;
    case "export-templates":
      await exportTemplates(args);
      break;
    case "gate":
      await gate(args);
      break;
    default:
      die(`unknown command "${command}"`);
  }
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error));
});
