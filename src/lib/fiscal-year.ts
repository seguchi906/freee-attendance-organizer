export const MIN_PERIOD = 45;
export const BASE_PERIOD = 48;
export const BASE_START_YEAR = 2026; // 2026年7月〜2027年6月 = 48期 (startYear - 1978 = period)
const YEAR_OFFSET = BASE_START_YEAR - BASE_PERIOD; // 1978

export type FiscalMonth = {
  year: number;
  month: number;
  targetMonth: string; // "YYYY-MM"
  label: string; // "7月", etc.
  fullLabel: string; // "2026年7月", etc.
};

/**
 * 基準年月（YYYY-MM）から事業期を算出します（7月開始）。
 * 例: "2026-07" => 48, "2027-06" => 48, "2026-06" => 47
 */
export function getPeriodFromTargetMonth(targetMonth: string): number {
  const [yearStr, monthStr] = targetMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const startYear = month >= 7 ? year : year - 1;
  return startYear - YEAR_OFFSET;
}

/**
 * 日付から事業期を算出します。
 */
export function getCurrentPeriod(date = new Date()): number {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  return startYear - YEAR_OFFSET;
}

/**
 * 事業期の開始年（7月の年）を取得します。
 * 例: 48期 => 2026
 */
export function getStartYearFromPeriod(period: number): number {
  return period + YEAR_OFFSET;
}

/**
 * 事業期の期間表記（例: "2026年7月〜2027年6月"）を取得します。
 */
export function getPeriodRangeLabel(period: number): string {
  const startYear = getStartYearFromPeriod(period);
  return `${startYear}年7月〜${startYear + 1}年6月`;
}

/**
 * 指定した事業期の12ヶ月の一覧を取得します（7月〜翌年6月順）。
 */
export function getFiscalMonths(period: number): FiscalMonth[] {
  const startYear = getStartYearFromPeriod(period);
  const months: FiscalMonth[] = [];

  // 7月〜12月
  for (let m = 7; m <= 12; m++) {
    const targetMonth = `${startYear}-${String(m).padStart(2, "0")}`;
    months.push({
      year: startYear,
      month: m,
      targetMonth,
      label: `${m}月`,
      fullLabel: `${startYear}年${m}月`,
    });
  }

  // 翌年1月〜6月
  const nextYear = startYear + 1;
  for (let m = 1; m <= 6; m++) {
    const targetMonth = `${nextYear}-${String(m).padStart(2, "0")}`;
    months.push({
      year: nextYear,
      month: m,
      targetMonth,
      label: `${m}月`,
      fullLabel: `${nextYear}年${m}月`,
    });
  }

  return months;
}
