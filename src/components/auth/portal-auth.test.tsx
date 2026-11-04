import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { PortalAuthGate } from "./auth-wrapper";
vi.mock("./auth-config", () => ({
  allowedAuthEmailsConfig: "user1@example.com",
  portalOriginsConfig: "",
  loginRequest: {},
  silentRequest: {},
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("ignores an untrusted origin/window and trusts only a correlated parent token", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  const post = vi
    .spyOn(window.parent, "postMessage")
    .mockImplementation(() => {});
  const view = render(
    <PortalAuthGate>
      <div>protected attendance</div>
    </PortalAuthGate>,
  );
  const requestId = post.mock.calls[0][0].requestId;
  const data = {
    type: "ATTENDANCE_TOKEN",
    requestId,
    accessToken: "opaque",
    expiresAt: Date.now() + 3600000,
  };
  for (const event of [
    new MessageEvent("message", {
      source: window.parent,
      origin: "https://n-app-portal.netlify.app",
      data: {
        type: "AUTH_HINT",
        loginHint: "user1@example.com",
        idToken: "legacy-id-token",
      },
    }),
    new MessageEvent("message", {
      source: window.parent,
      origin: "https://attacker.example",
      data,
    }),
    new MessageEvent("message", {
      source: null,
      origin: "https://n-app-portal.netlify.app",
      data,
    }),
    new MessageEvent("message", {
      source: window.parent,
      origin: "https://n-app-portal.netlify.app",
      data: { ...data, requestId: "wrong" },
    }),
  ])
    window.dispatchEvent(event);
  expect(fetcher).not.toHaveBeenCalled();
  expect(view.queryByText("protected attendance")).toBeNull();
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      origin: "https://n-app-portal.netlify.app",
      data,
    }),
  );
  await waitFor(() =>
    expect(view.queryByText("protected attendance")).not.toBeNull(),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      origin: "https://n-app-portal.netlify.app",
      data: { type: "ATTENDANCE_LOGOUT" },
    }),
  );
  await waitFor(() =>
    expect(view.queryByText("protected attendance")).toBeNull(),
  );
});

it("a new child under an already-open old parent times out without accepting hints or fetching data", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const view = render(
    <PortalAuthGate>
      <div>protected attendance</div>
    </PortalAuthGate>,
  );
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      origin: "https://n-app-portal.netlify.app",
      data: {
        type: "AUTH_HINT",
        loginHint: "user1@example.com",
        idToken: "legacy-id",
      },
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10001);
  });
  expect(view.queryByText("protected attendance")).toBeNull();
  expect(
    view.getByText("ポータルからAPI認証を取得できませんでした。"),
  ).toBeDefined();
  expect(fetcher).not.toHaveBeenCalled();
});
