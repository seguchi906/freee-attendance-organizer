import { describe, expect, it } from "vitest";
import { compareEmployees, isActive, previousMonth } from "@/lib/employee-diff";
import type { Employee, SanitizedAttendanceRow } from "@/lib/attendance-types";

const employee: Employee = { employeeCode: "N046", surname: "松田", department: "建コン事業", employmentType: "正社員", paidLeaveCycleStartMonth: 10, startMonth: "2026-07", endMonth: null };

describe("employee diff", () => {
  it("入社前は在籍扱いにしない", () => expect(isActive(employee, "2026-06")).toBe(false));
  it("入社月以降は在籍扱いにする", () => expect(isActive(employee, "2026-07")).toBe(true));
  it("在籍月にデータがない社員を不足として返す", () => {
    expect(compareEmployees([employee], [], "2026-07").missingEmployees).toEqual([employee]);
  });
  it("前月を年またぎで計算する", () => expect(previousMonth("2026-01")).toBe("2025-12"));
  it("同じ社員コードの苗字変更を検出する", () => {
    const row = { employeeCode: "N046", surname: "別姓" } as SanitizedAttendanceRow;
    expect(compareEmployees([employee], [row], "2026-07").surnameMismatches).toHaveLength(1);
  });
});
