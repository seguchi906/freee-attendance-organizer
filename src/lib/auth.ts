import type { AccountInfo } from "@azure/msal-browser";

export function parseCommaSeparated(value: string | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function getAccountEmailCandidates(account: AccountInfo): string[] {
  const claims = account.idTokenClaims as Record<string, unknown> | undefined;
  const candidates = [
    account.username,
    claims?.preferred_username,
    claims?.email,
    claims?.upn,
    claims?.login_hint,
  ];

  return Array.from(
    new Set(
      candidates
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function findAllowedEmail(
  candidates: string[],
  allowedEmails: string[],
): string | null {
  const normalizedCandidates = candidates.map((email) =>
    email.trim().toLowerCase(),
  );
  if (allowedEmails.includes("*")) return normalizedCandidates[0] ?? null;
  return (
    normalizedCandidates.find((email) => allowedEmails.includes(email)) ?? null
  );
}

export function getAllowedPortalOrigins(
  configuredOrigins: string | undefined,
  isDevelopment: boolean,
): string[] {
  const origins = [
    ...parseCommaSeparated(configuredOrigins),
    "https://n-app-portal.netlify.app",
    ...(isDevelopment ? ["http://localhost:5173"] : []),
  ];
  return Array.from(new Set(origins));
}

export function isTrustedPortalMessage(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  parentWindow: Window,
  allowedOrigins: string[],
): event is Pick<MessageEvent, "origin" | "source" | "data"> & {
  data: { type: "AUTH_HINT"; loginHint: string; name?: string; idToken?: string };
} {
  return (
    event.source === parentWindow &&
    allowedOrigins.includes(event.origin.toLowerCase()) &&
    event.data?.type === "AUTH_HINT" &&
    typeof event.data.loginHint === "string" &&
    Boolean(event.data.loginHint.trim())
  );
}
