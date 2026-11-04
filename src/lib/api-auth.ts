import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import {
  ATTENDANCE_API_CLIENT_ID,
  ATTENDANCE_API_TENANT_ID,
} from "./api-access-token";
import { parseCommaSeparated } from "./auth";

const issuer = `https://login.microsoftonline.com/${ATTENDANCE_API_TENANT_ID}/v2.0`;
const keys = createRemoteJWKSet(
  new URL(
    `https://login.microsoftonline.com/${ATTENDANCE_API_TENANT_ID}/discovery/v2.0/keys`,
  ),
  { timeoutDuration: 5000 },
);
export const COMPANY_REPORT_CLIENT_ID = "20156efa-58be-4865-942c-6cd876a5488b";
const reportPaths = new Set([
  "/api/dashboard",
  "/api/vacation-summaries",
  "/api/paid-leave-compliance",
]);
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Call only after JWT verification: client and user restrictions are independent
// of the broader administrator-maintained attendance user mapping.
function enforceClientAccess(
  clientId: unknown,
  objectId: string,
  request?: Request,
) {
  if (clientId !== COMPANY_REPORT_CLIENT_ID) return;
  const configuredReportOid =
    process.env.COMPANY_REPORT_ALLOWED_OID?.trim() ?? "";
  if (
    !UUID_REGEX.test(configuredReportOid) ||
    objectId.toLowerCase() !== configuredReportOid.toLowerCase() ||
    !request ||
    request.method !== "GET" ||
    !reportPaths.has(new URL(request.url).pathname)
  )
    throw new ApiAuthError(403, "report_access_denied");
}
type AllowedUser = { oid: string; email: string };
type Config = { users: AllowedUser[]; emails: string[]; clientId: string };

export type ApiAuthDiagnosticCode =
  | "missing_bearer"
  | "expired"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "tenant_mismatch"
  | "token_version_mismatch"
  | "identity_claim_invalid"
  | "application_token_not_allowed"
  | "signature_invalid"
  | "jwks_fetch_failed"
  | "jwks_tls_error"
  | "jwks_timeout"
  | "jwks_response_invalid"
  | "jwks_invalid"
  | "jwks_key_not_found"
  | "jwks_multiple_keys"
  | "jwt_malformed"
  | "algorithm_not_allowed"
  | "unsupported_token"
  | "claim_validation_failed"
  | "authorization_denied"
  | "client_mismatch"
  | "scope_missing"
  | "user_not_allowed"
  | "report_access_denied"
  | "authorization_config_unavailable"
  | "unknown_validation_error";

const TLS_CAUSE_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);
const NETWORK_CAUSE_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function classifyJwtValidationError(
  error: unknown,
): ApiAuthDiagnosticCode {
  const code = getErrorCode(error);
  const claim =
    error && typeof error === "object" &&
    typeof (error as { claim?: unknown }).claim === "string"
      ? (error as { claim: string }).claim
      : undefined;

  if (code === "ERR_JWT_EXPIRED") return "expired";
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    if (claim === "iss") return "issuer_mismatch";
    if (claim === "aud") return "audience_mismatch";
    if (claim === "tid") return "tenant_mismatch";
    if (claim === "ver") return "token_version_mismatch";
    if (claim === "oid" || claim === "sub" || claim === "azp")
      return "identity_claim_invalid";
    return "claim_validation_failed";
  }
  if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED")
    return "signature_invalid";
  if (code === "ERR_JWKS_TIMEOUT") return "jwks_timeout";
  if (code === "ERR_JWKS_NO_MATCHING_KEY") return "jwks_key_not_found";
  if (code === "ERR_JWKS_MULTIPLE_MATCHING_KEYS") return "jwks_multiple_keys";
  if (code === "ERR_JWKS_INVALID" || code === "ERR_JWK_INVALID")
    return "jwks_invalid";
  if (code === "ERR_JOSE_GENERIC") return "jwks_response_invalid";
  if (code === "ERR_JWT_INVALID" || code === "ERR_JWS_INVALID")
    return "jwt_malformed";
  if (code === "ERR_JOSE_ALG_NOT_ALLOWED") return "algorithm_not_allowed";
  if (code === "ERR_JOSE_NOT_SUPPORTED") return "unsupported_token";

  const causeCode =
    error && typeof error === "object"
      ? getErrorCode((error as { cause?: unknown }).cause)
      : undefined;
  if (causeCode && TLS_CAUSE_CODES.has(causeCode)) return "jwks_tls_error";
  if (causeCode && NETWORK_CAUSE_CODES.has(causeCode))
    return "jwks_fetch_failed";
  return "unknown_validation_error";
}

export class ApiAuthError extends Error {
  constructor(
    public status: number,
    public diagnosticCode: ApiAuthDiagnosticCode =
      status === 503
        ? "authorization_config_unavailable"
        : "authorization_denied",
  ) {
    super(
      status === 401
        ? "Authentication required"
        : status === 403
          ? "Access denied"
          : "API authorization is not configured",
    );
  }
}
export function readAuthorizationConfig(): Config {
  try {
    const users: unknown = JSON.parse(
      process.env.ATTENDANCE_ALLOWED_USERS ?? "[]",
    );
    const emails = parseCommaSeparated(
      process.env.NEXT_PUBLIC_ALLOWED_AUTH_EMAILS,
    );
    const clientId = process.env.NEXT_PUBLIC_MSAL_CLIENT_ID?.trim() ?? "";
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      !Array.isArray(users) ||
      !users.length ||
      !emails.length ||
      !uuid.test(clientId) ||
      clientId === ATTENDANCE_API_CLIENT_ID ||
      users.some(
        (user) =>
          !user ||
          !uuid.test(user.oid) ||
          typeof user.email !== "string" ||
          (!emails.includes("*") &&
            !emails.includes(user.email.trim().toLowerCase())),
      )
    )
      throw new Error();
    return { users, emails, clientId };
  } catch {
    throw new ApiAuthError(503, "authorization_config_unavailable");
  }
}
export async function verifyAttendanceToken(
  token: string,
  config: Config,
  getKey: JWTVerifyGetKey = keys,
  request?: Request,
) {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, getKey, {
      algorithms: ["RS256"],
      issuer,
      audience: ATTENDANCE_API_CLIENT_ID,
      requiredClaims: ["exp", "iat", "nbf", "tid", "oid", "sub", "ver", "azp"],
    }));
  } catch (error) {
    throw new ApiAuthError(401, classifyJwtValidationError(error));
  }
  if (payload.tid !== ATTENDANCE_API_TENANT_ID)
    throw new ApiAuthError(401, "tenant_mismatch");
  if (payload.ver !== "2.0")
    throw new ApiAuthError(401, "token_version_mismatch");
  if (typeof payload.oid !== "string")
    throw new ApiAuthError(401, "identity_claim_invalid");
  if (payload.idtyp === "app")
    throw new ApiAuthError(401, "application_token_not_allowed");
  if (
    payload.azp !== config.clientId &&
    payload.azp !== COMPANY_REPORT_CLIENT_ID
  )
    throw new ApiAuthError(403, "client_mismatch");
  if (
    typeof payload.scp !== "string" ||
    !payload.scp.split(" ").includes("attendance.access")
  )
    throw new ApiAuthError(403, "scope_missing");
  const user = config.users.find(
    (user) => user.oid.toLowerCase() === String(payload.oid).toLowerCase(),
  );
  // Email is only a migration bound on the administrator-maintained mapping, never a token identity claim.
  if (
    !user ||
    (!config.emails.includes("*") &&
      !config.emails.includes(user.email.trim().toLowerCase()))
  )
    throw new ApiAuthError(403, "user_not_allowed");
  enforceClientAccess(payload.azp, String(payload.oid), request);
  return { oid: user.oid, email: user.email };
}
export async function authorizeApi(request: Request): Promise<Response | null> {
  try {
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.get("authorization") ?? "",
    );
    if (!match) throw new ApiAuthError(401, "missing_bearer");
    await verifyAttendanceToken(
      match[1],
      readAuthorizationConfig(),
      keys,
      request,
    );
    return null;
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : 503;
    const diagnosticCode =
      error instanceof ApiAuthError
        ? error.diagnosticCode
        : "unknown_validation_error";
    return Response.json(
      {
        error:
          status === 401
            ? "Authentication required"
            : status === 403
              ? "Access denied"
              : "API authorization unavailable",
        ...(process.env.NODE_ENV === "development"
          ? { diagnosticCode }
          : {}),
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
        },
      },
    );
  }
}
