import { authorizeApi } from "@/lib/api-auth";
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

/** レポート作成用に、登録済みの全期間をまとめて返す勤怠基データ。 */
export async function GET(request: Request) {
  const authError = await authorizeApi(request);
  if (authError) return authError;
  if (!databaseConfigured) {
    return Response.json({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      databaseConfigured: false,
      fiscalPeriods: [],
      employees: [],
      attendance: [],
      excludedEmployeeMonths: [],
    });
  }

  const { db, pool } = getDb();
  try {
    const [importRows, employeeRows, attendanceRows, exclusionRows] = await Promise.all([
      db.select().from(monthlyImports).orderBy(asc(monthlyImports.targetMonth)),
      db.select().from(employees).orderBy(asc(employees.employeeCode)),
      db
        .select({ attendance: monthlyAttendance, employee: employees })
        .from(monthlyAttendance)
        .innerJoin(employees, eq(monthlyAttendance.employeeId, employees.id))
        .orderBy(asc(monthlyAttendance.targetMonth), asc(employees.employeeCode)),
      db
        .select({ targetMonth: employeeMonthExclusions.targetMonth, employeeCode: employees.employeeCode })
        .from(employeeMonthExclusions)
        .innerJoin(employees, eq(employeeMonthExclusions.employeeId, employees.id))
        .orderBy(asc(employeeMonthExclusions.targetMonth), asc(employees.employeeCode)),
    ]);

    const monthsByPeriod = new Map<number, string[]>();
    for (const row of importRows) {
      const period = getPeriodFromTargetMonth(row.targetMonth);
      const months = monthsByPeriod.get(period) ?? [];
      months.push(row.targetMonth);
      monthsByPeriod.set(period, months);
    }

    return Response.json({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      databaseConfigured: true,
      fiscalPeriods: [...monthsByPeriod.entries()]
        .sort(([left], [right]) => left - right)
        .map(([period, registeredMonths]) => ({
          period,
          rangeLabel: getPeriodRangeLabel(period),
          registeredMonths,
          isComplete: registeredMonths.length === 12,
        })),
      employees: employeeRows.map((row) => ({
        employeeCode: row.employeeCode,
        surname: row.surname,
        department: row.department,
        employmentType: row.employmentType,
        isJunior: row.isJunior ?? false,
        paidLeaveCycleStartMonth: row.paidLeaveCycleStartMonth === 4 ? 4 : 10,
        startMonth: row.startMonth,
        endMonth: row.endMonth,
      })),
      attendance: attendanceRows.map(({ attendance, employee }) => ({
        ...attendance,
        employeeCode: employee.employeeCode,
        surname: employee.surname,
      })),
      excludedEmployeeMonths: exclusionRows.map(
        (row) => `${row.employeeCode}:${row.targetMonth}`,
      ),
    });
  } finally {
    await pool.end();
  }
}
