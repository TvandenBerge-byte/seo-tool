'use client';

import { useState } from 'react';

type PageType = 'complaint' | 'treatment';

interface ApiOk {
  ok: true;
  content: string;
}
interface ApiErr {
  ok: false;
  error: string;
}
type ApiResponse = ApiOk | ApiErr;

export default function Home() {
  const [topic, setTopic] = useState<string>('tenniselleboog');
  const [pageType, setPageType] = useState<PageType>('complaint');
  const [loading, setLoading] = useState<boolean>(false);
  const [out, setOut] = useState<string>('');
  const [err, setErr] = useState<string>('');

  async function generate() {
    setLoading(true);
    setErr('');
    setOut('');

    try {
      const res = await fetch('/api/generate-seo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, pageType }),
        cache: 'no-store',
      });

      const data: unknown = await res.json();

      // Foutafhandeling op basis van ons API-schema
      if (!res.ok) {
        const msg =
          typeof data === 'object' &&
          data !== null &&
          'error' in data &&
          typeof (data as ApiErr).error === 'string'
            ? (data as ApiErr).error
            : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const okData =
        typeof data === 'object' &&
        data !== null &&
        'ok' in data &&
        (data as ApiOk).ok === true &&
        'content' in data &&
        typeof (data as ApiOk).content === 'string'
          ? (data as ApiOk)
          : null;

      if (!okData) throw new Error('Onverwacht API‑antwoord');

      setOut(okData.content || '(geen content)');
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : typeof e === 'string' ? e : 'Onbekende fout';
      setErr(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 800, margin: '40px auto', padding: 16, fontFamily: 'system-ui' }}>
      <h1>SEO Generator (test)</h1>

      <label style={{ display: 'block', marginTop: 12 }}>
        Onderwerp (topic)
        <input
          value={topic}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTopic(e.target.value)}
          style={{ width: '100%', padding: 8, marginTop: 6 }}
          placeholder="bijv. tenniselleboog"
        />
      </label>

      <label style={{ display: 'block', marginTop: 12 }}>
        Pagina type
        <select
          value={pageType}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setPageType(e.target.value as PageType)
          }
          style={{ width: '100%', padding: 8, marginTop: 6 }}
        >
          <option value="complaint">Klachtenpagina</option>
          <option value="treatment">Behandelpagina</option>
        </select>
      </label>

      <button
        onClick={generate}
        disabled={loading}
        style={{ marginTop: 14, padding: '10px 14px', cursor: 'pointer' }}
        aria-busy={loading}
      >
        {loading ? 'Bezig…' : 'Genereer tekst'}
      </button>

      {err && <p style={{ color: 'crimson', marginTop: 14 }}>Fout: {err}</p>}

      {out && (
        <section style={{ marginTop: 20, whiteSpace: 'pre-wrap' }}>
          <h2>Resultaat</h2>
          <div>{out}</div>
        </section>
      )}
    </main>
  );
}