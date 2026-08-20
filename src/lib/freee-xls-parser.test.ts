import { describe, expect, it } from "vitest";
import {
  detectTargetMonthFromTextOrName,
  parseDayHourValue,
} from "@/lib/freee-xls-parser";

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


