import type { NormalizedImportItem } from "./adapters";

export type ImportDiffItem = Pick<NormalizedImportItem, "fingerprint"> &
  Partial<NormalizedImportItem>;

export function diffImports(left: ImportDiffItem[], right: ImportDiffItem[]) {
  const leftSet = new Set(left.map((item) => item.fingerprint));
  const rightSet = new Set(right.map((item) => item.fingerprint));
  return {
    added: right.filter((item) => !leftSet.has(item.fingerprint)),
    removed: left.filter((item) => !rightSet.has(item.fingerprint)),
    unchanged: left.filter((item) => rightSet.has(item.fingerprint)),
  };
}
