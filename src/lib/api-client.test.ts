import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  setApiToken,
  apiFetch,
  clearApiSession,
  setApiTokenProvider,
  onApiSessionInvalidated,
} from "./api-client";
const valid = {
  accessToken: "opaque-access-token",
  expiresAt: Date.now() + 3600000,
};
beforeEach(() => setApiTokenProvider(async () => valid));
afterEach(() => {
  setApiTokenProvider(null);
  vi.unstubAllGlobals();
});
it("attaches an API Bearer token", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetcher);
  await apiFetch("/api/dashboard");
  expect(
    new Headers(fetcher.mock.calls[0][1].headers).get("authorization"),
  ).toBe("Bearer opaque-access-token");
});
it.each(["POST", "PATCH"])("does not replay %s after 401", async (method) => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("expired", { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  const invalidated = vi.fn();
  const unsubscribe = onApiSessionInvalidated(invalidated);
  expect((await apiFetch("/api/imports", { method, body: "{}" })).status).toBe(
    401,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(invalidated).toHaveBeenCalledTimes(1);
  unsubscribe();
});
it("shares renewal and never sends a mutation when renewal fails", async () => {
  const refresh = vi.fn().mockRejectedValue(new Error("renewal failed"));
  setApiTokenProvider(refresh);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await Promise.all([
    expect(apiFetch("/api/imports", { method: "POST" })).rejects.toThrow(
      "renewal failed",
    ),
    expect(apiFetch("/api/dashboard")).rejects.toThrow("renewal failed"),
  ]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(fetcher).not.toHaveBeenCalled();
});
it("discards a token arriving after logout", async () => {
  let resolve!: (token: typeof valid) => void;
  setApiTokenProvider(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const request = apiFetch("/api/imports", { method: "POST" });
  clearApiSession();
  resolve(valid);
  await expect(request).rejects.toThrow("session changed");
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects expired renewal metadata and external destinations", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  setApiTokenProvider(async () => ({ ...valid, expiresAt: 1 }));
  await expect(apiFetch("/api/imports")).rejects.toThrow("expired");
  await expect(apiFetch("https://attacker.example/api/data")).rejects.toThrow(
    "destination",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["POST", "PATCH"])(
  "does not send cached-token %s after logout before dispatch",
  async (method) => {
    setApiToken(valid);
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    const request = apiFetch("/api/imports", { method, body: "{}" });
    clearApiSession();
    await expect(request).rejects.toThrow("session changed");
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it("does not dispatch an old account's cached token after provider replacement", async () => {
  setApiToken(valid);
  const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  const request = apiFetch("/api/imports", { method: "POST", body: "{}" });
  setApiTokenProvider(async () => ({ ...valid, accessToken: "new-account" }));
  await expect(request).rejects.toThrow("session changed");
  expect(fetcher).not.toHaveBeenCalled();
});
