"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  FileSpreadsheet,
  Layers,
  Loader2,
  Search,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  DashboardAttendance,
  DashboardData,
  Employee,
  PaidLeaveComplianceData,
  PaidLeaveComplianceItem,
  ParsedAttendanceFile,
  SanitizedAttendanceRow,
} from "@/lib/attendance-types";
import { LEAVE_FIELDS } from "@/lib/attendance-types";
import { compareEmployees, isActive } from "@/lib/employee-diff";
import {
  getCurrentPeriod,
  getFiscalMonths,
  getPeriodFromTargetMonth,
  getPeriodRangeLabel,
  MIN_PERIOD,
  type FiscalMonth,
} from "@/lib/fiscal-year";
import { parseFreeeXls } from "@/lib/freee-xls-parser";
import { cn } from "@/lib/utils";

function getEnrollmentStatus(
  employee: Employee,
  month: string,
): "before-hire" | "retired" | "active" {
  if (employee.startMonth && month < employee.startMonth) return "before-hire";
  if (employee.endMonth && month > employee.endMonth) return "retired";
  return "active";
}

type EmployeeDiff = {
  newEmployees: SanitizedAttendanceRow[];
  surnameMismatches: {
    employeeCode: string;
    currentSurname: string;
    newSurname: string;
  }[];
  missingEmployees: Employee[];
};

export type BatchFileItem = {
  id: string;
  file: File;
  fileName: string;
  parsed: ParsedAttendanceFile | null;
  diff: EmployeeDiff | null;
  error: string | null;
  registered: boolean;
  missingActions: Record<string, "retire" | "exclude">;
  acceptedSurnames: string[];
  status: "parsed" | "saving" | "completed" | "error";
  statusMessage?: string;
};

const EMPTY_DASHBOARD: DashboardData = {
  databaseConfigured: false,
  employees: [],
  attendance: [],
  registeredMonths: [],
  excludedEmployeeMonths: [],
};
const warningLabels = {
  overtime: "残業45時間以上",
  "holiday-work": "休日出勤",
  "late-or-early": "遅刻・早退",
  unclosed: "未締め",
} as const;

function apiPayload(parsed: ParsedAttendanceFile) {
  return {
    targetMonth: parsed.targetMonth,
    columnCount: 49 as const,
    rows: parsed.rows,
    totals: parsed.totals,
  };
}

export function AttendanceDashboard() {
  const [period, setPeriod] = useState<number>(() =>
    Math.max(MIN_PERIOD, getCurrentPeriod()),
  );
  const [dashboard, setDashboard] = useState<DashboardData>(EMPTY_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [batchFiles, setBatchFiles] = useState<BatchFileItem[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [activeTab, setActiveTab] = useState("status");
  const [detail, setDetail] = useState<DashboardAttendance | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/dashboard?period=${period}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "登録状況を取得できませんでした。");
      setDashboard(data);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "登録状況を取得できませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void Promise.resolve().then(loadDashboard);
  }, [loadDashboard]);

  async function inspectFiles(files: File[]) {
    if (!files.length) return;
    setMessage("");
    setSaving(false);
    setBatchProgress(null);

    const items: BatchFileItem[] = [];

    for (const file of files) {
      const id = `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`;
      if (!file.name.toLowerCase().endsWith(".xls")) {
        items.push({
          id,
          file,
          fileName: file.name,
          parsed: null,
          diff: null,
          error: "拡張子が.xlsではありません。",
          registered: false,
          missingActions: {},
          acceptedSurnames: [],
          status: "error",
          statusMessage: "非対応ファイル（.xlsのみ）",
        });
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        items.push({
          id,
          file,
          fileName: file.name,
          parsed: null,
          diff: null,
          error: "ファイルサイズが10MBを超えています。",
          registered: false,
          missingActions: {},
          acceptedSurnames: [],
          status: "error",
          statusMessage: "サイズ超過（10MB以下）",
        });
        continue;
      }
      try {
        const text = await file.text();
        const result = parseFreeeXls(text, file.name);
        const registered = dashboard.registeredMonths.includes(
          result.targetMonth,
        );
        const diff = dashboard.databaseConfigured
          ? compareEmployees(
              dashboard.employees,
              result.rows,
              result.targetMonth,
            )
          : null;
        items.push({
          id,
          file,
          fileName: file.name,
          parsed: result,
          diff,
          error: null,
          registered,
          missingActions: {},
          acceptedSurnames: [],
          status: "parsed",
        });
      } catch (error) {
        items.push({
          id,
          file,
          fileName: file.name,
          parsed: null,
          diff: null,
          error: error instanceof Error ? error.message : "解析に失敗しました。",
          registered: false,
          missingActions: {},
          acceptedSurnames: [],
          status: "error",
          statusMessage: error instanceof Error ? error.message : "解析エラー",
        });
      }
    }

    // Sort items chronologically by targetMonth
    items.sort((a, b) => {
      if (!a.parsed) return 1;
      if (!b.parsed) return -1;
      return a.parsed.targetMonth.localeCompare(b.parsed.targetMonth);
    });

    setBatchFiles(items);
    setActiveFileId(items[0]?.id ?? null);

    const firstValid = items.find((item) => item.parsed)?.parsed;
    if (firstValid) {
      setPeriod(
        Math.max(MIN_PERIOD, getPeriodFromTargetMonth(firstValid.targetMonth)),
      );
    }
  }

  function updateItemMissingAction(
    fileId: string,
    employeeCode: string,
    action: "retire" | "exclude",
  ) {
    setBatchFiles((prev) =>
      prev.map((item) =>
        item.id === fileId
          ? {
              ...item,
              missingActions: {
                ...item.missingActions,
                [employeeCode]: action,
              },
            }
          : item,
      ),
    );
  }

  function updateItemAcceptedSurname(
    fileId: string,
    employeeCode: string,
    accept: boolean,
  ) {
    setBatchFiles((prev) =>
      prev.map((item) =>
        item.id === fileId
          ? {
              ...item,
              acceptedSurnames: accept
                ? [...item.acceptedSurnames, employeeCode]
                : item.acceptedSurnames.filter((code) => code !== employeeCode),
            }
          : item,
      ),
    );
  }

  function removeBatchFile(fileId: string) {
    setBatchFiles((prev) => {
      const next = prev.filter((item) => item.id !== fileId);
      if (activeFileId === fileId) {
        setActiveFileId(next[0]?.id ?? null);
      }
      return next;
    });
  }

  function clearBatchFiles() {
    setBatchFiles([]);
    setActiveFileId(null);
    setBatchProgress(null);
  }

  async function saveBatchImports() {
    const readyItems = batchFiles.filter(
      (item) =>
        item.parsed &&
        !item.error &&
        item.status !== "completed" &&
        item.diff &&
        item.diff.missingEmployees.every(
          (m) => item.missingActions[m.employeeCode],
        ) &&
        item.diff.surnameMismatches.every((s) =>
          item.acceptedSurnames.includes(s.employeeCode),
        ),
    );

    if (!readyItems.length) return;
    setSaving(true);
    setMessage("");

    let successCount = 0;
    let lastTargetMonth = "";
    const totalToSave = readyItems.length;

    for (let index = 0; index < readyItems.length; index++) {
      const item = readyItems[index];
      if (!item.parsed) continue;

      setBatchProgress({ current: index + 1, total: totalToSave });
      setBatchFiles((prev) =>
        prev.map((b) => (b.id === item.id ? { ...b, status: "saving" } : b)),
      );

      try {
        const response = await fetch("/api/imports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...apiPayload(item.parsed),
            replaceExisting: item.registered,
            surnameUpdates: item.acceptedSurnames,
            missingActions: item.missingActions,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          setBatchFiles((prev) =>
            prev.map((b) =>
              b.id === item.id
                ? { ...b, status: "error", error: data.error ?? "登録失敗" }
                : b,
            ),
          );
        } else {
          successCount++;
          lastTargetMonth = item.parsed.targetMonth;
          setBatchFiles((prev) =>
            prev.map((b) =>
              b.id === item.id ? { ...b, status: "completed" } : b,
            ),
          );
        }
      } catch (err) {
        setBatchFiles((prev) =>
          prev.map((b) =>
            b.id === item.id
              ? {
                  ...b,
                  status: "error",
                  error: err instanceof Error ? err.message : "登録失敗",
                }
              : b,
          ),
        );
      }
    }

    setSaving(false);
    setBatchProgress(null);

    if (successCount > 0) {
      if (lastTargetMonth) {
        setPeriod(getPeriodFromTargetMonth(lastTargetMonth));
      }
      setMessage(`${successCount}件の月別勤怠データを正常に登録しました。`);
      await loadDashboard();
    }
  }

  async function handleFilesSelectFromStatus(files: File[]) {
    setActiveTab("import");
    await inspectFiles(files);
  }

  const navItems = [
    { id: "overtime-summary", label: "残業サマリー", icon: TrendingUp },
    { id: "overtime", label: "残業集計", icon: Clock },
    { id: "leave-summary", label: "休暇サマリー", icon: BarChart3 },
    { id: "leave", label: "休暇集計", icon: CalendarCheck },
    { id: "status", label: "登録状況", icon: FileSpreadsheet },
    { id: "employees", label: "社員マスタ", icon: Users },
  ] as const;

  return (
    <div className="flex min-h-screen bg-muted/20 text-foreground">
      {/* Left Sidebar Pane */}
      <aside className="sticky top-0 z-30 flex h-screen w-20 shrink-0 flex-col items-center border-r bg-card py-4 select-none">
        {/* Navigation buttons */}
        <nav className="flex flex-1 flex-col items-center gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl text-[11px] transition-all cursor-pointer",
                  isActive
                    ? "bg-blue-50 font-bold text-blue-700 shadow-xs border border-blue-200/80 dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-800"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
                title={item.label}
              >
                <Icon className={cn("size-5", isActive ? "text-blue-600 dark:text-blue-400" : "")} />
                <span className="leading-tight">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 p-6 lg:p-8 overflow-y-auto">
        {!dashboard.databaseConfigured && (
          <Alert className="mb-6">
            <Database />
            <AlertTitle>Neonデータベースが未接続です</AlertTitle>
            <AlertDescription>
              .env.localへDATABASE_URLを設定し、npm run db:pushを実行してください。
            </AlertDescription>
          </Alert>
        )}
        {message && (
          <Alert
            className={cn(
              "mb-6",
              message.includes("登録しました")
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-950",
            )}
          >
            <AlertCircle />
            <AlertTitle>
              {message.includes("登録しました") ? "完了" : "お知らせ"}
            </AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        {activeTab === "status" && (
          <div className="space-y-6">
            <StatusTable
              period={period}
              setPeriod={setPeriod}
              dashboard={dashboard}
              loading={loading}
              onDetail={setDetail}
              onFilesSelect={inspectFiles}
            />
            {batchFiles.length > 0 && (
              <ImportPanel
                batchFiles={batchFiles}
                activeFileId={activeFileId}
                setActiveFileId={setActiveFileId}
                saving={saving}
                batchProgress={batchProgress}
                databaseConfigured={dashboard.databaseConfigured}
                onFiles={inspectFiles}
                onSaveBatch={saveBatchImports}
                onClearBatch={clearBatchFiles}
                onRemoveFile={removeBatchFile}
                onUpdateMissingAction={updateItemMissingAction}
                onUpdateAcceptedSurname={updateItemAcceptedSurname}
              />
            )}
          </div>
        )}

        {activeTab === "leave-summary" && (
          <AllPeriodsVacationSummary />
        )}

        {activeTab === "leave" && (
          <VacationTable
            period={period}
            setPeriod={setPeriod}
            dashboard={dashboard}
            loading={loading}
          />
        )}

        {activeTab === "overtime-summary" && (
          <AllPeriodsOvertimeSummary />
        )}

        {activeTab === "overtime" && (
          <OvertimeTable
            period={period}
            setPeriod={setPeriod}
            dashboard={dashboard}
            loading={loading}
            onDetail={setDetail}
          />
        )}

        {activeTab === "employees" && (
          <EmployeeMaster
            employees={dashboard.employees}
            onEdit={setEditing}
          />
        )}
      </main>
      <DetailDialog detail={detail} onClose={() => setDetail(null)} />
      <EmployeeDialog
        key={editing?.employeeCode ?? "none"}
        employee={editing}
        onClose={() => setEditing(null)}
        onSaved={loadDashboard}
      />
    </div>
  );
}

const vacationFields = [
  "有休 日数",
  "特別休暇 日数",
  "代休 日数",
  "夏季休暇 日数",
] as const;

function sumLeaveDays(row: DashboardAttendance) {
  return vacationFields.reduce((sum, field) => sum + row.leaves[field].days, 0);
}

function sumLeaveHours(row: DashboardAttendance) {
  return vacationFields.reduce((sum, field) => sum + row.leaves[field].hours, 0);
}

function getWeekdayOvertimeHours(row?: DashboardAttendance | null): number {
  if (!row) return 0;
  if (typeof row.weekdayOvertimeHours === "number" && row.weekdayOvertimeHours > 0) {
    return row.weekdayOvertimeHours;
  }
  const holidayOt = getHolidayOvertimeHours(row);
  return Math.max(0, row.overtimeHours - holidayOt);
}

function getHolidayOvertimeHours(row?: DashboardAttendance | null): number {
  if (!row) return 0;
  if (typeof row.holidayOvertimeHours === "number" && row.holidayOvertimeHours > 0) {
    return row.holidayOvertimeHours;
  }
  if (row.holidayAttendanceDays > 0 && row.overtimeHours > 0) {
    return Math.min(row.overtimeHours, row.holidayAttendanceDays * 8);
  }
  return 0;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 1,
  }).format(value);
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium shadow-xs transition hover:bg-muted/50">
      <div className="relative inline-flex items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="h-5 w-9 rounded-full bg-slate-200 peer-checked:bg-blue-600 transition-colors dark:bg-slate-700 dark:peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4 shadow-inner" />
      </div>
      <span className="text-foreground">{label}</span>
    </label>
  );
}

type VacationSummaryEmployee = {
  employeeCode: string;
  surname: string;
  leave: number;
  paid: number;
  summer: number;
};

type PeriodVacationSummary = {
  period: number;
  rangeLabel: string;
  registeredMonths: string[];
  isComplete: boolean;
  employeeCount: number;
  averageLeaveDays: number;
  averageSummerLeaveDays: number;
  lowSummerLeaveEmployees: VacationSummaryEmployee[];
  lowPaidLeaveEmployees: VacationSummaryEmployee[];
};

function AllPeriodsVacationSummary() {
  const [summaries, setSummaries] = useState<PeriodVacationSummary[]>([]);
  const [compliance, setCompliance] = useState<PaidLeaveComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [complianceLoading, setComplianceLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/vacation-summaries", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "休暇サマリーを取得できませんでした。");
        if (active)
          setSummaries(
            (body.summaries ?? [])
              .filter((summary: PeriodVacationSummary) =>
                [46, 47, 48].includes(summary.period),
              )
              .sort(
                (a: PeriodVacationSummary, b: PeriodVacationSummary) =>
                  a.period - b.period,
              ),
          );
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "休暇サマリーを取得できませんでした。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/paid-leave-compliance", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "有休5日管理データを取得できませんでした。");
        if (active) setCompliance(body);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "有休5日管理データを取得できませんでした。",
          );
      })
      .finally(() => {
        if (active) setComplianceLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-gradient-to-br from-blue-50 via-background to-cyan-50 p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-600 p-2 text-white"><BarChart3 className="size-5" /></div>
          <div>
            <h2 className="text-lg font-semibold">事業期別 休暇サマリー</h2>
            <p className="text-sm text-muted-foreground">第46期〜第48期を一覧で比較します（アルバイトを除く）。</p>
          </div>
        </div>
      </div>
      {error && <Alert className="border-red-200 bg-red-50 text-red-900"><AlertCircle /><AlertTitle>取得エラー</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {loading ? (
        <Card><CardContent className="flex h-40 items-center justify-center text-muted-foreground">読み込み中…</CardContent></Card>
      ) : summaries.length === 0 ? (
        <Card><CardContent className="flex h-40 items-center justify-center text-muted-foreground">登録済みの事業期がありません。</CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="min-w-44">事業期</TableHead>
                    <TableHead className="min-w-32 text-right">平均休暇日数</TableHead>
                    <TableHead className="min-w-40 text-right">平均夏季休暇日数</TableHead>
                    <TableHead className="min-w-72">夏季休暇 5日未満</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaries.map((summary) => (
                    <TableRow key={summary.period} className="align-top">
                      <TableCell>
                        <div className="font-semibold">第{summary.period}期</div>
                        <div className="mt-1 text-xs text-muted-foreground">{summary.rangeLabel}</div>
                        <Badge variant="outline" className={cn("mt-2", summary.isComplete ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700")}>
                          {summary.isComplete ? "12か月完了" : `暫定 ${summary.registeredMonths.length}/12か月`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-lg font-semibold tabular-nums text-blue-700">{formatCount(summary.averageLeaveDays)}日</TableCell>
                      <TableCell className="text-right text-lg font-semibold tabular-nums text-amber-700">{formatCount(summary.averageSummerLeaveDays)}日</TableCell>
                      <TableCell><LowEmployeeList employees={summary.lowSummerLeaveEmployees} valueKey="summer" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="pt-3">
        <h3 className="text-base font-semibold">本来の取得期間による有休5日管理</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          事業期とは分け、社員ごとの4月・10月起算期間で判定します
          {compliance?.asOf ? `（${compliance.asOf}現在）` : ""}。
        </p>
      </div>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>社員</TableHead>
                  <TableHead>起算</TableHead>
                  <TableHead>対象期間</TableHead>
                  <TableHead className="min-w-52">取得進捗</TableHead>
                  <TableHead>残り</TableHead>
                  <TableHead>期限</TableHead>
                  <TableHead>状態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {complianceLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">読み込み中…</TableCell>
                  </TableRow>
                ) : (compliance?.items.length ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">対象となる正社員がいません。</TableCell>
                  </TableRow>
                ) : (
                  [...(compliance?.items ?? [])]
                    .sort(
                      (a, b) =>
                        a.paidLeaveDays - b.paidLeaveDays ||
                        a.employeeCode.localeCompare(b.employeeCode),
                    )
                    .map((item) => <ComplianceRow key={item.employeeCode} item={item} />)
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LowEmployeeList({
  employees,
  valueKey,
}: {
  employees: VacationSummaryEmployee[];
  valueKey: "paid" | "summer";
}) {
  return (
    <div>
      <div className="mb-2 font-semibold">{employees.length}名</div>
      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
        {employees.length ? employees.map((employee) => (
          <Badge key={employee.employeeCode} variant="outline" className="font-normal">
            {employee.employeeCode} {employee.surname} {formatCount(employee[valueKey])}日
          </Badge>
        )) : <span className="text-xs text-emerald-700">該当者なし</span>}
      </div>
    </div>
  );
}

function VacationSummary({
  period,
  setPeriod,
  dashboard,
  loading,
}: {
  period: number;
  setPeriod: (period: number) => void;
  dashboard: DashboardData;
  loading: boolean;
}) {
  const months = useMemo(() => getFiscalMonths(period), [period]);
  const [onlyJunior, setOnlyJunior] = useState(false);
  const [showPartTime, setShowPartTime] = useState(false);
  const exclusions = new Set(dashboard.excludedEmployeeMonths);
  const filteredEmployees = dashboard.employees.filter((employee) => {
    const isPartTime = employee.employmentType?.includes("アルバイト");
    if (!showPartTime && isPartTime) return false;
    if (onlyJunior && (isPartTime || !employee.isJunior)) return false;
    return true;
  });
  const employeeCodes = new Set(
    filteredEmployees.map((employee) => employee.employeeCode),
  );
  const includedAttendance = dashboard.attendance.filter(
    (row) =>
      employeeCodes.has(row.employeeCode) &&
      !exclusions.has(`${row.employeeCode}:${row.targetMonth}`),
  );
  const attendanceByEmployeeMonth = new Map(
    includedAttendance.map((row) => [
      `${row.employeeCode}:${row.targetMonth}`,
      row,
    ]),
  );
  const totalLeaveDays = includedAttendance.reduce(
    (sum, row) => sum + sumLeaveDays(row),
    0,
  );
  const totalLeaveHours = includedAttendance.reduce(
    (sum, row) => sum + sumLeaveHours(row),
    0,
  );
  const summerLeaveDays = includedAttendance.reduce(
    (sum, row) => sum + (row.leaves["夏季休暇 日数"]?.days ?? 0),
    0,
  );
  const totalWeekdayWorkDays = includedAttendance.reduce(
    (sum, row) => sum + row.weekdayAttendanceDays,
    0,
  );
  const totalHolidayWorkDays = includedAttendance.reduce(
    (sum, row) => sum + row.holidayAttendanceDays,
    0,
  );
  const totalWorkDays = totalWeekdayWorkDays + totalHolidayWorkDays;
  const employeesWithData = new Set(
    includedAttendance.map((row) => row.employeeCode),
  ).size;
  const averagePerEmployee = employeesWithData
    ? totalLeaveDays / employeesWithData
    : 0;
  const averageSummerPerEmployee = employeesWithData
    ? summerLeaveDays / employeesWithData
    : 0;
  const employeePeriodTotals = filteredEmployees
    .map((employee) => {
      const rows = includedAttendance.filter(
        (row) => row.employeeCode === employee.employeeCode,
      );
      return {
        employee,
        hasData: rows.length > 0,
        paidLeaveDays: rows.reduce(
          (sum, row) => sum + (row.leaves["有休 日数"]?.days ?? 0),
          0,
        ),
        summerLeaveDays: rows.reduce(
          (sum, row) => sum + (row.leaves["夏季休暇 日数"]?.days ?? 0),
          0,
        ),
      };
    })
    .filter((item) => item.hasData);
  const lowSummerLeaveEmployees = employeePeriodTotals.filter(
    (item) => item.summerLeaveDays < 5,
  );
  const lowPaidLeaveEmployees = employeePeriodTotals.filter(
    (item) => item.paidLeaveDays < 5,
  );
  const monthlyAverages = months.map((m) => {
    const rows = includedAttendance.filter(
      (row) => row.targetMonth === m.targetMonth,
    );
    return rows.length
      ? rows.reduce((sum, row) => sum + sumLeaveDays(row), 0) / rows.length
      : null;
  });
  const monthlySummerAverages = months.map((m) => {
    const rows = includedAttendance.filter(
      (row) => row.targetMonth === m.targetMonth,
    );
    return rows.length
      ? rows.reduce(
          (sum, row) => sum + (row.leaves["夏季休暇 日数"]?.days ?? 0),
          0,
        ) / rows.length
      : null;
  });
  const maxMonthlyAverage = Math.max(
    1,
    ...monthlyAverages.map((value) => value ?? 0),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 rounded-2xl border bg-gradient-to-br from-blue-50 via-background to-cyan-50 p-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-blue-600 p-2 text-white">
              <CalendarCheck className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">第{period}期 休暇サマリー</h2>
              <p className="text-sm text-muted-foreground">
                {getPeriodRangeLabel(period)}（有休・特別休暇・代休・夏季休暇を月別に集計）
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleSwitch
            checked={onlyJunior}
            onChange={setOnlyJunior}
            label="若手社員のみ表示"
          />
          <ToggleSwitch
            checked={showPartTime}
            onChange={setShowPartTime}
            label="アルバイトを表示"
          />
          <PeriodSelector period={period} setPeriod={setPeriod} />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <VacationMetric
          label="平均休暇日数"
          value={`${formatCount(averagePerEmployee)}日`}
          note={`${employeesWithData}名の休暇合計から算出`}
          accent="bg-blue-500"
        />
        <VacationMetric
          label="平均夏季休暇日数"
          value={`${formatCount(averageSummerPerEmployee)}日`}
          note={`夏季休暇合計 ${formatCount(summerLeaveDays)}日`}
          accent="bg-amber-500"
        />
        <VacationThresholdMetric
          label="夏季休暇 5日未満"
          employees={lowSummerLeaveEmployees.map((item) => item.employee)}
          accent="bg-orange-500"
        />
        <VacationThresholdMetric
          label="有休 5日未満"
          employees={lowPaidLeaveEmployees.map((item) => item.employee)}
          accent="bg-red-500"
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">月別の平均休暇日数</CardTitle>
          <CardDescription>
            各月に登録された社員1人あたりの平均です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid min-h-44 grid-cols-12 items-end gap-2">
            {monthlyAverages.map((value, index) => (
              <div
                key={months[index].targetMonth}
                className="flex h-full min-w-0 flex-col justify-end gap-2 text-center"
              >
                <span className="text-xs font-medium tabular-nums">
                  {value === null ? "―" : formatCount(value)}
                </span>
                <div className="flex h-28 items-end rounded-lg bg-muted/50 p-1">
                  <div
                    className="w-full rounded-md bg-gradient-to-t from-blue-600 to-cyan-400 transition-all"
                    style={{
                      height: `${value === null ? 0 : Math.max(6, (value / maxMonthlyAverage) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {months[index].label}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function VacationTable({
  period,
  setPeriod,
  dashboard,
  loading,
}: {
  period: number;
  setPeriod: (period: number) => void;
  dashboard: DashboardData;
  loading: boolean;
}) {
  const months = useMemo(() => getFiscalMonths(period), [period]);
  const [onlyJunior, setOnlyJunior] = useState(false);
  const [showPartTime, setShowPartTime] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const exclusions = new Set(dashboard.excludedEmployeeMonths);
  const filteredEmployees = dashboard.employees.filter((employee) => {
    const isPartTime = employee.employmentType?.includes("アルバイト");
    if (!showPartTime && isPartTime) return false;
    if (onlyJunior && (isPartTime || !employee.isJunior)) return false;
    return true;
  });
  const employeeCodes = new Set(
    filteredEmployees.map((employee) => employee.employeeCode),
  );
  const includedAttendance = dashboard.attendance.filter(
    (row) =>
      employeeCodes.has(row.employeeCode) &&
      !exclusions.has(`${row.employeeCode}:${row.targetMonth}`),
  );
  const attendanceByEmployeeMonth = new Map(
    includedAttendance.map((row) => [
      `${row.employeeCode}:${row.targetMonth}`,
      row,
    ]),
  );
  const totalLeaveDays = includedAttendance.reduce(
    (sum, row) => sum + sumLeaveDays(row),
    0,
  );
  const totalLeaveHours = includedAttendance.reduce(
    (sum, row) => sum + sumLeaveHours(row),
    0,
  );
  const summerLeaveDays = includedAttendance.reduce(
    (sum, row) => sum + (row.leaves["夏季休暇 日数"]?.days ?? 0),
    0,
  );
  const totalWorkDays = includedAttendance.reduce(
    (sum, row) =>
      sum + row.weekdayAttendanceDays + row.holidayAttendanceDays,
    0,
  );
  const employeesWithData = new Set(
    includedAttendance.map((row) => row.employeeCode),
  ).size;
  const averagePerEmployee = employeesWithData
    ? totalLeaveDays / employeesWithData
    : 0;
  const averageSummerPerEmployee = employeesWithData
    ? summerLeaveDays / employeesWithData
    : 0;
  const monthlyAverages = months.map((m) => {
    const rows = includedAttendance.filter(
      (row) => row.targetMonth === m.targetMonth,
    );
    return rows.length
      ? rows.reduce((sum, row) => sum + sumLeaveDays(row), 0) / rows.length
      : null;
  });
  const monthlySummerAverages = months.map((m) => {
    const rows = includedAttendance.filter(
      (row) => row.targetMonth === m.targetMonth,
    );
    return rows.length
      ? rows.reduce(
          (sum, row) => sum + (row.leaves["夏季休暇 日数"]?.days ?? 0),
          0,
        ) / rows.length
      : null;
  });

  const sortedEmployees = (() => {
    const list = [...filteredEmployees];
    return list.sort((a, b) => {
      const aRows = months.map((m) =>
        attendanceByEmployeeMonth.get(`${a.employeeCode}:${m.targetMonth}`),
      );
      const bRows = months.map((m) =>
        attendanceByEmployeeMonth.get(`${b.employeeCode}:${m.targetMonth}`),
      );
      const aTotal = aRows.reduce((sum, r) => sum + (r ? sumLeaveDays(r) : 0), 0);
      const bTotal = bRows.reduce((sum, r) => sum + (r ? sumLeaveDays(r) : 0), 0);
      if (aTotal !== bTotal) {
        return bTotal - aTotal;
      }
      return a.employeeCode.localeCompare(b.employeeCode);
    });
  })();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <PeriodSelector period={period} setPeriod={setPeriod} />
            <div className="flex flex-wrap items-center gap-3">
              <ToggleSwitch
                checked={onlyJunior}
                onChange={setOnlyJunior}
                label="若手社員のみ表示"
              />
              <ToggleSwitch
                checked={showPartTime}
                onChange={setShowPartTime}
                label="アルバイトを表示"
              />
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full bg-blue-600" />
                  左: 有休
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full bg-amber-600" />
                  右: 夏季休暇 (7〜10月)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                  灰: 在籍外（入社前・退職済）
                </span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="sticky left-0 z-20 min-w-28 bg-muted/90 font-semibold">
                    雇用区分
                  </TableHead>
                  <TableHead className="sticky left-28 z-20 min-w-36 bg-muted/90 font-semibold border-r">
                    名前
                  </TableHead>
                  {months.map((m) => {
                    const isSummer = m.month >= 7 && m.month <= 10;
                    return (
                      <TableHead
                        key={m.targetMonth}
                        className={cn(
                          "px-1 py-2 text-center",
                          isSummer ? "min-w-20" : "min-w-16",
                        )}
                      >
                        <div className="font-semibold">{m.label}</div>
                        {isSummer ? (
                          <div className="mt-1 grid grid-cols-2 border-t border-border/60 pt-0.5 text-[10px] font-normal text-muted-foreground">
                            <span className="text-blue-700 dark:text-blue-400">
                              有休
                            </span>
                            <span className="text-amber-700 dark:text-amber-400">
                              夏季
                            </span>
                          </div>
                        ) : (
                          <div className="mt-1 border-t border-transparent pt-0.5 text-[10px] font-normal text-transparent select-none">
                            ―
                          </div>
                        )}
                      </TableHead>
                    );
                  })}
                  <TableHead className="min-w-24 px-1 py-2 text-center border-l bg-blue-50/50 dark:bg-blue-950/30">
                    <div className="font-semibold text-blue-800 dark:text-blue-300">
                      合計
                    </div>
                    <div className="mt-1 grid grid-cols-2 border-t border-blue-200 dark:border-blue-800 pt-0.5 text-[10px] font-normal text-muted-foreground">
                      <span className="text-blue-700 dark:text-blue-400">
                        有休
                      </span>
                      <span className="text-amber-700 dark:text-amber-400">
                        夏季
                      </span>
                    </div>
                  </TableHead>
                  <TableHead className="min-w-24 px-1 py-2 text-center border-l">
                    <div className="font-semibold">勤務日数</div>
                    <div className="mt-1 grid grid-cols-2 border-t border-border/60 pt-0.5 text-[10px] font-normal text-muted-foreground">
                      <span>平日</span>
                      <span>休日</span>
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={16} className="h-32 text-center">
                      読み込み中…
                    </TableCell>
                  </TableRow>
                ) : sortedEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={16}
                      className="h-32 text-center text-muted-foreground"
                    >
                      集計対象の社員データがありません。
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedEmployees.map((employee) => {
                    const rows = months.map((m) =>
                      attendanceByEmployeeMonth.get(
                        `${employee.employeeCode}:${m.targetMonth}`,
                      ),
                    );
                    const annualLeave = rows.reduce(
                      (sum, row) => sum + (row ? sumLeaveDays(row) : 0),
                      0,
                    );
                    const annualPaidLeave = rows.reduce(
                      (sum, row) =>
                        sum + (row ? (row.leaves["有休 日数"]?.days ?? 0) : 0),
                      0,
                    );
                    const annualSummerLeave = rows.reduce(
                      (sum, row) =>
                        sum +
                        (row ? (row.leaves["夏季休暇 日数"]?.days ?? 0) : 0),
                      0,
                    );
                    const otherLeaves = LEAVE_FIELDS.filter(
                      (f) => f !== "有休 日数" && f !== "夏季休暇 日数",
                    )
                      .map((f) => ({
                        name: f.replace(" 日数", ""),
                        days: rows.reduce(
                          (sum, row) =>
                            sum + (row ? (row.leaves[f]?.days ?? 0) : 0),
                          0,
                        ),
                      }))
                      .filter((item) => item.days > 0);

                    const otherLeavesStr = otherLeaves
                      .map((i) => `${i.name} ${formatCount(i.days)}日`)
                      .join("・");

                    const rowTooltip = `クリックで ${employee.surname} の休暇内訳詳細を表示`;
                    const totalCellTooltip = `全休暇合計: ${formatCount(annualLeave)}日 [有休: ${formatCount(annualPaidLeave)}日, 夏季: ${formatCount(annualSummerLeave)}日${otherLeavesStr ? `, ${otherLeavesStr}` : ""}] (クリックで詳細表示)`;

                    const annualWeekdayWork = rows.reduce(
                      (sum, row) =>
                        sum + (row ? row.weekdayAttendanceDays : 0),
                      0,
                    );
                    const annualHolidayWork = rows.reduce(
                      (sum, row) =>
                        sum + (row ? row.holidayAttendanceDays : 0),
                      0,
                    );
                    const annualWork = annualWeekdayWork + annualHolidayWork;
                    return (
                      <TableRow
                        key={employee.employeeCode}
                        className="hover:bg-blue-50/40 dark:hover:bg-blue-950/20 cursor-pointer transition-colors group"
                        onClick={() => setSelectedEmployee(employee)}
                        title={rowTooltip}
                      >
                        <TableCell className="sticky left-0 z-10 bg-background group-hover:bg-blue-50/60 dark:group-hover:bg-slate-900 text-xs text-muted-foreground font-medium">
                          {employee.employmentType}
                        </TableCell>
                        <TableCell className="sticky left-28 z-10 bg-background group-hover:bg-blue-50/60 dark:group-hover:bg-slate-900 font-medium border-r">
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate group-hover:text-blue-600 transition-colors">
                                {employee.employeeCode} {employee.surname}
                              </span>
                              {!employee.employmentType?.includes("アルバイト") &&
                                employee.isJunior && (
                                  <Badge
                                    variant="outline"
                                    className="px-1.5 py-0 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 shrink-0"
                                  >
                                    若手
                                  </Badge>
                                )}
                            </div>
                            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-normal underline decoration-dotted shrink-0 opacity-70 group-hover:opacity-100">
                              内訳
                            </span>
                          </div>
                        </TableCell>
                        {months.map((m) => {
                          const isSummer = m.month >= 7 && m.month <= 10;
                          const row = attendanceByEmployeeMonth.get(
                            `${employee.employeeCode}:${m.targetMonth}`,
                          );
                          const status = getEnrollmentStatus(
                            employee,
                            m.targetMonth,
                          );
                          const isExcluded = exclusions.has(
                            `${employee.employeeCode}:${m.targetMonth}`,
                          );

                          if (status === "before-hire") {
                            return (
                              <TableCell
                                key={m.targetMonth}
                                className="bg-slate-100/70 dark:bg-slate-900/50 p-1 text-center align-middle"
                                title={`${employee.startMonth}入社前`}
                              >
                                <div className="flex flex-col items-center justify-center rounded py-1 select-none">
                                  <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                                    入社前
                                  </span>
                                  <div className="mt-0.5 border-t border-transparent pt-0.5 text-[10px] text-transparent">
                                    ―
                                  </div>
                                </div>
                              </TableCell>
                            );
                          }

                          if (status === "retired") {
                            return (
                              <TableCell
                                key={m.targetMonth}
                                className="bg-slate-100/70 dark:bg-slate-900/50 p-1 text-center align-middle"
                                title={`${employee.endMonth}退職後`}
                              >
                                <div className="flex flex-col items-center justify-center rounded py-1 select-none">
                                  <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                                    退職済
                                  </span>
                                  <div className="mt-0.5 border-t border-transparent pt-0.5 text-[10px] text-transparent">
                                    ―
                                  </div>
                                </div>
                              </TableCell>
                            );
                          }

                          if (isExcluded) {
                            return (
                              <TableCell
                                key={m.targetMonth}
                                className="bg-muted/30 p-1 text-center align-middle text-muted-foreground"
                                title="一時対象外"
                              >
                                <div className="flex flex-col items-center justify-center rounded py-1 select-none">
                                  <span className="text-[10px] font-medium text-muted-foreground">
                                    対象外
                                  </span>
                                  <div className="mt-0.5 border-t border-transparent pt-0.5 text-[10px] text-transparent">
                                    ―
                                  </div>
                                </div>
                              </TableCell>
                            );
                          }

                          if (!row) {
                            return (
                              <TableCell
                                key={m.targetMonth}
                                className="p-1 text-center align-middle text-muted-foreground"
                                title="データ未取込"
                              >
                                <div className="flex flex-col items-center justify-center rounded py-1">
                                  <span className="text-xs font-normal">―</span>
                                  <div className="mt-0.5 border-t border-transparent pt-0.5 text-[11px] text-transparent select-none">
                                    ―
                                  </div>
                                </div>
                              </TableCell>
                            );
                          }
                          const leaveTotal = sumLeaveDays(row);
                          const paidLeave = row.leaves["有休 日数"]?.days ?? 0;
                          const summerLeave =
                            row.leaves["夏季休暇 日数"]?.days ?? 0;
                          return (
                            <TableCell
                              key={m.targetMonth}
                              className="p-1 text-center align-middle"
                            >
                              <div className="flex flex-col items-center justify-center rounded bg-muted/20 py-1 transition-colors hover:bg-muted/50">
                                <span className="text-sm font-semibold tabular-nums text-foreground">
                                  {formatCount(leaveTotal)}
                                </span>
                                {isSummer ? (
                                  <div className="mt-0.5 grid w-full grid-cols-2 border-t border-dashed border-border/70 pt-0.5 text-[11px] tabular-nums">
                                    <span
                                      className="border-r border-dashed border-border/60 font-medium text-blue-700 dark:text-blue-400"
                                      title="有休日数"
                                    >
                                      {formatCount(paidLeave)}
                                    </span>
                                    <span
                                      className="font-medium text-amber-700 dark:text-amber-400"
                                      title="夏季休暇日数"
                                    >
                                      {formatCount(summerLeave)}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="mt-0.5 border-t border-transparent pt-0.5 text-[11px] text-transparent select-none">
                                    ―
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          );
                        })}
                        <TableCell
                          className="p-1 text-center align-middle border-l bg-blue-50/20 dark:bg-blue-950/10"
                          title={totalCellTooltip}
                        >
                          <div className="flex flex-col items-center justify-center rounded py-1">
                            <span className="text-sm font-bold tabular-nums text-blue-700 dark:text-blue-400">
                              {formatCount(annualLeave)}日
                            </span>
                            <div className="mt-0.5 grid w-full grid-cols-2 border-t border-dashed border-blue-200 dark:border-blue-900 pt-0.5 text-[11px] tabular-nums">
                              <span
                                className="border-r border-dashed border-blue-200 dark:border-blue-900 font-medium text-blue-700 dark:text-blue-400"
                                title="年間有休合計"
                              >
                                {formatCount(annualPaidLeave)}
                              </span>
                              <span
                                className="font-medium text-amber-700 dark:text-amber-400"
                                title="年間夏季休暇合計"
                              >
                                {formatCount(annualSummerLeave)}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="p-1 text-center align-middle border-l">
                          <div className="flex flex-col items-center justify-center rounded py-1">
                            <span className="text-sm font-semibold tabular-nums text-foreground">
                              {formatCount(annualWork)}日
                            </span>
                            <div className="mt-0.5 grid w-full grid-cols-2 border-t border-dashed border-border/70 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
                              <span
                                className="border-r border-dashed border-border/60 font-medium text-foreground"
                                title="平日出勤日数"
                              >
                                {formatCount(annualWeekdayWork)}
                              </span>
                              <span
                                className={cn(
                                  "font-medium",
                                  annualHolidayWork > 0
                                    ? "text-orange-600 dark:text-orange-400"
                                    : "text-muted-foreground",
                                )}
                                title="休日出勤日数"
                              >
                                {formatCount(annualHolidayWork)}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
              <TableFooter className="border-t-2 border-sky-200 bg-sky-50/80 dark:bg-sky-950/40 text-foreground">
                <TableRow className="hover:bg-sky-100/50 dark:hover:bg-sky-900/30">
                  <TableCell
                    colSpan={2}
                    className="sticky left-0 z-10 bg-sky-50/95 dark:bg-sky-950/95 font-semibold text-sky-950 dark:text-sky-100 border-r"
                  >
                    平均休暇 社員
                  </TableCell>
                  {months.map((m, index) => {
                    const value = monthlyAverages[index];
                    return (
                      <TableCell
                        key={m.targetMonth}
                        className="text-center tabular-nums font-semibold text-xs text-sky-950 dark:text-sky-100"
                      >
                        {value === null ? "―" : formatCount(value)}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center tabular-nums font-bold text-xs text-sky-950 dark:text-sky-100 border-l">
                    {formatCount(averagePerEmployee)}日
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground pr-3">
                    ―
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-sky-100/50 dark:hover:bg-sky-900/30">
                  <TableCell
                    colSpan={2}
                    className="sticky left-0 z-10 bg-sky-50/95 dark:bg-sky-950/95 font-semibold text-amber-950 dark:text-amber-100 border-r"
                  >
                    平均夏季休暇 社員
                  </TableCell>
                  {months.map((m, index) => {
                    const isSummer = m.month >= 7 && m.month <= 10;
                    const value = monthlySummerAverages[index];
                    return (
                      <TableCell
                        key={m.targetMonth}
                        className="text-center tabular-nums font-semibold text-xs text-amber-900 dark:text-amber-300"
                      >
                        {!isSummer ? "―" : value === null ? "―" : formatCount(value)}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center tabular-nums font-bold text-xs text-amber-900 dark:text-amber-300 border-l">
                    {formatCount(averageSummerPerEmployee)}日
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground pr-3">
                    ―
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
      <VacationDetailDialog
        data={
          selectedEmployee
            ? {
                employee: selectedEmployee,
                rows: months.map((m) => ({
                  month: m,
                  attendance: attendanceByEmployeeMonth.get(
                    `${selectedEmployee.employeeCode}:${m.targetMonth}`,
                  ),
                })),
              }
            : null
        }
        period={period}
        onClose={() => setSelectedEmployee(null)}
      />
    </div>
  );
}

type OvertimeLimitOccurrence = {
  employeeCode: string;
  surname: string;
  targetMonth: string;
  monthLabel: string;
  overtimeHours: number;
};

type PeriodOvertimeSummary = {
  period: number;
  rangeLabel: string;
  registeredMonths: string[];
  isComplete: boolean;
  quarters: {
    quarter: number;
    label: string;
    monthLabel: string;
    averageOverall: number | null;
    averageOther: number | null;
    averageJunior: number | null;
    overLimitEmployeeCount: number;
    overLimitOccurrences: OvertimeLimitOccurrence[];
  }[];
};

const overtimeSummaryMetrics = [
  { key: "averageOverall", label: "平均残業時間（全体）" },
  { key: "averageOther", label: "平均残業時間（その他）" },
  { key: "averageJunior", label: "平均残業時間（若手）" },
  { key: "overLimit", label: "45h超過者" },
] as const;

function AllPeriodsOvertimeSummary() {
  const [summaries, setSummaries] = useState<PeriodOvertimeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/overtime-summaries", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "残業サマリーを取得できませんでした。");
        if (active)
          setSummaries(
            (body.summaries ?? []).sort(
              (a: PeriodOvertimeSummary, b: PeriodOvertimeSummary) =>
                a.period - b.period,
            ),
          );
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "残業サマリーを取得できませんでした。",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-gradient-to-br from-amber-50 via-background to-orange-50 p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-600 p-2 text-white">
            <Clock className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">事業期別 残業サマリー</h2>
            <p className="text-sm text-muted-foreground">
              四半期ごとの社員1人・1か月あたり平均残業時間を、第46期〜第48期で比較します（アルバイトを除く）。
            </p>
          </div>
        </div>
      </div>

      {error && (
        <Alert className="border-red-200 bg-red-50 text-red-900">
          <AlertCircle />
          <AlertTitle>取得エラー</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Card>
          <CardContent className="flex h-40 items-center justify-center text-muted-foreground">
            読み込み中…
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="min-w-32">四半期</TableHead>
                    <TableHead className="min-w-52">集計項目</TableHead>
                    {summaries.map((summary) => (
                      <TableHead key={summary.period} className="min-w-72 align-top">
                        <div className="font-semibold text-foreground">第{summary.period}期</div>
                        <div className="mt-1 text-xs font-normal text-muted-foreground">
                          {summary.rangeLabel}
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "mt-2",
                            summary.isComplete
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-amber-300 bg-amber-50 text-amber-700",
                          )}
                        >
                          {summary.isComplete
                            ? "12か月完了"
                            : `暫定 ${summary.registeredMonths.length}/12か月`}
                        </Badge>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[1, 2, 3, 4].flatMap((quarterNumber) =>
                    overtimeSummaryMetrics.map((metric, metricIndex) => (
                      <TableRow
                        key={`${quarterNumber}-${metric.key}`}
                        className={cn(
                          "align-top",
                          metricIndex === 0 && quarterNumber > 1 && "border-t-2",
                        )}
                      >
                        {metricIndex === 0 && (
                          <TableCell rowSpan={overtimeSummaryMetrics.length} className="bg-muted/20 align-top">
                            <div className="font-semibold">第{quarterNumber}四半期</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {summaries[0]?.quarters.find((item) => item.quarter === quarterNumber)
                                ?.monthLabel ?? ""}
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="font-medium">{metric.label}</TableCell>
                        {summaries.map((summary) => {
                          const quarter = summary.quarters.find(
                            (item) => item.quarter === quarterNumber,
                          );
                          if (!quarter) return <TableCell key={summary.period}>―</TableCell>;
                          if (metric.key === "overLimit") {
                            return (
                              <TableCell key={summary.period}>
                                <OvertimeLimitCell quarter={quarter} />
                              </TableCell>
                            );
                          }
                          const value = quarter[metric.key];
                          return (
                            <TableCell key={summary.period} className="text-lg font-semibold tabular-nums">
                              {value === null ? "―" : `${formatCount(value)}h`}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        「その他」は若手社員以外です。45h超過者は、月の残業時間が45時間以上の社員を表示します。
      </p>
    </div>
  );
}

function OvertimeLimitCell({
  quarter,
}: {
  quarter: PeriodOvertimeSummary["quarters"][number];
}) {
  if (!quarter.overLimitOccurrences.length) {
    return <span className="text-sm text-emerald-700">該当者なし</span>;
  }
  return (
    <div>
      <div className="mb-2 font-semibold text-red-700">
        {quarter.overLimitEmployeeCount}名
      </div>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
        {quarter.overLimitOccurrences.map((item) => (
          <Badge
            key={`${item.employeeCode}:${item.targetMonth}`}
            variant="outline"
            className="border-red-200 bg-red-50 font-normal text-red-800"
          >
            {item.employeeCode} {item.surname}（{item.monthLabel} {formatCount(item.overtimeHours)}h）
          </Badge>
        ))}
      </div>
    </div>
  );
}

function OvertimeSummary({
  period,
  setPeriod,
  dashboard,
  loading,
}: {
  period: number;
  setPeriod: (period: number) => void;
  dashboard: DashboardData;
  loading: boolean;
}) {
  const months = useMemo(() => getFiscalMonths(period), [period]);
  const [onlyJunior, setOnlyJunior] = useState(false);
  const [showPartTime, setShowPartTime] = useState(false);
  const exclusions = new Set(dashboard.excludedEmployeeMonths);

  const filteredEmployees = dashboard.employees.filter((employee) => {
    const isPartTime = employee.employmentType?.includes("アルバイト");
    if (!showPartTime && isPartTime) return false;
    if (onlyJunior && (isPartTime || !employee.isJunior)) return false;
    return true;
  });

  const employeeCodes = new Set(
    filteredEmployees.map((employee) => employee.employeeCode),
  );
  const includedAttendance = dashboard.attendance.filter(
    (row) =>
      employeeCodes.has(row.employeeCode) &&
      !exclusions.has(`${row.employeeCode}:${row.targetMonth}`),
  );
  const attendanceByEmployeeMonth = new Map(
    includedAttendance.map((row) => [
      `${row.employeeCode}:${row.targetMonth}`,
      row,
    ]),
  );

  const totalOvertimeHours = includedAttendance.reduce(
    (sum, row) => sum + row.overtimeHours,
    0,
  );
  const totalWorkHours = includedAttendance.reduce(
    (sum, row) => sum + row.totalWorkHours,
    0,
  );
  const employeesWithData = new Set(
    includedAttendance.map((row) => row.employeeCode),
  ).size;
  const averageOvertimePerEmployee = employeesWithData
    ? totalOvertimeHours / employeesWithData
    : 0;
  const monthlyAverageOvertime =
    employeesWithData && months.length
      ? totalOvertimeHours / (employeesWithData * months.length)
      : 0;

  const highOvertimeCount = includedAttendance.filter(
    (row) => row.overtimeHours >= 45 || row.warnings.includes("overtime"),
  ).length;

  const monthlyAverages = months.map((m) => {
    const rows = includedAttendance.filter(
      (row) => row.targetMonth === m.targetMonth,
    );
    return rows.length
      ? rows.reduce((sum, row) => sum + row.overtimeHours, 0) / rows.length
      : null;
  });

  const maxMonthlyAverage = Math.max(
    1,
    ...monthlyAverages.map((value) => value ?? 0),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 rounded-2xl border bg-gradient-to-br from-amber-50 via-background to-orange-50 p-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-amber-600 p-2 text-white">
              <Clock className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">第{period}期 残業サマリー</h2>
              <p className="text-sm text-muted-foreground">
                {getPeriodRangeLabel(period)}（月別残業時間・平均・過重残業の集計）
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleSwitch
            checked={onlyJunior}
            onChange={setOnlyJunior}
            label="若手社員のみ表示"
          />
          <ToggleSwitch
            checked={showPartTime}
            onChange={setShowPartTime}
            label="アルバイトを表示"
          />
          <PeriodSelector period={period} setPeriod={setPeriod} />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <VacationMetric
          label="総残業時間"
          value={`${formatCount(totalOvertimeHours)}時間`}
          note={`期中 総労働 ${formatCount(totalWorkHours)}時間`}
          accent="bg-amber-500"
        />
        <VacationMetric
          label="1人あたり年間平均残業"
          value={`${formatCount(averageOvertimePerEmployee)}時間`}
          note={`集計対象 ${employeesWithData}名`}
          accent="bg-orange-500"
        />
        <VacationMetric
          label="月平均残業時間"
          value={`${formatCount(monthlyAverageOvertime)}時間 / 月`}
          note="社員1人あたりの月平均"
          accent="bg-blue-500"
        />
        <VacationMetric
          label="45h超過・要確認"
          value={`${highOvertimeCount}件`}
          note={
            highOvertimeCount > 0
              ? "36協定・過重労働注意"
              : "過重残業はありません"
          }
          accent={highOvertimeCount > 0 ? "bg-red-500" : "bg-emerald-500"}
        />
      </section>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">月別平均残業時間の推移</CardTitle>
              <CardDescription>
                各月の社員1人あたり平均残業時間（h）
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full bg-amber-500" />
                通常残業
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full bg-red-500" />
                45h超過
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-12 gap-2">
            {monthlyAverages.map((value, index) => {
              const isOverLimit = value !== null && value >= 45;
              return (
                <div
                  key={months[index].targetMonth}
                  className="flex h-full min-w-0 flex-col justify-end gap-2 text-center"
                >
                  <span
                    className={cn(
                      "text-xs font-semibold tabular-nums",
                      isOverLimit ? "text-red-600" : "text-foreground",
                    )}
                  >
                    {value === null ? "―" : `${formatCount(value)}h`}
                  </span>
                  <div className="flex h-28 items-end rounded-lg bg-muted/50 p-1">
                    <div
                      className={cn(
                        "w-full rounded-md transition-all",
                        isOverLimit
                          ? "bg-gradient-to-t from-red-600 to-rose-400"
                          : "bg-gradient-to-t from-amber-600 to-orange-400",
                      )}
                      style={{
                        height: `${value === null ? 0 : Math.max(6, (value / maxMonthlyAverage) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {months[index].label}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OvertimeTable({
  period,
  setPeriod,
  dashboard,
  loading,
  onDetail,
}: {
  period: number;
  setPeriod: (period: number) => void;
  dashboard: DashboardData;
  loading: boolean;
  onDetail: (row: DashboardAttendance) => void;
}) {
  const months = useMemo(() => getFiscalMonths(period), [period]);
  const [onlyJunior, setOnlyJunior] = useState(false);
  const [showPartTime, setShowPartTime] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const exclusions = new Set(dashboard.excludedEmployeeMonths);

  const filteredEmployees = dashboard.employees.filter((employee) => {
    const isPartTime = employee.employmentType?.includes("アルバイト");
    if (!showPartTime && isPartTime) return false;
    if (onlyJunior && (isPartTime || !employee.isJunior)) return false;
    return true;
  });

  const employeeCodes = new Set(
    filteredEmployees.map((employee) => employee.employeeCode),
  );
  const includedAttendance = dashboard.attendance.filter(
    (row) =>
      employeeCodes.has(row.employeeCode) &&
      !exclusions.has(`${row.employeeCode}:${row.targetMonth}`),
  );
  const attendanceByEmployeeMonth = new Map(
    includedAttendance.map((row) => [
      `${row.employeeCode}:${row.targetMonth}`,
      row,
    ]),
  );

  const totalOvertimeHours = includedAttendance.reduce(
    (sum, row) => sum + row.overtimeHours,
    0,
  );
  const totalWorkHours = includedAttendance.reduce(
    (sum, row) => sum + row.totalWorkHours,
    0,
  );
  const employeesWithData = new Set(
    includedAttendance.map((row) => row.employeeCode),
  ).size;
  const averageOvertimePerEmployee = employeesWithData
    ? totalOvertimeHours / employeesWithData
    : 0;

  const monthlyAverages = months.map((m) => {
    const rows = includedAttendance.filter(
      (row) => row.targetMonth === m.targetMonth,
    );
    return rows.length
      ? rows.reduce((sum, row) => sum + row.overtimeHours, 0) / rows.length
      : null;
  });

  // Calculate averages by category for footer
  const juniorAttendance = dashboard.attendance.filter((row) => {
    const emp = dashboard.employees.find((e) => e.employeeCode === row.employeeCode);
    return (
      emp &&
      !emp.employmentType?.includes("アルバイト") &&
      emp.isJunior &&
      !exclusions.has(`${row.employeeCode}:${row.targetMonth}`)
    );
  });
  const juniorEmployeesWithData = new Set(
    juniorAttendance.map((r) => r.employeeCode),
  ).size;
  const juniorTotalOvertime = juniorAttendance.reduce(
    (sum, row) => sum + row.overtimeHours,
    0,
  );
  const juniorAverageAnnual = juniorEmployeesWithData
    ? juniorTotalOvertime / juniorEmployeesWithData
    : 0;
  const juniorMonthlyAverages = months.map((m) => {
    const rows = juniorAttendance.filter(
      (row) => row.targetMonth === m.targetMonth,
    );
    return rows.length
      ? rows.reduce((sum, row) => sum + row.overtimeHours, 0) / rows.length
      : null;
  });

  const otherAttendance = dashboard.attendance.filter((row) => {
    const emp = dashboard.employees.find((e) => e.employeeCode === row.employeeCode);
    return (
      emp &&
      !emp.employmentType?.includes("アルバイト") &&
      !emp.isJunior &&
      !exclusions.has(`${row.employeeCode}:${row.targetMonth}`)
    );
  });
  const otherEmployeesWithData = new Set(
    otherAttendance.map((r) => r.employeeCode),
  ).size;
  const otherTotalOvertime = otherAttendance.reduce(
    (sum, row) => sum + row.overtimeHours,
    0,
  );
  const otherAverageAnnual = otherEmployeesWithData
    ? otherTotalOvertime / otherEmployeesWithData
    : 0;
  const otherMonthlyAverages = months.map((m) => {
    const rows = otherAttendance.filter(
      (row) => row.targetMonth === m.targetMonth,
    );
    return rows.length
      ? rows.reduce((sum, row) => sum + row.overtimeHours, 0) / rows.length
      : null;
  });

  const sortedEmployees = (() => {
    const list = [...filteredEmployees];
    return list.sort((a, b) => {
      const aRows = months.map((m) =>
        attendanceByEmployeeMonth.get(`${a.employeeCode}:${m.targetMonth}`),
      );
      const bRows = months.map((m) =>
        attendanceByEmployeeMonth.get(`${b.employeeCode}:${m.targetMonth}`),
      );
      const aTotal = aRows.reduce((sum, r) => sum + (r ? r.overtimeHours : 0), 0);
      const bTotal = bRows.reduce((sum, r) => sum + (r ? r.overtimeHours : 0), 0);
      if (aTotal !== bTotal) {
        return bTotal - aTotal;
      }
      return a.employeeCode.localeCompare(b.employeeCode);
    });
  })();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <PeriodSelector period={period} setPeriod={setPeriod} />
            <div className="flex flex-wrap items-center gap-3">
              <ToggleSwitch
                checked={onlyJunior}
                onChange={setOnlyJunior}
                label="若手社員のみ表示"
              />
              <ToggleSwitch
                checked={showPartTime}
                onChange={setShowPartTime}
                label="アルバイトを表示"
              />
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full bg-amber-500" />
                  30h以上
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full bg-red-500" />
                  45h以上
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                  灰: 在籍外（入社前・退職済）
                </span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="sticky left-0 z-20 min-w-28 bg-muted/90 font-semibold">
                    雇用区分
                  </TableHead>
                  <TableHead className="sticky left-28 z-20 min-w-36 bg-muted/90 font-semibold border-r">
                    名前
                  </TableHead>
                  {months.map((m) => (
                    <TableHead
                      key={m.targetMonth}
                      className="min-w-16 px-1 py-2 text-center"
                    >
                      <div className="font-semibold">{m.label}</div>
                      <div className="mt-1 border-t border-border/60 pt-0.5 text-[10px] font-normal text-muted-foreground">
                        残業
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="min-w-28 px-1 py-2 text-center border-l bg-amber-50/50 dark:bg-amber-950/30">
                    <div className="font-semibold text-amber-900 dark:text-amber-300">
                      年間残業
                    </div>
                    <div className="mt-1 grid grid-cols-2 border-t border-amber-200 dark:border-amber-800 pt-0.5 text-[10px] font-normal text-muted-foreground">
                      <span>平日</span>
                      <span>休日</span>
                    </div>
                  </TableHead>
                  <TableHead className="min-w-20 px-2 py-2 text-right">
                    <div className="font-semibold">総労働</div>
                    <div className="mt-1 border-t border-border/60 pt-0.5 text-[10px] font-normal text-muted-foreground">
                      総時間
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={16} className="h-32 text-center">
                      読み込み中…
                    </TableCell>
                  </TableRow>
                ) : sortedEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={16}
                      className="h-32 text-center text-muted-foreground"
                    >
                      集計対象の社員データがありません。
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedEmployees.map((employee) => {
                    const isPartTime = employee.employmentType?.includes("アルバイト");
                    const rows = months.map((m) =>
                      attendanceByEmployeeMonth.get(
                        `${employee.employeeCode}:${m.targetMonth}`,
                      ),
                    );
                    const annualOvertime = rows.reduce(
                      (sum, row) => sum + (row ? row.overtimeHours : 0),
                      0,
                    );
                    const annualWeekdayOt = rows.reduce(
                      (sum, row) => sum + (row ? getWeekdayOvertimeHours(row) : 0),
                      0,
                    );
                    const annualHolidayOt = rows.reduce(
                      (sum, row) => sum + (row ? getHolidayOvertimeHours(row) : 0),
                      0,
                    );
                    const monthsCount = rows.filter(Boolean).length;
                    const monthlyAvg = monthsCount ? annualOvertime / monthsCount : 0;
                    const annualWorkHours = rows.reduce(
                      (sum, row) => sum + (row ? row.totalWorkHours : 0),
                      0,
                    );
                    return (
                      <TableRow
                        key={employee.employeeCode}
                        className="hover:bg-amber-50/40 dark:hover:bg-amber-950/20 cursor-pointer transition-colors group"
                        onClick={() => setSelectedEmployee(employee)}
                        title={`クリックで ${employee.surname} の残業・労働時間詳細を表示`}
                      >
                        <TableCell className="sticky left-0 z-10 bg-background group-hover:bg-amber-50/60 dark:group-hover:bg-slate-900 text-xs text-muted-foreground font-medium">
                          {employee.employmentType}
                        </TableCell>
                        <TableCell className="sticky left-28 z-10 bg-background group-hover:bg-amber-50/60 dark:group-hover:bg-slate-900 font-medium border-r">
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate group-hover:text-amber-600 transition-colors">
                                {employee.employeeCode} {employee.surname}
                              </span>
                              {!isPartTime && employee.isJunior && (
                                <Badge
                                  variant="outline"
                                  className="px-1.5 py-0 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 shrink-0"
                                >
                                  若手
                                </Badge>
                              )}
                            </div>
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-normal underline decoration-dotted shrink-0 opacity-70 group-hover:opacity-100">
                              内訳
                            </span>
                          </div>
                        </TableCell>
                        {months.map((m) => {
                          const row = attendanceByEmployeeMonth.get(
                            `${employee.employeeCode}:${m.targetMonth}`,
                          );
                          const status = getEnrollmentStatus(
                            employee,
                            m.targetMonth,
                          );
                          const isExcluded = exclusions.has(
                            `${employee.employeeCode}:${m.targetMonth}`,
                          );

                          if (status === "before-hire") {
                            return (
                              <TableCell
                                key={m.targetMonth}
                                className="bg-slate-100/70 dark:bg-slate-900/50 p-1 text-center align-middle select-none"
                                title={`${employee.startMonth}入社前`}
                              >
                                <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                                  入社前
                                </span>
                              </TableCell>
                            );
                          }

                          if (status === "retired") {
                            return (
                              <TableCell
                                key={m.targetMonth}
                                className="bg-slate-100/70 dark:bg-slate-900/50 p-1 text-center align-middle select-none"
                                title={`${employee.endMonth}退職後`}
                              >
                                <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                                  退職済
                                </span>
                              </TableCell>
                            );
                          }

                          if (isExcluded) {
                            return (
                              <TableCell
                                key={m.targetMonth}
                                className="bg-muted/30 p-1 text-center align-middle text-muted-foreground select-none"
                                title="一時対象外"
                              >
                                <span className="text-[10px]">対象外</span>
                              </TableCell>
                            );
                          }

                          if (!row) {
                            return (
                              <TableCell
                                key={m.targetMonth}
                                className="p-1 text-center align-middle text-muted-foreground"
                                title="データ未取込"
                              >
                                <span className="text-xs">―</span>
                              </TableCell>
                            );
                          }
                          const ot = row.overtimeHours;
                          const holidayOt = getHolidayOvertimeHours(row);
                          const isWarning = ot >= 45 || row.warnings.includes("overtime");
                          const isCaution = ot >= 30 && !isWarning;
                          return (
                            <TableCell
                              key={m.targetMonth}
                              className="p-1 text-center align-middle"
                            >
                              <div
                                className={cn(
                                  "w-full rounded py-1 text-center transition-colors",
                                  isWarning
                                    ? "bg-red-100 text-red-700 font-bold dark:bg-red-950/60 dark:text-red-300"
                                    : isCaution
                                      ? "bg-amber-100 text-amber-800 font-semibold dark:bg-amber-950/50 dark:text-amber-300"
                                      : ot > 0
                                        ? "bg-muted/30 font-medium text-foreground"
                                        : "text-muted-foreground",
                                )}
                              >
                                <span className="text-sm tabular-nums">
                                  {formatCount(ot)}
                                </span>
                                {holidayOt > 0 && (
                                  <span className="block text-[9px] font-normal text-orange-600 dark:text-orange-400">
                                    休{formatCount(holidayOt)}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          );
                        })}
                        <TableCell className="p-1 text-center align-middle border-l bg-amber-50/20 dark:bg-amber-950/10">
                          <div className="flex flex-col items-center justify-center py-1">
                            <span className="text-sm font-bold tabular-nums text-amber-900 dark:text-amber-300">
                              {formatCount(annualOvertime)}h
                            </span>
                            <div className="mt-0.5 grid w-full grid-cols-2 border-t border-dashed border-amber-200 dark:border-amber-900 pt-0.5 text-[10px] tabular-nums text-muted-foreground">
                              <span
                                className="border-r border-dashed border-amber-200 dark:border-amber-900 font-medium text-amber-950 dark:text-amber-200"
                                title="年間平日残業合計"
                              >
                                {formatCount(annualWeekdayOt)}
                              </span>
                              <span
                                className={cn(
                                  "font-medium",
                                  annualHolidayOt > 0
                                    ? "text-orange-600 dark:text-orange-400 font-semibold"
                                    : "text-muted-foreground/60",
                                )}
                                title="年間休日残業合計"
                              >
                                {formatCount(annualHolidayOt)}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-sm pr-3">
                          {formatCount(annualWorkHours)}h
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
              <TableFooter className="border-t-2 border-amber-200 bg-amber-50/80 dark:bg-amber-950/40 text-foreground">
                <TableRow className="hover:bg-amber-100/50 dark:hover:bg-amber-900/30">
                  <TableCell
                    colSpan={2}
                    className="sticky left-0 z-10 bg-amber-50/95 dark:bg-amber-950/95 font-semibold text-amber-950 dark:text-amber-100 border-r"
                  >
                    平均残業 社員全体
                  </TableCell>
                  {months.map((m, index) => {
                    const value = monthlyAverages[index];
                    return (
                      <TableCell
                        key={m.targetMonth}
                        className="text-center tabular-nums font-semibold text-xs text-amber-950 dark:text-amber-100"
                      >
                        {value === null ? "―" : `${formatCount(value)}h`}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center tabular-nums font-bold text-xs text-amber-950 dark:text-amber-100 border-l">
                    {formatCount(averageOvertimePerEmployee)}h
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground pr-3">
                    ―
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-emerald-100/50 dark:hover:bg-emerald-900/30">
                  <TableCell
                    colSpan={2}
                    className="sticky left-0 z-10 bg-emerald-50/95 dark:bg-emerald-950/95 font-semibold text-emerald-950 dark:text-emerald-100 border-r"
                  >
                    平均残業 若手社員
                  </TableCell>
                  {months.map((m, index) => {
                    const value = juniorMonthlyAverages[index];
                    return (
                      <TableCell
                        key={m.targetMonth}
                        className="text-center tabular-nums font-semibold text-xs text-emerald-900 dark:text-emerald-300"
                      >
                        {value === null ? "―" : `${formatCount(value)}h`}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center tabular-nums font-bold text-xs text-emerald-900 dark:text-emerald-300 border-l">
                    {formatCount(juniorAverageAnnual)}h
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground pr-3">
                    ―
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-slate-100/50 dark:hover:bg-slate-900/30">
                  <TableCell
                    colSpan={2}
                    className="sticky left-0 z-10 bg-slate-50/95 dark:bg-slate-950/95 font-semibold text-slate-950 dark:text-slate-100 border-r"
                  >
                    平均残業 その他社員
                  </TableCell>
                  {months.map((m, index) => {
                    const value = otherMonthlyAverages[index];
                    return (
                      <TableCell
                        key={m.targetMonth}
                        className="text-center tabular-nums font-semibold text-xs text-slate-900 dark:text-slate-300"
                      >
                        {value === null ? "―" : `${formatCount(value)}h`}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center tabular-nums font-bold text-xs text-slate-900 dark:text-slate-300 border-l">
                    {formatCount(otherAverageAnnual)}h
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground pr-3">
                    ―
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
      <OvertimeDetailDialog
        data={
          selectedEmployee
            ? {
                employee: selectedEmployee,
                rows: months.map((m) => ({
                  month: m,
                  attendance: attendanceByEmployeeMonth.get(
                    `${selectedEmployee.employeeCode}:${m.targetMonth}`,
                  ),
                })),
              }
            : null
        }
        period={period}
        onClose={() => setSelectedEmployee(null)}
      />
    </div>
  );
}

function VacationMetric({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  accent: string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className={`h-1 ${accent}`} />
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function VacationThresholdMetric({
  label,
  employees,
  accent,
}: {
  label: string;
  employees: Employee[];
  accent: string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className={`h-1 ${accent}`} />
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{employees.length}名</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {employees.length
            ? employees.map((employee) => `${employee.employeeCode} ${employee.surname}`).join("、")
            : "該当者なし"}
        </p>
      </CardContent>
    </Card>
  );
}

function PeriodSelector({
  period,
  setPeriod,
}: {
  period: number;
  setPeriod: (period: number) => void;
}) {
  const rangeLabel = getPeriodRangeLabel(period);
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label="前期"
        disabled={period <= MIN_PERIOD}
        onClick={() => setPeriod(Math.max(MIN_PERIOD, period - 1))}
      >
        <ChevronLeft />
      </Button>
      <div className="min-w-44 text-center">
        <div className="text-lg font-bold leading-tight">第{period}期</div>
        <div className="text-xs text-muted-foreground">{rangeLabel}</div>
      </div>
      <Button
        variant="outline"
        size="icon"
        aria-label="次期"
        onClick={() => setPeriod(period + 1)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="size-4 text-blue-600" />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function StatusTable({
  period,
  setPeriod,
  dashboard,
  loading,
  onDetail,
  onFilesSelect,
}: {
  period: number;
  setPeriod: (period: number) => void;
  dashboard: DashboardData;
  loading: boolean;
  onDetail: (row: DashboardAttendance) => void;
  onFilesSelect: (files: File[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const months = useMemo(() => getFiscalMonths(period), [period]);
  const employees = useMemo(
    () =>
      [...dashboard.employees].sort((a, b) =>
        a.employeeCode.localeCompare(b.employeeCode),
      ),
    [dashboard.employees],
  );
  const attendance = new Map(
    dashboard.attendance.map((row) => [
      `${row.employeeCode}:${row.targetMonth}`,
      row,
    ]),
  );
  const exclusions = new Set(dashboard.excludedEmployeeMonths);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <PeriodSelector period={period} setPeriod={setPeriod} />
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xls,application/vnd.ms-excel"
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length > 0) {
                  onFilesSelect(files);
                  event.target.value = "";
                }
              }}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 font-medium shadow-sm bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
            >
              <Upload className="size-4" />
              Excel取込
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 min-w-40 bg-background">
                  社員
                </TableHead>
                {months.map((m) => {
                  return (
                    <TableHead key={m.targetMonth} className="min-w-20 text-center">
                      <div>{m.label}</div>
                      {dashboard.registeredMonths.includes(m.targetMonth) && (
                        <Check className="mx-auto mt-1 size-3 text-emerald-600" />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={13} className="h-32 text-center">
                    読み込み中…
                  </TableCell>
                </TableRow>
              ) : employees.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={13}
                    className="h-32 text-center text-muted-foreground"
                  >
                    社員データがありません。Excelを登録すると一覧が作成されます。
                  </TableCell>
                </TableRow>
              ) : (
                employees.map((employee) => {
                  const isPartTime = employee.employmentType?.includes("アルバイト");
                  return (
                    <TableRow key={employee.employeeCode}>
                      <TableCell className="sticky left-0 z-10 bg-background font-medium">
                        <div className="flex items-center gap-1.5">
                          <span>
                            {employee.employeeCode} {employee.surname}
                          </span>
                          {!isPartTime && employee.isJunior && (
                            <Badge
                              variant="outline"
                              className="px-1.5 py-0 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300"
                            >
                              若手
                            </Badge>
                          )}
                        </div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {employee.employmentType}
                      </div>
                    </TableCell>
                    {months.map((m) => {
                      const employeeMonth = `${employee.employeeCode}:${m.targetMonth}`;
                      const row = attendance.get(employeeMonth);
                      const status = getEnrollmentStatus(employee, m.targetMonth);
                      const isExcluded = exclusions.has(employeeMonth);

                      if (status === "before-hire") {
                        return (
                          <TableCell
                            key={m.targetMonth}
                            className="bg-slate-100/70 dark:bg-slate-900/50 text-center text-[10px] text-slate-400 dark:text-slate-500 select-none"
                            title={`${employee.startMonth}入社前`}
                          >
                            入社前
                          </TableCell>
                        );
                      }

                      if (status === "retired") {
                        return (
                          <TableCell
                            key={m.targetMonth}
                            className="bg-slate-100/70 dark:bg-slate-900/50 text-center text-[10px] text-slate-400 dark:text-slate-500 select-none"
                            title={`${employee.endMonth}退職後`}
                          >
                            退職済
                          </TableCell>
                        );
                      }

                      if (isExcluded) {
                        return (
                          <TableCell
                            key={m.targetMonth}
                            className="bg-muted/40 text-center text-[10px] text-muted-foreground select-none"
                            title="一時対象外"
                          >
                            対象外
                          </TableCell>
                        );
                      }

                      if (!row)
                        return (
                          <TableCell
                            key={m.targetMonth}
                            className="text-center"
                            title="データ未登録"
                          >
                            <span className="font-medium text-amber-700 dark:text-amber-400">
                              未
                            </span>
                          </TableCell>
                        );
                      const warning = row.warnings.length > 0;
                      return (
                        <TableCell key={m.targetMonth} className="text-center">
                          <button
                            onClick={() => onDetail(row)}
                            className={
                              warning
                                ? "font-medium text-orange-700 hover:underline"
                                : "font-semibold text-emerald-700 hover:underline"
                            }
                          >
                            {warning ? "要確認" : "✓"}
                          </button>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ImportPanel(props: {
  batchFiles: BatchFileItem[];
  activeFileId: string | null;
  setActiveFileId: (id: string | null) => void;
  saving: boolean;
  batchProgress: { current: number; total: number } | null;
  databaseConfigured: boolean;
  onFiles: (files: File[]) => void;
  onSaveBatch: () => void;
  onClearBatch: () => void;
  onRemoveFile: (id: string) => void;
  onUpdateMissingAction: (
    fileId: string,
    employeeCode: string,
    action: "retire" | "exclude",
  ) => void;
  onUpdateAcceptedSurname: (
    fileId: string,
    employeeCode: string,
    accept: boolean,
  ) => void;
}) {
  const {
    batchFiles,
    activeFileId,
    setActiveFileId,
    saving,
    batchProgress,
    databaseConfigured,
    onFiles,
    onSaveBatch,
    onClearBatch,
    onRemoveFile,
    onUpdateMissingAction,
    onUpdateAcceptedSurname,
  } = props;
  const fileInput = useRef<HTMLInputElement>(null);

  const activeItem =
    batchFiles.find((item) => item.id === activeFileId) ?? batchFiles[0] ?? null;

  const readyItems = batchFiles.filter(
    (item) =>
      item.parsed &&
      !item.error &&
      item.status !== "completed" &&
      item.diff &&
      item.diff.missingEmployees.every(
        (m) => item.missingActions[m.employeeCode],
      ) &&
      item.diff.surnameMismatches.every((s) =>
        item.acceptedSurnames.includes(s.employeeCode),
      ),
  );

  const completedCount = batchFiles.filter((item) => item.status === "completed").length;
  const errorCount = batchFiles.filter((item) => item.error || item.status === "error").length;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="size-5 text-blue-600" />
                読み込みファイル一覧（{batchFiles.length}件）
              </CardTitle>
              <CardDescription>
                対象年月順（昇順）に並んでいます。内容を確認して一括登録してください。
              </CardDescription>
            </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-background">
                  全 {batchFiles.length} ファイル
                </Badge>
                <Badge
                  variant="outline"
                  className="bg-emerald-50 text-emerald-700 border-emerald-200"
                >
                  登録可能: {readyItems.length}件
                </Badge>
                {completedCount > 0 && (
                  <Badge
                    variant="outline"
                    className="bg-blue-50 text-blue-700 border-blue-200"
                  >
                    登録完了: {completedCount}件
                  </Badge>
                )}
                {errorCount > 0 && (
                  <Badge variant="destructive">エラー: {errorCount}件</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-[180px]">対象年月（事業期）</TableHead>
                    <TableHead>ファイル名</TableHead>
                    <TableHead className="text-right">社員数</TableHead>
                    <TableHead className="text-right">所定時間</TableHead>
                    <TableHead className="text-right">残業</TableHead>
                    <TableHead className="text-right">有休</TableHead>
                    <TableHead className="text-right">労働合計</TableHead>
                    <TableHead className="text-center">マスタ差異</TableHead>
                    <TableHead className="text-center">ステータス</TableHead>
                    <TableHead className="w-[120px] text-center">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchFiles.map((item) => {
                    const isSelected = activeItem?.id === item.id;
                    const parsed = item.parsed;
                    const period = parsed
                      ? getPeriodFromTargetMonth(parsed.targetMonth)
                      : null;

                    let diffStatus = "確認中…";
                    let diffVariant: "outline" | "secondary" | "destructive" = "outline";

                    if (item.error) {
                      diffStatus = "解析エラー";
                      diffVariant = "destructive";
                    } else if (!databaseConfigured) {
                      diffStatus = "DB未接続";
                    } else if (item.diff) {
                      const hasNew = item.diff.newEmployees.length > 0;
                      const hasMissing = item.diff.missingEmployees.length > 0;
                      const hasMismatch = item.diff.surnameMismatches.length > 0;
                      if (!hasNew && !hasMissing && !hasMismatch) {
                        diffStatus = "一致（差分なし）";
                        diffVariant = "outline";
                      } else {
                        const notes = [];
                        if (hasNew) notes.push(`新規${item.diff.newEmployees.length}名`);
                        if (hasMissing) notes.push(`未在籍${item.diff.missingEmployees.length}名`);
                        if (hasMismatch) notes.push(`改姓${item.diff.surnameMismatches.length}名`);
                        diffStatus = notes.join(" / ");
                        diffVariant = "secondary";
                      }
                    }

                    return (
                      <TableRow
                        key={item.id}
                        className={cn(
                          "cursor-pointer transition-colors",
                          isSelected && "bg-blue-50/70 dark:bg-blue-950/30",
                        )}
                        onClick={() => setActiveFileId(item.id)}
                      >
                        <TableCell className="font-semibold">
                          {parsed ? (
                            <span className="flex items-center gap-1.5">
                              <span>
                                {parsed.targetMonth.slice(0, 4)}年
                                {Number(parsed.targetMonth.slice(5))}月
                              </span>
                              <Badge variant="outline" className="text-[11px] font-normal">
                                第{period}期
                              </Badge>
                            </span>
                          ) : (
                            <span className="text-destructive">不明</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={item.fileName}>
                          {item.fileName}
                        </TableCell>
                        <TableCell className="text-right">
                          {parsed ? `${parsed.rows.length}名` : "―"}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {parsed ? `${parsed.totals.scheduledHours}h` : "―"}
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium">
                          {parsed ? (
                            <span className={parsed.totals.overtimeHours > 0 ? "text-amber-700 dark:text-amber-400" : ""}>
                              {parsed.totals.overtimeHours}h
                            </span>
                          ) : (
                            "―"
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {parsed ? `${parsed.totals.paidLeaveDays}日` : "―"}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold">
                          {parsed ? `${parsed.totals.totalWorkHours}h` : "―"}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          <Badge variant={diffVariant} className="text-[11px]">
                            {diffStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {item.status === "saving" ? (
                            <Badge variant="secondary" className="gap-1 animate-pulse">
                              <Loader2 className="size-3 animate-spin" />
                              登録中
                            </Badge>
                          ) : item.status === "completed" ? (
                            <Badge className="bg-emerald-600 hover:bg-emerald-600 gap-1 text-white">
                              <CheckCircle2 className="size-3" />
                              完了
                            </Badge>
                          ) : item.status === "error" ? (
                            <Badge variant="destructive" className="gap-1" title={item.error ?? ""}>
                              <XCircle className="size-3" />
                              エラー
                            </Badge>
                          ) : item.registered ? (
                            <Badge variant="destructive">既存置換</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-slate-100 dark:bg-slate-800">
                              新規登録
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-7 px-2 text-xs",
                                isSelected && "bg-blue-100 text-blue-800 dark:bg-blue-900",
                              )}
                              onClick={() => setActiveFileId(item.id)}
                            >
                              詳細
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => onRemoveFile(item.id)}
                              title="一覧から除外"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col justify-between gap-4 border-t p-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                multiple
                accept=".xls,application/vnd.ms-excel"
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length > 0) void onFiles(files);
                  event.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={saving}
                className="flex items-center gap-1.5"
              >
                <Upload className="size-3.5" />
                ファイル追加
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onClearBatch}
                disabled={saving}
              >
                一覧をクリア
              </Button>
            </div>
            <div className="flex items-center gap-3">
              {batchProgress && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-blue-600" />
                  <span>
                    一括登録中... ({batchProgress.current} / {batchProgress.total})
                  </span>
                </div>
              )}
              <Button
                size="lg"
                className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                disabled={readyItems.length === 0 || saving}
                onClick={onSaveBatch}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    一括登録中...
                  </>
                ) : (
                  <>
                    <Layers className="mr-2 size-4" />
                    {readyItems.length > 1
                      ? `全 ${readyItems.length} 件を一括登録する`
                      : "選択した内容を登録する"}
                  </>
                )}
              </Button>
            </div>
          </CardFooter>
        </Card>

      {activeItem && activeItem.parsed && (
        <Card className="border-blue-200 dark:border-blue-900">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">
                  個別確認: {activeItem.parsed.targetMonth.slice(0, 4)}年
                  {Number(activeItem.parsed.targetMonth.slice(5))}月（第
                  {getPeriodFromTargetMonth(activeItem.parsed.targetMonth)}期）
                </CardTitle>
                <CardDescription>{activeItem.fileName}</CardDescription>
              </div>
              <Badge variant={activeItem.registered ? "destructive" : "secondary"}>
                {activeItem.registered ? "登録済み・置換" : "新規登録"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Metric
                label="対象年月（事業期）"
                value={`${activeItem.parsed.targetMonth.slice(0, 4)}年${Number(activeItem.parsed.targetMonth.slice(5))}月（第${getPeriodFromTargetMonth(activeItem.parsed.targetMonth)}期）`}
              />
              <Metric label="従業員" value={`${activeItem.parsed.rows.length}名`} />
              <Metric
                label="所定時間"
                value={`${activeItem.parsed.totals.scheduledHours}h`}
              />
              <Metric label="残業" value={`${activeItem.parsed.totals.overtimeHours}h`} />
              <Metric
                label="有休"
                value={`${activeItem.parsed.totals.paidLeaveDays}日 ${activeItem.parsed.totals.paidLeaveHours}h`}
              />
              <Metric
                label="労働合計"
                value={`${activeItem.parsed.totals.totalWorkHours}h`}
              />
            </div>

            {activeItem.error ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>エラー</AlertTitle>
                <AlertDescription>{activeItem.error}</AlertDescription>
              </Alert>
            ) : !databaseConfigured ? (
              <p className="text-sm text-amber-700">
                DB接続後に社員差異を確認し、登録できます。
              </p>
            ) : !activeItem.diff ? (
              <p className="text-sm text-muted-foreground">
                社員マスタを確認中です…
              </p>
            ) : (
              <DiffReview
                diff={activeItem.diff}
                missingActions={activeItem.missingActions}
                setMissingActions={(actions) => {
                  for (const [code, action] of Object.entries(actions)) {
                    onUpdateMissingAction(activeItem.id, code, action);
                  }
                }}
                acceptedSurnames={activeItem.acceptedSurnames}
                setAcceptedSurnames={(surnames) => {
                  for (const code of activeItem.diff?.surnameMismatches.map((s) => s.employeeCode) ?? []) {
                    onUpdateAcceptedSurname(activeItem.id, code, surnames.includes(code));
                  }
                }}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function DiffReview({
  diff,
  missingActions,
  setMissingActions,
  acceptedSurnames,
  setAcceptedSurnames,
}: {
  diff: EmployeeDiff;
  missingActions: Record<string, "retire" | "exclude">;
  setMissingActions: (value: Record<string, "retire" | "exclude">) => void;
  acceptedSurnames: string[];
  setAcceptedSurnames: (value: string[]) => void;
}) {
  if (
    !diff.newEmployees.length &&
    !diff.missingEmployees.length &&
    !diff.surnameMismatches.length
  )
    return (
      <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
        <Check />
        <AlertTitle>社員マスタと一致しました</AlertTitle>
        <AlertDescription>そのまま登録できます。</AlertDescription>
      </Alert>
    );
  return (
    <div className="space-y-4">
      {diff.newEmployees.length > 0 && (
        <ReviewGroup
          title={`新しい社員 ${diff.newEmployees.length}名`}
          description="対象月を在籍開始月として追加します。"
        >
          {diff.newEmployees.map((row) => (
            <Badge key={row.employeeCode} variant="outline">
              {row.employeeCode} {row.surname}
            </Badge>
          ))}
        </ReviewGroup>
      )}
      {diff.missingEmployees.length > 0 && (
        <ReviewGroup
          title={`データがない在籍社員 ${diff.missingEmployees.length}名`}
          description="退職または一時的な対象外を選択してください。"
        >
          {diff.missingEmployees.map((employee) => (
            <div
              key={employee.employeeCode}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <span className="text-sm font-medium">
                {employee.employeeCode} {employee.surname}
              </span>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={missingActions[employee.employeeCode] ?? ""}
                onChange={(event) =>
                  setMissingActions({
                    ...missingActions,
                    [employee.employeeCode]: event.target.value as
                      "retire" | "exclude",
                  })
                }
              >
                <option value="">選択してください</option>
                <option value="exclude">この月だけ対象外</option>
                <option value="retire">前月で退職</option>
              </select>
            </div>
          ))}
        </ReviewGroup>
      )}
      {diff.surnameMismatches.length > 0 && (
        <ReviewGroup
          title="苗字の変更"
          description="社員コードが同じため、変更を確認してください。"
        >
          {diff.surnameMismatches.map((item) => (
            <label
              key={item.employeeCode}
              className="flex items-center gap-3 rounded-lg border p-3 text-sm"
            >
              <input
                type="checkbox"
                checked={acceptedSurnames.includes(item.employeeCode)}
                onChange={(event) =>
                  setAcceptedSurnames(
                    event.target.checked
                      ? [...acceptedSurnames, item.employeeCode]
                      : acceptedSurnames.filter(
                          (code) => code !== item.employeeCode,
                        ),
                  )
                }
              />
              <span>
                {item.employeeCode}: {item.currentSurname} → {item.newSurname}
              </span>
            </label>
          ))}
        </ReviewGroup>
      )}
    </div>
  );
}

function ReviewGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-medium">{title}</p>
      <p className="mb-2 text-xs text-muted-foreground">{description}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

const complianceLabels = {
  achieved: "達成",
  "in-progress": "進行中",
  warning: "要注意",
} as const;

function ComplianceRow({ item }: { item: PaidLeaveComplianceItem }) {
  const progress = Math.min(100, (item.paidLeaveDays / 5) * 100);
  const dateLabel = (value: string) => value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1/$2/$3");
  return (
    <TableRow className={item.status === "warning" ? "bg-red-50/60 dark:bg-red-950/20" : ""}>
      <TableCell className="font-medium"><div>{item.employeeCode} {item.surname}</div><div className="text-xs font-normal text-muted-foreground">{item.employmentType}</div></TableCell>
      <TableCell>{item.paidLeaveCycleStartMonth}月</TableCell>
      <TableCell className="whitespace-nowrap text-xs">{dateLabel(item.periodStart)}<br />〜 {dateLabel(item.periodEnd)}</TableCell>
      <TableCell>
        <div className="mb-1 flex justify-between text-xs"><span className="font-semibold">{formatCount(item.paidLeaveDays)} / 5日</span><span>{Math.round(progress)}%</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", item.status === "achieved" ? "bg-emerald-500" : item.status === "warning" ? "bg-red-500" : "bg-blue-500")} style={{ width: `${progress}%` }} /></div>
        {item.missingMonths.length > 0 && <p className="mt-1 text-[11px] text-amber-700">未取込: {item.missingMonths.join("、")}</p>}
      </TableCell>
      <TableCell className="font-semibold tabular-nums">{formatCount(item.remainingDays)}日</TableCell>
      <TableCell className="whitespace-nowrap text-sm"><div>{dateLabel(item.periodEnd)}</div><div className="text-xs text-muted-foreground">あと{item.daysUntilDeadline}日</div></TableCell>
      <TableCell><Badge variant="outline" className={cn(item.status === "achieved" && "border-emerald-300 bg-emerald-50 text-emerald-700", item.status === "warning" && "border-red-300 bg-red-50 text-red-700", item.status === "in-progress" && "border-blue-300 bg-blue-50 text-blue-700")}>{complianceLabels[item.status]}</Badge></TableCell>
    </TableRow>
  );
}

function EmployeeMaster({
  employees,
  onEdit,
}: {
  employees: Employee[];
  onEdit: (employee: Employee) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>社員マスタ</CardTitle>
        <CardDescription>
          苗字、雇用区分、区分、有休起算月、在籍期間を管理します。名は保存されません。
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>社員コード</TableHead>
              <TableHead>苗字</TableHead>
              <TableHead>雇用区分</TableHead>
              <TableHead>区分</TableHead>
              <TableHead>有休起算</TableHead>
              <TableHead>在籍開始月</TableHead>
              <TableHead>在籍終了月</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.length ? (
              employees.map((employee) => {
                const isPartTime = employee.employmentType?.includes("アルバイト");
                return (
                  <TableRow key={employee.employeeCode}>
                    <TableCell className="font-medium">
                      {employee.employeeCode}
                    </TableCell>
                    <TableCell>{employee.surname}</TableCell>
                    <TableCell className="text-xs font-medium text-muted-foreground">
                      {employee.employmentType}
                    </TableCell>
                    <TableCell>
                      {isPartTime ? (
                        <span className="text-xs text-muted-foreground">―</span>
                      ) : employee.isJunior ? (
                        <Badge
                          variant="outline"
                          className="bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300"
                        >
                          若手
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">一般</span>
                      )}
                    </TableCell>
                    <TableCell>{employee.paidLeaveCycleStartMonth}月</TableCell>
                    <TableCell>{employee.startMonth}</TableCell>
                    <TableCell>{employee.endMonth ?? "在籍中"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(employee)}
                      >
                        編集
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-32 text-center text-muted-foreground"
                >
                  社員データがありません。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function VacationDetailDialog({
  data,
  period,
  onClose,
}: {
  data: {
    employee: Employee;
    rows: { month: FiscalMonth; attendance?: DashboardAttendance }[];
  } | null;
  period: number;
  onClose: () => void;
}) {
  if (!data) return null;
  const { employee, rows } = data;
  const rangeLabel = getPeriodRangeLabel(period);

  const leaveSummary = LEAVE_FIELDS.map((field) => {
    const cleanLabel = field.replace(" 日数", "");
    const totalDays = rows.reduce(
      (sum, item) => sum + (item.attendance?.leaves[field]?.days ?? 0),
      0,
    );
    const totalHours = rows.reduce(
      (sum, item) => sum + (item.attendance?.leaves[field]?.hours ?? 0),
      0,
    );
    const monthlyData = rows.map((item) => ({
      month: item.month,
      days: item.attendance?.leaves[field]?.days ?? 0,
      hours: item.attendance?.leaves[field]?.hours ?? 0,
    }));
    return {
      field,
      cleanLabel,
      totalDays,
      totalHours,
      hasUsage: totalDays > 0 || totalHours > 0,
      monthlyData,
    };
  });

  const usedLeaves = leaveSummary.filter((l) => l.hasUsage);

  const totalAllLeaveDays = usedLeaves.reduce((s, l) => s + l.totalDays, 0);
  const totalAllLeaveHours = usedLeaves.reduce((s, l) => s + l.totalHours, 0);

  const totalWeekdayWork = rows.reduce(
    (sum, item) => sum + (item.attendance?.weekdayAttendanceDays ?? 0),
    0,
  );
  const totalHolidayWork = rows.reduce(
    (sum, item) => sum + (item.attendance?.holidayAttendanceDays ?? 0),
    0,
  );

  return (
    <Dialog open={Boolean(data)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-blue-600 p-2 text-white">
              <CalendarCheck className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">
                {employee.employeeCode} {employee.surname} の休暇内訳詳細
              </DialogTitle>
              <DialogDescription>
                第{period}期（{rangeLabel}） / {employee.department || "部署未設定"} / {employee.employmentType || "雇用区分未設定"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border bg-blue-50/50 dark:bg-blue-950/20 p-3 text-center">
              <div className="text-xs text-muted-foreground">全休暇合計</div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {formatCount(totalAllLeaveDays)}日
              </div>
              {totalAllLeaveHours > 0 ? (
                <div className="text-[11px] text-muted-foreground">
                  ほか {formatCount(totalAllLeaveHours)}時間
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  全13種別の合算
                </div>
              )}
            </div>
            <div className="rounded-xl border bg-muted/30 p-3 text-center">
              <div className="text-xs text-muted-foreground">有給休暇</div>
              <div className="text-2xl font-bold text-foreground">
                {formatCount(
                  leaveSummary.find((l) => l.field === "有休 日数")?.totalDays ?? 0,
                )}日
              </div>
              <div className="text-[11px] text-muted-foreground">有休日数</div>
            </div>
            <div className="rounded-xl border bg-amber-50/50 dark:bg-amber-950/20 p-3 text-center">
              <div className="text-xs text-muted-foreground">夏季休暇</div>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {formatCount(
                  leaveSummary.find((l) => l.field === "夏季休暇 日数")?.totalDays ?? 0,
                )}日
              </div>
              <div className="text-[11px] text-muted-foreground">7〜10月対象</div>
            </div>
            <div className="rounded-xl border bg-emerald-50/50 dark:bg-emerald-950/20 p-3 text-center">
              <div className="text-xs text-muted-foreground">出勤日数</div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatCount(totalWeekdayWork + totalHolidayWork)}日
              </div>
              <div className="text-[11px] text-muted-foreground">
                平日 {formatCount(totalWeekdayWork)} / 休日 {formatCount(totalHolidayWork)}
              </div>
            </div>
          </div>

          {/* Breakdown by Leave Type Table */}
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="border-b bg-muted/20 px-4 py-2.5 font-semibold text-sm flex items-center justify-between">
              <span>休暇種別ごとの月別内訳</span>
              <span className="text-xs text-muted-foreground font-normal">
                取得実績のある休暇項目（日数 / 時間）
              </span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 text-xs">
                    <TableHead className="min-w-28 font-semibold">休暇種別</TableHead>
                    <TableHead className="min-w-20 text-center font-semibold border-r">年間合計</TableHead>
                    {rows.map((r) => (
                      <TableHead key={r.month.targetMonth} className="text-center px-1 text-[11px] min-w-11">
                        {r.month.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usedLeaves.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={14} className="h-20 text-center text-xs text-muted-foreground">
                        この事業期に取得された休暇データはありません。
                      </TableCell>
                    </TableRow>
                  ) : (
                    usedLeaves.map((leave) => (
                      <TableRow key={leave.field} className="hover:bg-muted/30 text-xs">
                        <TableCell className="font-medium text-foreground">
                          {leave.cleanLabel}
                        </TableCell>
                        <TableCell className="text-center font-bold tabular-nums text-blue-600 dark:text-blue-400 border-r">
                          {formatCount(leave.totalDays)}日
                          {leave.totalHours > 0 && (
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              {formatCount(leave.totalHours)}h
                            </span>
                          )}
                        </TableCell>
                        {leave.monthlyData.map((m) => (
                          <TableCell key={m.month.targetMonth} className="text-center tabular-nums p-1 text-[11px]">
                            {m.days > 0 ? (
                              <span className="font-semibold text-foreground">
                                {formatCount(m.days)}
                              </span>
                            ) : m.hours > 0 ? (
                              <span className="text-[10px] text-muted-foreground">
                                {formatCount(m.hours)}h
                              </span>
                            ) : (
                              <span className="text-muted-foreground/30">―</span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Monthly detailed cards */}
          <div className="rounded-xl border bg-card p-4 space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground">月別勤怠状況</h4>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 text-xs">
              {rows.map(({ month, attendance: att }) => {
                if (!att) {
                  return (
                    <div key={month.targetMonth} className="rounded-lg border bg-muted/10 p-2 text-center">
                      <div className="font-medium text-muted-foreground">{month.label}</div>
                      <div className="text-[10px] text-muted-foreground/60 mt-1">未登録 / 在籍外</div>
                    </div>
                  );
                }
                const monthLeaveTotal = sumLeaveDays(att);
                return (
                  <div key={month.targetMonth} className="rounded-lg border bg-background p-2 text-center shadow-xs">
                    <div className="font-bold text-foreground">{month.label}</div>
                    <div className="mt-1 text-sm font-semibold text-blue-600 dark:text-blue-400">
                      休暇 {formatCount(monthLeaveTotal)}日
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      出勤 {att.weekdayAttendanceDays + att.holidayAttendanceDays}日
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OvertimeDetailDialog({
  data,
  period,
  onClose,
}: {
  data: {
    employee: Employee;
    rows: { month: FiscalMonth; attendance?: DashboardAttendance }[];
  } | null;
  period: number;
  onClose: () => void;
}) {
  if (!data) return null;
  const { employee, rows } = data;
  const rangeLabel = getPeriodRangeLabel(period);

  const registeredRows = rows.filter(
    (
      r,
    ): r is { month: FiscalMonth; attendance: DashboardAttendance } =>
      Boolean(r.attendance),
  );

  const totalOvertime = registeredRows.reduce(
    (sum, r) => sum + r.attendance.overtimeHours,
    0,
  );
  const totalWeekdayOvertime = registeredRows.reduce(
    (sum, r) => sum + getWeekdayOvertimeHours(r.attendance),
    0,
  );
  const totalHolidayOvertime = registeredRows.reduce(
    (sum, r) => sum + getHolidayOvertimeHours(r.attendance),
    0,
  );
  const totalWorkHours = registeredRows.reduce(
    (sum, r) => sum + r.attendance.totalWorkHours,
    0,
  );
  const totalScheduledHours = registeredRows.reduce(
    (sum, r) => sum + r.attendance.scheduledHours,
    0,
  );
  const totalBreakHours = registeredRows.reduce(
    (sum, r) => sum + r.attendance.breakHours,
    0,
  );
  const totalLateCount = registeredRows.reduce(
    (sum, r) => sum + r.attendance.lateCount,
    0,
  );
  const totalEarlyCount = registeredRows.reduce(
    (sum, r) => sum + r.attendance.earlyLeaveCount,
    0,
  );
  const countOver45 = registeredRows.filter(
    (r) => r.attendance.overtimeHours >= 45,
  ).length;
  const countOver30 = registeredRows.filter(
    (r) =>
      r.attendance.overtimeHours >= 30 && r.attendance.overtimeHours < 45,
  ).length;
  const avgMonthlyOvertime = registeredRows.length
    ? totalOvertime / registeredRows.length
    : 0;

  return (
    <Dialog open={Boolean(data)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-amber-500 p-2 text-white">
              <Clock className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">
                {employee.employeeCode} {employee.surname} の残業・労働時間詳細
              </DialogTitle>
              <DialogDescription>
                第{period}期（{rangeLabel}） / {employee.department || "部署未設定"} / {employee.employmentType || "雇用区分未設定"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border bg-amber-50/50 dark:bg-amber-950/20 p-3 text-center">
              <div className="text-xs text-muted-foreground">年間残業合計</div>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {formatCount(totalOvertime)}h
              </div>
              <div className="text-[11px] text-muted-foreground font-medium">
                平日 {formatCount(totalWeekdayOvertime)}h / 休日 {formatCount(totalHolidayOvertime)}h
              </div>
              <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                月平均: {formatCount(avgMonthlyOvertime)}h
              </div>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3 text-center">
              <div className="text-xs text-muted-foreground">年間総労働時間</div>
              <div className="text-2xl font-bold text-foreground">
                {formatCount(totalWorkHours)}h
              </div>
              <div className="text-[11px] text-muted-foreground">
                所定: {formatCount(totalScheduledHours)}h
              </div>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3 text-center">
              <div className="text-xs text-muted-foreground">残業アラート</div>
              <div className="text-xl font-bold text-foreground flex flex-wrap items-center justify-center gap-1 mt-0.5">
                {countOver45 > 0 && (
                  <span className="text-red-600 dark:text-red-400 text-sm font-bold">
                    45h超: {countOver45}回
                  </span>
                )}
                {countOver30 > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 text-sm font-semibold">
                    30h超: {countOver30}回
                  </span>
                )}
                {countOver45 === 0 && countOver30 === 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                    基準内 (0回)
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">
                30h超 / 45h超 月数
              </div>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3 text-center">
              <div className="text-xs text-muted-foreground">遅刻・早退</div>
              <div className="text-2xl font-bold text-foreground">
                {totalLateCount + totalEarlyCount}回
              </div>
              <div className="text-[11px] text-muted-foreground">
                遅刻 {totalLateCount}回 / 早退 {totalEarlyCount}回
              </div>
            </div>
          </div>

          {/* Monthly Breakdown Table */}
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="border-b bg-muted/20 px-4 py-2.5 font-semibold text-sm flex items-center justify-between">
              <span>月別勤怠・労働時間内訳</span>
              <span className="text-xs text-muted-foreground font-normal">
                7月〜翌年6月
              </span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 text-xs">
                    <TableHead className="font-semibold min-w-16">対象月</TableHead>
                    <TableHead className="text-center font-semibold min-w-28">
                      <div>残業時間</div>
                      <div className="mt-1 grid grid-cols-2 border-t border-border/60 pt-0.5 text-[10px] font-normal text-muted-foreground">
                        <span>平日</span>
                        <span>休日</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center font-semibold min-w-20">所定時間</TableHead>
                    <TableHead className="text-center font-semibold min-w-20">総労働時間</TableHead>
                    <TableHead className="text-center font-semibold min-w-16">休憩</TableHead>
                    <TableHead className="text-center font-semibold min-w-20">出勤日数</TableHead>
                    <TableHead className="text-center font-semibold min-w-20">遅刻・早退</TableHead>
                    <TableHead className="text-center font-semibold min-w-24">確認事項</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ month, attendance: att }) => {
                    if (!att) {
                      return (
                        <TableRow key={month.targetMonth} className="text-xs text-muted-foreground bg-muted/10">
                          <TableCell className="font-medium">{month.label}</TableCell>
                          <TableCell colSpan={7} className="text-center text-[11px] text-muted-foreground/60 py-2">
                            未登録 / 在籍外
                          </TableCell>
                        </TableRow>
                      );
                    }
                    const isOver45 = att.overtimeHours >= 45;
                    const isOver30 = att.overtimeHours >= 30 && !isOver45;
                    const weekdayOt = getWeekdayOvertimeHours(att);
                    const holidayOt = getHolidayOvertimeHours(att);
                    return (
                      <TableRow key={month.targetMonth} className="hover:bg-muted/30 text-xs">
                        <TableCell className="font-semibold text-foreground">
                          {month.label}
                        </TableCell>
                        <TableCell className="p-1 text-center align-middle">
                          <div className="flex flex-col items-center justify-center rounded py-1">
                            <span
                              className={cn(
                                "inline-block px-2 py-0.5 rounded text-sm font-bold tabular-nums",
                                isOver45
                                  ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                                  : isOver30
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                                    : att.overtimeHours > 0
                                      ? "text-foreground font-semibold"
                                      : "text-muted-foreground/60",
                              )}
                            >
                              {formatCount(att.overtimeHours)}h
                            </span>
                            <div className="mt-0.5 grid w-full grid-cols-2 border-t border-dashed border-border/70 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
                              <span
                                className="border-r border-dashed border-border/60 font-medium text-foreground"
                                title="平日残業時間"
                              >
                                {formatCount(weekdayOt)}h
                              </span>
                              <span
                                className={cn(
                                  "font-medium",
                                  holidayOt > 0
                                    ? "text-orange-600 dark:text-orange-400 font-semibold"
                                    : "text-muted-foreground/60",
                                )}
                                title="休日残業・労働時間"
                              >
                                {formatCount(holidayOt)}h
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-muted-foreground">
                          {formatCount(att.scheduledHours)}h
                        </TableCell>
                        <TableCell className="text-center tabular-nums font-semibold text-foreground">
                          {formatCount(att.totalWorkHours)}h
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-muted-foreground">
                          {formatCount(att.breakHours)}h
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {att.weekdayAttendanceDays + att.holidayAttendanceDays}日
                          {att.holidayAttendanceDays > 0 && (
                            <span className="text-[10px] text-orange-600 block">
                              (休出 {att.holidayAttendanceDays}日)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {att.lateCount === 0 && att.earlyLeaveCount === 0 ? (
                            <span className="text-muted-foreground/40">―</span>
                          ) : (
                            <span className="text-orange-600 font-medium">
                              {att.lateCount > 0 && `遅${att.lateCount}`}
                              {att.lateCount > 0 && att.earlyLeaveCount > 0 && " / "}
                              {att.earlyLeaveCount > 0 && `早${att.earlyLeaveCount}`}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {att.warnings.length > 0 ? (
                            <div className="flex flex-wrap items-center justify-center gap-1">
                              {att.warnings.map((w) => (
                                <Badge
                                  key={w}
                                  variant="outline"
                                  className="text-[10px] px-1 py-0 border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
                                >
                                  {warningLabels[w] || w}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/30 text-[11px]">特記事項なし</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({
  detail,
  onClose,
}: {
  detail: DashboardAttendance | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(detail)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {detail && (
          <>
            <DialogHeader>
              <DialogTitle>
                {detail.employeeCode} {detail.surname}・{detail.targetMonth}
              </DialogTitle>
              <DialogDescription>
                {detail.department} / {detail.employmentType}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="所定時間" value={`${detail.scheduledHours}h`} />
              <Metric label="残業時間" value={`${detail.overtimeHours}h`} />
              <Metric label="休憩時間" value={`${detail.breakHours}h`} />
              <Metric label="労働合計" value={`${detail.totalWorkHours}h`} />
              <Metric
                label="有休"
                value={`${detail.leaves["有休 日数"].days}日 ${detail.leaves["有休 日数"].hours}h`}
              />
              <Metric
                label="休日出勤"
                value={`${detail.holidayAttendanceDays}日`}
              />
            </div>
            {detail.warnings.length > 0 && (
              <Alert className="border-orange-200 bg-orange-50">
                <AlertCircle />
                <AlertTitle>要確認</AlertTitle>
                <AlertDescription>
                  {detail.warnings
                    .map((warning) => warningLabels[warning])
                    .join("、")}
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmployeeDialog({
  employee,
  onClose,
  onSaved,
}: {
  employee: Employee | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isPartTime = Boolean(
    employee?.employmentType?.includes("アルバイト"),
  );
  const [form, setForm] = useState({
    surname: employee?.surname ?? "",
    isJunior: isPartTime ? false : (employee?.isJunior ?? false),
    paidLeaveCycleStartMonth: employee?.paidLeaveCycleStartMonth ?? 10,
    startMonth: employee?.startMonth ?? "",
    endMonth: employee?.endMonth ?? "",
  });
  const [error, setError] = useState("");
  async function save() {
    if (!employee) return;
    setError("");
    const response = await fetch(
      `/api/employees/${encodeURIComponent(employee.employeeCode)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surname: form.surname,
          isJunior: isPartTime ? false : form.isJunior,
          paidLeaveCycleStartMonth: form.paidLeaveCycleStartMonth,
          startMonth: form.startMonth,
          endMonth: form.endMonth || null,
        }),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "更新できませんでした。");
      return;
    }
    await onSaved();
    onClose();
  }
  return (
    <Dialog
      open={Boolean(employee)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>社員マスタを編集</DialogTitle>
          <DialogDescription>
            {employee?.employeeCode}（{employee?.employmentType}）の苗字、区分、在籍期間を変更します。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="surname">苗字</Label>
            <Input
              id="surname"
              className="mt-1"
              value={form.surname}
              onChange={(event) =>
                setForm({ ...form, surname: event.target.value })
              }
            />
          </div>
          {isPartTime ? (
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground bg-muted/20">
              雇用区分が「{employee?.employmentType}」のため、若手/一般区分の設定対象外（―）です。
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/20">
              <input
                id="isJunior"
                type="checkbox"
                className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                checked={form.isJunior}
                onChange={(event) =>
                  setForm({ ...form, isJunior: event.target.checked })
                }
              />
              <div className="text-sm">
                <Label htmlFor="isJunior" className="font-semibold cursor-pointer">
                  若手社員として登録
                </Label>
                <p className="text-xs text-muted-foreground">
                  チェックを入れると「若手社員」として集計・区分されます。
                </p>
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="paid-leave-cycle">有休取得期間の起算月</Label>
            <select
              id="paid-leave-cycle"
              className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-sm"
              value={form.paidLeaveCycleStartMonth}
              onChange={(event) =>
                setForm({
                  ...form,
                  paidLeaveCycleStartMonth: Number(event.target.value) as 4 | 10,
                })
              }
            >
              <option value={10}>10月起算（10月1日〜翌年9月30日）</option>
              <option value={4}>4月起算（4月1日〜翌年3月31日）</option>
            </select>
          </div>
          <div>
            <Label htmlFor="start">在籍開始月</Label>
            <Input
              id="start"
              type="month"
              className="mt-1"
              value={form.startMonth}
              onChange={(event) =>
                setForm({ ...form, startMonth: event.target.value })
              }
            />
          </div>
          <div>
            <Label htmlFor="end">在籍終了月（空欄は在籍中）</Label>
            <Input
              id="end"
              type="month"
              className="mt-1"
              value={form.endMonth}
              onChange={(event) =>
                setForm({ ...form, endMonth: event.target.value })
              }
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
