// @vitest-environment node
import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
const state = vi.hoisted(() => ({
  publicKey: undefined as CryptoKey | undefined,
  getDb: vi.fn(() => {
    throw new Error("DB must not be reached");
  }),
}));
vi.mock("jose", async (original) => {
  const actual = await original<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: () => async () => {
      if (!state.publicKey) throw new Error();
      return state.publicKey;
    },
  };
});
vi.mock("@/db", () => ({ databaseConfigured: true, getDb: state.getDb }));
let bearer: string;
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
const attendanceUsers = [
  {
    oid: "00000000-0000-4000-8000-000000000011",
    email: "user1@example.com",
  },
  {
    oid: "00000000-0000-4000-8000-000000000012",
    email: "user2@example.com",
  },
  {
    oid: "00000000-0000-4000-8000-000000000013",
    email: "user3@example.com",
  },
  {
    oid: "00000000-0000-4000-8000-000000000014",
    email: "user4@example.com",
  },
  {
    oid: "00000000-0000-4000-8000-000000000015",
    email: "user5@example.com",
  },
  {
    oid: "00000000-0000-4000-8000-000000000016",
    email: "user6@example.com",
  },
];
async function signedBearer(clientId: string, objectId: string) {
  const tid = "691eddd6-0048-45f2-a4e6-ec7ce5828c4a";
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tid,
    oid: objectId,
    sub: "subject",
    ver: "2.0",
    azp: clientId,
    scp: "attendance.access",
    aud: "62d02c09-7d62-4216-bc2e-bc81b1d5afb7",
    iss: "https://login.microsoftonline.com/" + tid + "/v2.0",
    iat: now,
    nbf: now - 5,
    exp: now + 3600,
    email: attendanceUsers[0].email,
    login_hint: attendanceUsers[0].email,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(pair.privateKey);
}
function configureAllAttendanceUsers() {
  vi.stubEnv(
    "NEXT_PUBLIC_MSAL_CLIENT_ID",
    "3b2b5c62-16cc-42df-b275-e50c3084fb95",
  );
  vi.stubEnv(
    "NEXT_PUBLIC_ALLOWED_AUTH_EMAILS",
    attendanceUsers.map((user) => user.email).join(","),
  );
  vi.stubEnv("ATTENDANCE_ALLOWED_USERS", JSON.stringify(attendanceUsers));
  vi.stubEnv("COMPANY_REPORT_ALLOWED_OID", attendanceUsers[0].oid);
}
beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  state.publicKey = pair.publicKey;
  bearer = await signedBearer(
    "20156efa-58be-4865-942c-6cd876a5488b",
    attendanceUsers[0].oid,
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  state.getDb.mockClear();
});
const loaders = import.meta.glob("../app/api/**/route.ts");
it.each([
  ["session", "GET"],
  ["report-data", "GET"],
  ["overtime-summaries", "GET"],
  ["imports", "POST"],
  ["imports/validate", "POST"],
  ["employees/[employeeCode]", "PATCH"],
])("report client denied %s %s before DB and body", async (route, method) => {
  configureAllAttendanceUsers();
  const handlers = (await loaders[
    "../app/api/" + route + "/route.ts"
  ]()) as Record<string, (...args: unknown[]) => Promise<Response>>;
  const response = await handlers[method](
    new Request("http://localhost/api/" + route, {
      method,
      headers: { authorization: "Bearer " + bearer },
      ...(method === "GET" ? {} : { body: "malformed JSON" }),
    }),
    { params: Promise.resolve({ employeeCode: "test" }) },
  );
  expect(response.status).toBe(403);
  expect(state.getDb).not.toHaveBeenCalled();
});

it.each(attendanceUsers.slice(1))(
  "denies report client for another attendance user $email before DB access",
  async (user) => {
    configureAllAttendanceUsers();
    const value = await signedBearer(
      "20156efa-58be-4865-942c-6cd876a5488b",
      user.oid,
    );
    for (const route of [
      "dashboard",
      "vacation-summaries",
      "paid-leave-compliance",
    ]) {
      const handlers = (await loaders[
        "../app/api/" + route + "/route.ts"
      ]()) as Record<string, (request: Request) => Promise<Response>>;
      const response = await handlers.GET(
        new Request("http://localhost/api/" + route, {
          headers: { authorization: "Bearer " + value },
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Access denied" });
      expect(state.getDb).not.toHaveBeenCalled();
    }
  },
);

it.each(attendanceUsers)(
  "accepts screen session for existing user $email",
  async (user) => {
    configureAllAttendanceUsers();
    const value = await signedBearer(
      "3b2b5c62-16cc-42df-b275-e50c3084fb95",
      user.oid,
    );
    const handlers = (await loaders["../app/api/session/route.ts"]()) as Record<
      string,
      (request: Request) => Promise<Response>
    >;
    const response = await handlers.GET(
      new Request("http://localhost/api/session", {
        headers: { authorization: "Bearer " + value },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true });
    expect(state.getDb).not.toHaveBeenCalled();
  },
);
