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
    const splitCache = storage.loadSplitEventsCache();

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
      const fetchedAt = new Date().toISOString();
      gapEntries.forEach((entry, i) => {
        const yahooSymbol = yahooSymbols[i];
        const result = data[yahooSymbol];
        const prices = result?.prices;
        if (Array.isArray(prices)) {
          cache[entry.symbol] = {
            prices,
            rangeStart: fromDate,
            rangeEnd: toDate,
            fetchedAt,
          };
          splitCache[entry.symbol] = {
            splits: Array.isArray(result.splits) ? result.splits : [],
            rangeStart: fromDate,
            rangeEnd: toDate,
            fetchedAt,
          };
        }
      });
      storage.saveHistoricalPriceCache(cache);
      storage.saveSplitEventsCache(splitCache);
    }

    return cache;
  }

  // 每個 symbol 的股價還原（除以分割比例）只算一次並快取在這個 closure 裡，
  // 即使同一個 resolver 之後被呼叫多次（例如 ROI 趨勢圖逐月取價）。
  function buildResolver(cache, splitEventsCache = {}) {
    const splitEvents = window.PFD.splitEvents;
    const adjustedBySymbol = {};

    function adjustedPricesFor(symbol) {
      if (!(symbol in adjustedBySymbol)) {
        adjustedBySymbol[symbol] = splitEvents.adjustPricesForSplits(
          cache[symbol]?.prices || [],
          splitEventsCache[symbol]?.splits || [],
        );
      }
      return adjustedBySymbol[symbol];
    }

    return (symbol, dateStr) =>
      findCloseOnOrBefore(adjustedPricesFor(symbol), dateStr);
  }

  window.PFD = window.PFD || {};
  window.PFD.historicalPrice = {
    findCloseOnOrBefore,
    findGaps,
    fetchHistoricalPrices,
    buildResolver,
  };
})();
