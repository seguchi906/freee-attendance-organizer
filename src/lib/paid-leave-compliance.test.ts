import { describe, expect, it } from "vitest";
import {
  daysBetween,
  getComplianceStatus,
  getPaidLeavePeriod,
  listMonths,
} from "@/lib/paid-leave-compliance";

describe("paid leave compliance", () => {
  it("calculates the active April cycle across a year boundary", () => {
    expect(getPaidLeavePeriod("2026-08-19", 4)).toEqual({
      periodStart: "2026-04-01",
      periodEnd: "2027-03-31",
    });
  });

  it("calculates the active October cycle before October", () => {
    expect(getPaidLeavePeriod("2026-08-19", 10)).toEqual({
      periodStart: "2025-10-01",
      periodEnd: "2026-09-30",
    });
  });

  it.each([
    [0, 200, "in-progress"],
    [4.5, 91, "in-progress"],
    [4.5, 90, "warning"],
    [5, 1, "achieved"],
    [5.5, 0, "achieved"],
  ] as const)("classifies %s days with %s days remaining", (days, remaining, status) => {
    expect(getComplianceStatus(days, remaining)).toBe(status);
  });

  it("lists months inclusively across a year boundary", () => {
    expect(listMonths("2025-10", "2026-02")).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("calculates calendar-day deadline distance", () => {
    expect(daysBetween("2026-07-02", "2026-09-30")).toBe(90);
  });
});
