(function () {
  const BACKUP_REMINDER_THRESHOLD = 5;

  const storage = window.PFD.storage;
  const csv = window.PFD.csv;
  const exchangeRate = window.PFD.exchangeRate;
  const stockPrice = window.PFD.stockPrice;
  const roi = window.PFD.roi;
  const charts = window.PFD.charts;
  const ui = window.PFD.ui;

  const state = {
    transactions: [],
    priceOverrides: {},
    priceCache: {},
    fxResult: null,
    filters: { year: 'all', market: 'all', displayCurrency: 'TWD' },
    demoMode: false,
    sort: { column: null, direction: 'asc' },
  };

  function compareForSort(a, b, column) {
    const av = a[column];
    const bv = b[column];
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av ?? '').localeCompare(String(bv ?? ''));
    }
    const an = Number.isFinite(av) ? av : -Infinity;
    const bn = Number.isFinite(bv) ? bv : -Infinity;
    return an - bn;
  }

  function sortSymbolPnl(rows, sort) {
    if (!sort.column) return rows;
    const sorted = [...rows].sort((a, b) => compareForSort(a, b, sort.column));
    return sort.direction === 'desc' ? sorted.reverse() : sorted;
  }

  function reloadTransactionsFromStorage() {
    state.transactions = [...storage.loadTransactions('TW'), ...storage.loadTransactions('US')];
  }

  function blockIfDemoMode() {
    if (!state.demoMode) return false;
    alert('示範模式僅供瀏覽範例資料，請先關閉示範模式再進行此操作。');
    return true;
  }

  function currencyFor(market) {
    return market === 'TW' ? 'TWD' : 'USD';
  }

  function render() {
    const priceCtx = { priceOverrides: state.priceOverrides, priceCache: state.priceCache };
    const fxRate = state.fxResult ? state.fxResult.rate : null;

    const fullSummary = roi.computePortfolioSummary(state.transactions, priceCtx, { year: 'all', market: 'all' });
    const filteredSummary = roi.computePortfolioSummary(state.transactions, priceCtx, state.filters);
    const filteredTx = roi.filterTransactions(state.transactions, state.filters);

    const converted = roi.convertSummaryToDisplayCurrency(filteredSummary.byMarket, state.filters.displayCurrency, fxRate);

    const allocationData = {
      TW: roi.convertAmount(filteredSummary.byMarket.TW.costBasisHeld, 'TWD', state.filters.displayCurrency, fxRate),
      US: roi.convertAmount(filteredSummary.byMarket.US.costBasisHeld, 'USD', state.filters.displayCurrency, fxRate),
    };

    const symbolPnl = filteredSummary.perSymbol.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      market: s.market,
      remainingQty: s.remainingQty,
      avgCost: s.avgCost,
      currentPrice: s.currentPrice,
      priceSource: s.priceSource,
      priceFetchedAt: s.priceFetchedAt,
      costBasisHeld: roi.convertAmount(s.costBasisHeld, currencyFor(s.market), state.filters.displayCurrency, fxRate),
      marketValue: roi.convertAmount(s.marketValue, currencyFor(s.market), state.filters.displayCurrency, fxRate),
      realizedGain: roi.convertAmount(s.realizedGain, currencyFor(s.market), state.filters.displayCurrency, fxRate),
      unrealizedGain: roi.convertAmount(s.unrealizedGain, currencyFor(s.market), state.filters.displayCurrency, fxRate),
      roiPct: s.roiPct,
    }));

    const symbolAllocationData = filteredSummary.perSymbol
      .filter((s) => s.remainingQty > 0)
      .map((s) => ({
        symbol: s.symbol,
        value: roi.convertAmount(s.marketValue, currencyFor(s.market), state.filters.displayCurrency, fxRate),
      }));

    ui.renderFilterControls(state);
    ui.renderFxStatusPanel(state.fxResult);
    ui.renderSummaryCards(converted);
    ui.renderTransactionTable(filteredTx, handleDeleteTransaction);
    ui.renderSymbolPnlTable(sortSymbolPnl(symbolPnl, state.sort), state.filters.displayCurrency);
    ui.updateSortIndicators('symbol-pnl-table', state.sort);
    ui.renderPriceOverridePanel(fullSummary.perSymbol, state.priceOverrides, {
      onOverrideChange: handlePriceOverrideChange,
      onOverrideClear: handlePriceOverrideClear,
    });
    ui.renderBackupReminderBanner(storage.loadUnexportedChangeCount(), BACKUP_REMINDER_THRESHOLD);
    ui.renderDemoModeBanner(state.demoMode);
    document.body.classList.toggle('demo-mode-active', state.demoMode);
    charts.renderAllocationChart(document.getElementById('allocation-chart'), allocationData, state.filters.displayCurrency);
    charts.renderSymbolAllocationChart(document.getElementById('symbol-allocation-chart'), symbolAllocationData, state.filters.displayCurrency);

    storage.saveUiFilters(state.filters);
  }

  function handleFilterChange(partial) {
    Object.assign(state.filters, partial);
    render();
  }

  function handleAddTransaction(market, tx) {
    if (blockIfDemoMode()) return;
    storage.addTransaction(market, tx);
    reloadTransactionsFromStorage();
    storage.incrementUnexportedChanges();
    render();
  }

  function handleDeleteTransaction(id, market) {
    if (blockIfDemoMode()) return;
    storage.deleteTransaction(market, id);
    reloadTransactionsFromStorage();
    storage.incrementUnexportedChanges();
    render();
  }

  function handlePriceOverrideChange(symbol, value) {
    if (blockIfDemoMode()) return;
    storage.savePriceOverride(symbol, value);
    state.priceOverrides = storage.loadPriceOverrides();
    render();
  }

  function handlePriceOverrideClear(symbol) {
    if (blockIfDemoMode()) return;
    storage.clearPriceOverride(symbol);
    state.priceOverrides = storage.loadPriceOverrides();
    render();
  }

  function currentlyHeldSymbols() {
    const priceCtx = { priceOverrides: state.priceOverrides, priceCache: state.priceCache };
    const fullSummary = roi.computePortfolioSummary(state.transactions, priceCtx, { year: 'all', market: 'all' });
    return fullSummary.perSymbol
      .filter((s) => s.remainingQty > 0)
      .map((s) => ({ symbol: s.symbol, market: s.market }));
  }

  async function refreshAllPrices() {
    await stockPrice.refreshPrices(currentlyHeldSymbols());
    state.priceCache = storage.loadPriceCache();
    render();
  }

  let isRefreshing = false;

  async function handleRefreshAll() {
    if (isRefreshing) return;
    isRefreshing = true;
    const btn = document.getElementById('refresh-all-btn');
    btn.disabled = true;
    try {
      state.fxResult = await exchangeRate.getExchangeRate({ forceRefresh: true });
      await refreshAllPrices();
    } finally {
      btn.disabled = false;
      isRefreshing = false;
    }
  }

  function handleExport(market) {
    if (blockIfDemoMode()) return;
    const list = storage.loadTransactions(market);
    csv.downloadCsv(csv.fileNameFor(market, ''), csv.stringifyCsv(list));
    storage.resetUnexportedChanges();
    render();
  }

  function loadRowsIntoMarket(rows, market, mode) {
    if (mode === 'replace') {
      storage.replaceTransactions(market, rows);
    } else {
      rows.forEach((row) => storage.addTransaction(market, row));
    }
  }

  function handleReplaceImportText(text, market) {
    if (blockIfDemoMode()) return;
    const { rows, errors } = csv.parseCsv(text, market);
    loadRowsIntoMarket(rows, market, 'replace');
    reloadTransactionsFromStorage();
    const marketLabel = market === 'TW' ? '台股' : '美股';
    ui.renderImportFeedback('import-errors', { notice: `已使用匯入資料取代現有的${marketLabel}交易紀錄（${rows.length} 筆）`, errors });
    render();
  }

  function handleAppendImportText(text, market) {
    if (blockIfDemoMode()) return;
    const { rows, errors } = csv.parseCsv(text, market);
    loadRowsIntoMarket(rows, market, 'append');
    reloadTransactionsFromStorage();
    storage.incrementUnexportedChanges();
    const marketLabel = market === 'TW' ? '台股' : '美股';
    ui.renderImportFeedback('add-tx-import-feedback', { notice: `已新增 ${rows.length} 筆${marketLabel}交易至現有資料`, errors });
    render();
  }

  async function setDemoMode(enabled) {
    state.demoMode = enabled;
    if (enabled) {
      const [tw, us] = await Promise.all([csv.fetchExampleCsv('TW'), csv.fetchExampleCsv('US')]);
      state.transactions = [...tw.rows, ...us.rows];
    } else {
      reloadTransactionsFromStorage();
    }
    render();
  }

  function wireStaticHandlers() {
    ui.initTabs();

    document.getElementById('filter-year').addEventListener('change', (e) => handleFilterChange({ year: e.target.value }));
    document.getElementById('filter-market').addEventListener('change', (e) => handleFilterChange({ market: e.target.value }));
    document.getElementById('filter-currency').addEventListener('change', (e) => handleFilterChange({ displayCurrency: e.target.value }));

    document.getElementById('refresh-all-btn').addEventListener('click', handleRefreshAll);

    document.querySelectorAll('#symbol-pnl-table thead th[data-sort-key]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sortKey;
        if (state.sort.column === key) {
          state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort = { column: key, direction: 'asc' };
        }
        render();
      });
    });

    document.getElementById('add-transaction-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const data = new FormData(form);
      const market = data.get('market');
      const quantity = Number(data.get('quantity'));
      const price = Number(data.get('price'));
      const fee = Number(data.get('fee') || 0);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) {
        alert('股數必須大於 0，單價不可為負數');
        return;
      }
      handleAddTransaction(market, {
        date: data.get('date'),
        symbol: data.get('symbol'),
        name: data.get('name') || '',
        action: data.get('action'),
        quantity,
        price,
        fee,
      });
      form.reset();
    });

    document.getElementById('export-btn').addEventListener('click', () => {
      handleExport(document.getElementById('tx-market-select').value);
    });
    document.getElementById('backup-reminder-export-btn').addEventListener('click', () => {
      handleExport('TW');
      handleExport('US');
    });

    document.getElementById('demo-mode-toggle').addEventListener('change', (e) => setDemoMode(e.target.checked));

    document.getElementById('theme-select').addEventListener('change', (e) => {
      const theme = e.target.value;
      document.documentElement.setAttribute('data-theme', theme);
      storage.saveTheme(theme);
    });

    document.getElementById('import-csv-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const market = document.getElementById('tx-market-select').value;
      const reader = new FileReader();
      reader.onload = () => handleReplaceImportText(String(reader.result), market);
      reader.readAsText(file);
      e.target.value = '';
    });

    document.getElementById('add-tx-import-csv-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const market = document.getElementById('add-tx-import-market-select').value;
      const reader = new FileReader();
      reader.onload = () => handleAppendImportText(String(reader.result), market);
      reader.readAsText(file);
      e.target.value = '';
    });

    window.addEventListener('beforeunload', (e) => {
      if (storage.loadUnexportedChangeCount() > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  async function init() {
    const theme = storage.loadTheme();
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('theme-select').value = theme;

    reloadTransactionsFromStorage();
    if (state.transactions.length === 0) {
      const [tw, us] = await Promise.all([csv.fetchInitialCsv('TW'), csv.fetchInitialCsv('US')]);
      tw.rows.forEach((row) => storage.addTransaction('TW', row));
      us.rows.forEach((row) => storage.addTransaction('US', row));
      reloadTransactionsFromStorage();
    }

    state.priceOverrides = storage.loadPriceOverrides();
    state.priceCache = storage.loadPriceCache();

    const savedFilters = storage.loadUiFilters();
    if (savedFilters) Object.assign(state.filters, savedFilters);

    wireStaticHandlers();

    state.fxResult = await exchangeRate.getExchangeRate();
    render();

    await refreshAllPrices();
  }

  init();
})();
