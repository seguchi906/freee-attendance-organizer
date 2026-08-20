"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { MsalProvider } from "@azure/msal-react";
import {
  allowedAuthEmailsConfig,
  microsoftClientId,
  microsoftTenantId,
} from "@/components/auth/auth-config";
import { DirectAuthGate, PortalAuthGate } from "@/components/auth/auth-wrapper";
import { msalInstance } from "@/components/auth/msal-instance";
import { AuthMessageScreen } from "@/components/auth/auth-screen";

export function AuthProvider({ children }: { children: ReactNode }) {
  const isInIframe = useSyncExternalStore<boolean | null>(
    () => () => undefined,
    () => window.self !== window.top,
    () => null,
  );

  if (isInIframe === null) {
    return <AuthMessageScreen mode="loading" />;
  }
  if (!microsoftClientId || !microsoftTenantId) {
    return (
      <AuthMessageScreen
        mode="error"
        title="Microsoftログイン設定が不足しています"
        message="NEXT_PUBLIC_MSAL_CLIENT_ID または NEXT_PUBLIC_MSAL_TENANT_ID が設定されていません。"
      />
    );
  }
  if (!allowedAuthEmailsConfig) {
    return (
      <AuthMessageScreen
        mode="error"
        title="ログイン制限設定が不足しています"
        message="NEXT_PUBLIC_ALLOWED_AUTH_EMAILS に許可するメールアドレスを設定してください。"
      />
    );
  }
  if (isInIframe) {
    return <PortalAuthGate>{children}</PortalAuthGate>;
  }
  return (
    <MsalProvider instance={msalInstance}>
      <DirectAuthGate>{children}</DirectAuthGate>
    </MsalProvider>
  );
}
