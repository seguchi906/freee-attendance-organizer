ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "paid_leave_cycle_start_month" integer DEFAULT 10 NOT NULL;
