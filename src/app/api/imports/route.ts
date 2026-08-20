import { eq } from "drizzle-orm";
import {
  employeeMonthExclusions,
  employees,
  monthlyAttendance,
  monthlyImports,
} from "@/db/schema";
import { databaseConfigured, getDb } from "@/db";
import { compareEmployees, previousMonth } from "@/lib/employee-diff";
import { importCommitSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!databaseConfigured)
    return Response.json(
      { error: "DATABASE_URLが設定されていません。" },
      { status: 503 },
    );
  const parsed = importCommitSchema.safeParse(await request.json());
  if (!parsed.success)
    return Response.json(
      { error: "取込データの形式が不正です。" },
      { status: 400 },
    );
  const payload = parsed.data;
  const { db, pool } = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const existingEmployees = await tx.select().from(employees);
      const normalized = existingEmployees.map((record) => ({
        employeeCode: record.employeeCode,
        surname: record.surname,
        department: record.department,
        employmentType: record.employmentType,
        paidLeaveCycleStartMonth: record.paidLeaveCycleStartMonth === 4 ? 4 as const : 10 as const,
        startMonth: record.startMonth,
        endMonth: record.endMonth,
      }));
      const diff = compareEmployees(
        normalized,
        payload.rows,
        payload.targetMonth,
      );
      const unresolvedSurnames = diff.surnameMismatches.filter(
        (item) => !payload.surnameUpdates.includes(item.employeeCode),
      );
      const unresolvedMissing = diff.missingEmployees.filter(
        (item) => !payload.missingActions[item.employeeCode],
      );
      if (unresolvedSurnames.length || unresolvedMissing.length)
        throw new Error("社員差異の確認が完了していません。");

      const [existingImport] = await tx
        .select()
        .from(monthlyImports)
        .where(eq(monthlyImports.targetMonth, payload.targetMonth));
      if (existingImport && !payload.replaceExisting)
        throw new Error("この月は登録済みです。置換確認が必要です。");
      if (existingImport)
        await tx
          .delete(monthlyImports)
          .where(eq(monthlyImports.id, existingImport.id));

      for (const row of diff.newEmployees) {
        await tx
          .insert(employees)
          .values({
            employeeCode: row.employeeCode,
            surname: row.surname,
            department: row.department,
            employmentType: row.employmentType,
            startMonth: payload.targetMonth,
          });
      }
      for (const mismatch of diff.surnameMismatches) {
        const row = payload.rows.find(
          (item) => item.employeeCode === mismatch.employeeCode,
        )!;
        await tx
          .update(employees)
          .set({
            surname: row.surname,
            department: row.department,
            employmentType: row.employmentType,
            updatedAt: new Date(),
          })
          .where(eq(employees.employeeCode, row.employeeCode));
      }
      for (const employee of diff.missingEmployees) {
        const action = payload.missingActions[employee.employeeCode];
        if (action === "retire") {
          await tx
            .update(employees)
            .set({
              endMonth: previousMonth(payload.targetMonth),
              updatedAt: new Date(),
            })
            .where(eq(employees.employeeCode, employee.employeeCode));
        } else if (action === "exclude") {
          const [record] = await tx
            .select()
            .from(employees)
            .where(eq(employees.employeeCode, employee.employeeCode));
          await tx
            .insert(employeeMonthExclusions)
            .values({
              employeeId: record.id,
              targetMonth: payload.targetMonth,
              reason: "一時的な対象外",
            })
            .onConflictDoNothing();
        }
      }
      for (const row of payload.rows) {
        const existing = existingEmployees.find(
          (item) => item.employeeCode === row.employeeCode,
        );
        const startMonth =
          existing && existing.startMonth
            ? payload.targetMonth < existing.startMonth
              ? payload.targetMonth
              : existing.startMonth
            : payload.targetMonth;
        await tx
          .update(employees)
          .set({
            department: row.department,
            employmentType: row.employmentType,
            startMonth,
            updatedAt: new Date(),
          })
          .where(eq(employees.employeeCode, row.employeeCode));
      }
      const [createdImport] = await tx
        .insert(monthlyImports)
        .values({
          targetMonth: payload.targetMonth,
          employeeCount: payload.rows.length,
          totals: payload.totals,
        })
        .returning();
      const employeeRecords = await tx.select().from(employees);
      const idByCode = new Map(
        employeeRecords.map((employee) => [employee.employeeCode, employee.id]),
      );
      await tx
        .insert(monthlyAttendance)
        .values(
          payload.rows.map((row) => ({
            importId: createdImport.id,
            employeeId: idByCode.get(row.employeeCode)!,
            targetMonth: payload.targetMonth,
            department: row.department,
            employmentType: row.employmentType,
            closingStatus: row.closingStatus,
            weekdayAttendanceDays: row.weekdayAttendanceDays,
            holidayAttendanceDays: row.holidayAttendanceDays,
            lateCount: row.lateCount,
            earlyLeaveCount: row.earlyLeaveCount,
            scheduledHours: row.scheduledHours,
            overtimeHours: row.overtimeHours,
            lateHours: row.lateHours,
            earlyLeaveHours: row.earlyLeaveHours,
            breakHours: row.breakHours,
            totalWorkHours: row.totalWorkHours,
            leaves: row.leaves,
            warnings: row.warnings,
          })),
        );
      return {
        targetMonth: payload.targetMonth,
        employeeCount: payload.rows.length,
      };
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "登録に失敗しました。",
      },
      { status: 409 },
    );
  } finally {
    await pool.end();
  }
}
