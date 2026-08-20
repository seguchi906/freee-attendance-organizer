import { asc, eq } from "drizzle-orm";
import {
  employeeMonthExclusions,
  employees,
  monthlyAttendance,
  monthlyImports,
} from "@/db/schema";
import { databaseConfigured, getDb } from "@/db";
import { getPeriodFromTargetMonth, getPeriodRangeLabel } from "@/lib/fiscal-year";

export const runtime = "nodejs";

const vacationFields = ["有休 日数", "特別休暇 日数", "代休 日数", "夏季休暇 日数"];

export async function GET() {
  if (!databaseConfigured)
    return Response.json({ databaseConfigured: false, summaries: [] });

  const { db, pool } = getDb();
  try {
    const [attendanceRows, importRows, exclusionRows] = await Promise.all([
      db
        .select({ attendance: monthlyAttendance, employee: employees })
        .from(monthlyAttendance)
        .innerJoin(employees, eq(monthlyAttendance.employeeId, employees.id)),
      db.select({ targetMonth: monthlyImports.targetMonth }).from(monthlyImports),
      db
        .select({ targetMonth: employeeMonthExclusions.targetMonth, employeeCode: employees.employeeCode })
        .from(employeeMonthExclusions)
        .innerJoin(employees, eq(employeeMonthExclusions.employeeId, employees.id))
        .orderBy(asc(employeeMonthExclusions.targetMonth)),
    ]);
    const exclusions = new Set(
      exclusionRows.map((row) => `${row.employeeCode}:${row.targetMonth}`),
    );
    const periods = new Set([
      ...importRows.map((row) => getPeriodFromTargetMonth(row.targetMonth)),
      ...attendanceRows.map((row) => getPeriodFromTargetMonth(row.attendance.targetMonth)),
    ]);
    const summaries = [...periods]
      .sort((a, b) => b - a)
      .map((period) => {
        const rows = attendanceRows.filter(
          ({ attendance, employee }) =>
            getPeriodFromTargetMonth(attendance.targetMonth) === period &&
            !attendance.employmentType.includes("アルバイト") &&
            !exclusions.has(`${employee.employeeCode}:${attendance.targetMonth}`),
        );
        const byEmployee = new Map<string, { employeeCode: string; surname: string; leave: number; paid: number; summer: number }>();
        for (const { attendance, employee } of rows) {
          const leaves = attendance.leaves as Record<string, { days: number }>;
          const item = byEmployee.get(employee.employeeCode) ?? {
            employeeCode: employee.employeeCode,
            surname: employee.surname,
            leave: 0,
            paid: 0,
            summer: 0,
          };
          item.leave += vacationFields.reduce((sum, field) => sum + (leaves[field]?.days ?? 0), 0);
          item.paid += leaves["有休 日数"]?.days ?? 0;
          item.summer += leaves["夏季休暇 日数"]?.days ?? 0;
          byEmployee.set(employee.employeeCode, item);
        }
        const employeeTotals = [...byEmployee.values()].sort((a, b) =>
          a.employeeCode.localeCompare(b.employeeCode),
        );
        const count = employeeTotals.length;
        const registeredMonths = importRows
          .map((row) => row.targetMonth)
          .filter((month) => getPeriodFromTargetMonth(month) === period)
          .sort();
        return {
          period,
          rangeLabel: getPeriodRangeLabel(period),
          registeredMonths,
          isComplete: registeredMonths.length === 12,
          employeeCount: count,
          averageLeaveDays: count
            ? employeeTotals.reduce((sum, item) => sum + item.leave, 0) / count
            : 0,
          averageSummerLeaveDays: count
            ? employeeTotals.reduce((sum, item) => sum + item.summer, 0) / count
            : 0,
          lowSummerLeaveEmployees: employeeTotals.filter((item) => item.summer < 5),
          lowPaidLeaveEmployees: employeeTotals.filter((item) => item.paid < 5),
        };
      });
    return Response.json({ databaseConfigured: true, summaries });
  } finally {
    await pool.end();
  }
}
