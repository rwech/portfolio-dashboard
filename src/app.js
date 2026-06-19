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
  };

  function reloadTransactionsFromStorage() {
    state.transactions = [...storage.loadTransactions('TW'), ...storage.loadTransactions('US')];
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

    const perSymbolConverted = filteredSummary.perSymbol.map((s) => ({
      symbol: s.symbol,
      realizedGain: roi.convertAmount(s.realizedGain, currencyFor(s.market), state.filters.displayCurrency, fxRate),
      unrealizedGain: roi.convertAmount(s.unrealizedGain, currencyFor(s.market), state.filters.displayCurrency, fxRate),
    }));

    const allocationData = {
      TW: roi.convertAmount(filteredSummary.byMarket.TW.costBasisHeld, 'TWD', state.filters.displayCurrency, fxRate),
      US: roi.convertAmount(filteredSummary.byMarket.US.costBasisHeld, 'USD', state.filters.displayCurrency, fxRate),
    };

    ui.renderFilterControls(state);
    ui.renderFxStatusPanel(state.fxResult);
    ui.renderSummaryCards(converted);
    ui.renderTransactionTable(filteredTx, handleDeleteTransaction);
    ui.renderPriceOverridePanel(fullSummary.perSymbol, state.priceOverrides, {
      onOverrideChange: handlePriceOverrideChange,
      onOverrideClear: handlePriceOverrideClear,
    });
    ui.renderBackupReminderBanner(storage.loadUnexportedChangeCount(), BACKUP_REMINDER_THRESHOLD);
    charts.renderRoiBarChart(document.getElementById('roi-bar-chart'), perSymbolConverted, state.filters.displayCurrency);
    charts.renderAllocationChart(document.getElementById('allocation-chart'), allocationData, state.filters.displayCurrency);

    storage.saveUiFilters(state.filters);
  }

  function handleFilterChange(partial) {
    Object.assign(state.filters, partial);
    render();
  }

  function handleAddTransaction(market, tx) {
    storage.addTransaction(market, tx);
    reloadTransactionsFromStorage();
    storage.incrementUnexportedChanges();
    render();
  }

  function handleDeleteTransaction(id, market) {
    storage.deleteTransaction(market, id);
    reloadTransactionsFromStorage();
    storage.incrementUnexportedChanges();
    render();
  }

  function handlePriceOverrideChange(symbol, value) {
    storage.savePriceOverride(symbol, value);
    state.priceOverrides = storage.loadPriceOverrides();
    render();
  }

  function handlePriceOverrideClear(symbol) {
    storage.clearPriceOverride(symbol);
    state.priceOverrides = storage.loadPriceOverrides();
    render();
  }

  async function handleFxRefresh() {
    state.fxResult = await exchangeRate.getExchangeRate({ forceRefresh: true });
    render();
  }

  function currentlyHeldSymbols() {
    const priceCtx = { priceOverrides: state.priceOverrides, priceCache: state.priceCache };
    const fullSummary = roi.computePortfolioSummary(state.transactions, priceCtx, { year: 'all', market: 'all' });
    return fullSummary.perSymbol
      .filter((s) => s.remainingQty > 0)
      .map((s) => ({ symbol: s.symbol, market: s.market }));
  }

  async function handleRefreshAllPrices() {
    await stockPrice.refreshPrices(currentlyHeldSymbols());
    state.priceCache = storage.loadPriceCache();
    render();
  }

  function handleExport(market) {
    const list = storage.loadTransactions(market);
    csv.downloadCsv(csv.fileNameFor(market, ''), csv.stringifyCsv(list));
    storage.resetUnexportedChanges();
    render();
  }

  function handleImportText(text, market) {
    const { rows, errors } = csv.parseCsv(text, market);
    rows.forEach((row) => storage.addTransaction(market, row));
    reloadTransactionsFromStorage();
    ui.renderImportErrors(errors);
    render();
  }

  async function handleLoadExample() {
    for (const market of ['TW', 'US']) {
      const { rows } = await csv.fetchExampleCsv(market);
      rows.forEach((row) => storage.addTransaction(market, row));
    }
    reloadTransactionsFromStorage();
    render();
    await handleRefreshAllPrices();
  }

  function wireStaticHandlers() {
    ui.initTabs();

    document.getElementById('filter-year').addEventListener('change', (e) => handleFilterChange({ year: e.target.value }));
    document.getElementById('filter-market').addEventListener('change', (e) => handleFilterChange({ market: e.target.value }));
    document.getElementById('filter-currency').addEventListener('change', (e) => handleFilterChange({ displayCurrency: e.target.value }));

    document.getElementById('fx-refresh-btn').addEventListener('click', handleFxRefresh);
    document.getElementById('refresh-all-prices-btn').addEventListener('click', handleRefreshAllPrices);

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

    document.getElementById('export-tw-btn').addEventListener('click', () => handleExport('TW'));
    document.getElementById('export-us-btn').addEventListener('click', () => handleExport('US'));
    document.getElementById('backup-reminder-export-btn').addEventListener('click', () => {
      handleExport('TW');
      handleExport('US');
    });

    document.getElementById('load-example-btn').addEventListener('click', handleLoadExample);

    document.getElementById('import-csv-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const market = document.getElementById('import-market-select').value;
      const reader = new FileReader();
      reader.onload = () => handleImportText(String(reader.result), market);
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

    await handleRefreshAllPrices();
  }

  init();
})();
