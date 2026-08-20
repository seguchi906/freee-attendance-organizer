import type {
  Configuration,
  RedirectRequest,
  SilentRequest,
} from "@azure/msal-browser";

export const microsoftClientId = process.env.NEXT_PUBLIC_MSAL_CLIENT_ID?.trim() ?? "";
export const microsoftTenantId = process.env.NEXT_PUBLIC_MSAL_TENANT_ID?.trim() ?? "";
export const allowedAuthEmailsConfig =
  process.env.NEXT_PUBLIC_ALLOWED_AUTH_EMAILS?.trim() ?? "";
export const portalOriginsConfig =
  process.env.NEXT_PUBLIC_PORTAL_ORIGINS?.trim() ?? "";

export const msalConfig: Configuration = {
  auth: {
    clientId: microsoftClientId,
    authority: `https://login.microsoftonline.com/${microsoftTenantId || "common"}`,
    redirectUri: typeof window === "undefined" ? "/" : window.location.origin,
    postLogoutRedirectUri:
      typeof window === "undefined" ? "/" : window.location.origin,
  },
  cache: { cacheLocation: "sessionStorage" },
};

export const loginRequest: RedirectRequest = {
  scopes: ["openid", "profile", "email", "User.Read"],
};

export const silentRequest: SilentRequest = {
  scopes: ["openid", "profile", "email", "User.Read"],
  redirectUri:
    typeof window === "undefined"
      ? undefined
      : `${window.location.origin}/redirect.html`,
};
