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
    throw new ApiAuthError(403);
}
type AllowedUser = { oid: string; email: string };
type Config = { users: AllowedUser[]; emails: string[]; clientId: string };
export class ApiAuthError extends Error {
  constructor(public status: number) {
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
    throw new ApiAuthError(503);
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
    if (
      payload.tid !== ATTENDANCE_API_TENANT_ID ||
      payload.ver !== "2.0" ||
      typeof payload.oid !== "string" ||
      payload.idtyp === "app"
    )
      throw new Error();
  } catch {
    throw new ApiAuthError(401);
  }
  if (
    (payload.azp !== config.clientId &&
      payload.azp !== COMPANY_REPORT_CLIENT_ID) ||
    typeof payload.scp !== "string" ||
    !payload.scp.split(" ").includes("attendance.access")
  )
    throw new ApiAuthError(403);
  const user = config.users.find(
    (user) => user.oid.toLowerCase() === String(payload.oid).toLowerCase(),
  );
  // Email is only a migration bound on the administrator-maintained mapping, never a token identity claim.
  if (
    !user ||
    (!config.emails.includes("*") &&
      !config.emails.includes(user.email.trim().toLowerCase()))
  )
    throw new ApiAuthError(403);
  enforceClientAccess(payload.azp, String(payload.oid), request);
  return { oid: user.oid, email: user.email };
}
export async function authorizeApi(request: Request): Promise<Response | null> {
  try {
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.get("authorization") ?? "",
    );
    if (!match) throw new ApiAuthError(401);
    await verifyAttendanceToken(
      match[1],
      readAuthorizationConfig(),
      keys,
      request,
    );
    return null;
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : 503;
    return Response.json(
      {
        error:
          status === 401
            ? "Authentication required"
            : status === 403
              ? "Access denied"
              : "API authorization unavailable",
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
