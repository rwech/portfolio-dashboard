const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const FETCH_TIMEOUT_MS = 6000;

// Override via the ALLOWED_ORIGINS env var (comma-separated) on Vercel without a code change.
const DEFAULT_ALLOWED_ORIGINS = ['https://rwech.github.io'];

function isAllowedOrigin(origin) {
  const allowed = (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

async function fetchYahooChart(yahooSymbol) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${YAHOO_CHART_URL}${encodeURIComponent(yahooSymbol)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
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

export default async function handler(req, res) {
  const origin = req.headers.origin;

  // Same-origin requests (e.g. the all-in-on-Vercel deploy mode) typically don't send an
  // Origin header at all, so only enforce the whitelist when one is actually present.
  if (origin && !isAllowedOrigin(origin)) {
    res.status(403).json({ error: 'origin not allowed' });
    return;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const symbols = String(req.query.symbols || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    res.status(400).json({ error: 'missing symbols query param' });
    return;
  }

  const results = await Promise.allSettled(symbols.map(fetchYahooChart));

  const body = {};
  symbols.forEach((symbol, i) => {
    const result = results[i];
    body[symbol] = result.status === 'fulfilled' ? result.value : null;
  });

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  res.status(200).json(body);
}
