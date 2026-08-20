export const LEAVE_FIELDS = [
  "有休 日数",
  "代休 日数",
  "欠勤 日数",
  "子の看護休暇 日数",
  "介護休暇 日数",
  "産前産後休業 日数",
  "育児休業 日数",
  "介護休業 日数",
  "労災休業 日数",
  "公休 日数",
  "忌引き 日数",
  "特別休暇 日数",
  "夏季休暇 日数",
] as const;

export type LeaveField = (typeof LEAVE_FIELDS)[number];

export type DayHourValue = { days: number; hours: number };

export type AttendanceWarning =
  | "overtime"
  | "holiday-work"
  | "late-or-early"
  | "unclosed";

export type SanitizedAttendanceRow = {
  employeeCode: string;
  surname: string;
  department: string;
  employmentType: string;
  closingStatus: string;
  weekdayAttendanceDays: number;
  holidayAttendanceDays: number;
  lateCount: number;
  earlyLeaveCount: number;
  scheduledHours: number;
  overtimeHours: number;
  weekdayOvertimeHours?: number;
  holidayOvertimeHours?: number;
  lateHours: number;
  earlyLeaveHours: number;
  breakHours: number;
  totalWorkHours: number;
  leaves: Record<LeaveField, DayHourValue>;
  warnings: AttendanceWarning[];
};

export type ImportTotals = {
  scheduledHours: number;
  overtimeHours: number;
  breakHours: number;
  totalWorkHours: number;
  paidLeaveDays: number;
  paidLeaveHours: number;
};

export type ParsedAttendanceFile = {
  targetMonth: string;
  sourceFileName: string;
  columnCount: number;
  rows: SanitizedAttendanceRow[];
  totals: ImportTotals;
};

export type Employee = {
  employeeCode: string;
  surname: string;
  department: string;
  employmentType: string;
  isJunior?: boolean;
  paidLeaveCycleStartMonth: 4 | 10;
  startMonth: string;
  endMonth: string | null;
};

export type PaidLeaveComplianceStatus = "achieved" | "in-progress" | "warning";

export type PaidLeaveComplianceItem = {
  employeeCode: string;
  surname: string;
  employmentType: string;
  paidLeaveCycleStartMonth: 4 | 10;
  periodStart: string;
  periodEnd: string;
  paidLeaveDays: number;
  remainingDays: number;
  daysUntilDeadline: number;
  registeredMonths: string[];
  missingMonths: string[];
  status: PaidLeaveComplianceStatus;
};

export type PaidLeaveComplianceData = {
  databaseConfigured: boolean;
  asOf: string;
  items: PaidLeaveComplianceItem[];
};

export type DashboardAttendance = SanitizedAttendanceRow & { targetMonth: string };

export type DashboardData = {
  databaseConfigured: boolean;
  employees: Employee[];
  attendance: DashboardAttendance[];
  registeredMonths: string[];
  excludedEmployeeMonths: string[];
};
