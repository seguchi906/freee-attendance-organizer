import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeApi: vi.fn(),
  dbSelect: vi.fn(),
  getDb: vi.fn(),
  poolEnd: vi.fn(),
  fetch: vi.fn(() => {
    throw new Error("Unexpected network request in paid leave route test");
  }),
}));

vi.mock("@/lib/api-auth", () => ({
  authorizeApi: mocks.authorizeApi,
}));

vi.mock("@/db", () => ({
  databaseConfigured: true,
  getDb: mocks.getDb,
}));

import { GET } from "@/app/api/paid-leave-compliance/route";

function makeRequest(asOf?: string) {
  const url = new URL("http://localhost/api/paid-leave-compliance");
  if (asOf !== undefined) url.searchParams.set("asOf", asOf);
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.authorizeApi.mockResolvedValue(null);

  const queryRows: unknown[][] = [[], [], [], []];
  mocks.dbSelect.mockImplementation(() => {
    const rows = queryRows.shift() ?? [];
    const query = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      orderBy: vi.fn(),
      where: vi.fn(),
    };
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.orderBy.mockImplementation(() => Promise.resolve(rows));
    query.where.mockImplementation(() => Promise.resolve(rows));
    return query;
  });
  mocks.poolEnd.mockImplementation(async () => undefined);
  mocks.getDb.mockReturnValue({
    db: { select: mocks.dbSelect },
    pool: { end: mocks.poolEnd },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("paid leave compliance route asOf validation", () => {
  it.each([
    "2000-02-29",
    "2024-02-29",
    "2025-02-28",
    "2026-04-30",
    "2099-12-31",
  ])("accepts valid date %s and preserves asOf", async (asOf) => {
    const response = await GET(makeRequest(asOf));

    expect(response.status).toBe(200);
    expect((await response.json()).asOf).toBe(asOf);
    expect(mocks.getDb).toHaveBeenCalledOnce();
    expect(mocks.dbSelect).toHaveBeenCalledTimes(4);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("uses the current Tokyo calendar date when asOf is omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T15:30:00.000Z"));

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect((await response.json()).asOf).toBe("2026-11-01");
    expect(mocks.dbSelect).toHaveBeenCalledTimes(4);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([401, 403])("returns auth status %i before rejecting an invalid date", async (status) => {
    mocks.authorizeApi.mockResolvedValueOnce(
      Response.json({ error: "Unauthorized" }, { status }),
    );

    const response = await GET(makeRequest("2026-02-30"));

    expect(response.status).toBe(status);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.dbSelect).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects a date with a trailing newline", async () => {
    const response = await GET(makeRequest("2026-03-01\n"));

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.dbSelect).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "2026-02-30",
    "2024-02-30",
    "2026-04-31",
    "2026-06-31",
    "2026-09-31",
    "2026-11-31",
    "2025-02-29",
    "2026-02-29",
    "2026-02-00",
    "2026-01-00",
    "2026-01-32",
    "2026-04-00",
    "2026-00-15",
    "2026-13-15",
    "2026-1-01",
    "2026-01-1",
    "2026/01/01",
    "1999-12-31",
    "2100-01-01",
    "0000-01-01",
    "2026-01-01T00:00:00Z",
    "",
    "not-a-date",
  ])("rejects invalid calendar date %j", async (asOf) => {
    const response = await GET(makeRequest(asOf));

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.dbSelect).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});