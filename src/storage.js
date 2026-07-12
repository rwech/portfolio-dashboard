(function () {
  const KEYS = {
    TX_TW: 'pfd.transactions.tw',
    TX_US: 'pfd.transactions.us',
    PRICE_CACHE: 'pfd.priceCache',
    HISTORICAL_PRICE_CACHE: 'pfd.historicalPriceCache',
    SPLIT_EVENTS_CACHE: 'pfd.splitEventsCache',
    SEEN_SPLITS: 'pfd.seenSplits',
    PRICE_OVERRIDES: 'pfd.priceOverrides',
    FX_CACHE: 'pfd.exchangeRate.cache',
    UI_FILTERS: 'pfd.ui.lastFilters',
    UNEXPORTED_COUNT: 'pfd.ui.unexportedChangeCount',
    THEME: 'pfd.ui.theme',
    IMPORT_MAPPINGS: 'pfd.importMappings',
  };

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      // only enforce array shape when the caller expects an array
      if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
      return parsed;
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
    return readJson(txKey(market), []).map((tx) =>
      typeof tx.action === 'string'
        ? { ...tx, action: tx.action.toLowerCase() }
        : tx,
    );
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
    const withIds = rows.map((tx) => ({
      ...tx,
      id: crypto.randomUUID(),
      market,
    }));
    saveTransactions(market, withIds);
    return withIds;
  }

  // Re-inserts a previously deleted transaction as-is (keeps its original id),
  // unlike addTransaction which always generates a fresh id. Used by undo.
  function restoreTransaction(market, tx) {
    const list = loadTransactions(market);
    list.push({ ...tx });
    saveTransactions(market, list);
    return tx;
  }

  // Bulk insert for CSV import: one read + one write instead of the
  // per-row read/write addTransaction would do (O(n²) on large files).
  // Rows are expected to already carry their own id (from the import parser).
  function appendTransactions(market, rows) {
    const list = loadTransactions(market);
    rows.forEach((tx) => list.push({ ...tx, market }));
    saveTransactions(market, list);
    return list;
  }

  function deleteTransaction(market, id) {
    const list = loadTransactions(market).filter((tx) => tx.id !== id);
    saveTransactions(market, list);
  }

  function updateTransaction(market, id, updates) {
    const list = loadTransactions(market);
    const idx = list.findIndex((tx) => tx.id === id);
    if (idx === -1) return null;
    const updated = { ...list[idx], ...updates, id, market };
    list[idx] = updated;
    saveTransactions(market, list);
    return updated;
  }

  function loadPriceCache() {
    return readJson(KEYS.PRICE_CACHE, {});
  }

  function savePriceCache(cache) {
    writeJson(KEYS.PRICE_CACHE, cache);
  }

  function loadHistoricalPriceCache() {
    return readJson(KEYS.HISTORICAL_PRICE_CACHE, {});
  }

  function saveHistoricalPriceCache(cache) {
    writeJson(KEYS.HISTORICAL_PRICE_CACHE, cache);
  }

  function loadSplitEventsCache() {
    return readJson(KEYS.SPLIT_EVENTS_CACHE, {});
  }

  function saveSplitEventsCache(cache) {
    writeJson(KEYS.SPLIT_EVENTS_CACHE, cache);
  }

  function loadSeenSplits() {
    return readJson(KEYS.SEEN_SPLITS, []);
  }

  function saveSeenSplits(list) {
    writeJson(KEYS.SEEN_SPLITS, list);
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

  function decrementUnexportedChanges() {
    const count = Math.max(0, loadUnexportedChangeCount() - 1);
    writeJson(KEYS.UNEXPORTED_COUNT, count);
    return count;
  }

  function resetUnexportedChanges() {
    writeJson(KEYS.UNEXPORTED_COUNT, 0);
  }

  function loadImportMapping(signature) {
    const mappings = readJson(KEYS.IMPORT_MAPPINGS, {});
    return mappings[signature] || null;
  }

  function saveImportMapping(signature, mapping) {
    const mappings = readJson(KEYS.IMPORT_MAPPINGS, {});
    mappings[signature] = mapping;
    writeJson(KEYS.IMPORT_MAPPINGS, mappings);
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
    restoreTransaction,
    replaceTransactions,
    appendTransactions,
    deleteTransaction,
    updateTransaction,
    loadPriceCache,
    savePriceCache,
    loadHistoricalPriceCache,
    saveHistoricalPriceCache,
    loadSplitEventsCache,
    saveSplitEventsCache,
    loadSeenSplits,
    saveSeenSplits,
    loadPriceOverrides,
    savePriceOverride,
    clearPriceOverride,
    loadFxCache,
    saveFxCache,
    loadUiFilters,
    saveUiFilters,
    loadUnexportedChangeCount,
    incrementUnexportedChanges,
    decrementUnexportedChanges,
    resetUnexportedChanges,
    loadTheme,
    saveTheme,
    loadImportMapping,
    saveImportMapping,
  };
})();
