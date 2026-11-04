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
  vi.unstubAllEnvs();
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
  vi.stubEnv("NODE_ENV", "development");
  msal.instance.acquireTokenSilent.mockRejectedValueOnce(
    { errorCode: "interaction_required", message: "token=must-not-be-rendered" },
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
  const diagnostic = await view.findByTestId("auth-diagnostic");
  expect(diagnostic.textContent).toContain("api_token_acquisition");
  expect(diagnostic.textContent).toContain("interaction_required");
  expect(diagnostic.textContent).not.toContain("must-not-be-rendered");
  expect(diagnostic.textContent).toContain("HTTP status: なし");
  fireEvent.click(button);
  expect(msal.instance.loginRedirect).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: "login",
      scopes: ["api://62d02c09-7d62-4216-bc2e-bc81b1d5afb7/attendance.access"],
    }),
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("shows only the status and a safe code when /api/session rejects the request", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
  const view = render(
    <DirectAuthGate>
      <div>private attendance</div>
    </DirectAuthGate>,
  );

  const diagnostic = await view.findByTestId("auth-diagnostic");
  expect(diagnostic.textContent).toContain("api_session_response");
  expect(diagnostic.textContent).toContain("HTTP status: 403");
  expect(diagnostic.textContent).toContain("api_forbidden");
  expect(view.queryByText("private attendance")).toBeNull();
});

it("shows an allowlisted server classification for a 401 response", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Authentication required",
          diagnosticCode: "signature_invalid",
          detail: "must-not-be-rendered",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
  const view = render(
    <DirectAuthGate>
      <div>private attendance</div>
    </DirectAuthGate>,
  );

  const diagnostic = await view.findByTestId("auth-diagnostic");
  expect(diagnostic.textContent).toContain("api_session_response");
  expect(diagnostic.textContent).toContain("HTTP status: 401");
  expect(diagnostic.textContent).toContain("signature_invalid");
  expect(diagnostic.textContent).not.toContain("must-not-be-rendered");
  expect(diagnostic.textContent).not.toContain("Authentication required");
});

it("does not render detailed diagnostics outside development", async () => {
  vi.stubEnv("NODE_ENV", "production");
  msal.instance.acquireTokenSilent.mockRejectedValueOnce({
    errorCode: "interaction_required",
    message: "token=must-not-be-rendered",
  });
  const view = render(
    <DirectAuthGate>
      <div>private attendance</div>
    </DirectAuthGate>,
  );

  await view.findByRole("button", { name: "Microsoftで再ログイン" });
  expect(view.queryByTestId("auth-diagnostic")).toBeNull();
  expect(view.queryByText("must-not-be-rendered")).toBeNull();
});
