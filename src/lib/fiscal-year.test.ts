import { describe, expect, it } from "vitest";
import {
  getCurrentPeriod,
  getFiscalMonths,
  getPeriodFromTargetMonth,
  getPeriodRangeLabel,
  getStartYearFromPeriod,
} from "./fiscal-year";

describe("fiscal-year utility", () => {
  it("correctly converts targetMonth to period (48期: 2026-07 to 2027-06)", () => {
    expect(getPeriodFromTargetMonth("2026-07")).toBe(48);
    expect(getPeriodFromTargetMonth("2026-08")).toBe(48);
    expect(getPeriodFromTargetMonth("2026-12")).toBe(48);
    expect(getPeriodFromTargetMonth("2027-01")).toBe(48);
    expect(getPeriodFromTargetMonth("2027-06")).toBe(48);

    // 47期
    expect(getPeriodFromTargetMonth("2025-07")).toBe(47);
    expect(getPeriodFromTargetMonth("2026-06")).toBe(47);

    // 49期
    expect(getPeriodFromTargetMonth("2027-07")).toBe(49);
  });

  it("calculates startYear and label from period", () => {
    expect(getStartYearFromPeriod(48)).toBe(2026);
    expect(getPeriodRangeLabel(48)).toBe("2026年7月〜2027年6月");

    expect(getStartYearFromPeriod(47)).toBe(2025);
    expect(getPeriodRangeLabel(47)).toBe("2025年7月〜2026年6月");
  });

  it("returns 12 months ordered from July to June", () => {
    const months = getFiscalMonths(48);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({
      year: 2026,
      month: 7,
      targetMonth: "2026-07",
      label: "7月",
      fullLabel: "2026年7月",
    });
    expect(months[5]).toEqual({
      year: 2026,
      month: 12,
      targetMonth: "2026-12",
      label: "12月",
      fullLabel: "2026年12月",
    });
    expect(months[6]).toEqual({
      year: 2027,
      month: 1,
      targetMonth: "2027-01",
      label: "1月",
      fullLabel: "2027年1月",
    });
    expect(months[11]).toEqual({
      year: 2027,
      month: 6,
      targetMonth: "2027-06",
      label: "6月",
      fullLabel: "2027年6月",
    });
  });

  it("calculates current period from date correctly", () => {
    expect(getCurrentPeriod(new Date("2026-07-01T00:00:00Z"))).toBe(48);
    expect(getCurrentPeriod(new Date("2026-12-31T00:00:00Z"))).toBe(48);
    expect(getCurrentPeriod(new Date("2027-06-30T00:00:00Z"))).toBe(48);
    expect(getCurrentPeriod(new Date("2026-06-30T00:00:00Z"))).toBe(47);
  });
});
