import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function j(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET() {
  return j({ ok: true, route: "/api/publish-to-wordpress" });
}

export async function POST(req: NextRequest) {
  // tijdelijk: gewoon echo terug zodat we 200 JSON krijgen
  const body = await req.json().catch(() => ({}));
  return j({ ok: true, received: body });
}