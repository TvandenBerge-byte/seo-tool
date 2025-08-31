import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function j(data: unknown, status = 200, extra: Record<string,string> = {}) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

function isAllowed(req: NextRequest) {
  // 1) Bearer token (server-to-server)
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token && process.env.INTERNAL_API_SECRET && token === process.env.INTERNAL_API_SECRET) return true;

  // 2) Same-origin (UI)
  const site    = (process.env.SITE_URL || "").replace(/\/$/, "");
  const origin  = (req.headers.get("origin")  || "").replace(/\/$/, "");
  const referer = (req.headers.get("referer") || "").replace(/\/$/, "");
  if (site && (origin.startsWith(site) || referer.startsWith(site))) return true;

  return false;
}

// 1 gemeenschappelijke handler: werkt voor POST (body) én GET (query)
async function handlePublish(req: NextRequest) {
  if (!isAllowed(req)) return j({ ok:false, message:"Unauthorized" }, 401);

  let body: any = {};
  if (req.method === "POST") {
    body = await req.json().catch(() => ({}));
  } else {
    // GET: pak bv. jobId uit de query (?jobId=...)
    const { searchParams } = new URL(req.url);
    body = { jobId: searchParams.get("jobId") ?? undefined };
  }

  // >>>>> HIER jouw echte publicatielogica aanroepen <<<<<
  // const result = await publishToWordPress(body);
  const result = { received: body, published: true, via: req.method };

  return j({ ok: true, result }, 200);
}

export async function POST(req: NextRequest) { 
  try { return await handlePublish(req); } 
  catch (e:any) { return j({ ok:false, message:e?.message||"Server error" }, 500); }
}

// Failsafe GET i.p.v. 405 — voorkomt errors als Supabase per ongeluk GET doet
export async function GET(req: NextRequest) {
  try { return await handlePublish(req); }
  catch (e:any) { return j({ ok:false, message:e?.message||"Server error" }, 500); }
}

// CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}