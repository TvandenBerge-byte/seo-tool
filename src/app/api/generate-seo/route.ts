/* eslint-disable @typescript-eslint/no-explicit-any */


import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

type PageType = "complaint" | "treatment";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY ontbreekt" },
        { status: 500 }
      );
    }

    const body: unknown = await req.json().catch(() => null);
    const { topic, pageType } =
      (body as { topic?: string; pageType?: PageType }) || {};

    if (!topic || !pageType) {
      return NextResponse.json(
        { ok: false, error: "topic en pageType zijn verplicht" },
        { status: 400 }
      );
    }

    const client = new OpenAI({ apiKey });

    const r = await client.chat.completions.create({
      model,
      temperature: 0.3,
      max_tokens: 2500,
      messages: [
        {
          role: "system",
          content:
            `Je bent een professionele SEO-tekstschrijver gespecialiseerd in fysiotherapie. 
Je schrijft complete, leesvriendelijke Nederlandstalige teksten op basis van samenvattingen van betrouwbare bronnen zoals B-Fysic, Fysiotherapie Achtse Barrier en Thuisarts.nl.
Gebruik altijd de H1 en H2-structuur zoals opgegeven in de instructies.
Verwerk antwoorden onder elke H2 op basis van de genoemde bronnen en algemene medische kennis.
Integreer relevante zoekwoorden natuurlijk, schrijf warm en informatief, en voeg altijd een duidelijke call-to-action toe.`,
        },
        {
          role: "user",
          content:
            `Schrijf een volledige SEO-geoptimaliseerde pagina over: ${topic} (${pageType}).
Structuur:
- H1: ${topic}
- H2: Wat is ${topic}?
- H2: Oorzaken van ${topic}
- H2: Symptomen van ${topic}
- H2: Behandelopties bij ${topic}
- H2: Veelgestelde vragen (7 stuks met uitgebreide antwoorden)
- H2: Direct een afspraak maken
Zorg dat alle antwoorden correct, volledig en op basis van de bronnen zijn samengevat.`,
        },
      ],
    });

    const content = r.choices[0]?.message?.content?.trim() || "(geen content)";
    return NextResponse.json({ ok: true, content });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Onbekende fout";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}