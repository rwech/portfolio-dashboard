// Cloudflare Pages Function equivalent of api/historical-price.js (Vercel). Same
// behavior, adapted to the Pages Functions signature: onRequest* receives a context
// object and returns a Response, instead of Vercel's (req, res) callback style.
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

async function fetchYahooHistorical(yahooSymbol, period1, period2, interval) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${YAHOO_CHART_URL}${encodeURIComponent(yahooSymbol)}?period1=${period1}&period2=${period2}&interval=${interval}`,
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(timestamps) || !Array.isArray(closes)) return null;

    const prices = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      const close = closes[i];
      if (typeof close !== 'number' || !Number.isFinite(close)) continue;
      const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      prices.push({ date, close });
    }
    prices.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return prices;
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
  const period1 = Number(url.searchParams.get('period1'));
  const period2 = Number(url.searchParams.get('period2'));
  const interval = url.searchParams.get('interval') || '1d';

  if (symbols.length === 0) {
    return new Response(
      JSON.stringify({ error: 'missing symbols query param' }),
      { status: 400, headers },
    );
  }
  if (
    !Number.isFinite(period1) ||
    !Number.isFinite(period2) ||
    period2 <= period1
  ) {
    return new Response(
      JSON.stringify({ error: 'invalid period1/period2 query params' }),
      { status: 400, headers },
    );
  }

  const results = await Promise.allSettled(
    symbols.map((symbol) =>
      fetchYahooHistorical(symbol, period1, period2, interval),
    ),
  );

  const body = {};
  symbols.forEach((symbol, i) => {
    const result = results[i];
    body[symbol] = result.status === 'fulfilled' ? result.value : null;
  });

  // Past closes never change, so this can be cached far more aggressively than the
  // live-price endpoint.
  headers['Cache-Control'] = 's-maxage=3600, stale-while-revalidate=300';
  return new Response(JSON.stringify(body), { status: 200, headers });
}
