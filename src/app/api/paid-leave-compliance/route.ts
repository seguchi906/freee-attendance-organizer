import { and, asc, eq, gte, lt } from "drizzle-orm";
import {
  employeeMonthExclusions,
  employees,
  monthlyAttendance,
  monthlyImports,
} from "@/db/schema";
import { databaseConfigured, getDb } from "@/db";
import {
  daysBetween,
  getComplianceStatus,
  getPaidLeavePeriod,
  getTokyoDateString,
  listMonths,
  type PaidLeaveCycleStartMonth,
} from "@/lib/paid-leave-compliance";

export const runtime = "nodejs";

function previousMonth(targetMonth: string) {
  const [year, month] = targetMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  if (!databaseConfigured)
    return Response.json({ databaseConfigured: false, asOf: getTokyoDateString(), items: [] });

  const requestedAsOf = new URL(request.url).searchParams.get("asOf");
  const asOf = requestedAsOf ?? getTokyoDateString();
  if (!/^20\d{2}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(asOf))
    return Response.json({ error: "基準日の指定が不正です。" }, { status: 400 });

  const aprilPeriod = getPaidLeavePeriod(asOf, 4);
  const octoberPeriod = getPaidLeavePeriod(asOf, 10);
  const queryStart = [aprilPeriod.periodStart, octoberPeriod.periodStart].sort()[0].slice(0, 7);
  const latestEnd = [aprilPeriod.periodEnd, octoberPeriod.periodEnd].sort().at(-1)!;
  const [endYear, endMonth] = latestEnd.slice(0, 7).split("-").map(Number);
  const queryEndDate = new Date(Date.UTC(endYear, endMonth, 1));
  const queryEnd = `${queryEndDate.getUTCFullYear()}-${String(queryEndDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const asOfMonth = asOf.slice(0, 7);

  const { db, pool } = getDb();
  try {
    const [employeeRows, attendanceRows, importRows, exclusionRows] = await Promise.all([
      db.select().from(employees).orderBy(asc(employees.employeeCode)),
      db
        .select({ attendance: monthlyAttendance, employeeCode: employees.employeeCode })
        .from(monthlyAttendance)
        .innerJoin(employees, eq(monthlyAttendance.employeeId, employees.id))
        .where(and(gte(monthlyAttendance.targetMonth, queryStart), lt(monthlyAttendance.targetMonth, queryEnd))),
      db
        .select({ targetMonth: monthlyImports.targetMonth })
        .from(monthlyImports)
        .where(and(gte(monthlyImports.targetMonth, queryStart), lt(monthlyImports.targetMonth, queryEnd))),
      db
        .select({ targetMonth: employeeMonthExclusions.targetMonth, employeeCode: employees.employeeCode })
        .from(employeeMonthExclusions)
        .innerJoin(employees, eq(employeeMonthExclusions.employeeId, employees.id))
        .where(and(gte(employeeMonthExclusions.targetMonth, queryStart), lt(employeeMonthExclusions.targetMonth, queryEnd))),
    ]);

    const importedMonths = new Set(importRows.map((row) => row.targetMonth));
    const exclusions = new Set(exclusionRows.map((row) => `${row.employeeCode}:${row.targetMonth}`));
    const items = employeeRows
      .filter(
        (employee) =>
          employee.employmentType.includes("正社員") &&
          employee.startMonth <= asOfMonth &&
          (!employee.endMonth || employee.endMonth >= asOfMonth),
      )
      .map((employee) => {
        const cycleStartMonth: PaidLeaveCycleStartMonth =
          employee.paidLeaveCycleStartMonth === 4 ? 4 : 10;
        const { periodStart, periodEnd } = getPaidLeavePeriod(asOf, cycleStartMonth);
        const periodStartMonth = periodStart.slice(0, 7);
        const periodEndMonth = periodEnd.slice(0, 7);
        const rows = attendanceRows.filter(
          (row) =>
            row.employeeCode === employee.employeeCode &&
            row.attendance.targetMonth >= periodStartMonth &&
            row.attendance.targetMonth <= periodEndMonth &&
            row.attendance.targetMonth >= employee.startMonth &&
            (!employee.endMonth || row.attendance.targetMonth <= employee.endMonth) &&
            !exclusions.has(`${employee.employeeCode}:${row.attendance.targetMonth}`),
        );
        const paidLeaveDays = rows.reduce(
          (sum, row) => sum + (row.attendance.leaves as Record<string, { days: number }>)["有休 日数"].days,
          0,
        );
        const expectedEnd = [previousMonth(asOfMonth), employee.endMonth ?? periodEndMonth, periodEndMonth].sort()[0];
        const expectedStart = [periodStartMonth, employee.startMonth].sort().at(-1)!;
        const expectedMonths = expectedStart <= expectedEnd ? listMonths(expectedStart, expectedEnd) : [];
        const missingMonths = expectedMonths.filter(
          (month) => !importedMonths.has(month) && !exclusions.has(`${employee.employeeCode}:${month}`),
        );
        const registeredMonths = rows.map((row) => row.attendance.targetMonth).sort();
        const daysUntilDeadline = daysBetween(asOf, periodEnd);
        return {
          employeeCode: employee.employeeCode,
          surname: employee.surname,
          employmentType: employee.employmentType,
          paidLeaveCycleStartMonth: cycleStartMonth,
          periodStart,
          periodEnd,
          paidLeaveDays,
          remainingDays: Math.max(0, 5 - paidLeaveDays),
          daysUntilDeadline,
          registeredMonths,
          missingMonths,
          status: getComplianceStatus(paidLeaveDays, daysUntilDeadline),
        };
      });
    return Response.json({ databaseConfigured: true, asOf, items });
  } finally {
    await pool.end();
  }
}
