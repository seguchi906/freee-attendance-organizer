// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const { getDb } = vi.hoisted(() => ({
  getDb: vi.fn(() => {
    throw new Error("DB must not be reached");
  }),
}));
vi.mock("@/db", () => ({ databaseConfigured: true, getDb }));
beforeEach(() => {
  vi.stubEnv(
    "NEXT_PUBLIC_MSAL_CLIENT_ID",
    "3b2b5c62-16cc-42df-b275-e50c3084fb95",
  );
  vi.stubEnv(
    "NEXT_PUBLIC_ALLOWED_AUTH_EMAILS",
    "user1@example.com",
  );
  vi.stubEnv(
    "ATTENDANCE_ALLOWED_USERS",
    JSON.stringify([
      {
        oid: "00000000-0000-4000-8000-000000000011",
        email: "user1@example.com",
      },
    ]),
  );
});
afterEach(() => vi.unstubAllEnvs());
const loaders = import.meta.glob("../app/api/**/route.ts");
it.each([
  ["dashboard", "GET"],
  ["vacation-summaries", "GET"],
  ["overtime-summaries", "GET"],
  ["paid-leave-compliance", "GET"],
  ["report-data", "GET"],
  ["imports", "POST"],
  ["imports/validate", "POST"],
  ["employees/[employeeCode]", "PATCH"],
  ["session", "GET"],
])(
  "%s rejects unauthenticated requests before database/body processing",
  async (route, method) => {
    const handlers = (await loaders[
      `../app/api/${route}/route.ts`
    ]()) as Record<string, (...args: unknown[]) => Promise<Response>>;
    for (const authorization of ["", "Bearer bad.token.value"]) {
      const response = await handlers[method](
        new Request("http://localhost/api/" + route, {
          method,
          headers: { authorization },
          ...(method === "GET" ? {} : { body: "malformed JSON" }),
        }),
        { params: Promise.resolve({ employeeCode: "test" }) },
      );
      expect(response.status).toBe(401);
      expect(getDb).not.toHaveBeenCalled();
    }
  },
);
