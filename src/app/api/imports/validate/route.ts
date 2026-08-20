import { asc } from "drizzle-orm";
import { employees } from "@/db/schema";
import { databaseConfigured, getDb } from "@/db";
import { compareEmployees } from "@/lib/employee-diff";
import { importPreviewSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!databaseConfigured) return Response.json({ error: "DATABASE_URLが設定されていません。" }, { status: 503 });
  const parsed = importPreviewSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "取込データの形式が不正です。" }, { status: 400 });
  const { db, pool } = getDb();
  try {
    const records = await db.select().from(employees).orderBy(asc(employees.employeeCode));
    const normalized = records.map((record) => ({ employeeCode: record.employeeCode, surname: record.surname, department: record.department, employmentType: record.employmentType, paidLeaveCycleStartMonth: record.paidLeaveCycleStartMonth === 4 ? 4 as const : 10 as const, startMonth: record.startMonth, endMonth: record.endMonth }));
    return Response.json(compareEmployees(normalized, parsed.data.rows, parsed.data.targetMonth));
  } finally { await pool.end(); }
}
