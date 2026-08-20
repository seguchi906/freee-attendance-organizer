import { boolean, doublePrecision, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  employeeCode: text("employee_code").notNull().unique(),
  surname: text("surname").notNull(),
  department: text("department").notNull(),
  employmentType: text("employment_type").notNull(),
  isJunior: boolean("is_junior").default(false).notNull(),
  paidLeaveCycleStartMonth: integer("paid_leave_cycle_start_month").default(10).notNull(),
  startMonth: text("start_month").notNull(),
  endMonth: text("end_month"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const monthlyImports = pgTable("monthly_imports", {
  id: serial("id").primaryKey(),
  targetMonth: text("target_month").notNull().unique(),
  employeeCount: integer("employee_count").notNull(),
  totals: jsonb("totals").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
});

export const monthlyAttendance = pgTable("monthly_attendance", {
  id: serial("id").primaryKey(),
  importId: integer("import_id").notNull().references(() => monthlyImports.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  targetMonth: text("target_month").notNull(),
  department: text("department").notNull(),
  employmentType: text("employment_type").notNull(),
  closingStatus: text("closing_status").notNull(),
  weekdayAttendanceDays: doublePrecision("weekday_attendance_days").notNull(),
  holidayAttendanceDays: doublePrecision("holiday_attendance_days").notNull(),
  lateCount: doublePrecision("late_count").notNull(),
  earlyLeaveCount: doublePrecision("early_leave_count").notNull(),
  scheduledHours: doublePrecision("scheduled_hours").notNull(),
  overtimeHours: doublePrecision("overtime_hours").notNull(),
  lateHours: doublePrecision("late_hours").notNull(),
  earlyLeaveHours: doublePrecision("early_leave_hours").notNull(),
  breakHours: doublePrecision("break_hours").notNull(),
  totalWorkHours: doublePrecision("total_work_hours").notNull(),
  leaves: jsonb("leaves").notNull(),
  warnings: jsonb("warnings").notNull(),
}, (table) => [uniqueIndex("attendance_employee_month_idx").on(table.employeeId, table.targetMonth)]);

export const employeeMonthExclusions = pgTable("employee_month_exclusions", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  targetMonth: text("target_month").notNull(),
  reason: text("reason").notNull(),
}, (table) => [uniqueIndex("employee_month_exclusion_idx").on(table.employeeId, table.targetMonth)]);
