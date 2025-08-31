// src/app/api/generate-seo/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const AHREFS_API_KEY = process.env.AHREFS_API_KEY || ""; // zet in .env.local

type PageTypeIn = "complaint" | "treatment" | "klacht" | "behandeling";
type PageType   = "complaint" | "treatment";

function normalizePageType(v?: string): PageType | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase().trim();
  if (s === "complaint" || s === "klacht") return "complaint";
  if (s === "treatment" || s === "behandeling") return "treatment";
  return undefined;
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/generate-seo", method: "POST only" });
}

export async function POST(req: NextRequest) {
  try {
    // ---------- 1) Input ----------
    const raw = (await req.json().catch(() => ({}))) as Record<string, any>;

    const topic: string | undefined =
      raw.topic ?? raw.hoofdkeyword ?? raw.keyword ?? raw.subject;
    const pageTypeIn: PageTypeIn | undefined = raw.pageType ?? raw.pagetype;
    const pageType = normalizePageType(pageTypeIn);

    if (!topic || !pageType) {
      return NextResponse.json(
        { ok: false, error: "topic (of hoofdkeyword) en pageType/pagetype zijn verplicht" },
        { status: 400 }
      );
    }

    // optioneel
    const locatie        = raw.locatie ?? raw.location ?? "";
    const praktijknaam   = raw.praktijknaam ?? raw.practice ?? "";
    const doelgroep      = raw.doelgroep ?? "";
    const usp            = raw.usp ?? "";
    const secundaireKW   = raw.secundaire_keywords ?? raw.secondaryKeywords ?? "";
    const lengteRange    = (raw.long_article_length_range ?? raw.wordcount ?? "1000-1400").toString();
    const minWords       = Math.max(Number(lengteRange.split("-")[0]) || 1000, 600);
    const telefoon       = raw.telefoon ?? "";
    const email          = raw.email ?? "";
    const h1Override     = raw.onderwerp ?? raw.h1 ?? "";

    // ---------- 2) (Optioneel) upstream proxy ----------
    const upstreamUrl = (process.env.UPSTREAM_API_URL || "").trim();
    if (upstreamUrl) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const upstreamKey = (process.env.UPSTREAM_API_KEY || "").trim();
      if (upstreamKey) {
        const authHeader = (process.env.UPSTREAM_API_AUTH_HEADER || "Authorization").trim();
        const authScheme = (process.env.UPSTREAM_API_AUTH_SCHEME || "Bearer").trim();
        headers[authHeader] = `${authScheme} ${upstreamKey}`;
      }
      const res = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...raw, topic, pageType }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return NextResponse.json(
          { ok: false, error: `Upstream ${res.status}: ${text || res.statusText}` },
          { status: 502 }
        );
      }
      const data = await res.json();
      return NextResponse.json(data);
    }

    // ---------- 3) Ahrefs keywords ----------
    let ahrefsKeywords: any[] = [];
    if (AHREFS_API_KEY) {
      const ahrefsUrl =
        `https://api.ahrefs.com/v3/keywords-explorer/related-terms` +
        `?country=nl&keywords=${encodeURIComponent(topic)}` +
        `&limit=50&order_by=volume%3Adesc` +
        `&select=serp_last_update%2Ccpc%2Cvolume_mobile_pct%2Cfirst_seen%2Cvolume_desktop_pct%2Cvolume_monthly%2Cparent_topic%2Cglobal_volume%2Ckeyword%2Ccps%2Cvolume%2Cserp_features%2Ctraffic_potential%2Cdifficulty%2Cintents` +
        `&terms=also_rank_for&view_for=top_10`;

      try {
        const r = await fetch(ahrefsUrl, {
          headers: {
            Authorization: `Bearer ${AHREFS_API_KEY}`,
            "Content-Type": "application/json",
          },
          // voorkom dat één trage call alles blokkeert
          cache: "no-store",
        });
        if (r.ok) {
          const j = await r.json();
          ahrefsKeywords = Array.isArray(j?.data) ? j.data : [];
        } else {
          console.error("Ahrefs API error", r.status);
        }
      } catch (err) {
        console.error("Ahrefs fetch fout:", err);
      }
    }

    // ---------- 4) OpenAI ----------
    const apiKey   = (process.env.OPENAI_API_KEY || "").trim();
    const envModel = (process.env.OPENAI_MODEL || "").trim();
    const model    = envModel || "gpt-4o-mini";
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY ontbreekt (of zet UPSTREAM_API_URL in env)" },
        { status: 500 }
      );
    }
    const client = new OpenAI({ apiKey });

    const system = [
      "Je bent een professionele SEO-tekstschrijver gespecialiseerd in fysiotherapie.",
      "Schrijf in helder, toegankelijk Nederlands; evidence‑informed, geen overmatige claims.",
      "Gebruik een duidelijke H1/H2-structuur.",
      "Baseer je inhoud op samengevatte kennis uit betrouwbare NL-bronnen:",
      " - B‑Fysic",
      " - Fysiotherapie Achtse Barrier",
      " - Thuisarts.nl",
      "Citeer niet letterlijk; schrijf in eigen woorden.",
      "",
      "Je ANTWOORD MOET één JSON‑object zijn met exact deze sleutels:",
      '{ "meta": { "title": "string", "description": "string", "h1": "string" },',
      '  "artikeltekst": "<geldige HTML met H1/H2/H3/P>",',
      '  "faq_schema": { ... geldig JSON‑LD FAQPage ... },',
      '  "keywords_used": { "primary": "string", "secondary": ["string", "..."] },',
      '  "suggested_keywords": ["string", "..."] }',
      "",
      `Vereisten: meta.title ≤ 60 tekens; meta.description 140–160 tekens; artikeltekst ≥ ~${minWords} woorden; alle velden niet leeg.`,
    ].join("\n");

    const user = [
      `Genereer een volledige SEO‑pagina over: ${topic} (${pageType}).`,
      "Integreer hoofd- en secundaire keywords natuurlijk (geen stuffing).",
      "",
      "Context:",
      `- Locatie: ${locatie || "(niet opgegeven)"}`,
      `- Praktijknaam: ${praktijknaam || "(niet opgegeven)"}`,
      `- Doelgroep: ${doelgroep || "(niet opgegeven)"}`,
      `- USP: ${usp || "(niet opgegeven)"}`,
      `- Secundaire keywords (komma’s): ${secundaireKW || "(geen)"}`,
      `- Telefoon: ${telefoon || "(niet opgegeven)"} | Email: ${email || "(niet opgegeven)"}`,
      `- H1 override: ${h1Override || "(auto)"}`,
      "",
      "Structuur voor de artikeltekst (HTML):",
      `- H1: ${h1Override || `${topic}${locatie ? ` in ${locatie}` : ""}`}`,
      `- H2: Wat is ${topic}?`,
      `- H2: Oorzaken van ${topic}`,
      `- H2: Symptomen van ${topic}`,
      `- H2: Behandelopties bij ${topic}`,
      `- H2: Veelgestelde vragen (7 stuks met volledige, praktische antwoorden)`,
      `- H2: Direct een afspraak maken (verwerk praktijknaam + CTA; voeg tel/mail toe indien aanwezig)`,
      "",
      "Gebruik onderstaande Ahrefs data (indien aanwezig) voor keywordkeuzes en vermeld deze in 'keywords_used' en 'suggested_keywords':",
      JSON.stringify(ahrefsKeywords),
      "",
      "Lever ALLEEN het JSON‑object zoals in de systeeminstructies.",
    ].join("\n");

    const aiRes = await client.chat.completions.create({
      model,
      temperature: 0.35,
      max_tokens: 4200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const rawContent = aiRes.choices[0]?.message?.content?.trim();
    if (!rawContent) {
      return NextResponse.json({ ok: false, error: "Geen content ontvangen van OpenAI." }, { status: 500 });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return NextResponse.json({ ok: false, error: "OpenAI response was not valid JSON." }, { status: 500 });
    }

    // ---------- 5) Validatie ----------
    const valid =
      parsed &&
      parsed.meta &&
      typeof parsed.meta.title === "string" && parsed.meta.title.trim().length > 0 &&
      typeof parsed.meta.description === "string" && parsed.meta.description.trim().length > 0 &&
      typeof parsed.meta.h1 === "string" && parsed.meta.h1.trim().length > 0 &&
      typeof parsed.artikeltekst === "string" && parsed.artikeltekst.trim().length > 0 &&
      parsed.faq_schema && typeof parsed.faq_schema === "object" &&
      parsed.keywords_used && typeof parsed.keywords_used === "object" &&
      typeof parsed.keywords_used.primary === "string" &&
      Array.isArray(parsed.keywords_used.secondary) &&
      Array.isArray(parsed.suggested_keywords);

    if (!valid) {
      return NextResponse.json(
        { ok: false, error: "OpenAI JSON-structuur is ongeldig of bevat lege velden." },
        { status: 500 }
      );
    }

    // ---------- 6) Succes ----------
    return NextResponse.json({
      ...parsed,
      ahrefs_keywords: ahrefsKeywords, // extra veld voor je UI
    });

  } catch (e: any) {
    const msg =
      e?.response?.data?.error?.message ||
      e?.error?.message ||
      e?.message ||
      "Onbekende fout";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}