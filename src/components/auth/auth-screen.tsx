import type { ReactNode } from "react";

export function AuthMessageScreen({
  mode,
  title,
  message,
  details,
  action,
}: {
  mode: "loading" | "error" | "forbidden" | "login";
  title?: string;
  message?: string;
  details?: ReactNode;
  action?: ReactNode;
}) {
  const isWarning = mode === "forbidden";
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
      <section className="w-full max-w-lg rounded-2xl border bg-white p-8 shadow-sm">
        {mode === "loading" ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="size-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-600">認証状態を確認しています…</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div
              className={`mx-auto flex size-14 items-center justify-center rounded-2xl text-2xl font-bold ${
                isWarning
                  ? "bg-amber-100 text-amber-700"
                  : mode === "login"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-red-100 text-red-700"
              }`}
            >
              {mode === "login" ? "M" : isWarning ? "×" : "!"}
            </div>
            <div className="space-y-2 text-center">
              <h1 className="text-xl font-semibold">{title}</h1>
              {message && <p className="text-sm leading-6 text-slate-600">{message}</p>}
            </div>
            {details}
            {action}
          </div>
        )}
      </section>
    </main>
  );
}
