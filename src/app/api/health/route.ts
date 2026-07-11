import { NextResponse } from "next/server";

export function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  return NextResponse.json(
    {
      status: "ok",
      service: "dingodocs",
      timestamp: new Date().toISOString(),
    },
    { headers: { "x-request-id": requestId } },
  );
}
