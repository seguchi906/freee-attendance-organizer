"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { InteractionStatus, type AuthenticationResult } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import {
  allowedAuthEmailsConfig,
  loginRequest,
  portalOriginsConfig,
  silentRequest,
} from "@/components/auth/auth-config";
import { AuthMessageScreen } from "@/components/auth/auth-screen";
import {
  findAllowedEmail,
  getAccountEmailCandidates,
  getAllowedPortalOrigins,
  isTrustedPortalMessage,
  parseCommaSeparated,
} from "@/lib/auth";

type GateState =
  | { status: "loading" }
  | { status: "authenticated"; email: string; name?: string }
  | { status: "unauthenticated" }
  | { status: "forbidden"; candidates: string[] }
  | { status: "error"; message: string };

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
            <p><span className="text-slate-500">判定対象メール：</span>{state.candidates.join(", ") || "（なし）"}</p>
            <p><span className="text-slate-500">現在の許可設定：</span>{allowedAuthEmailsConfig}</p>
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
    />
  );
}

export function PortalAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "loading" });

  useEffect(() => {
    let received = false;
    const origins = getAllowedPortalOrigins(
      portalOriginsConfig,
      process.env.NODE_ENV !== "production",
    );
    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedPortalMessage(event, window.parent, origins)) return;
      received = true;
      const loginHint = event.data.loginHint.trim().toLowerCase();
      const allowedEmail = findAllowedEmail([loginHint], allowedEmails);
      setState(
        allowedEmail
          ? { status: "authenticated", email: allowedEmail, name: event.data.name }
          : { status: "forbidden", candidates: [loginHint] },
      );
    };

    window.addEventListener("message", handleMessage);
    window.parent.postMessage({ type: "AUTH_HINT_REQUEST" }, "*");
    const timeoutId = window.setTimeout(() => {
      if (!received) {
        setState({
          status: "error",
          message:
            "ポータルから認証情報を取得できませんでした。ポータル側でログイン済みか確認してください。",
        });
      }
    }, 5000);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.clearTimeout(timeoutId);
    };
  }, []);

  return <AuthStateView state={state}>{children}</AuthStateView>;
}

export function DirectAuthGate({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const [state, setState] = useState<GateState>({ status: "loading" });
  const silentPromise = useRef<Promise<AuthenticationResult> | null>(null);

  useEffect(() => {
    if (inProgress !== InteractionStatus.None) return;
    let active = true;
    const account = instance.getActiveAccount() ?? accounts[0] ?? instance.getAllAccounts()[0];
    if (account) {
      instance.setActiveAccount(account);
      const candidates = getAccountEmailCandidates(account);
      const email = findAllowedEmail(candidates, allowedEmails);
      queueMicrotask(() => {
        if (!active) return;
        setState(
          email
            ? { status: "authenticated", email, name: account.name }
            : { status: "forbidden", candidates },
        );
      });
      return () => {
        active = false;
      };
    }

    if (!silentPromise.current) {
      silentPromise.current = Promise.race([
        instance.ssoSilent(silentRequest),
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("Microsoft silent authentication timed out")),
            5000,
          );
        }),
      ]);
    }
    void silentPromise.current
      .then((result) => {
        if (!active || !result.account) return;
        instance.setActiveAccount(result.account);
        const candidates = getAccountEmailCandidates(result.account);
        const email = findAllowedEmail(candidates, allowedEmails);
        setState(
          email
            ? { status: "authenticated", email, name: result.account.name }
            : { status: "forbidden", candidates },
        );
      })
      .catch(() => {
        if (active) setState({ status: "unauthenticated" });
      });
    return () => {
      active = false;
    };
  }, [accounts, inProgress, instance]);

  const login = () => {
    void instance.loginRedirect(loginRequest).catch(() => {
      setState({
        status: "error",
        message: "Microsoftログインを開始できませんでした。もう一度お試しください。",
      });
    });
  };

  return (
    <AuthStateView state={state} onLogin={login}>
      {children}
    </AuthStateView>
  );
}
