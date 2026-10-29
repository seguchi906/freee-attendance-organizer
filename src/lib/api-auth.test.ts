// @vitest-environment node
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { verifyAttendanceToken, readAuthorizationConfig } from "./api-auth";
import {
  ATTENDANCE_API_CLIENT_ID as aud,
  ATTENDANCE_API_TENANT_ID as tid,
} from "./api-access-token";
const oid = "00000000-0000-4000-8000-000000000011";
const clientId = "00000000-0000-4000-8000-000000000001";
const config = {
  users: [{ oid, email: "user1@example.com" }],
  emails: ["user1@example.com"],
  clientId,
};
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  pair = await generateKeyPair("RS256");
});
beforeEach(() => {
  vi.stubEnv("COMPANY_REPORT_ALLOWED_OID", oid);
});
afterEach(() => vi.unstubAllEnvs());
const getKey: JWTVerifyGetKey = async () => pair.publicKey;
async function token(overrides = {}, key = pair.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    aud,
    tid,
    oid,
    sub: "subject",
    ver: "2.0",
    azp: clientId,
    scp: "attendance.access",
    iss: `https://login.microsoftonline.com/${tid}/v2.0`,
    iat: now,
    nbf: now - 5,
    exp: now + 3600,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(key);
}
it("accepts a signed token by Object ID even when UPN and email differ", async () => {
  await expect(
    verifyAttendanceToken(
      await token({
        preferred_username: "user1@tenant.example.com",
        email: "another@example.com",
      }),
      config,
      getKey,
    ),
  ).resolves.toEqual({ oid, email: "user1@example.com" });
});
it.each([
  ["expired", { exp: 1 }, 401],
  ["future", { nbf: 9999999999 }, 401],
  ["wrong API", { aud: clientId }, 401],
  ["wrong tenant", { tid: clientId }, 401],
  ["wrong issuer", { iss: "https://attacker.example" }, 401],
  ["v1", { ver: "1.0" }, 401],
  ["scope missing", { scp: "User.Read" }, 403],
  ["ID token", { scp: undefined }, 403],
  ["scope substring", { scp: "attendance.access.other" }, 403],
  ["wrong client", { azp: aud }, 403],
  ["unauthorized user", { oid: clientId, email: "user1@example.com" }, 403],
  ["missing oid", { oid: undefined }, 401],
  ["missing expiry", { exp: undefined }, 401],
  ["app-only", { idtyp: "app" }, 401],
])("rejects %s", async (_name, claims, status) => {
  await expect(
    verifyAttendanceToken(await token(claims), config, getKey),
  ).rejects.toMatchObject({ status });
});
it("rejects invalid signatures and malformed tokens", async () => {
  const other = await generateKeyPair("RS256");
  for (const value of [await token({}, other.privateKey), "not-a-jwt"])
    await expect(
      verifyAttendanceToken(value, config, getKey),
    ).rejects.toMatchObject({ status: 401 });
});
it("refuses a mapping outside the existing permission range", async () => {
  await expect(
    verifyAttendanceToken(
      await token(),
      { ...config, emails: ["someone@example.com"] },
      getKey,
    ),
  ).rejects.toMatchObject({ status: 403 });
});
describe("configuration fails closed", () => {
  it("requires a user mapping", () => {
    vi.stubEnv("ATTENDANCE_ALLOWED_USERS", "[]");
    expect(() => readAuthorizationConfig()).toThrow();
  });
  it("accepts only a mapping within the old email list", () => {
    vi.stubEnv("ATTENDANCE_ALLOWED_USERS", JSON.stringify(config.users));
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", clientId);
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_AUTH_EMAILS", "user1@example.com");
    expect(readAuthorizationConfig()).toMatchObject(config);
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_AUTH_EMAILS", "someone@example.com");
    expect(() => readAuthorizationConfig()).toThrow();
  });
});

const reportClient = "20156efa-58be-4865-942c-6cd876a5488b";
it.each(["dashboard", "vacation-summaries", "paid-leave-compliance"])(
  "allows report client GET %s",
  async (route) => {
    await expect(
      verifyAttendanceToken(
        await token({ azp: reportClient }),
        config,
        getKey,
        new Request("http://localhost/api/" + route),
      ),
    ).resolves.toEqual({ oid, email: "user1@example.com" });
  },
);
it.each([
  "session",
  "report-data",
  "overtime-summaries",
  "employees/test",
  "imports",
  "imports/validate",
  "dashboard/",
  "dashboard/extra",
])("denies report client GET %s", async (route) => {
  await expect(
    verifyAttendanceToken(
      await token({ azp: reportClient }),
      config,
      getKey,
      new Request("http://localhost/api/" + route),
    ),
  ).rejects.toMatchObject({ status: 403 });
});
it.each(["POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"])(
  "denies report client %s even on allowed paths",
  async (method) => {
    for (const route of [
      "dashboard",
      "vacation-summaries",
      "paid-leave-compliance",
    ])
      await expect(
        verifyAttendanceToken(
          await token({ azp: reportClient }),
          config,
          getKey,
          new Request("http://localhost/api/" + route, { method }),
        ),
      ).rejects.toMatchObject({ status: 403 });
  },
);
it("keeps report users and scopes restricted", async () => {
  for (const claims of [
    { oid: clientId },
    { scp: "User.Read" },
    { azp: reportClient, exp: 1 },
  ])
    await expect(
      verifyAttendanceToken(
        await token({ azp: reportClient, ...claims }),
        config,
        getKey,
        new Request("http://localhost/api/dashboard"),
      ),
    ).rejects.toHaveProperty("status");
});
it.each([
  ["unset", undefined],
  ["empty", ""],
  ["whitespace", "   "],
  ["invalid format", "not-a-valid-uuid"],
  ["other user", "00000000-0000-4000-8000-000000000012"],
])("denies report client when COMPANY_REPORT_ALLOWED_OID is %s", async (_label, envValue) => {
  if (envValue === undefined) {
    vi.unstubAllEnvs();
  } else {
    vi.stubEnv("COMPANY_REPORT_ALLOWED_OID", envValue);
  }
  await expect(
    verifyAttendanceToken(
      await token({ azp: reportClient }),
      config,
      getKey,
      new Request("http://localhost/api/dashboard"),
    ),
  ).rejects.toMatchObject({ status: 403 });
});
it("preserves portal client access to existing operations", async () => {
  await expect(
    verifyAttendanceToken(
      await token(),
      config,
      getKey,
      new Request("http://localhost/api/imports", { method: "POST" }),
    ),
  ).resolves.toEqual({ oid, email: "user1@example.com" });
});

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
const attendanceConfig = {
  users: attendanceUsers,
  emails: attendanceUsers.map((user) => user.email),
  clientId: "3b2b5c62-16cc-42df-b275-e50c3084fb95",
};
const attendanceOperations = [
  ["session", "GET"],
  ["dashboard", "GET"],
  ["vacation-summaries", "GET"],
  ["paid-leave-compliance", "GET"],
  ["overtime-summaries", "GET"],
  ["report-data", "GET"],
  ["imports", "POST"],
  ["imports/validate", "POST"],
  ["employees/test", "PATCH"],
] as const;

describe("client and user combination with the complete attendance allowlist", () => {
  it("accepts all six existing users in authorization configuration", () => {
    vi.stubEnv("ATTENDANCE_ALLOWED_USERS", JSON.stringify(attendanceUsers));
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", attendanceConfig.clientId);
    vi.stubEnv(
      "NEXT_PUBLIC_ALLOWED_AUTH_EMAILS",
      attendanceConfig.emails.join(","),
    );
    expect(readAuthorizationConfig()).toEqual(attendanceConfig);
  });

  it.each(attendanceUsers)(
    "preserves screen API operations for $email",
    async (user) => {
      const value = await token({
        azp: attendanceConfig.clientId,
        oid: user.oid,
      });
      for (const [route, method] of attendanceOperations)
        await expect(
          verifyAttendanceToken(
            value,
            attendanceConfig,
            getKey,
            new Request("http://localhost/api/" + route, { method }),
          ),
        ).resolves.toEqual(user);
    },
  );

  it.each(attendanceUsers)(
    "allows report GETs only for the authorized report user: $email",
    async (user) => {
      const value = await token({
        azp: reportClient,
        oid: user.oid,
        email: "user1@example.com",
        preferred_username: "user1@tenant.example.com",
        login_hint: "user1@tenant.example.com",
      });
      for (const route of [
        "dashboard",
        "vacation-summaries",
        "paid-leave-compliance",
      ]) {
        const verification = verifyAttendanceToken(
          value,
          attendanceConfig,
          getKey,
          new Request("http://localhost/api/" + route + "?oid=" + oid),
        );
        if (user.oid === oid) await expect(verification).resolves.toEqual(user);
        else await expect(verification).rejects.toMatchObject({ status: 403 });
      }
    },
  );

  it.each(attendanceUsers)(
    "rejects report writes and other routes for $email",
    async (user) => {
      const value = await token({ azp: reportClient, oid: user.oid });
      for (const [route, method] of attendanceOperations.filter(
        ([route, method]) =>
          method !== "GET" ||
          ![
            "dashboard",
            "vacation-summaries",
            "paid-leave-compliance",
          ].includes(route),
      ))
        await expect(
          verifyAttendanceToken(
            value,
            attendanceConfig,
            getKey,
            new Request("http://localhost/api/" + route, { method }),
          ),
        ).rejects.toMatchObject({ status: 403 });
      for (const method of [
        "POST",
        "PATCH",
        "PUT",
        "DELETE",
        "HEAD",
        "OPTIONS",
      ])
        for (const route of [
          "dashboard",
          "vacation-summaries",
          "paid-leave-compliance",
        ])
          await expect(
            verifyAttendanceToken(
              value,
              attendanceConfig,
              getKey,
              new Request("http://localhost/api/" + route, { method }),
            ),
          ).rejects.toMatchObject({ status: 403 });
    },
  );

  it.each(attendanceUsers)(
    "requires request context for report authorization: $email",
    async (user) => {
      await expect(
        verifyAttendanceToken(
          await token({ azp: reportClient, oid: user.oid }),
          attendanceConfig,
          getKey,
        ),
      ).rejects.toMatchObject({ status: 403 });
    },
  );

  it("does not widen report access if the interactive client configuration is wrong", async () => {
    await expect(
      verifyAttendanceToken(
        await token({ azp: reportClient, oid: attendanceUsers[1].oid }),
        { ...attendanceConfig, clientId: reportClient },
        getKey,
        new Request("http://localhost/api/dashboard"),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("requires the authorized report user to remain in the administrator-maintained attendance mapping", async () => {
    await expect(
      verifyAttendanceToken(
        await token({ azp: reportClient }),
        { ...attendanceConfig, users: attendanceUsers.slice(1) },
        getKey,
        new Request("http://localhost/api/dashboard"),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("does not accept matching email claims as an attendance user", async () => {
    await expect(
      verifyAttendanceToken(
        await token({
          azp: attendanceConfig.clientId,
          oid: clientId,
          email: attendanceUsers[0].email,
          login_hint: attendanceUsers[0].email,
        }),
        attendanceConfig,
        getKey,
        new Request("http://localhost/api/imports", { method: "POST" }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a forged report user/client combination before authorization", async () => {
    const other = await generateKeyPair("RS256");
    await expect(
      verifyAttendanceToken(
        await token({ azp: reportClient }, other.privateKey),
        attendanceConfig,
        getKey,
        new Request("http://localhost/api/dashboard"),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});
