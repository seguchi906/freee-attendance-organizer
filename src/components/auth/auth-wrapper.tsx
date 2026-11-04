"use client";
import {
  apiFetch,
  clearApiSession,
  onApiSessionInvalidated,
  setApiTokenProvider,
} from "@/lib/api-client";
import { ATTENDANCE_API_SCOPE } from "@/lib/api-access-token";
import {
  createAuthDiagnostic,
  readSafeServerDiagnosticCode,
  safeMsalErrorCode,
  type AuthDiagnostic,
} from "@/lib/auth-diagnostics";

import { useEffect, useState, type ReactNode } from "react";
import { InteractionStatus } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import {
  allowedAuthEmailsConfig,
  loginRequest,
  portalOriginsConfig,
  silentRequest,
} from "@/components/auth/auth-config";
import { AuthMessageScreen } from "@/components/auth/auth-screen";
import { AuthDiagnosticDetails } from "@/components/auth/auth-diagnostic";
import {
  findAllowedEmail,
  getAccountEmailCandidates,
  getAllowedPortalOrigins,
  parseCommaSeparated,
} from "@/lib/auth";

type GateState =
  | { status: "loading" }
  | {
      status: "authenticated";
      email: string;
      name?: string;
      accountId?: string;
    }
  | { status: "unauthenticated" }
  | { status: "forbidden"; candidates: string[] }
  | { status: "error"; message: string; diagnostic?: AuthDiagnostic };

const allowedEmails = parseCommaSeparated(allowedAuthEmailsConfig);

function AuthStateView({
  state,
  onLogin,
  children,
}: {
  state: GateState;
  onLogin?: () => void;
  children: ReactNode;
}) {
  if (state.status === "authenticated") return <>{children}</>;
  if (state.status === "loading") return <AuthMessageScreen mode="loading" />;
  if (state.status === "unauthenticated") {
    return (
      <AuthMessageScreen
        mode="login"
        title="freee 勤怠データ整理"
        message="利用を開始するにはMicrosoftアカウントでサインインしてください。"
        action={
          <button
            type="button"
            onClick={onLogin}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-700"
          >
            Microsoftでサインイン
          </button>
        }
      />
    );
  }
  if (state.status === "forbidden") {
    return (
      <AuthMessageScreen
        mode="forbidden"
        title="アプリを表示できません"
        message="ログインユーザーはこのアプリの利用が許可されていません。"
        details={
          <div className="space-y-2 rounded-xl border bg-slate-50 p-4 text-xs leading-5">
            <p>
              <span className="text-slate-500">判定対象メール：</span>
              {state.candidates.join(", ") || "（なし）"}
            </p>
            <p>
              <span className="text-slate-500">現在の許可設定：</span>
              {allowedAuthEmailsConfig}
            </p>
          </div>
        }
      />
    );
  }
  return (
    <AuthMessageScreen
      mode="error"
      title="認証情報を確認できませんでした"
      message={state.message}
      details={
        state.diagnostic ? (
          <AuthDiagnosticDetails diagnostic={state.diagnostic} />
        ) : undefined
      }
      action={
        onLogin ? (
          <button
            type="button"
            onClick={onLogin}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-700"
          >
            Microsoftで再ログイン
          </button>
        ) : undefined
      }
    />
  );
}

export function PortalAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    const origins = getAllowedPortalOrigins(
      portalOriginsConfig,
      process.env.NODE_ENV !== "production",
    );
    const requests = new Map<
      string,
      {
        resolve: (token: { accessToken: string; expiresAt: number }) => void;
        reject: (error: Error) => void;
        timer: number;
      }
    >();
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !origins.includes(event.origin))
        return;
      if (event.data?.type === "ATTENDANCE_LOGOUT") {
        clearApiSession();
        return;
      }
      if (
        !["ATTENDANCE_TOKEN", "ATTENDANCE_TOKEN_ERROR"].includes(
          event.data?.type,
        )
      )
        return;
      const request = requests.get(event.data.requestId);
      if (!request) return;
      requests.delete(event.data.requestId);
      window.clearTimeout(request.timer);
      if (
        event.data.type === "ATTENDANCE_TOKEN" &&
        typeof event.data.accessToken === "string" &&
        typeof event.data.expiresAt === "number"
      )
        request.resolve({
          accessToken: event.data.accessToken,
          expiresAt: event.data.expiresAt,
        });
      else
        request.reject(
          new Error(
            "ポータルでAPI認証を更新できませんでした。再ログインしてください。",
          ),
        );
    };
    window.addEventListener("message", handleMessage);
    const unsubscribe = onApiSessionInvalidated(() => {
      if (active)
        setState({
          status: "error",
          message:
            "API認証が失効しました。ポータルで再ログインしてください。操作は自動再送していません。",
        });
    });
    setApiTokenProvider(
      () =>
        new Promise((resolve, reject) => {
          const requestId = crypto.randomUUID();
          const timer = window.setTimeout(() => {
            requests.delete(requestId);
            reject(new Error("ポータルからAPI認証を取得できませんでした。"));
          }, 10000);
          requests.set(requestId, { resolve, reject, timer });
          for (const origin of origins)
            window.parent.postMessage(
              { type: "ATTENDANCE_TOKEN_REQUEST", requestId },
              origin,
            );
        }),
    );
    void apiFetch("/api/session")
      .then((response) => {
        if (!active) return;
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? "勤怠管理の利用が許可されていません。"
              : "API認証を確認できませんでした。管理者に設定を確認してください。",
          );
        setState({ status: "authenticated", email: "" });
      })
      .catch((error) => {
        if (active) setState({ status: "error", message: error.message });
      });
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("message", handleMessage);
      for (const request of requests.values()) {
        window.clearTimeout(request.timer);
        request.reject(new Error("API session ended"));
      }
      requests.clear();
      setApiTokenProvider(null);
      clearApiSession();
    };
  }, []);
  return <AuthStateView state={state}>{children}</AuthStateView>;
}

export function DirectAuthGate({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const [state, setState] = useState<GateState>({ status: "loading" });
  useEffect(() => {
    if (inProgress !== InteractionStatus.None) return;
    let active = true;
    let diagnostic = createAuthDiagnostic(
      process.env.NODE_ENV,
      "api_session_request",
      null,
      "api_request_failed",
    );
    const unsubscribe = onApiSessionInvalidated(() => {
      if (active)
        setState({
          status: "error",
          message:
            "API認証が失効しました。再ログインしてください。操作は自動再送していません。",
        });
    });
    setApiTokenProvider(async () => {
      const account =
        instance.getActiveAccount() ??
        accounts[0] ??
        instance.getAllAccounts()[0];
      if (!account) {
        diagnostic = createAuthDiagnostic(
          process.env.NODE_ENV,
          "api_token_acquisition",
          null,
          "account_not_available",
        );
        throw new Error("Microsoft login required");
      }
      let result;
      try {
        result = await instance.acquireTokenSilent({
          scopes: [ATTENDANCE_API_SCOPE],
          account,
        });
      } catch (error) {
        diagnostic = createAuthDiagnostic(
          process.env.NODE_ENV,
          "api_token_acquisition",
          null,
          safeMsalErrorCode(error),
        );
        throw error;
      }
      if (
        !active ||
        (instance.getActiveAccount() ?? instance.getAllAccounts()[0])
          ?.homeAccountId !== account.homeAccountId
      ) {
        diagnostic = createAuthDiagnostic(
          process.env.NODE_ENV,
          "api_token_acquisition",
          null,
          "account_context_changed",
        );
        throw new Error("API session changed");
      }
      const expiresAt = result.expiresOn?.getTime() ?? 0;
      if (!result.accessToken || expiresAt <= Date.now() + 60000) {
        diagnostic = createAuthDiagnostic(
          process.env.NODE_ENV,
          "api_token_acquisition",
          null,
          "api_token_unusable",
        );
      } else {
        diagnostic = createAuthDiagnostic(
          process.env.NODE_ENV,
          "api_session_request",
          null,
          "api_request_failed",
        );
      }
      return {
        accessToken: result.accessToken,
        expiresAt,
      };
    });
    void (async () => {
      let account =
        instance.getActiveAccount() ??
        accounts[0] ??
        instance.getAllAccounts()[0];
      if (!account) {
        try {
          const result = await instance.ssoSilent({
            ...silentRequest,
            scopes: [ATTENDANCE_API_SCOPE],
          });
          if (!active || !result.account) return;
          account = result.account;
        } catch {
          if (active) setState({ status: "unauthenticated" });
          return;
        }
      }
      if (!active) return;
      instance.setActiveAccount(account);
      const candidates = getAccountEmailCandidates(account);
      const email = findAllowedEmail(candidates, allowedEmails);
      if (!email) {
        setState({ status: "forbidden", candidates });
        return;
      }
      try {
        const response = await apiFetch("/api/session");
        if (!active) return;
        if (!response.ok) {
          const serverCode =
            process.env.NODE_ENV === "development"
              ? await readSafeServerDiagnosticCode(response)
              : undefined;
          diagnostic = createAuthDiagnostic(
            process.env.NODE_ENV,
            "api_session_response",
            response.status,
            serverCode,
          );
          throw new Error(
            "API認証または利用権限を確認できませんでした。管理者に設定を確認してください。",
          );
        }
        setState({
          status: "authenticated",
          email,
          name: account.name,
          accountId: account.homeAccountId,
        });
      } catch {
        if (active)
          setState({
            status: "error",
            message:
              "API認証を取得できませんでした。再ログインするか管理者に確認してください。",
            diagnostic,
          });
      }
    })();
    return () => {
      active = false;
      unsubscribe();
      setApiTokenProvider(null);
      clearApiSession();
    };
  }, [accounts, inProgress, instance]);
  const login = () => {
    clearApiSession();
    void instance
      .loginRedirect({
        ...loginRequest,
        scopes: [ATTENDANCE_API_SCOPE],
        prompt: "login",
      })
      .catch(() => {
        setState({
          status: "error",
          message: "Microsoftログインを開始できませんでした。",
        });
      });
  };
  return (
    <AuthStateView
      state={
        inProgress !== InteractionStatus.None ||
        (state.status === "authenticated" &&
          state.accountId !==
            (instance.getActiveAccount() ?? accounts[0])?.homeAccountId)
          ? { status: "loading" }
          : state
      }
      onLogin={login}
    >
      {children}
    </AuthStateView>
  );
}
