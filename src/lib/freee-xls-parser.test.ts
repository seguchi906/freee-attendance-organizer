import { describe, expect, it } from "vitest";
import {
  detectTargetMonthFromTextOrName,
  parseDayHourValue,
  parseFreeeXls,
} from "@/lib/freee-xls-parser";

describe("指定された18列の残業集計", () => {
  const fields = [
    "残業 時間", "割増 残業", "深夜 所定", "深夜 所定外", "深夜 残業", "割増 深夜 残業",
    "法定 休日 所定", "法定 休日 所定外", "法定 休日 残業", "法定 休日 深夜 所定", "法定 休日 深夜 所定外", "法定 休日 深夜 残業",
    "法定外 休日 所定", "法定外 休日 所定外", "法定外 休日 残業", "法定外 休日 深夜 所定", "法定外 休日 深夜 所定外", "法定外 休日 深夜 残業",
  ];
  function parse(hours: string[]) {
    const headers = ["No.", "所属", "名前", "労働合計", "タイムカード", "所定 時間", "所定外", ...fields];
    while (headers.length < 49) headers.push(`未使用${headers.length}`);
    const row = (total: boolean) => `<tr>${headers.map((_, i) => `<td>${i === 0 ? total ? "" : "1" : i === 2 ? total ? "" : "E001 テスト 太郎" : i === 4 ? total ? "合計" : "" : i === 5 || i === 6 ? "100" : i >= 7 && i < 25 ? hours[i - 7] ?? "" : ""}</td>`).join("")}</tr>`;
    return parseFreeeXls(`<table><tr>${headers.map(h => `<th>${h.replaceAll(" ", "<br>")}</th>`).join("")}</tr>${row(false)}${row(true)}</table>`, "working202608.xls");
  }

  it("各列を一度ずつ加算し、対象外の所定・所定外を含めない", () => {
    const result = parse(fields.map((_, i) => String(i + 1)));
    expect(result.rows[0]).toMatchObject({ overtimeHours: 171, weekdayOvertimeHours: 21, holidayOvertimeHours: 150 });
    expect(result.totals.overtimeHours).toBe(171);
    expect(result.rows[0].warnings).toContain("overtime");
  });

  it("空欄は0として休日分だけでも合計する", () => {
    const result = parse(fields.map((_, i) => i === 12 ? "11" : i === 14 ? "5.5" : ""));
    expect(result.rows[0]).toMatchObject({ overtimeHours: 16.5, weekdayOvertimeHours: 0, holidayOvertimeHours: 16.5 });
    expect(result.totals.overtimeHours).toBe(16.5);
    expect(result.rows[0].warnings).not.toContain("overtime");
  });
});

describe("parseDayHourValue", () => {
  it.each([
    ["", { days: 0, hours: 0 }],
    ["2.0", { days: 2, hours: 0 }],
    ["3H", { days: 0, hours: 3 }],
    ["2.0 1H", { days: 2, hours: 1 }],
    ["0.5\n3H", { days: 0.5, hours: 3 }],
  ])("%sを日数と時間へ分離する", (input, expected) => {
    expect(parseDayHourValue(input)).toEqual(expected);
  });

  it("規則外の文字を拒否する", () => {
    expect(() => parseDayHourValue("有休1日")).toThrow("解析できません");
  });
});

describe("detectTargetMonthFromTextOrName", () => {
  it("freee標準の表示期間（YYYY/MM/DD ～ YYYY/MM/DD）から年月を自動判定する", () => {
    const text = "事業所名：テスト株式会社 表示期間：2023/07/01 ～ 2023/07/31 締め日：末日締め";
    expect(detectTargetMonthFromTextOrName(text)).toBe("2023-07");
  });

  it("締め日（20日締めなどの月またぎ期間）から締め年月を自動判定する", () => {
    const text = "表示期間：2023/06/21 ～ 2023/07/20 締め日：20日締め";
    expect(detectTargetMonthFromTextOrName(text)).toBe("2023-07");
  });

  it("日本語表記（YYYY年MM月）から年月を自動判定する", () => {
    const text = "月別データ 2024年4月度 集計期間：2024年4月1日～2024年4月30日";
    expect(detectTargetMonthFromTextOrName(text)).toBe("2024-04");
  });

  it("ハイフン表記（YYYY-MM）から年月を自動判定する", () => {
    const text = "対象年月: 2025-11 勤怠一覧";
    expect(detectTargetMonthFromTextOrName(text)).toBe("2025-11");
  });

  it("1桁の月（2023/7）をゼロ埋め（2023-07）に正規化する", () => {
    const text = "表示期間: 2023/7/1 ～ 2023/7/31";
    expect(detectTargetMonthFromTextOrName(text)).toBe("2023-07");
  });

  it("本文にない場合でもファイル名（月別データ_2023-08.xls）から自動判定する", () => {
    expect(detectTargetMonthFromTextOrName("", "月別データ_2023-08.xls")).toBe(
      "2023-08",
    );
    expect(detectTargetMonthFromTextOrName("", "attendance_202409.xls")).toBe(
      "2024-09",
    );
  });
});

