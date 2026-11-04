export type AuthDiagnosticStage =
  | "api_token_acquisition"
  | "api_session_request"
  | "api_session_response";

export type AuthDiagnostic = {
  stage: AuthDiagnosticStage;
  httpStatus: number | null;
  errorCode: string;
};

const SAFE_MSAL_ERROR_CODES = new Set([
  "interaction_required",
  "consent_required",
  "login_required",
  "no_tokens_found",
  "token_refresh_required",
  "no_account_error",
  "no_network_connectivity",
  "monitor_window_timeout",
  "silent_sso_error",
  "invalid_grant",
  "invalid_scope",
  "unauthorized_client",
  "access_denied",
  "server_error",
  "temporarily_unavailable",
]);

const SAFE_DIAGNOSTIC_CODES = new Set([
  ...SAFE_MSAL_ERROR_CODES,
  "token_acquisition_failed",
  "account_not_available",
  "account_context_changed",
  "api_token_unusable",
  "api_request_failed",
  "api_unauthorized",
  "api_forbidden",
  "api_unavailable",
  "api_http_error",
  "missing_bearer",
  "expired",
  "issuer_mismatch",
  "audience_mismatch",
  "tenant_mismatch",
  "token_version_mismatch",
  "identity_claim_invalid",
  "application_token_not_allowed",
  "signature_invalid",
  "jwks_fetch_failed",
  "jwks_tls_error",
  "jwks_timeout",
  "jwks_response_invalid",
  "jwks_invalid",
  "jwks_key_not_found",
  "jwks_multiple_keys",
  "jwt_malformed",
  "algorithm_not_allowed",
  "unsupported_token",
  "claim_validation_failed",
  "authorization_denied",
  "client_mismatch",
  "scope_missing",
  "user_not_allowed",
  "report_access_denied",
  "authorization_config_unavailable",
  "unknown_validation_error",
]);

export function safeMsalErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "token_acquisition_failed";
  const value = (error as { errorCode?: unknown }).errorCode;
  if (typeof value !== "string") return "token_acquisition_failed";
  const code = value.toLowerCase();
  return SAFE_MSAL_ERROR_CODES.has(code) ? code : "token_acquisition_failed";
}

function responseErrorCode(status: number | null) {
  if (status === 401) return "api_unauthorized";
  if (status === 403) return "api_forbidden";
  if (status === 503) return "api_unavailable";
  return "api_http_error";
}

export function createAuthDiagnostic(
  environment: string | undefined,
  stage: AuthDiagnosticStage,
  httpStatus: number | null,
  errorCode?: string,
): AuthDiagnostic | undefined {
  if (environment !== "development") return undefined;

  const status =
    Number.isInteger(httpStatus) && httpStatus !== null && httpStatus >= 100 && httpStatus <= 599
      ? httpStatus
      : null;
  const fallback =
    stage === "api_token_acquisition"
      ? "token_acquisition_failed"
      : stage === "api_session_request"
        ? "api_request_failed"
        : responseErrorCode(status);
  const candidate = errorCode?.toLowerCase();

  return {
    stage,
    httpStatus: status,
    errorCode:
      candidate && SAFE_DIAGNOSTIC_CODES.has(candidate) ? candidate : fallback,
  };
}

export async function readSafeServerDiagnosticCode(response: Response) {
  try {
    const body: unknown = await response.clone().json();
    if (!body || typeof body !== "object") return undefined;
    const value = (body as { diagnosticCode?: unknown }).diagnosticCode;
    if (typeof value !== "string") return undefined;
    const code = value.toLowerCase();
    return SAFE_DIAGNOSTIC_CODES.has(code) ? code : undefined;
  } catch {
    return undefined;
  }
}
