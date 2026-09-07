import { z } from "zod";
import { LEAVE_FIELDS } from "@/lib/attendance-types";

const dayHourSchema = z.object({ days: z.number().nonnegative(), hours: z.number().nonnegative() }).strict();
const leavesShape = Object.fromEntries(LEAVE_FIELDS.map((field) => [field, dayHourSchema])) as Record<
  (typeof LEAVE_FIELDS)[number],
  typeof dayHourSchema
>;

export const attendanceRowSchema = z.object({
  employeeCode: z.string().regex(/^[A-Za-z0-9_-]+$/).max(40),
  surname: z.string().min(1).max(80),
  department: z.string().max(200),
  employmentType: z.string().max(100),
  closingStatus: z.string().max(20),
  weekdayAttendanceDays: z.number(),
  holidayAttendanceDays: z.number(),
  lateCount: z.number(),
  earlyLeaveCount: z.number(),
  scheduledHours: z.number(),
  overtimeHours: z.number(),
  weekdayOvertimeHours: z.number().optional(),
  holidayOvertimeHours: z.number().optional(),
  lateHours: z.number(),
  earlyLeaveHours: z.number(),
  breakHours: z.number(),
  totalWorkHours: z.number(),
  leaves: z.object(leavesShape).strict(),
  warnings: z.array(z.enum(["overtime", "holiday-work", "late-or-early", "unclosed"])),
}).strict();

export const totalsSchema = z.object({
  scheduledHours: z.number(),
  overtimeHours: z.number(),
  breakHours: z.number(),
  totalWorkHours: z.number(),
  paidLeaveDays: z.number(),
  paidLeaveHours: z.number(),
}).strict();

export const importPreviewSchema = z.object({
  targetMonth: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
  columnCount: z.literal(49),
  rows: z.array(attendanceRowSchema).min(1).max(1000),
  totals: totalsSchema,
}).strict();

export const importCommitSchema = importPreviewSchema.extend({
  replaceExisting: z.boolean().default(false),
  surnameUpdates: z.array(z.string()).default([]),
  missingActions: z.record(z.string(), z.enum(["retire", "exclude"])).default({}),
}).strict();

export const employeePatchSchema = z.object({
  surname: z.string().min(1).max(80).optional(),
  isJunior: z.boolean().optional(),
  paidLeaveCycleStartMonth: z.union([z.literal(4), z.literal(10)]).optional(),
  startMonth: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).optional(),
  endMonth: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).nullable().optional(),
}).strict();
