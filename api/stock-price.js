const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const FETCH_TIMEOUT_MS = 6000;

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

module.exports = async (req, res) => {
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
};
