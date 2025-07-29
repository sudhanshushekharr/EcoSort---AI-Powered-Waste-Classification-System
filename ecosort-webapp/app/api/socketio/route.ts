// app/api/socketio/route.ts
import { NextRequest, NextResponse } from "next/server";

// Set dynamic to ensure the route is not statically optimized
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return NextResponse.json({
    message: "To trigger a webcam capture, use the /api/trigger-capture endpoint provided by the custom server",
    status: "info",
    endpoint: "/api/trigger-capture"
  });
}