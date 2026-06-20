(function () {
  const KEYS = {
    TX_TW: 'pfd.transactions.tw',
    TX_US: 'pfd.transactions.us',
    PRICE_CACHE: 'pfd.priceCache',
    PRICE_OVERRIDES: 'pfd.priceOverrides',
    FX_CACHE: 'pfd.exchangeRate.cache',
    UI_FILTERS: 'pfd.ui.lastFilters',
    UNEXPORTED_COUNT: 'pfd.ui.unexportedChangeCount',
    THEME: 'pfd.ui.theme',
  };

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore quota/availability errors, app keeps working in-memory for this render
    }
  }

  function txKey(market) {
    return market === 'TW' ? KEYS.TX_TW : KEYS.TX_US;
  }

  function loadTransactions(market) {
    return readJson(txKey(market), []);
  }

  function saveTransactions(market, txArray) {
    writeJson(txKey(market), txArray);
  }

  function addTransaction(market, tx) {
    const list = loadTransactions(market);
    const withId = { ...tx, id: crypto.randomUUID(), market };
    list.push(withId);
    saveTransactions(market, list);
    return withId;
  }

  function replaceTransactions(market, rows) {
    const withIds = rows.map((tx) => ({ ...tx, id: crypto.randomUUID(), market }));
    saveTransactions(market, withIds);
    return withIds;
  }

  function deleteTransaction(market, id) {
    const list = loadTransactions(market).filter((tx) => tx.id !== id);
    saveTransactions(market, list);
  }

  function loadPriceCache() {
    return readJson(KEYS.PRICE_CACHE, {});
  }

  function savePriceCache(cache) {
    writeJson(KEYS.PRICE_CACHE, cache);
  }

  function loadPriceOverrides() {
    return readJson(KEYS.PRICE_OVERRIDES, {});
  }

  function savePriceOverride(symbol, price) {
    const overrides = loadPriceOverrides();
    overrides[symbol] = price;
    writeJson(KEYS.PRICE_OVERRIDES, overrides);
  }

  function clearPriceOverride(symbol) {
    const overrides = loadPriceOverrides();
    delete overrides[symbol];
    writeJson(KEYS.PRICE_OVERRIDES, overrides);
  }

  function loadFxCache() {
    return readJson(KEYS.FX_CACHE, null);
  }

  function saveFxCache(fxObj) {
    writeJson(KEYS.FX_CACHE, fxObj);
  }

  function loadUiFilters() {
    return readJson(KEYS.UI_FILTERS, null);
  }

  function saveUiFilters(filters) {
    writeJson(KEYS.UI_FILTERS, filters);
  }

  function loadUnexportedChangeCount() {
    return readJson(KEYS.UNEXPORTED_COUNT, 0);
  }

  function incrementUnexportedChanges() {
    const count = loadUnexportedChangeCount() + 1;
    writeJson(KEYS.UNEXPORTED_COUNT, count);
    return count;
  }

  function resetUnexportedChanges() {
    writeJson(KEYS.UNEXPORTED_COUNT, 0);
  }

  function loadTheme() {
    return readJson(KEYS.THEME, 'neon');
  }

  function saveTheme(theme) {
    writeJson(KEYS.THEME, theme);
  }

  window.PFD = window.PFD || {};
  window.PFD.storage = {
    KEYS,
    loadTransactions,
    saveTransactions,
    addTransaction,
    replaceTransactions,
    deleteTransaction,
    loadPriceCache,
    savePriceCache,
    loadPriceOverrides,
    savePriceOverride,
    clearPriceOverride,
    loadFxCache,
    saveFxCache,
    loadUiFilters,
    saveUiFilters,
    loadUnexportedChangeCount,
    incrementUnexportedChanges,
    resetUnexportedChanges,
    loadTheme,
    saveTheme,
  };
})();
