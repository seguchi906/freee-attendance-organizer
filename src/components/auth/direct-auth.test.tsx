import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { DirectAuthGate } from "./auth-wrapper";
const msal = vi.hoisted(() => {
  const account = {
    homeAccountId: "user-a",
    username: "user1@example.com",
    name: "test",
  };
  return {
    inProgress: "none",
    accounts: [account],
    instance: {
      getActiveAccount: vi.fn(() => account),
      getAllAccounts: vi.fn(() => [account]),
      setActiveAccount: vi.fn(),
      acquireTokenSilent: vi.fn(async () => ({
        accessToken: "opaque",
        expiresOn: new Date(Date.now() + 3600000),
      })),
      ssoSilent: vi.fn(),
      loginRedirect: vi.fn(async () => {}),
    },
  };
});
vi.mock("@azure/msal-react", () => ({ useMsal: () => msal }));
vi.mock("./auth-config", () => ({
  allowedAuthEmailsConfig: "user1@example.com",
  portalOriginsConfig: "",
  loginRequest: {},
  silentRequest: {},
}));
afterEach(() => {
  cleanup();
  msal.inProgress = "none";
  vi.unstubAllGlobals();
});
it("hides the previous user's view during direct-account authentication changes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  const view = render(
    <DirectAuthGate>
      <div>private attendance</div>
    </DirectAuthGate>,
  );
  await waitFor(() =>
    expect(view.queryByText("private attendance")).not.toBeNull(),
  );
  expect(msal.instance.acquireTokenSilent.mock.calls[0]).toBeDefined();
  msal.inProgress = "login";
  view.rerender(
    <DirectAuthGate>
      <div>private attendance</div>
    </DirectAuthGate>,
  );
  expect(view.queryByText("private attendance")).toBeNull();
});

it("offers an interactive API login after silent token acquisition fails without replaying requests", async () => {
  msal.instance.acquireTokenSilent.mockRejectedValueOnce(
    new Error("interaction required"),
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <DirectAuthGate>
      <div>private attendance</div>
    </DirectAuthGate>,
  );
  const button = await view.findByRole("button", {
    name: "Microsoftで再ログイン",
  });
  expect(view.queryByText("private attendance")).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(msal.instance.loginRedirect).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: "login",
      scopes: ["api://62d02c09-7d62-4216-bc2e-bc81b1d5afb7/attendance.access"],
    }),
  );
  expect(fetcher).not.toHaveBeenCalled();
});
