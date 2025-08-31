/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState } from 'react';

type PageType = 'complaint' | 'treatment';
type FaqItem = { q: string; a: string };

type ApiShapeNow = {
  artikeltekst?: string;                 // HTML
  faq_schema?: Record<string, any>;      // JSON-LD
  keywords_used?: { primary?: string; secondary?: string[] };
  suggested_keywords?: string[];
};

type ApiShapeRich = {
  content_markdown?: string;             // Markdown/tekst
  meta?: { title?: string; description?: string; h1?: string };
  keywords?: { primary?: string; secondary?: string[] };
  faq?: FaqItem[];
};

type ApiShapeLegacy = {
  content?: string;
};

type ApiOk  = { ok?: true }  & ApiShapeNow & ApiShapeRich & ApiShapeLegacy;
type ApiErr = { ok?: false; error?: string };

export default function Home() {
  // verplichte velden
  const [topic, setTopic] = useState('tenniselleboog');
  const [pageType, setPageType] = useState<PageType>('complaint');

  // extra (optioneel) velden
  const [praktijknaam, setPraktijknaam] = useState('FysioPraktijk Voorbeeld');
  const [locatie, setLocatie]         = useState('Amsterdam');
  const [secundaire, setSecundaire]   = useState('elleboogpijn, peesontsteking');
  const [onderwerpH1, setOnderwerpH1] = useState('');
  const [woordRange, setWoordRange]   = useState('1000-1400');
  const [telefoon, setTelefoon]       = useState('020-1234567');
  const [email, setEmail]             = useState('info@fysiovoorbeeld.nl');
  const [doelgroep, setDoelgroep]     = useState(
    'Sporters en mensen met overbelastingsklachten aan de elleboog.'
  );
  const [usp, setUsp] = useState(
    'Persoonlijke behandeling, snelle diagnose en effectieve revalidatie.'
  );

  // UI-state
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [view, setView] = useState<{
    h1?: string;
    metaTitle?: string;
    metaDesc?: string;
    usedPrimary?: string;
    usedSecondary?: string[];
    suggested?: string[];
    bodyHTML?: string;         // HTML
    bodyText?: string;         // Markdown/tekst
    faq?: FaqItem[];
    faqSchema?: Record<string, any>;
    raw?: any;
  } | null>(null);

  async function generate() {
    setLoading(true);
    setErr('');
    setView(null);

    try {
      const res = await fetch('/api/generate-seo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          topic,
          pageType,
          praktijknaam,
          locatie,
          doelgroep,
          usp,
          secundaire_keywords: secundaire,
          long_article_length_range: woordRange,
          telefoon,
          email,
          onderwerp: onderwerpH1,
        }),
      });

      const data: ApiOk | ApiErr = await res.json();

      if (!res.ok) {
        const msg = (data as ApiErr)?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      // ---- Normalisatie van velden uit álle varianten ----
      const now    = data as ApiShapeNow;
      const rich   = data as ApiShapeRich;
      const legacy = data as ApiShapeLegacy;

      const h1 =
        rich?.meta?.h1 ||
        (onderwerpH1 || `${topic}${locatie ? ` in ${locatie}` : ''}`);

      const metaTitle = rich?.meta?.title;
      const metaDesc  = rich?.meta?.description;

      const usedPrimary   = now?.keywords_used?.primary ?? rich?.keywords?.primary ?? '';
      const usedSecondary = now?.keywords_used?.secondary ?? rich?.keywords?.secondary ?? [];

      const suggested = now?.suggested_keywords ?? [];

      const bodyHTML = now?.artikeltekst; // HTML
      const bodyText = rich?.content_markdown ?? legacy?.content ?? undefined;

      const faq       = rich?.faq ?? [];
      const faqSchema = now?.faq_schema;

      if (!bodyHTML && !bodyText) {
        throw new Error('API gaf geen artikeltekst terug.');
      }

      setView({
        h1,
        metaTitle,
        metaDesc,
        usedPrimary: usedPrimary || undefined,
        usedSecondary,
        suggested,
        bodyHTML,
        bodyText,
        faq,
        faqSchema,
        raw: data,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Onbekende fout');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: '40px auto', padding: 16, fontFamily: 'system-ui' }}>
      <h1>SEO Generator (test)</h1>

      {/* Basisinputs */}
      <label style={{ display: 'block', marginTop: 12 }}>
        Onderwerp (topic)
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          style={{ width: '100%', padding: 8, marginTop: 6 }}
          placeholder="bijv. tenniselleboog"
        />
      </label>

      <label style={{ display: 'block', marginTop: 12 }}>
        Pagina type
        <select
          value={pageType}
          onChange={(e) => setPageType(e.target.value as PageType)}
          style={{ width: '100%', padding: 8, marginTop: 6 }}
        >
          <option value="complaint">Klachtenpagina</option>
          <option value="treatment">Behandelpagina</option>
        </select>
      </label>

      {/* Extra context */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <label>
          Praktijknaam
          <input value={praktijknaam} onChange={(e) => setPraktijknaam(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 6 }} />
        </label>
        <label>
          Locatie
          <input value={locatie} onChange={(e) => setLocatie(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 6 }} />
        </label>
        <label>
          Secundaire keywords (komma’s)
          <input value={secundaire} onChange={(e) => setSecundaire(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 6 }} />
        </label>
        <label>
          Onderwerp (H1 override, optioneel)
          <input value={onderwerpH1} onChange={(e) => setOnderwerpH1(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 6 }} placeholder="leeg laten = automatische H1" />
        </label>
        <label>
          Woordenaantal (min-max)
          <input value={woordRange} onChange={(e) => setWoordRange(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 6 }} placeholder="bijv. 1000-1400" />
        </label>
        <label>
          Telefoon
          <input value={telefoon} onChange={(e) => setTelefoon(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 6 }} />
        </label>
        <label>
          E-mail
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 6 }} />
        </label>
      </div>

      <label style={{ display: 'block', marginTop: 12 }}>
        Doelgroep
        <textarea value={doelgroep} onChange={(e) => setDoelgroep(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 6 }} rows={2} />
      </label>

      <label style={{ display: 'block', marginTop: 12 }}>
        Unique Selling Proposition (USP)
        <textarea value={usp} onChange={(e) => setUsp(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 6 }} rows={2} />
      </label>

      <div style={{ marginTop: 16 }}>
    <button
  style={{ marginTop: 16, padding: '8px 12px', borderRadius: 8 }}
  disabled={loading}
  onClick={generate}
>
  {loading ? 'Bezig...' : 'Genereer content'}
</button>
      </div>

      {err && <p style={{ color: 'crimson', marginTop: 14 }}>Fout: {err}</p>}

      {/* Resultaat */}
      {view && (
        <section style={{ marginTop: 24 }}>
          <h2>Gegenereerde content</h2>

          {(view.metaTitle || view.metaDesc || view.h1) && (
            <div style={{ margin: '12px 0' }}>
              {view.metaTitle && <div><strong>Meta title:</strong> {view.metaTitle}</div>}
              {view.metaDesc  && <div><strong>Meta description:</strong> {view.metaDesc}</div>}
              {view.h1        && <div><strong>H1:</strong> {view.h1}</div>}
            </div>
          )}

          {(view.usedPrimary || (view.usedSecondary && view.usedSecondary.length)) && (
            <div style={{ margin: '12px 0' }}>
              {view.usedPrimary && <div><strong>Primair keyword:</strong> {view.usedPrimary}</div>}
              {!!(view.usedSecondary?.length) && (
                <div><strong>Secundaire keywords:</strong> {view.usedSecondary.join(', ')}</div>
              )}
            </div>
          )}

          {!!(view.suggested?.length) && (
            <div style={{ margin: '12px 0' }}>
              <strong>Voorgestelde keywords:</strong> {view.suggested.join(', ')}
            </div>
          )}

          {/* HTML artikel */}
          {view.bodyHTML && (
            <article
              style={{ marginTop: 12 }}
              className="prose"
              dangerouslySetInnerHTML={{ __html: view.bodyHTML }}
            />
          )}

          {/* Tekst/Markdown fallback */}
          {view.bodyText && !view.bodyHTML && (
            <article style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>
              {view.bodyText}
            </article>
          )}

          {/* FAQ Schema */}
          {view.faqSchema && (
            <div style={{ marginTop: 16 }}>
              <h3>FAQ Schema (JSON-LD)</h3>
              <pre style={{ background: '#f6f6f6', padding: 12, overflowX: 'auto' }}>
                {JSON.stringify(view.faqSchema, null, 2)}
              </pre>
            </div>
          )}

          {/* FAQ lijst */}
          {!!(view.faq && view.faq.length) && (
            <div style={{ marginTop: 16 }}>
              <h3>FAQ</h3>
              <ul>
                {view.faq.map((f, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>
                    <strong>{f.q}</strong>
                    <div>{f.a}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}