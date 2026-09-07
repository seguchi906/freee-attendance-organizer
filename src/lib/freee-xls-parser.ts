import {
  LEAVE_FIELDS,
  type DayHourValue,
  type ImportTotals,
  type LeaveField,
  type ParsedAttendanceFile,
  type SanitizedAttendanceRow,
} from "@/lib/attendance-types";

const normalize = (value: string | null | undefined) =>
  (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const headerKey = (value: string | null | undefined) =>
  normalize(value).replace(/\s/g, "");

function cellText(cell: Element) {
  const clone = cell.cloneNode(true) as Element;
  clone
    .querySelectorAll("br")
    .forEach((breakElement) => breakElement.replaceWith(" "));
  return normalize(clone.textContent);
}

const numberValue = (value: string | undefined) => {
  const parsed = Number(normalize(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

export function parseDayHourValue(input: string): DayHourValue {
  const value = normalize(input);
  if (!value) return { days: 0, hours: 0 };

  const tokens = value.match(/\d+(?:\.\d+)?H|\d+(?:\.\d+)?/gi) ?? [];
  const remainder = value.replace(/\d+(?:\.\d+)?H|\d+(?:\.\d+)?/gi, "").trim();
  if (remainder || !tokens.length)
    throw new Error(`休暇値「${value}」を解析できません。`);

  let days = 0;
  let hours = 0;
  for (const token of tokens) {
    if (token.toUpperCase().endsWith("H")) hours += Number(token.slice(0, -1));
    else days += Number(token);
  }
  return { days, hours };
}

export function detectTargetMonthFromTextOrName(
  text: string,
  fileName = "",
): string {
  const normText = normalize(text);

  // 1. Date range patterns: e.g. 2023/07/01 ～ 2023/07/31 or 2023/06/21 ～ 2023/07/20
  // Range check is prioritized so mid-month cutoffs (e.g. 20日締め) accurately identify the closing month.
  const rangePattern =
    /(20\d{2})[\/\-年\.]\s*(1[0-2]|0[1-9]|[1-9])[\/\-月\.]\s*\d{1,2}[日\s]*[～〜~\-－―to\s]+[^\d]*(20\d{2})[\/\-年\.]\s*(1[0-2]|0[1-9]|[1-9])[\/\-月\.]\s*\d{1,2}/;
  const rangeMatch = normText.match(rangePattern);
  if (rangeMatch) {
    const endYear = rangeMatch[3];
    const endMonth = rangeMatch[4].padStart(2, "0");
    return `${endYear}-${endMonth}`;
  }

  // 2. Explicit display/target period patterns (Freee standard headers)
  const displayPatterns = [
    /(?:表示期間|対象期間|集計期間|対象年月|対象月|給与月|勤怠月)[^0-9]{0,30}(20\d{2})[\/\-年\.]\s*(1[0-2]|0[1-9]|[1-9])/,
    /(?:表示期間|対象期間|集計期間|対象年月|対象月)[^0-9]{0,30}(20\d{2})(0[1-9]|1[0-2])/,
    /(20\d{2})年\s*(1[0-2]|0[1-9]|[1-9])月度?/,
  ];

  for (const pattern of displayPatterns) {
    const match = normText.match(pattern);
    if (match) {
      const year = match[1];
      const month = match[2].padStart(2, "0");
      return `${year}-${month}`;
    }
  }

  // 3. Generic year/month in text: e.g. 2023/07 or 2023年7月
  const genericPattern = /(20\d{2})[\/\-年\.]\s*(1[0-2]|0[1-9]|[1-9])/;
  const genericMatch = normText.match(genericPattern);
  if (genericMatch) {
    const year = genericMatch[1];
    const month = genericMatch[2].padStart(2, "0");
    return `${year}-${month}`;
  }

  // 4. Fallback to file name if available: e.g. 月別データ_2023-07.xls
  if (fileName) {
    const fileMatch =
      fileName.match(/(20\d{2})[\-_年/\.](1[0-2]|0[1-9]|[1-9])/) ??
      fileName.match(/(20\d{2})(0[1-9]|1[0-2])/);
    if (fileMatch) {
      const year = fileMatch[1];
      const month = fileMatch[2].padStart(2, "0");
      return `${year}-${month}`;
    }
  }

  throw new Error(
    "ファイル内の表示期間・日付情報から対象年月（年・月）を自動判定できませんでした。",
  );
}

function detectTargetMonth(document: Document, sourceFileName: string) {
  const text = document.body?.textContent ?? "";
  return detectTargetMonthFromTextOrName(text, sourceFileName);
}

function findAttendanceTable(document: Document) {
  for (const table of Array.from(document.querySelectorAll("table"))) {
    const rows = Array.from(table.querySelectorAll("tr"));
    const headerIndex = rows.findIndex((row) => {
      const labels = Array.from(row.querySelectorAll("th,td")).map((cell) =>
        headerKey(cellText(cell)),
      );
      return (
        labels.includes("No.") &&
        labels.includes("所属") &&
        labels.includes("名前") &&
        labels.includes("労働合計")
      );
    });
    if (headerIndex >= 0) return { rows, headerIndex };
  }
  throw new Error("freee月別データの一覧表を見つけられません。");
}

function parseIdentity(value: string) {
  const parts = normalize(value).split(" ").filter(Boolean);
  if (parts.length < 3 || !/^[A-Za-z0-9_-]+$/.test(parts[0])) {
    throw new Error("社員コード・苗字・名前を分離できない行があります。");
  }
  return { employeeCode: parts[0], surname: parts[1] };
}

function mapRow(headers: string[], cells: Element[]) {
  return Object.fromEntries(
    headers.map((header, index) => [
      header,
      cells[index] ? cellText(cells[index]) : "",
    ]),
  );
}

function buildWarnings(row: Omit<SanitizedAttendanceRow, "warnings">) {
  const warnings: SanitizedAttendanceRow["warnings"] = [];
  if (row.overtimeHours >= 45) warnings.push("overtime");
  if (row.holidayAttendanceDays > 0) warnings.push("holiday-work");
  if (row.lateCount > 0 || row.earlyLeaveCount > 0)
    warnings.push("late-or-early");
  if (row.closingStatus !== "済") warnings.push("unclosed");
  return warnings;
}

// User-defined reporting total: all 18 columns from 残業時間 through 法定外休日深夜残業.
const weekdayOvertimeFields = [
  "残業時間", "割増残業", "深夜所定", "深夜所定外", "深夜残業", "割増深夜残業",
];
const holidayOvertimeFields = [
  "法定休日所定", "法定休日所定外", "法定休日残業",
  "法定休日深夜所定", "法定休日深夜所定外", "法定休日深夜残業",
  "法定外休日所定", "法定外休日所定外", "法定外休日残業",
  "法定外休日深夜所定", "法定外休日深夜所定外", "法定外休日深夜残業",
];

function parseOvertime(values: Record<string, string>) {
  const sum = (fields: string[]) => fields.reduce((total, field) => total + numberValue(values[field]), 0);
  const weekdayOvertimeHours = sum(weekdayOvertimeFields);
  const holidayOvertimeHours = sum(holidayOvertimeFields);
  return { weekdayOvertimeHours, holidayOvertimeHours, overtimeHours: weekdayOvertimeHours + holidayOvertimeHours };
}

function parseEmployeeRow(
  values: Record<string, string>,
): SanitizedAttendanceRow {
  const value = (label: string) => values[headerKey(label)] ?? "";
  const identity = parseIdentity(value("名前"));
  const leaves = Object.fromEntries(
    LEAVE_FIELDS.map((field) => [field, parseDayHourValue(value(field))]),
  ) as Record<LeaveField, DayHourValue>;
  const { overtimeHours, weekdayOvertimeHours, holidayOvertimeHours } = parseOvertime(values);

  const base: Omit<SanitizedAttendanceRow, "warnings"> = {
    ...identity,
    department: value("所属"),
    employmentType: value("雇用区分"),
    closingStatus: value("締"),
    weekdayAttendanceDays: numberValue(value("平日 出勤 日数")),
    holidayAttendanceDays: numberValue(value("休日 出勤 日数")),
    lateCount: numberValue(value("遅刻 回数")),
    earlyLeaveCount: numberValue(value("早退 回数")),
    scheduledHours: numberValue(value("所定 時間")),
    overtimeHours,
    weekdayOvertimeHours,
    holidayOvertimeHours,
    lateHours: numberValue(value("遅刻 時間")),
    earlyLeaveHours: numberValue(value("早退 時間")),
    breakHours: numberValue(value("休憩 時間")),
    totalWorkHours: numberValue(value("労働 合計")),
    leaves,
  };
  return { ...base, warnings: buildWarnings(base) };
}

function parseTotals(values: Record<string, string>): ImportTotals {
  const value = (label: string) => values[headerKey(label)] ?? "";
  const paidLeave = parseDayHourValue(value("有休 日数"));
  return {
    scheduledHours: numberValue(value("所定 時間")),
    overtimeHours: parseOvertime(values).overtimeHours,
    breakHours: numberValue(value("休憩 時間")),
    totalWorkHours: numberValue(value("労働 合計")),
    paidLeaveDays: paidLeave.days,
    paidLeaveHours: paidLeave.hours,
  };
}

export function parseFreeeXls(
  text: string,
  sourceFileName: string,
): ParsedAttendanceFile {
  const document = new DOMParser().parseFromString(text, "text/html");
  const targetMonth = detectTargetMonth(document, sourceFileName);
  const { rows: tableRows, headerIndex } = findAttendanceTable(document);
  const headers = Array.from(
    tableRows[headerIndex].querySelectorAll("th,td"),
  ).map((cell) => headerKey(cellText(cell)));
  if (headers.length !== 49)
    throw new Error(
      `列数が想定と異なります（${headers.length}列、想定49列）。`,
    );

  const rows: SanitizedAttendanceRow[] = [];
  let totals: ImportTotals | null = null;
  const seenCodes = new Set<string>();
  for (const tr of tableRows.slice(headerIndex + 1)) {
    const cells = Array.from(tr.querySelectorAll(":scope > td"));
    if (cells.length < headers.length) continue;
    const values = mapRow(headers, cells);
    if (values[headerKey("タイム カード")] === "合計") {
      totals = parseTotals(values);
      continue;
    }
    if (!values[headerKey("No.")] || !values[headerKey("名前")]) continue;
    const row = parseEmployeeRow(values);
    if (seenCodes.has(row.employeeCode))
      throw new Error(`社員コード ${row.employeeCode} が重複しています。`);
    seenCodes.add(row.employeeCode);
    rows.push(row);
  }
  if (!rows.length || !totals)
    throw new Error("従業員データまたは合計行を読み取れませんでした。");
  return {
    targetMonth,
    sourceFileName,
    columnCount: headers.length,
    rows,
    totals,
  };
}
