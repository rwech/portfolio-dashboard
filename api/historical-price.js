const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const FETCH_TIMEOUT_MS = 6000;

// Override via the ALLOWED_ORIGINS env var (comma-separated) on Vercel without a code change.
const DEFAULT_ALLOWED_ORIGINS = ['https://rwech.github.io'];

function isAllowedOrigin(origin) {
  const allowed = (
    process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(',')
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin);
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

  const period1 = Number(req.query.period1);
  const period2 = Number(req.query.period2);
  const interval = String(req.query.interval || '1d');

  if (symbols.length === 0) {
    res.status(400).json({ error: 'missing symbols query param' });
    return;
  }
  if (
    !Number.isFinite(period1) ||
    !Number.isFinite(period2) ||
    period2 <= period1
  ) {
    res.status(400).json({ error: 'invalid period1/period2 query params' });
    return;
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

  // Past closes never change, so this can be cached far more aggressively than the live-price endpoint.
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=300');
  res.status(200).json(body);
}
