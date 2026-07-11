import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "dingodocs",
    timestamp: new Date().toISOString(),
  });
}
