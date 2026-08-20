import { describe, expect, it } from "vitest";
import type { AccountInfo } from "@azure/msal-browser";
import {
  findAllowedEmail,
  getAccountEmailCandidates,
  getAllowedPortalOrigins,
  isTrustedPortalMessage,
  parseCommaSeparated,
} from "@/lib/auth";

describe("Microsoft認証ヘルパー", () => {
  it("カンマ区切り設定を正規化して重複を除く", () => {
    expect(parseCommaSeparated(" User@Example.com, user@example.com, second@example.com ")).toEqual([
      "user@example.com",
      "second@example.com",
    ]);
    expect(parseCommaSeparated(undefined)).toEqual([]);
  });

  it("Microsoftアカウントのメール候補をすべて正規化する", () => {
    const account = {
      username: "USER@tenant.onmicrosoft.com",
      idTokenClaims: {
        preferred_username: "user@example.com",
        email: " USER@EXAMPLE.COM ",
        upn: "other@example.com",
      },
    } as unknown as AccountInfo;
    expect(getAccountEmailCandidates(account)).toEqual([
      "user@tenant.onmicrosoft.com",
      "user@example.com",
      "other@example.com",
    ]);
  });

  it("個別許可と明示的な全員許可を判定する", () => {
    expect(findAllowedEmail(["USER@example.com"], ["user@example.com"])).toBe(
      "user@example.com",
    );
    expect(findAllowedEmail(["user@example.com"], [])).toBeNull();
    expect(findAllowedEmail(["user@example.com"], ["*"])).toBe("user@example.com");
  });

  it("本番ポータルと開発用ポータルoriginを構成する", () => {
    expect(getAllowedPortalOrigins("https://portal.example.com", false)).toEqual([
      "https://portal.example.com",
      "https://n-app-portal.netlify.app",
    ]);
    expect(getAllowedPortalOrigins(undefined, true)).toContain(
      "http://localhost:5173",
    );
  });

  it("親window、origin、メッセージ形式をすべて検証する", () => {
    const parentWindow = window;
    const valid = {
      source: parentWindow,
      origin: "https://portal.example.com",
      data: { type: "AUTH_HINT", loginHint: "user@example.com" },
    };
    expect(
      isTrustedPortalMessage(valid, parentWindow, ["https://portal.example.com"]),
    ).toBe(true);
    expect(
      isTrustedPortalMessage(
        { ...valid, origin: "https://evil.example.com" },
        parentWindow,
        ["https://portal.example.com"],
      ),
    ).toBe(false);
    expect(
      isTrustedPortalMessage(
        { ...valid, data: { type: "AUTH_HINT", loginHint: "" } },
        parentWindow,
        ["https://portal.example.com"],
      ),
    ).toBe(false);
  });
});
