CREATE TABLE IF NOT EXISTS "employee_month_exclusions" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"target_month" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_code" text NOT NULL,
	"surname" text NOT NULL,
	"department" text NOT NULL,
	"employment_type" text NOT NULL,
	"start_month" text NOT NULL,
	"end_month" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_employee_code_unique" UNIQUE("employee_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "monthly_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"target_month" text NOT NULL,
	"department" text NOT NULL,
	"employment_type" text NOT NULL,
	"closing_status" text NOT NULL,
	"weekday_attendance_days" double precision NOT NULL,
	"holiday_attendance_days" double precision NOT NULL,
	"late_count" double precision NOT NULL,
	"early_leave_count" double precision NOT NULL,
	"scheduled_hours" double precision NOT NULL,
	"overtime_hours" double precision NOT NULL,
	"late_hours" double precision NOT NULL,
	"early_leave_hours" double precision NOT NULL,
	"break_hours" double precision NOT NULL,
	"total_work_hours" double precision NOT NULL,
	"leaves" jsonb NOT NULL,
	"warnings" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "monthly_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_month" text NOT NULL,
	"employee_count" integer NOT NULL,
	"totals" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_imports_target_month_unique" UNIQUE("target_month")
);
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_month_exclusions_employee_id_employees_id_fk') THEN ALTER TABLE "employee_month_exclusions" ADD CONSTRAINT "employee_month_exclusions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monthly_attendance_import_id_monthly_imports_id_fk') THEN ALTER TABLE "monthly_attendance" ADD CONSTRAINT "monthly_attendance_import_id_monthly_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."monthly_imports"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monthly_attendance_employee_id_employees_id_fk') THEN ALTER TABLE "monthly_attendance" ADD CONSTRAINT "monthly_attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employee_month_exclusion_idx" ON "employee_month_exclusions" USING btree ("employee_id","target_month");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_employee_month_idx" ON "monthly_attendance" USING btree ("employee_id","target_month");