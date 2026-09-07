ALTER TABLE "monthly_attendance" ADD COLUMN IF NOT EXISTS "weekday_overtime_hours" double precision;
--> statement-breakpoint
ALTER TABLE "monthly_attendance" ADD COLUMN IF NOT EXISTS "holiday_overtime_hours" double precision;
