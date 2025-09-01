// src/app/api/publish-to-wordpress/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ----- ENV -----
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server-only
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET!;             // server-only

// ----- Helpers -----
const json = (d: unknown, status = 200) =>
  NextResponse.json(d, { status, headers: { "Content-Type": "application/json" } });

const isAllowed = (req: NextRequest) =>
  (req.headers.get("authorization") ?? "") === `Bearer ${INTERNAL_API_SECRET}`;

// ✅ FIX: cookies() kan (in jouw Next-versie) een Promise zijn → altijd 'await' gebruiken
async function getSessionUserIdFromCookies(): Promise<string | null> {
  const store = await cookies();
  const supa = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get: (n) => store.get(n)?.value,
      set: (n, v, o) => store.set({ name: n, value: v, ...o }),
      remove: (n, o) => store.set({ name: n, value: "", ...o }),
    },
  });
  const { data } = await supa.auth.getUser();
  return data?.user?.id ?? null;
}

// ----- Types -----
type PageType = "klacht" | "behandeling" | "blog" | "revalidatie";

type PublishPayload = {
  user_id?: string;
  site_id?: string;
  pagetype?: PageType;
  title?: string;
  artikeltekst?: string;
  content?: string;
  summary?: string;
  seo?: {
    meta_title?: string;
    meta_description?: string;
    focus_keyword?: string;
  };
  schema_payload?: any; // string | object | any[]
  status?: "publish" | "draft" | "pending";
};

type WpSite = { id: string; wp_url: string; wp_user: string; wp_app_password: string };

type WpSettings = {
  post_type_slug_klacht?: string;
  post_type_slug_behandeling?: string;
  post_type_slug_blog?: string;
  post_type_slug_revalidatie?: string;

  acf_seo_title?: string;
  acf_seo_metadesc?: string;
  acf_seo_focuskw?: string;

  acf_summary_klacht?: string;
  acf_summary_behandeling?: string;
  acf_summary_blog?: string;
  acf_summary_revalidatie?: string;

  breadcrumbs_base_url?: string | null;
};

// ----- Supabase lookups -----
async function getWpCredsForUser(userId: string, siteId?: string): Promise<WpSite> {
  const admin = createAdmin(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let q = admin.from("wp_sites").select("id, wp_url, wp_user, wp_app_password, is_default").eq("user_id", userId);
  if (siteId) q = q.eq("id", siteId);
  const { data, error } = await q.order("is_default", { ascending: false }).limit(1);
  if (error) throw error;
  const site = data?.[0];
  if (!site) throw new Error("Geen WordPress-instellingen voor deze gebruiker.");
  return site as unknown as WpSite;
}

async function getWpSettings(userId: string): Promise<WpSettings> {
  const admin = createAdmin(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.from("wp_settings").select("*").eq("user_id", userId).single();
  if (error && error.code !== "PGRST116") throw error;
  return (data ?? {}) as WpSettings;
}

// ----- Mapping helpers -----
function resolvePostTypeSlug(pagetype: PageType | undefined, s: WpSettings): string {
  const fallback = { klacht: "klacht", behandeling: "behandeling", blog: "post", revalidatie: "revalideren" } as const;
  if (!pagetype) return fallback.blog;
  switch (pagetype) {
    case "klacht":       return s.post_type_slug_klacht || fallback.klacht;
    case "behandeling":  return s.post_type_slug_behandeling || fallback.behandeling;
    case "revalidatie":  return s.post_type_slug_revalidatie || fallback.revalidatie;
    case "blog":
    default:             return s.post_type_slug_blog || fallback.blog;
  }
}

function summaryFieldFor(pagetype: PageType | undefined, s: WpSettings): string | undefined {
  if (!pagetype) return s.acf_summary_blog;
  switch (pagetype) {
    case "klacht":       return s.acf_summary_klacht;
    case "behandeling":  return s.acf_summary_behandeling;
    case "revalidatie":  return s.acf_summary_revalidatie;
    case "blog":
    default:             return s.acf_summary_blog;
  }
}

// ----- Normalisatie & hardening -----
function safeSlug(input: string) {
  return (input || "post")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "post";
}
const normStr = (v?: string) => (v ?? "").toString().trim();

function normalizeSchemaPayload(input: any): { array: any[]; dropped: any[] } {
  let arr: any[] = [];
  if (!input) return { array: [], dropped: [] };

  try {
    if (typeof input === "string") {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) arr = parsed;
      else if (parsed && typeof parsed === "object") arr = [parsed];
      else return { array: [], dropped: [input] };
    } else if (Array.isArray(input)) {
      arr = input;
    } else if (typeof input === "object") {
      arr = [input];
    } else {
      return { array: [], dropped: [input] };
    }
  } catch {
    return { array: [], dropped: [input] };
  }

  const valid: any[] = [];
  const dropped: any[] = [];
  for (const item of arr) {
    if (item && typeof item === "object") {
      if (item["@type"] || item["@context"]) valid.push(item);
      else dropped.push(item);
    } else {
      dropped.push(item);
    }
  }
  return { array: valid, dropped };
}

function appendJsonLdToContent(html: string, schema_payload_any: any): { html: string; debug: any } {
  const { array, dropped } = normalizeSchemaPayload(schema_payload_any);
  if (!array.length) return { html, debug: { used: [], dropped } };
  const blocks = array.map(obj => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`).join("\n");
  return { html: `${html}\n\n${blocks}`, debug: { used: array, dropped } };
}

// ----- WordPress calls -----
async function wpCreatePost(
  site: WpSite,
  postTypeSlug: string,
  post: { title: string; content: string; status: string; excerpt?: string }
) {
  const base = site.wp_url.replace(/\/+$/, "");
  const endpoint =
    postTypeSlug === "post" ? `${base}/wp-json/wp/v2/posts` : `${base}/wp-json/wp/v2/${encodeURIComponent(postTypeSlug)}`;

  const auth = Buffer.from(`${site.wp_user}:${site.wp_app_password}`).toString("base64");

  const title = normStr(post.title) || "Untitled";
  const status = (normStr(post.status).toLowerCase() || "publish") as "publish" | "draft" | "pending";
  const content = normStr(post.content);
  const slug = safeSlug(title);

  const payload: any = { title, content, status, slug };
  if (post.excerpt) payload.excerpt = normStr(post.excerpt);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { data = { raw }; }

  const ok = res.ok || res.status === 201;
  const post_id = data?.id ?? null;
  const post_link = data?.link ?? data?.guid?.rendered ?? null;
  const invalidParams = data?.data?.params ? data.data.params : undefined;

  return { ok, status: res.status, endpoint, data, post_id, post_link, invalidParams, sent: payload };
}

async function wpPatchAcf(site: WpSite, postTypeSlug: string, postId: number, acfObject: Record<string, any>) {
  if (!acfObject || !Object.keys(acfObject).length) return { ok: true };
  const base = site.wp_url.replace(/\/+$/, "");
  const endpoint =
    postTypeSlug === "post"
      ? `${base}/wp-json/acf/v3/posts/${postId}`
      : `${base}/wp-json/acf/v3/${encodeURIComponent(postTypeSlug)}/${postId}`;

  const auth = Buffer.from(`${site.wp_user}:${site.wp_app_password}`).toString("base64");

  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ acf: acfObject }),
  });

  const raw = await res.text();
  let data: any; try { data = JSON.parse(raw); } catch { data = { raw }; }

  return { ok: res.ok, status: res.status, endpoint, data };
}

// ----- Route handler -----
export async function POST(req: NextRequest) {
  if (!isAllowed(req)) return json({ ok: false, error: "Unauthorized" }, 401);
  const debug = req.nextUrl.searchParams.get("debug") === "1";

  const body = (await req.json().catch(() => ({}))) as PublishPayload;

  // 1) bepaal user
  let userId = await getSessionUserIdFromCookies();
  if (!userId) userId = body.user_id ?? null;
  if (!userId) return json({ ok: false, error: "Geen gebruiker (cookies of user_id vereist)" }, 401);

  // 2) site & settings
  let site: WpSite;
  let settings: WpSettings = {};
  try {
    [site, settings] = await Promise.all([getWpCredsForUser(userId, body.site_id), getWpSettings(userId)]);
  } catch (e: any) {
    return json({ ok: false, error: "WP settings/credentials ontbreken", detail: String(e) }, 400);
  }

  // 3) payload samenstellen
  const pagetype: PageType | undefined = (body.pagetype as PageType) || undefined;
  const postTypeSlug = resolvePostTypeSlug(pagetype, settings);

  const title = body.title?.trim() || "Untitled";
  const status = body.status ?? "publish";

  let contentHtml = (body.artikeltekst ?? body.content ?? "").trim();
  if (!contentHtml) return json({ ok: false, error: "Lege content" }, 400);

  // JSON-LD toevoegen (met normalisatie en debug)
  const { html: contentWithSchema, debug: schemaDebug } = appendJsonLdToContent(contentHtml, body.schema_payload);

  const summary = (body.summary ?? "").trim();

  // 4) eerst post aanmaken
  const create = await wpCreatePost(site, postTypeSlug, {
    title,
    content: contentWithSchema,
    status,
    ...(summary ? { excerpt: summary } : {}),
  });

  if (!create.ok || !create.post_id || !create.post_link) {
    return json(
      {
        ok: false,
        error: "Malformed WP response - id/link ontbreekt of validatie faalde",
        status: create.status,
        endpoint: create.endpoint,
        invalid_params: create.invalidParams,
        wp_response: create.data,
        sent_payload: create.sent,
        ...(debug ? { debug_schema: schemaDebug } : {}),
      },
      422
    );
  }

  // 5) ACF (SEO + samenvatting)
  const acf: Record<string, any> = {};
  if (settings.acf_seo_title && body.seo?.meta_title)        acf[settings.acf_seo_title] = body.seo.meta_title;
  if (settings.acf_seo_metadesc && body.seo?.meta_description) acf[settings.acf_seo_metadesc] = body.seo.meta_description;
  if (settings.acf_seo_focuskw && body.seo?.focus_keyword)   acf[settings.acf_seo_focuskw] = body.seo.focus_keyword;

  const acfSummaryKey = summaryFieldFor(pagetype, settings);
  if (acfSummaryKey && summary) acf[acfSummaryKey] = summary;

  if (Object.keys(acf).length > 0) {
    const patched = await wpPatchAcf(site, postTypeSlug, create.post_id as number, acf);
    if (!patched.ok) {
      return json({
        ok: true,
        post_id: create.post_id,
        post_link: create.post_link,
        published: true,
        acf_warning: { status: patched.status, endpoint: patched.endpoint, wp_response: patched.data },
        ...(debug ? { debug_schema: schemaDebug } : {}),
      });
    }
  }

  // 6) succesvol
  return json({
    ok: true,
    post_id: create.post_id,
    post_link: create.post_link,
    published: true,
    ...(debug ? { debug_schema: schemaDebug } : {}),
  });
}

export async function OPTIONS() {
  return NextResponse.json(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}