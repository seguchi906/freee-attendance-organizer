import { afterEach, expect, it, vi } from "vitest";
import { createAttendanceCache } from "./attendance-cache";

afterEach(() => vi.unstubAllGlobals());

it("同じ期やタブの再表示・同時取得で通信を共有し、各呼び出しでJSONを読める", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"value":1}'));
  vi.stubGlobal("fetch", fetcher);
  const cache = createAttendanceCache();
  const responses = await Promise.all([cache.fetch("/api/dashboard?period=48"), cache.fetch("/api/dashboard?period=48")]);
  expect(await responses[0].json()).toEqual({ value: 1 });
  expect(await responses[1].json()).toEqual({ value: 1 });
  await cache.fetch("/api/dashboard?period=47");
  await cache.fetch("/api/dashboard?period=48");
  expect(fetcher).toHaveBeenCalledTimes(2);
  cache.clear();
  await cache.fetch("/api/dashboard?period=48");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("失敗した通信は保存せず次回再取得する", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response("error", { status: 500 }))
    .mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetcher);
  const cache = createAttendanceCache();
  await expect(cache.fetch("/api/dashboard")).rejects.toThrow("offline");
  expect((await cache.fetch("/api/dashboard")).status).toBe(500);
  expect(await (await cache.fetch("/api/dashboard")).text()).toBe("ok");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("変更前の取得が遅れて完了しても新しいキャッシュに戻さない", async () => {
  let resolveOld!: (response: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
    .mockResolvedValue(new Response("new"));
  vi.stubGlobal("fetch", fetcher);
  const cache = createAttendanceCache();
  const old = cache.fetch("/api/dashboard");
  cache.clear();
  await cache.fetch("/api/dashboard");
  resolveOld(new Response("old"));
  await old;
  expect(await (await cache.fetch("/api/dashboard")).text()).toBe("new");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
