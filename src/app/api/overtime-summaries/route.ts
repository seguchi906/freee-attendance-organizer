import { asc, eq } from "drizzle-orm";
import { databaseConfigured, getDb } from "@/db";
import {
  employeeMonthExclusions,
  employees,
  monthlyAttendance,
  monthlyImports,
} from "@/db/schema";
import { getFiscalMonths, getPeriodRangeLabel } from "@/lib/fiscal-year";

export const runtime = "nodejs";

const SUMMARY_PERIODS = [46, 47, 48] as const;

function averageOvertime(rows: { overtimeHours: number }[]) {
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + row.overtimeHours, 0) / rows.length;
}

export async function GET() {
  if (!databaseConfigured) {
    return Response.json({ databaseConfigured: false, summaries: [] });
  }

  const { db, pool } = getDb();
  try {
    const [attendanceRows, importRows, exclusionRows] = await Promise.all([
      db
        .select({ attendance: monthlyAttendance, employee: employees })
        .from(monthlyAttendance)
        .innerJoin(employees, eq(monthlyAttendance.employeeId, employees.id)),
      db.select({ targetMonth: monthlyImports.targetMonth }).from(monthlyImports),
      db
        .select({
          targetMonth: employeeMonthExclusions.targetMonth,
          employeeCode: employees.employeeCode,
        })
        .from(employeeMonthExclusions)
        .innerJoin(employees, eq(employeeMonthExclusions.employeeId, employees.id))
        .orderBy(asc(employeeMonthExclusions.targetMonth)),
    ]);

    const exclusions = new Set(
      exclusionRows.map((row) => `${row.employeeCode}:${row.targetMonth}`),
    );

    const summaries = SUMMARY_PERIODS.map((period) => {
      const fiscalMonths = getFiscalMonths(period);
      const fiscalMonthSet = new Set(fiscalMonths.map((month) => month.targetMonth));
      const registeredMonths = importRows
        .map((row) => row.targetMonth)
        .filter((targetMonth) => fiscalMonthSet.has(targetMonth))
        .sort();

      const periodRows = attendanceRows.filter(
        ({ attendance, employee }) =>
          fiscalMonthSet.has(attendance.targetMonth) &&
          !attendance.employmentType.includes("アルバイト") &&
          !exclusions.has(`${employee.employeeCode}:${attendance.targetMonth}`),
      );

      const quarters = Array.from({ length: 4 }, (_, quarterIndex) => {
        const quarterMonths = fiscalMonths.slice(quarterIndex * 3, quarterIndex * 3 + 3);
        const quarterMonthSet = new Set(quarterMonths.map((month) => month.targetMonth));
        const rows = periodRows.filter(({ attendance }) =>
          quarterMonthSet.has(attendance.targetMonth),
        );
        const juniorRows = rows.filter(({ employee }) => employee.isJunior);
        const otherRows = rows.filter(({ employee }) => !employee.isJunior);
        const overLimitOccurrences = rows
          .filter(({ attendance }) => attendance.overtimeHours >= 45)
          .map(({ attendance, employee }) => ({
            employeeCode: employee.employeeCode,
            surname: employee.surname,
            targetMonth: attendance.targetMonth,
            monthLabel:
              quarterMonths.find((month) => month.targetMonth === attendance.targetMonth)
                ?.label ?? attendance.targetMonth,
            overtimeHours: attendance.overtimeHours,
          }))
          .sort(
            (a, b) =>
              a.targetMonth.localeCompare(b.targetMonth) ||
              a.employeeCode.localeCompare(b.employeeCode),
          );

        return {
          quarter: quarterIndex + 1,
          label: `第${quarterIndex + 1}四半期`,
          monthLabel: `${quarterMonths[0].label.replace("月", "")}〜${quarterMonths[2].label}`,
          averageOverall: averageOvertime(rows.map(({ attendance }) => attendance)),
          averageOther: averageOvertime(otherRows.map(({ attendance }) => attendance)),
          averageJunior: averageOvertime(juniorRows.map(({ attendance }) => attendance)),
          overLimitEmployeeCount: new Set(
            overLimitOccurrences.map((item) => item.employeeCode),
          ).size,
          overLimitOccurrences,
        };
      });

      return {
        period,
        rangeLabel: getPeriodRangeLabel(period),
        registeredMonths,
        isComplete: registeredMonths.length === 12,
        quarters,
      };
    });

    return Response.json({ databaseConfigured: true, summaries });
  } finally {
    await pool.end();
  }
}
