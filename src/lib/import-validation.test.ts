import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEAVE_FIELDS } from "@/lib/attendance-types";
import { parseFreeeXls } from "@/lib/freee-xls-parser";
import { importCommitSchema, importPreviewSchema } from "@/lib/validation";

function payload() {
  const headers = ["No.", "所属", "名前", "労働合計", "タイムカード", "残業時間", ...LEAVE_FIELDS];
  while (headers.length < 49) headers.push(`未使用${headers.length}`);
  const row = (values: Record<string, string>) => `<tr>${headers.map((header) => `<td>${values[header] ?? ""}</td>`).join("")}</tr>`;
  const text = `<table><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>${row({ "No.": "1", 名前: "E001 テスト 太郎", 残業時間: "12.5" })}${row({ タイムカード: "合計", 残業時間: "12.5" })}</table>`;
  const parsed = parseFreeeXls(text, "working202608.xls");
  return { targetMonth: parsed.targetMonth, columnCount: parsed.columnCount, rows: parsed.rows, totals: parsed.totals };
}

describe("Excel解析結果と取込APIの互換性", () => {
  it("解析した残業内訳を確認・登録の両方で受け付ける", () => {
    const input = payload();
    expect(input.rows[0].weekdayOvertimeHours).toBe(12.5);
    expect(input.rows[0].holidayOvertimeHours).toBe(0);
    expect(importPreviewSchema.safeParse(input).success).toBe(true);
    expect(importCommitSchema.safeParse(input).success).toBe(true);
  });

  it("内訳のない従来データも受け付ける", () => {
    const input = payload();
    delete input.rows[0].weekdayOvertimeHours;
    delete input.rows[0].holidayOvertimeHours;
    expect(importCommitSchema.safeParse(input).success).toBe(true);
  });

  it("未知の項目や数値以外の残業内訳は引き続き拒否する", () => {
    const input = payload();
    for (const extra of [{ unexpected: 1 }, { weekdayOvertimeHours: "12.5" }, { holidayOvertimeHours: "0" }]) {
      const invalid = { ...input, rows: [{ ...input.rows[0], ...extra }] };
      expect(importPreviewSchema.safeParse(invalid).success).toBe(false);
      expect(importCommitSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it.skipIf(!process.env.ATTENDANCE_TEST_XLS)("指定した実ファイルを確認・登録形式で検証する", () => {
    const parsed = parseFreeeXls(readFileSync(process.env.ATTENDANCE_TEST_XLS!, "utf8"), "working202608.xls");
    const input = { targetMonth: parsed.targetMonth, columnCount: parsed.columnCount, rows: parsed.rows, totals: parsed.totals };
    expect(parsed.targetMonth).toBe("2026-08");
    expect(parsed.rows).toHaveLength(18);
    expect(parsed.totals).toMatchObject({ scheduledHours: 2423, overtimeHours: 182, totalWorkHours: 2605, paidLeaveDays: 13.5, paidLeaveHours: 5 });
    expect(importPreviewSchema.safeParse(input).success).toBe(true);
    expect(importCommitSchema.safeParse(input).success).toBe(true);
  });
});
