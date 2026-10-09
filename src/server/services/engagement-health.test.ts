import { describe, expect, it } from "vitest";
import {
  scoreEngagementHealth,
  type EngagementHealthInput,
} from "./engagement-health";

const now = new Date("2026-10-09T12:00:00.000Z");

function score(overrides: Partial<EngagementHealthInput> = {}) {
  return scoreEngagementHealth({
    status: "testing",
    endDate: "2026-10-20",
    now,
    tasks: [],
    steps: [],
    findings: [],
    ...overrides,
  });
}

describe("scoreEngagementHealth", () => {
  it("returns zero progress when every denominator is empty", () => {
    expect(score()).toEqual({ progress: 0, health: "on_track" });
  });

  it("averages only the ratios that have a denominator", () => {
    expect(
      score({
        tasks: [
          { status: "done", dueAt: null },
          { status: "cancelled", dueAt: null },
          { status: "todo", dueAt: null },
        ],
        steps: [
          { status: "completed" },
          { status: "not_applicable" },
          { status: "blocked" },
        ],
        findings: [
          { status: "published", severity: "low", deletedAt: null },
          { status: "draft", severity: "low", deletedAt: null },
          {
            status: "draft",
            severity: "critical",
            deletedAt: new Date("2026-10-01T00:00:00.000Z"),
          },
        ],
      }),
    ).toMatchObject({ progress: 61, health: "on_track" });
  });

  it("ignores deleted findings in the progress denominator", () => {
    expect(
      score({
        findings: [
          { status: "published", severity: "low", deletedAt: null },
          {
            status: "draft",
            severity: "critical",
            deletedAt: new Date("2026-10-01T00:00:00.000Z"),
          },
        ],
      }).progress,
    ).toBe(100);
  });

  it("rounds a single one-third ratio to 33", () => {
    expect(
      score({
        tasks: [
          { status: "done", dueAt: null },
          { status: "todo", dueAt: null },
          { status: "in_progress", dueAt: null },
        ],
      }).progress,
    ).toBe(33);
  });

  it("marks a non-terminal engagement past its end date at risk", () => {
    expect(score({ endDate: "2026-10-08", status: "testing" }).health).toBe(
      "at_risk",
    );
    expect(score({ endDate: "2026-10-09", status: "testing" }).health).toBe(
      "on_track",
    );
    expect(score({ endDate: null, status: "testing" }).health).toBe("on_track");
  });

  it("does not treat terminal engagements as late", () => {
    for (const status of ["complete", "archived", "cancelled"]) {
      expect(score({ endDate: "2026-10-01", status }).health).toBe("on_track");
    }
  });

  it("marks a non-finished overdue task at risk", () => {
    const dueAt = new Date("2026-10-09T11:59:00.000Z");
    expect(score({ tasks: [{ status: "blocked", dueAt }] }).health).toBe(
      "at_risk",
    );
    expect(score({ tasks: [{ status: "done", dueAt }] }).health).toBe(
      "on_track",
    );
    expect(score({ tasks: [{ status: "cancelled", dueAt }] }).health).toBe(
      "on_track",
    );
    expect(
      score({
        tasks: [
          { status: "todo", dueAt: new Date("2026-10-09T12:00:00.000Z") },
        ],
      }).health,
    ).toBe("on_track");
  });

  it("marks open critical or high findings at risk only after the end date", () => {
    const open = {
      status: "qa_approved",
      severity: "high",
      deletedAt: null,
    };
    expect(
      score({ status: "complete", endDate: "2026-10-08", findings: [open] })
        .health,
    ).toBe("at_risk");
    expect(
      score({ status: "complete", endDate: "2026-10-20", findings: [open] })
        .health,
    ).toBe("on_track");
    expect(
      score({
        status: "complete",
        endDate: "2026-10-08",
        findings: [{ ...open, severity: "medium" }],
      }).health,
    ).toBe("on_track");
    expect(
      score({
        status: "complete",
        endDate: "2026-10-08",
        findings: [{ ...open, status: "published" }],
      }).health,
    ).toBe("on_track");
    expect(
      score({
        status: "complete",
        endDate: "2026-10-08",
        findings: [{ ...open, severity: "critical", deletedAt: now }],
      }).health,
    ).toBe("on_track");
  });
});
