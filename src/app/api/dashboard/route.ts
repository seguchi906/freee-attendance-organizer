import { and, asc, eq, gte, lt } from "drizzle-orm";
import {
  employeeMonthExclusions,
  employees,
  monthlyAttendance,
  monthlyImports,
} from "@/db/schema";
import { databaseConfigured, getDb } from "@/db";
import { getCurrentPeriod, getStartYearFromPeriod } from "@/lib/fiscal-year";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!databaseConfigured)
    return Response.json({
      databaseConfigured: false,
      employees: [],
      attendance: [],
      registeredMonths: [],
      excludedEmployeeMonths: [],
    });

  const url = new URL(request.url);
  const periodParam = url.searchParams.get("period");
  const yearParam = url.searchParams.get("year");

  let period: number;
  if (periodParam && /^\d+$/.test(periodParam)) {
    period = Number(periodParam);
  } else if (yearParam && /^20\d{2}$/.test(yearParam)) {
    period = Number(yearParam) - 1978;
  } else if (yearParam && /^\d+$/.test(yearParam)) {
    period = Number(yearParam);
  } else {
    period = getCurrentPeriod();
  }

  if (period < 1 || period > 999)
    return Response.json({ error: "期の指定が不正です。" }, { status: 400 });

  const startYear = getStartYearFromPeriod(period);
  const startMonth = `${startYear}-07`;
  const nextStartMonth = `${startYear + 1}-07`;

  const { db, pool } = getDb();
  try {
    const [employeeRows, attendanceRows, imports, exclusions] =
      await Promise.all([
        db.select().from(employees).orderBy(asc(employees.employeeCode)),
        db
          .select({ attendance: monthlyAttendance, employee: employees })
          .from(monthlyAttendance)
          .innerJoin(employees, eq(monthlyAttendance.employeeId, employees.id))
          .where(
            and(
              gte(monthlyAttendance.targetMonth, startMonth),
              lt(monthlyAttendance.targetMonth, nextStartMonth),
            ),
          ),
        db
          .select()
          .from(monthlyImports)
          .where(
            and(
              gte(monthlyImports.targetMonth, startMonth),
              lt(monthlyImports.targetMonth, nextStartMonth),
            ),
          ),
        db
          .select({
            targetMonth: employeeMonthExclusions.targetMonth,
            employeeCode: employees.employeeCode,
          })
          .from(employeeMonthExclusions)
          .innerJoin(
            employees,
            eq(employeeMonthExclusions.employeeId, employees.id),
          )
          .where(
            and(
              gte(employeeMonthExclusions.targetMonth, startMonth),
              lt(employeeMonthExclusions.targetMonth, nextStartMonth),
            ),
          ),
      ]);
    return Response.json({
      databaseConfigured: true,
      period,
      startYear,
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
      registeredMonths: imports.map((row) => row.targetMonth),
      excludedEmployeeMonths: exclusions.map(
        (row) => `${row.employeeCode}:${row.targetMonth}`,
      ),
    });
  } finally {
    await pool.end();
  }
}
