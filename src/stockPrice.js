(function () {
  const FETCH_TIMEOUT_MS = 6000;
  const PRICE_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

  function toYahooSymbol(symbol, market) {
    return market === 'TW' ? `${symbol}.TW` : symbol;
  }

  async function refreshPrices(symbolEntries) {
    const storage = window.PFD.storage;
    const cache = storage.loadPriceCache();
    const result = new Map();

    if (symbolEntries.length === 0) return result;

    const yahooSymbols = symbolEntries.map((e) => toYahooSymbol(e.symbol, e.market));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let liveData = null;
    try {
      const apiBaseUrl = window.PFD.config?.apiBaseUrl || '';
      const res = await fetch(
        `${apiBaseUrl}/api/stock-price?symbols=${encodeURIComponent(yahooSymbols.join(','))}`,
        { signal: controller.signal }
      );
      if (res.ok) {
        liveData = await res.json();
      }
    } catch {
      liveData = null;
    } finally {
      clearTimeout(timeout);
    }

    symbolEntries.forEach((entry, i) => {
      const yahooSymbol = yahooSymbols[i];
      const live = liveData ? liveData[yahooSymbol] : null;
      if (live && typeof live.price === 'number') {
        const fresh = { price: live.price, currency: live.currency, fetchedAt: live.fetchedAt, source: 'live' };
        cache[entry.symbol] = fresh;
        result.set(entry.symbol, fresh);
      } else if (cache[entry.symbol]) {
        result.set(entry.symbol, { ...cache[entry.symbol], source: 'cache' });
      } else {
        result.set(entry.symbol, null);
      }
    });

    storage.savePriceCache(cache);
    return result;
  }

  function resolveCurrentPrice(symbol, { priceOverrides, priceCache, avgCost }) {
    if (typeof priceOverrides[symbol] === 'number') {
      return { value: priceOverrides[symbol], source: 'override', fetchedAt: null };
    }
    const cached = priceCache[symbol];
    if (cached && typeof cached.price === 'number') {
      const stillLive = cached.source === 'live' && !isPriceStale('live', cached.fetchedAt);
      return { value: cached.price, source: stillLive ? 'live' : 'cache', fetchedAt: cached.fetchedAt || null };
    }
    return { value: avgCost, source: 'estimate', fetchedAt: null };
  }

  function isPriceStale(source, fetchedAt) {
    if (source === 'override') return false;
    if (!fetchedAt) return true;
    return Date.now() - new Date(fetchedAt).getTime() > PRICE_STALE_THRESHOLD_MS;
  }

  window.PFD = window.PFD || {};
  window.PFD.stockPrice = {
    toYahooSymbol,
    refreshPrices,
    resolveCurrentPrice,
    isPriceStale,
    PRICE_STALE_THRESHOLD_MS,
  };
})();
