import { authorizeApi } from "@/lib/api-auth";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const error = await authorizeApi(request);
  return (
    error ??
    Response.json(
      { authenticated: true },
      { headers: { "Cache-Control": "no-store" } },
    )
  );
}
