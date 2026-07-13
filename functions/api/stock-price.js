// Cloudflare Pages Function equivalent of api/stock-price.js (Vercel). Same behavior,
// adapted to the Pages Functions signature: onRequest* receives a context object and
// returns a Response, instead of Vercel's (req, res) callback style.
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const FETCH_TIMEOUT_MS = 6000;

// Override via the ALLOWED_ORIGINS environment variable (comma-separated) in the
// Cloudflare Pages dashboard without a code change.
const DEFAULT_ALLOWED_ORIGINS = ['https://rwech.github.io'];

function isAllowedOrigin(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

async function fetchYahooChart(yahooSymbol) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${YAHOO_CHART_URL}${encodeURIComponent(yahooSymbol)}`,
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;
    return {
      price: meta.regularMarketPrice,
      currency: meta.currency || null,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestOptions({ request, env }) {
  const origin = request.headers.get('origin');
  if (origin && !isAllowedOrigin(origin, env)) {
    return new Response(JSON.stringify({ error: 'origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get('origin');

  // Same-origin requests (the all-in-one-on-Cloudflare-Pages deploy mode) typically
  // don't send an Origin header at all, so only enforce the whitelist when present.
  if (origin && !isAllowedOrigin(origin, env)) {
    return new Response(JSON.stringify({ error: 'origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders(origin),
  };

  const url = new URL(request.url);
  const symbols = (url.searchParams.get('symbols') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    return new Response(
      JSON.stringify({ error: 'missing symbols query param' }),
      { status: 400, headers },
    );
  }

  const results = await Promise.allSettled(symbols.map(fetchYahooChart));

  const body = {};
  symbols.forEach((symbol, i) => {
    const result = results[i];
    body[symbol] = result.status === 'fulfilled' ? result.value : null;
  });

  headers['Cache-Control'] = 's-maxage=60, stale-while-revalidate=30';
  return new Response(JSON.stringify(body), { status: 200, headers });
}
