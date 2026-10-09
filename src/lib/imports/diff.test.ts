import { describe, expect, it } from "vitest";
import { diffImports } from "./diff";

describe("diffImports", () => {
  it("compares fingerprint sets into added, removed, and unchanged", () => {
    const left = [
      { fingerprint: "a", title: "A" },
      { fingerprint: "b", title: "B" },
      { fingerprint: "c", title: "C" },
    ];
    const right = [
      { fingerprint: "b", title: "B" },
      { fingerprint: "c", title: "C" },
      { fingerprint: "d", title: "D" },
    ];
    const diff = diffImports(left, right);
    expect(diff.added.map((item) => item.fingerprint)).toEqual(["d"]);
    expect(diff.removed.map((item) => item.fingerprint)).toEqual(["a"]);
    expect(diff.unchanged.map((item) => item.fingerprint)).toEqual(["b", "c"]);
  });

  it("returns empty buckets for identical sets", () => {
    const items = [{ fingerprint: "x" }, { fingerprint: "y" }];
    const diff = diffImports(items, items);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toHaveLength(2);
  });
});
