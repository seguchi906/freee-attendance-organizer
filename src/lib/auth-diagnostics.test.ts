import { describe, expect, it } from "vitest";
import {
  createAuthDiagnostic,
  readSafeServerDiagnosticCode,
  safeMsalErrorCode,
} from "./auth-diagnostics";

describe("safe authentication diagnostics", () => {
  it("keeps only allowlisted MSAL error codes", () => {
    expect(safeMsalErrorCode({ errorCode: "interaction_required" })).toBe(
      "interaction_required",
    );
    expect(
      safeMsalErrorCode({
        errorCode: "token=secret-value",
        message: "https://example.invalid/?code=secret",
      }),
    ).toBe("token_acquisition_failed");
  });

  it("does not create diagnostics outside development", () => {
    expect(
      createAuthDiagnostic(
        "production",
        "api_session_response",
        401,
        "api_unauthorized",
      ),
    ).toBeUndefined();
    expect(
      createAuthDiagnostic(
        "test",
        "api_token_acquisition",
        null,
        "interaction_required",
      ),
    ).toBeUndefined();
  });

  it("uses fixed safe codes and strips invalid status values", () => {
    expect(
      createAuthDiagnostic(
        "development",
        "api_session_response",
        401,
        "https://example.invalid/?code=secret",
      ),
    ).toEqual({
      stage: "api_session_response",
      httpStatus: 401,
      errorCode: "api_unauthorized",
    });
    expect(
      createAuthDiagnostic(
        "development",
        "api_token_acquisition",
        700,
        "interaction_required",
      ),
    ).toEqual({
      stage: "api_token_acquisition",
      httpStatus: null,
      errorCode: "interaction_required",
    });
  });

  it("reads only an allowlisted server diagnostic code", async () => {
    const safe = new Response(
      JSON.stringify({ diagnosticCode: "signature_invalid", detail: "private" }),
    );
    const unsafe = new Response(
      JSON.stringify({ diagnosticCode: "token=secret-value" }),
    );

    await expect(readSafeServerDiagnosticCode(safe)).resolves.toBe(
      "signature_invalid",
    );
    await expect(readSafeServerDiagnosticCode(unsafe)).resolves.toBeUndefined();
  });
});
