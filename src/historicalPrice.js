(function () {
  const FETCH_TIMEOUT_MS = 6000;

  function findCloseOnOrBefore(prices, dateStr) {
    if (!Array.isArray(prices) || prices.length === 0) return null;
    let lo = 0;
    let hi = prices.length - 1;
    let result = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (prices[mid].date <= dateStr) {
        result = prices[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result ? result.close : null;
  }

  function findGaps(symbolDateRanges, cache) {
    return symbolDateRanges.filter(({ symbol, fromDate, toDate }) => {
      const cached = cache[symbol];
      if (!cached) return true;
      return cached.rangeStart > fromDate || cached.rangeEnd < toDate;
    });
  }

  async function fetchHistoricalPrices(gapEntries) {
    const storage = window.PFD.storage;
    const stockPrice = window.PFD.stockPrice;
    const cache = storage.loadHistoricalPriceCache();

    if (gapEntries.length === 0) return cache;

    const fromDate = gapEntries.reduce(
      (min, e) => (e.fromDate < min ? e.fromDate : min),
      gapEntries[0].fromDate,
    );
    const toDate = gapEntries.reduce(
      (max, e) => (e.toDate > max ? e.toDate : max),
      gapEntries[0].toDate,
    );
    const period1 = Math.floor(new Date(fromDate).getTime() / 1000);
    const period2 = Math.floor(new Date(toDate).getTime() / 1000) + 86400;

    const yahooSymbols = gapEntries.map((e) =>
      stockPrice.toYahooSymbol(e.symbol, e.market),
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let data = null;
    try {
      const apiBaseUrl = window.PFD.config?.apiBaseUrl || '';
      const res = await fetch(
        `${apiBaseUrl}/api/historical-price?symbols=${encodeURIComponent(yahooSymbols.join(','))}&period1=${period1}&period2=${period2}&interval=1d`,
        { signal: controller.signal },
      );
      if (res.ok) {
        data = await res.json();
      }
    } catch {
      data = null;
    } finally {
      clearTimeout(timeout);
    }

    if (data) {
      gapEntries.forEach((entry, i) => {
        const yahooSymbol = yahooSymbols[i];
        const prices = data[yahooSymbol];
        if (Array.isArray(prices)) {
          cache[entry.symbol] = {
            prices,
            rangeStart: fromDate,
            rangeEnd: toDate,
            fetchedAt: new Date().toISOString(),
          };
        }
      });
      storage.saveHistoricalPriceCache(cache);
    }

    return cache;
  }

  function buildResolver(cache) {
    return (symbol, dateStr) =>
      findCloseOnOrBefore(cache[symbol]?.prices || [], dateStr);
  }

  window.PFD = window.PFD || {};
  window.PFD.historicalPrice = {
    findCloseOnOrBefore,
    findGaps,
    fetchHistoricalPrices,
    buildResolver,
  };
})();
