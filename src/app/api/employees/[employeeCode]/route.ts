import { eq } from "drizzle-orm";
import { employees } from "@/db/schema";
import { databaseConfigured, getDb } from "@/db";
import { employeePatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ employeeCode: string }> }) {
  if (!databaseConfigured) return Response.json({ error: "DATABASE_URLが設定されていません。" }, { status: 503 });
  const data = employeePatchSchema.safeParse(await request.json());
  if (!data.success) return Response.json({ error: "更新内容が不正です。" }, { status: 400 });
  if (data.data.startMonth && data.data.endMonth && data.data.startMonth > data.data.endMonth) return Response.json({ error: "在籍終了月は開始月以降にしてください。" }, { status: 400 });
  const { employeeCode } = await context.params;
  const { db, pool } = getDb();
  try {
    const [updated] = await db.update(employees).set({ ...data.data, updatedAt: new Date() }).where(eq(employees.employeeCode, employeeCode)).returning();
    if (!updated) return Response.json({ error: "社員が見つかりません。" }, { status: 404 });
    return Response.json({ employeeCode: updated.employeeCode });
  } finally { await pool.end(); }
}
