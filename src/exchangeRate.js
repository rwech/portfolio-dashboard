(function () {
  const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
  const FX_TTL_MS = 60 * 60 * 1000; // 1 hour
  const FETCH_TIMEOUT_MS = 6000;

  function isFresh(cache) {
    if (!cache || !cache.fetchedAt) return false;
    return Date.now() - new Date(cache.fetchedAt).getTime() < FX_TTL_MS;
  }

  async function getExchangeRate({ forceRefresh = false } = {}) {
    const storage = window.PFD.storage;
    const cache = storage.loadFxCache();

    if (!forceRefresh && isFresh(cache)) {
      return { ...cache, source: 'cache' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(FX_ENDPOINT, { signal: controller.signal });
      const json = await res.json();
      if (json?.result !== 'success' || typeof json?.rates?.TWD !== 'number') {
        throw new Error('unexpected response shape');
      }
      const fresh = {
        rate: json.rates.TWD,
        base: 'USD',
        quote: 'TWD',
        fetchedAt: new Date().toISOString(),
      };
      storage.saveFxCache(fresh);
      return { ...fresh, source: 'live' };
    } catch {
      if (cache) {
        return { ...cache, source: 'stale-cache' };
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  function usdToTwd(amountUsd, rate) {
    return amountUsd * rate;
  }

  function twdToUsd(amountTwd, rate) {
    if (!rate) return NaN;
    return amountTwd / rate;
  }

  window.PFD = window.PFD || {};
  window.PFD.exchangeRate = {
    getExchangeRate,
    usdToTwd,
    twdToUsd,
  };
})();
