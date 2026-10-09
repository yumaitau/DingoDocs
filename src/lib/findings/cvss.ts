export type CvssVersion = "3.1" | "4.0";

export type CvssScoreResult = {
  version: CvssVersion;
  score: number;
  vector: string;
};

const AV_31 = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 } as const;
const AC_31 = { L: 0.77, H: 0.44 } as const;
const PR_U = { N: 0.85, L: 0.62, H: 0.27 } as const;
const PR_C = { N: 0.85, L: 0.68, H: 0.5 } as const;
const UI_31 = { N: 0.85, R: 0.62 } as const;
const CIA_31 = { H: 0.56, L: 0.22, N: 0 } as const;

const REQUIRED_31 = ["AV", "AC", "PR", "UI", "S", "C", "I", "A"] as const;
const ALLOWED_31: Record<string, readonly string[]> = {
  AV: ["N", "A", "L", "P"],
  AC: ["L", "H"],
  PR: ["N", "L", "H"],
  UI: ["N", "R"],
  S: ["U", "C"],
  C: ["H", "L", "N"],
  I: ["H", "L", "N"],
  A: ["H", "L", "N"],
};

/** CVSS 4.0 base metrics used by the documented approximation. */
const REQUIRED_40 = [
  "AV",
  "AC",
  "AT",
  "PR",
  "UI",
  "VC",
  "VI",
  "VA",
  "SC",
  "SI",
  "SA",
] as const;
const ALLOWED_40: Record<string, readonly string[]> = {
  AV: ["N", "A", "L", "P"],
  AC: ["L", "H"],
  AT: ["N", "P"],
  PR: ["N", "L", "H"],
  UI: ["N", "P", "A"],
  VC: ["H", "L", "N"],
  VI: ["H", "L", "N"],
  VA: ["H", "L", "N"],
  SC: ["H", "L", "N"],
  SI: ["H", "L", "N"],
  SA: ["H", "L", "N"],
};

const W_AV = { N: 1, A: 0.7, L: 0.5, P: 0.2 } as const;
const W_AC = { L: 1, H: 0.45 } as const;
const W_AT = { N: 1, P: 0.55 } as const;
const W_PR = { N: 1, L: 0.55, H: 0.25 } as const;
const W_UI = { N: 1, P: 0.7, A: 0.45 } as const;
const W_V = { H: 1, L: 0.45, N: 0 } as const;
const W_S = { H: 0.55, L: 0.25, N: 0 } as const;

function parseMetrics(body: string) {
  const metrics: Record<string, string> = {};
  for (const part of body.split("/")) {
    if (!part) continue;
    const split = part.indexOf(":");
    if (split <= 0) throw new Error(`Invalid CVSS metric segment: ${part}`);
    const key = part.slice(0, split);
    const value = part.slice(split + 1);
    if (!key || !value) throw new Error(`Invalid CVSS metric segment: ${part}`);
    if (metrics[key]) throw new Error(`Duplicate CVSS metric: ${key}`);
    metrics[key] = value;
  }
  return metrics;
}

function requireMetrics(
  metrics: Record<string, string>,
  required: readonly string[],
  allowed: Record<string, readonly string[]>,
) {
  for (const key of required) {
    const value = metrics[key];
    if (!value) throw new Error(`Missing required CVSS metric: ${key}`);
    if (!allowed[key]?.includes(value))
      throw new Error(`Unknown CVSS metric value: ${key}:${value}`);
  }
  for (const key of Object.keys(metrics)) {
    if (!(key in allowed)) throw new Error(`Unknown CVSS metric: ${key}`);
  }
}

/** FIRST.org roundup: smallest tenth greater than or equal to the value. */
function roundup(value: number) {
  return Math.ceil(value * 10 - 1e-9) / 10;
}

function scoreCvss31(vector: string, metrics: Record<string, string>): number {
  requireMetrics(metrics, REQUIRED_31, ALLOWED_31);
  const scopeChanged = metrics.S === "C";
  const iss =
    1 -
    (1 - CIA_31[metrics.C as keyof typeof CIA_31]) *
      (1 - CIA_31[metrics.I as keyof typeof CIA_31]) *
      (1 - CIA_31[metrics.A as keyof typeof CIA_31]);
  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15
    : 6.42 * iss;
  const pr = scopeChanged
    ? PR_C[metrics.PR as keyof typeof PR_C]
    : PR_U[metrics.PR as keyof typeof PR_U];
  const exploitability =
    8.22 *
    AV_31[metrics.AV as keyof typeof AV_31] *
    AC_31[metrics.AC as keyof typeof AC_31] *
    pr *
    UI_31[metrics.UI as keyof typeof UI_31];
  if (impact <= 0) return 0;
  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);
  return roundup(raw);
}

/**
 * Documented CVSS 4.0 approximation (not the official macrovector table).
 * Weighted product of exploitability and average confidentiality/integrity/
 * availability impact across vulnerable and subsequent systems. Monotonic in
 * each metric severity and stable for identical vectors.
 */
function scoreCvss40Approx(metrics: Record<string, string>): number {
  requireMetrics(metrics, REQUIRED_40, ALLOWED_40);
  const exploitability =
    W_AV[metrics.AV as keyof typeof W_AV] *
    W_AC[metrics.AC as keyof typeof W_AC] *
    W_AT[metrics.AT as keyof typeof W_AT] *
    W_PR[metrics.PR as keyof typeof W_PR] *
    W_UI[metrics.UI as keyof typeof W_UI];
  const vuln =
    (W_V[metrics.VC as keyof typeof W_V] +
      W_V[metrics.VI as keyof typeof W_V] +
      W_V[metrics.VA as keyof typeof W_V]) /
    3;
  const subsequent =
    (W_S[metrics.SC as keyof typeof W_S] +
      W_S[metrics.SI as keyof typeof W_S] +
      W_S[metrics.SA as keyof typeof W_S]) /
    3;
  const raw = 10 * (0.35 * exploitability + 0.5 * vuln + 0.15 * subsequent);
  return Math.round(Math.min(Math.max(raw, 0), 10) * 10) / 10;
}

export function scoreCvss(vector: string): CvssScoreResult {
  const trimmed = vector.trim();
  if (trimmed.startsWith("CVSS:3.1/")) {
    const metrics = parseMetrics(trimmed.slice("CVSS:3.1/".length));
    return {
      version: "3.1",
      score: scoreCvss31(trimmed, metrics),
      vector: trimmed,
    };
  }
  if (trimmed.startsWith("CVSS:4.0/")) {
    const metrics = parseMetrics(trimmed.slice("CVSS:4.0/".length));
    return {
      version: "4.0",
      score: scoreCvss40Approx(metrics),
      vector: trimmed,
    };
  }
  throw new Error("CVSS vector must start with CVSS:3.1/ or CVSS:4.0/");
}
