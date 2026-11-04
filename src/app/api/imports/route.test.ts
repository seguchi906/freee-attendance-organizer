import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAVE_FIELDS } from "@/lib/attendance-types";

const mocks = vi.hoisted(() => ({
  authorizeApi: vi.fn(),
  getDb: vi.fn(),
  employees: { table: "employees" },
  monthlyImports: { table: "monthlyImports" },
  monthlyAttendance: { table: "monthlyAttendance" },
  employeeMonthExclusions: { table: "employeeMonthExclusions" },
  fetch: vi.fn(() => {
    throw new Error("Unexpected network request in imports route test");
  }),
}));

vi.mock("@/lib/api-auth", () => ({
  authorizeApi: mocks.authorizeApi,
}));

vi.mock("@/db", () => ({
  databaseConfigured: true,
  getDb: mocks.getDb,
}));

vi.mock("@/db/schema", () => ({
  employees: mocks.employees,
  monthlyImports: mocks.monthlyImports,
  monthlyAttendance: mocks.monthlyAttendance,
  employeeMonthExclusions: mocks.employeeMonthExclusions,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

import { POST } from "@/app/api/imports/route";

function makePayload() {
  return {
    targetMonth: "2026-08",
    columnCount: 49,
    rows: [
      {
        employeeCode: "E001",
        surname: "Test",
        department: "Office",
        employmentType: "Regular",
        closingStatus: "closed",
        weekdayAttendanceDays: 20,
        holidayAttendanceDays: 0,
        lateCount: 0,
        earlyLeaveCount: 0,
        scheduledHours: 160,
        overtimeHours: 0,
        weekdayOvertimeHours: 0,
        holidayOvertimeHours: 0,
        lateHours: 0,
        earlyLeaveHours: 0,
        breakHours: 20,
        totalWorkHours: 160,
        leaves: Object.fromEntries(
          LEAVE_FIELDS.map((field) => [field, { days: 0, hours: 0 }]),
        ),
        warnings: [],
      },
    ],
    totals: {
      scheduledHours: 160,
      overtimeHours: 0,
      breakHours: 20,
      totalWorkHours: 160,
      paidLeaveDays: 0,
      paidLeaveHours: 0,
    },
  };
}

function makeRequest(payload: unknown) {
  return new Request("http://localhost/api/imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.authorizeApi.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("imports route safeguards", () => {
  it("rejects invalid input before opening a database transaction", async () => {
    const payload = { ...makePayload(), targetMonth: "2026-13" };

    const response = await POST(makeRequest(payload));

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not mutate data when an existing month lacks replacement confirmation", async () => {
    const existingEmployees = [
      {
        id: 1,
        employeeCode: "E001",
        surname: "Test",
        department: "Office",
        employmentType: "Regular",
        paidLeaveCycleStartMonth: 10,
        startMonth: "2026-01",
        endMonth: null,
      },
    ];
    const employeeQuery = {
      from: vi.fn().mockResolvedValue(existingEmployees),
    };
    const importWhere = vi.fn().mockResolvedValue([
      { id: 42, targetMonth: "2026-08" },
    ]);
    const importQuery = {
      from: vi.fn().mockReturnValue({ where: importWhere }),
    };
    const select = vi
      .fn()
      .mockReturnValueOnce(employeeQuery)
      .mockReturnValueOnce(importQuery);
    const deleteData = vi.fn();
    const insertData = vi.fn();
    const updateData = vi.fn();
    const tx = {
      select,
      delete: deleteData,
      insert: insertData,
      update: updateData,
    };
    const poolEnd = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (callback: (transaction: unknown) => unknown) =>
      callback(tx),
    );
    mocks.getDb.mockReturnValue({
      db: { transaction },
      pool: { end: poolEnd },
    });

    const response = await POST(makeRequest(makePayload()));

    expect(response.status).toBe(409);
    expect(transaction).toHaveBeenCalledOnce();
    expect(deleteData).not.toHaveBeenCalled();
    expect(insertData).not.toHaveBeenCalled();
    expect(updateData).not.toHaveBeenCalled();
    expect(poolEnd).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
