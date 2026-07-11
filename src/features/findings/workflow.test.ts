import { describe, expect, it } from "vitest";
import { assertFindingTransition, canTransitionFinding } from "./workflow";

describe("finding workflow", () => {
  it("allows the formal review path", () => {
    expect(canTransitionFinding("ready_for_review", "peer_reviewed")).toBe(
      true,
    );
    expect(canTransitionFinding("peer_reviewed", "qa_approved")).toBe(true);
    expect(canTransitionFinding("qa_approved", "published")).toBe(true);
  });

  it("blocks unapproved publication", () => {
    expect(() =>
      assertFindingTransition({
        from: "draft",
        to: "published",
        canOverride: false,
      }),
    ).toThrow();
  });

  it("requires a recorded reason for an authorised override", () => {
    expect(() =>
      assertFindingTransition({
        from: "draft",
        to: "published",
        canOverride: true,
      }),
    ).toThrow("requires a reason");
    expect(
      assertFindingTransition({
        from: "draft",
        to: "published",
        canOverride: true,
        overrideReason: "Emergency client release",
      }),
    ).toEqual({ override: true });
  });
});
