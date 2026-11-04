type Token = { accessToken: string; expiresAt: number };
let token: Token | null = null;
let provider: (() => Promise<Token>) | null = null;
let pending: Promise<Token> | null = null;
let generation = 0;
const listeners = new Set<() => void>();
export function clearApiSession() {
  generation++;
  token = null;
  pending = null;
  provider = null;
  for (const listener of listeners) listener();
}
export function onApiSessionInvalidated(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setApiToken(value: Token) {
  token = value;
}
export function setApiTokenProvider(value: (() => Promise<Token>) | null) {
  generation++;
  token = null;
  pending = null;
  provider = value;
}
async function getToken() {
  if (token && token.expiresAt > Date.now() + 60000) return token.accessToken;
  if (!provider) throw new Error("API login required");
  const current = generation;
  const request = pending ?? (pending = provider());
  try {
    const result = await request;
    if (current !== generation) throw new Error("API session changed");
    if (!result.accessToken || result.expiresAt <= Date.now() + 60000)
      throw new Error("API token expired");
    token = result;
    return result.accessToken;
  } catch (error) {
    if (current === generation) clearApiSession();
    throw error;
  } finally {
    if (pending === request) pending = null;
  }
}
export async function apiFetch(input: string, init: RequestInit = {}) {
  const url = new URL(input, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith("/api/")
  )
    throw new Error("Invalid API destination");
  const current = generation;
  const accessToken = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  // Awaiting even a cached token yields: logout/account changes must win before dispatch.
  if (current !== generation) throw new Error("API session changed");
  const response = await fetch(input, { ...init, headers, cache: "no-store" });
  if (current !== generation) throw new Error("API session changed");
  // Never replay a request after 401, including POST/PATCH.
  if (response.status === 401 || response.status === 403) clearApiSession();
  return response;
}
