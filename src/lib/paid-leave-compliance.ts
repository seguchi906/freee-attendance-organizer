export type PaidLeaveCycleStartMonth = 4 | 10;

const pad = (value: number) => String(value).padStart(2, "0");

export function getTokyoDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getPaidLeavePeriod(
  asOf: string,
  cycleStartMonth: PaidLeaveCycleStartMonth,
) {
  const [year, month] = asOf.split("-").map(Number);
  const startYear = month >= cycleStartMonth ? year : year - 1;
  const endMonth = cycleStartMonth === 4 ? 3 : 9;
  const endYear = startYear + 1;
  const lastDay = endMonth === 3 ? 31 : 30;
  return {
    periodStart: `${startYear}-${pad(cycleStartMonth)}-01`,
    periodEnd: `${endYear}-${pad(endMonth)}-${lastDay}`,
  };
}

export function daysBetween(from: string, to: string) {
  const utc = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.ceil((utc(to) - utc(from)) / 86_400_000);
}

export function getComplianceStatus(paidLeaveDays: number, daysUntilDeadline: number) {
  if (paidLeaveDays >= 5) return "achieved" as const;
  if (daysUntilDeadline <= 90) return "warning" as const;
  return "in-progress" as const;
}

export function listMonths(startMonth: string, endMonth: string) {
  const [startYear, start] = startMonth.split("-").map(Number);
  const [endYear, end] = endMonth.split("-").map(Number);
  const result: string[] = [];
  let year = startYear;
  let month = start;
  while (year < endYear || (year === endYear && month <= end)) {
    result.push(`${year}-${pad(month)}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return result;
}
