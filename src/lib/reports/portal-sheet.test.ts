import { describe, expect, it } from "vitest";
import { findingsToCsv, type PortalSheetRow } from "./portal-sheet";

const base: PortalSheetRow = {
  identifier: "F-1",
  title: "Safe title",
  severity: "high",
  status: "open",
  clientOwner: "",
  dueAt: "",
  retestStatus: "",
  remediationStatus: "",
};

function firstDataRow(row: Partial<PortalSheetRow>) {
  return findingsToCsv([{ ...base, ...row }]).split("\n")[1];
}

describe("findingsToCsv", () => {
  it.each(["=HYPERLINK(1)", "+1", "-1", "@SUM(A1)", "\tcmd"])(
    "neutralises formula-leading cell %j",
    (title) => {
      expect(firstDataRow({ title })).toContain(`'${title}`);
    },
  );

  it("neutralises a leading carriage return and still quotes it", () => {
    expect(firstDataRow({ title: "\r=1" })).toContain(`"'\r=1"`);
  });

  it("quotes commas and quotes after neutralising", () => {
    expect(firstDataRow({ title: '=a,"b"' })).toContain(`"'=a,""b"""`);
    expect(firstDataRow({ title: "Plain, text" })).toContain(`"Plain, text"`);
  });
});
