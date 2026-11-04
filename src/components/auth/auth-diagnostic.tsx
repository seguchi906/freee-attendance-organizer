import type { AuthDiagnostic } from "@/lib/auth-diagnostics";

export function AuthDiagnosticDetails({
  diagnostic,
}: {
  diagnostic: AuthDiagnostic;
}) {
  return (
    <section
      aria-label="開発用認証診断"
      className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-xs text-slate-700"
      data-testid="auth-diagnostic"
    >
      <p>段階: {diagnostic.stage}</p>
      <p>HTTP status: {diagnostic.httpStatus ?? "なし"}</p>
      <p>Error code: {diagnostic.errorCode}</p>
    </section>
  );
}
