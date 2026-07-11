(function () {
  const BACKUP_REMINDER_THRESHOLD = 5;

  const storage = window.PFD.storage;
  const csv = window.PFD.csv;
  const importer = window.PFD.importer;
  const exchangeRate = window.PFD.exchangeRate;
  const stockPrice = window.PFD.stockPrice;
  const historicalPrice = window.PFD.historicalPrice;
  const roi = window.PFD.roi;
  const charts = window.PFD.charts;
  const ui = window.PFD.ui;

  const state = {
    transactions: [],
    priceOverrides: {},
    priceCache: {},
    historicalPriceCache: {},
    fxResult: null,
    filters: {
      year: 'all',
      market: 'all',
      displayCurrency: 'TWD',
      roiTrendMode: 'cumulative',
    },
    demoMode: false,
    sort: { column: null, direction: 'asc' },
    txSort: { column: 'date', direction: 'desc' },
    txSearch: '',
    editingTxId: null,
  };

  // 依代號或名稱做不分大小寫的子字串搜尋（套用在年度/市場篩選之後）。
  function filterBySearch(rows, query) {
    const q = String(query || '')
      .trim()
      .toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (tx) =>
        String(tx.symbol || '')
          .toLowerCase()
          .includes(q) ||
        String(tx.name || '')
          .toLowerCase()
          .includes(q),
    );
  }

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

  function sortRows(rows, sort) {
    if (!sort.column) return rows;
    const sorted = [...rows].sort((a, b) => compareForSort(a, b, sort.column));
    return sort.direction === 'desc' ? sorted.reverse() : sorted;
  }

  function reloadTransactionsFromStorage() {
    state.transactions = [
      ...storage.loadTransactions('TW'),
      ...storage.loadTransactions('US'),
    ];
  }

  function blockIfDemoMode() {
    if (!state.demoMode) return false;
    ui.showToast('示範模式僅供瀏覽範例資料，請先關閉示範模式再進行此操作。', {
      type: 'error',
    });
    return true;
  }

  function currencyFor(market) {
    return market === 'TW' ? 'TWD' : 'USD';
  }

  function actionLabelFor(action) {
    return String(action).toLowerCase() === 'buy' ? '買進' : '賣出';
  }

  function render() {
    const priceCtx = {
      priceOverrides: state.priceOverrides,
      priceCache: state.priceCache,
    };
    const fxRate = state.fxResult ? state.fxResult.rate : null;

    state.filters.year = roi.resolveYearFilter(
      state.transactions,
      state.filters.year,
    );

    const fullSummary = roi.computePortfolioSummary(
      state.transactions,
      priceCtx,
      { year: 'all', market: 'all' },
    );
    const filteredSummary = roi.computePortfolioSummary(
      state.transactions,
      priceCtx,
      state.filters,
    );
    const filteredTx = roi.filterTransactions(
      state.transactions,
      state.filters,
    );

    const converted = roi.convertSummaryToDisplayCurrency(
      filteredSummary.byMarket,
      state.filters.displayCurrency,
      fxRate,
    );

    const allocationData = {
      TW: roi.convertAmount(
        filteredSummary.byMarket.TW.costBasisHeld,
        'TWD',
        state.filters.displayCurrency,
        fxRate,
      ),
      US: roi.convertAmount(
        filteredSummary.byMarket.US.costBasisHeld,
        'USD',
        state.filters.displayCurrency,
        fxRate,
      ),
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
      costBasisHeld: roi.convertAmount(
        s.costBasisHeld,
        currencyFor(s.market),
        state.filters.displayCurrency,
        fxRate,
      ),
      marketValue: roi.convertAmount(
        s.marketValue,
        currencyFor(s.market),
        state.filters.displayCurrency,
        fxRate,
      ),
      realizedGain: roi.convertAmount(
        s.realizedGain,
        currencyFor(s.market),
        state.filters.displayCurrency,
        fxRate,
      ),
      unrealizedGain: roi.convertAmount(
        s.unrealizedGain,
        currencyFor(s.market),
        state.filters.displayCurrency,
        fxRate,
      ),
      roiPct: s.roiPct,
    }));

    const symbolAllocationData = filteredSummary.perSymbol
      .filter((s) => s.remainingQty > 0)
      .map((s) => ({
        symbol: s.symbol,
        value: roi.convertAmount(
          s.marketValue,
          currencyFor(s.market),
          state.filters.displayCurrency,
          fxRate,
        ),
      }));

    const showEmptyState = state.transactions.length === 0 && !state.demoMode;
    // 只要任一「目前持有」標的的現價是估計值或已過期報價，
    // 未實現損益與 ROI% 就不可靠，需要提醒使用者。
    const hasUnreliableHeldPrice = fullSummary.perSymbol.some(
      (s) =>
        s.remainingQty > 0 &&
        (s.priceSource === 'estimate' ||
          stockPrice.isPriceStale(s.priceSource, s.priceFetchedAt)),
    );

    ui.renderFilterControls(state);
    ui.renderFxStatusPanel(state.fxResult);
    ui.renderEmptyState(showEmptyState);
    ui.renderPriceQualityWarning(!showEmptyState && hasUnreliableHeldPrice);
    ui.renderSummaryCards(converted);
    const searchedTx = filterBySearch(filteredTx, state.txSearch);

    // 搜尋框位於重新渲染的 tbody 之外，值與焦點天然保留；
    // 只在值不同步時回寫（例如程式端重設 txSearch），避免打斷輸入。
    const txSearchInput = document.getElementById('tx-search-input');
    if (txSearchInput && txSearchInput.value !== state.txSearch) {
      txSearchInput.value = state.txSearch;
    }

    ui.renderTransactionTable(sortRows(searchedTx, state.txSort), {
      onDelete: handleDeleteTransaction,
      onEditStart: handleEditStart,
      onEditCancel: handleEditCancel,
      onEditSave: handleEditSave,
      editingId: state.editingTxId,
    });
    ui.updateSortIndicators('transactions-table', state.txSort);
    ui.renderSymbolPnlTable(
      sortRows(symbolPnl, state.sort),
      state.filters.displayCurrency,
    );
    ui.updateSortIndicators('symbol-pnl-table', state.sort);
    ui.renderPriceOverridePanel(fullSummary.perSymbol, state.priceOverrides, {
      onOverrideChange: handlePriceOverrideChange,
      onOverrideClear: handlePriceOverrideClear,
    });
    ui.renderBackupReminderBanner(
      storage.loadUnexportedChangeCount(),
      BACKUP_REMINDER_THRESHOLD,
    );
    ui.renderDemoModeBanner(state.demoMode);
    document.body.classList.toggle('demo-mode-active', state.demoMode);
    charts.renderAllocationChart(
      document.getElementById('allocation-chart'),
      allocationData,
      state.filters.displayCurrency,
    );
    charts.renderSymbolAllocationChart(
      document.getElementById('symbol-allocation-chart'),
      symbolAllocationData,
      state.filters.displayCurrency,
    );

    const today = new Date().toISOString().slice(0, 10);
    const roiTrendSnapshots = roi.computeRoiTrend(state.transactions, {
      year: state.filters.year,
      mode: state.filters.roiTrendMode,
      resolveHistoricalPrice: historicalPrice.buildResolver(
        state.historicalPriceCache,
      ),
      fxRate,
      displayCurrency: state.filters.displayCurrency,
      today,
    });
    charts.renderRoiTrendChart(
      document.getElementById('roi-trend-chart'),
      roiTrendSnapshots,
      state.filters.roiTrendMode,
      state.filters.displayCurrency,
    );

    storage.saveUiFilters(state.filters);
  }

  function handleFilterChange(partial) {
    Object.assign(state.filters, partial);
    render();
  }

  function handleAddTransaction(market, tx) {
    if (blockIfDemoMode()) return false;
    const reason = csv.validateRow(tx);
    if (reason) {
      ui.showToast(reason, { type: 'error' });
      return false;
    }
    const added = storage.addTransaction(market, {
      ...tx,
      action: tx.action.toLowerCase(),
      quantity: Number(tx.quantity),
      price: Number(tx.price),
      fee: Number(tx.fee || 0),
    });
    reloadTransactionsFromStorage();
    storage.incrementUnexportedChanges();
    render();
    refreshHistoricalPrices();
    ui.showToast(
      `已新增 ${added.symbol} ${actionLabelFor(added.action)} ${added.quantity} 股`,
      { type: 'success' },
    );
    return true;
  }

  function handleDeleteTransaction(id, market) {
    if (blockIfDemoMode()) return;
    const deletedTx = storage
      .loadTransactions(market)
      .find((tx) => tx.id === id);
    storage.deleteTransaction(market, id);
    if (state.editingTxId === id) state.editingTxId = null;
    reloadTransactionsFromStorage();
    storage.incrementUnexportedChanges();
    render();
    refreshHistoricalPrices();
    if (!deletedTx) return;
    ui.showToast(
      `已刪除 ${deletedTx.symbol} ${actionLabelFor(deletedTx.action)} ${deletedTx.quantity} 股`,
      {
        type: 'info',
        durationMs: 6000,
        actionLabel: '復原',
        onAction: () => {
          storage.restoreTransaction(market, deletedTx);
          storage.decrementUnexportedChanges();
          reloadTransactionsFromStorage();
          render();
          refreshHistoricalPrices();
        },
      },
    );
  }

  function handleEditStart(id) {
    if (blockIfDemoMode()) return;
    state.editingTxId = id;
    render();
  }

  function handleEditCancel() {
    state.editingTxId = null;
    render();
  }

  function handleEditSave(id, market, updates) {
    if (blockIfDemoMode()) return;
    const reason = csv.validateRow(updates);
    if (reason) {
      ui.showToast(reason, { type: 'error' });
      return;
    }
    storage.updateTransaction(market, id, {
      ...updates,
      action: updates.action.toLowerCase(),
      quantity: Number(updates.quantity),
      price: Number(updates.price),
      fee: Number(updates.fee || 0),
    });
    state.editingTxId = null;
    reloadTransactionsFromStorage();
    storage.incrementUnexportedChanges();
    render();
    refreshHistoricalPrices();
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
    const priceCtx = {
      priceOverrides: state.priceOverrides,
      priceCache: state.priceCache,
    };
    const fullSummary = roi.computePortfolioSummary(
      state.transactions,
      priceCtx,
      { year: 'all', market: 'all' },
    );
    return fullSummary.perSymbol
      .filter((s) => s.remainingQty > 0)
      .map((s) => ({ symbol: s.symbol, market: s.market }));
  }

  async function refreshAllPrices() {
    await stockPrice.refreshPrices(currentlyHeldSymbols());
    state.priceCache = storage.loadPriceCache();
    render();
  }

  function allTransactedSymbols() {
    const map = new Map();
    state.transactions.forEach((tx) => {
      if (!map.has(tx.symbol)) map.set(tx.symbol, tx.market);
    });
    return Array.from(map, ([symbol, market]) => ({ symbol, market }));
  }

  let isRefreshingHistoricalPrices = false;

  async function refreshHistoricalPrices() {
    if (isRefreshingHistoricalPrices) return;
    if (state.transactions.length === 0) return;

    const today = new Date().toISOString().slice(0, 10);
    const earliestDate = state.transactions.reduce(
      (min, tx) => (tx.date < min ? tx.date : min),
      state.transactions[0].date,
    );

    const symbolDateRanges = allTransactedSymbols().map(
      ({ symbol, market }) => ({
        symbol,
        market,
        fromDate: earliestDate,
        toDate: today,
      }),
    );

    const gaps = historicalPrice.findGaps(
      symbolDateRanges,
      state.historicalPriceCache,
    );
    if (gaps.length === 0) return;

    isRefreshingHistoricalPrices = true;
    try {
      await historicalPrice.fetchHistoricalPrices(gaps);
      state.historicalPriceCache = storage.loadHistoricalPriceCache();
      render();
    } finally {
      isRefreshingHistoricalPrices = false;
    }
  }

  let isRefreshing = false;

  async function handleRefreshAll() {
    if (isRefreshing) return;
    isRefreshing = true;
    const btn = document.getElementById('refresh-all-btn');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.classList.add('is-refreshing');
    btn.textContent = '更新中…';
    try {
      state.fxResult = await exchangeRate.getExchangeRate({
        forceRefresh: true,
      });
      await refreshAllPrices();
      await refreshHistoricalPrices();
      if (state.fxResult && state.fxResult.source === 'live') {
        ui.showToast('匯率與現價已更新', { type: 'success' });
      } else {
        ui.showToast('無法取得最新匯率（可能離線中），顯示的資料可能非最新', {
          type: 'warning',
        });
      }
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-refreshing');
      btn.textContent = originalLabel;
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

  function marketLabelFor(market) {
    return market === 'TW' ? '台股' : '美股';
  }

  // 匯入第二步：以確定的欄位對應解析全檔、與現有資料做去重分析，
  // 顯示預覽統計，使用者確認後才真正寫入。
  function openImportPreview(session) {
    const { text, encoding, market, mapping } = session;
    const { rows, errors } = importer.parseWithMapping(text, mapping, market);
    const existing = storage.loadTransactions(market);
    const analysis = importer.analyzeImport(rows, existing);

    ui.renderImportPreviewStep(
      {
        marketLabel: marketLabelFor(market),
        validCount: rows.length,
        errors,
        dateRange: analysis.stats.dateRange,
        symbolCount: analysis.stats.symbolCount,
        duplicateCount: analysis.duplicateCount,
        newCount: analysis.newRows.length,
        existingCount: existing.length,
        previewRows: rows.slice(0, 5),
        encoding,
      },
      {
        onConfirm: ({ replace }) => {
          if (replace) {
            storage.replaceTransactions(market, rows);
          } else {
            storage.appendTransactions(market, analysis.newRows);
          }
          storage.incrementUnexportedChanges();
          ui.closeImportModal();
          reloadTransactionsFromStorage();
          render();
          refreshHistoricalPrices();
          const label = marketLabelFor(market);
          const message = replace
            ? `已以匯入資料取代${label}交易紀錄（${rows.length} 筆）`
            : `已新增 ${analysis.newRows.length} 筆${label}交易${
                analysis.duplicateCount > 0
                  ? `（略過重複 ${analysis.duplicateCount} 筆）`
                  : ''
              }`;
          ui.showToast(message, { type: 'success' });
        },
        onCancel: () => ui.closeImportModal(),
      },
    );
  }

  async function handleImportFile(file, market) {
    if (blockIfDemoMode()) return;
    const buffer = await file.arrayBuffer();
    const { text, encoding } = importer.decodeCsvBytes(buffer);
    const headerFields = importer.readHeader(text);
    if (headerFields.length === 0) {
      ui.showToast('檔案是空的或讀不到標題列', { type: 'error' });
      return;
    }

    const { mapping: guessed, isExactSchema } =
      importer.guessMapping(headerFields);
    const session = { text, encoding, market };
    ui.openImportModal();

    if (isExactSchema) {
      session.mapping = guessed;
      openImportPreview(session);
      return;
    }

    // 欄名非標準 schema：先走欄位對應精靈，沿用上次存過的對應（若有）
    const signature = importer.headerSignature(headerFields);
    const saved = storage.loadImportMapping(signature);
    ui.renderImportMappingStep(
      { headerFields, mapping: saved || guessed },
      {
        onApply: (mapping) => {
          storage.saveImportMapping(signature, mapping);
          session.mapping = mapping;
          openImportPreview(session);
        },
        onCancel: () => ui.closeImportModal(),
      },
    );
  }

  async function setDemoMode(enabled) {
    state.demoMode = enabled;
    if (enabled) {
      const [tw, us] = await Promise.all([
        csv.fetchExampleCsv('TW'),
        csv.fetchExampleCsv('US'),
      ]);
      state.transactions = [...tw.rows, ...us.rows];
    } else {
      reloadTransactionsFromStorage();
    }
    render();
  }

  function wireStaticHandlers() {
    ui.initTabs();
    ui.initDropdownMenus();

    document
      .getElementById('filter-year')
      .addEventListener('change', (e) =>
        handleFilterChange({ year: e.target.value }),
      );
    document
      .getElementById('filter-market')
      .addEventListener('change', (e) =>
        handleFilterChange({ market: e.target.value }),
      );
    document
      .getElementById('filter-currency')
      .addEventListener('change', (e) =>
        handleFilterChange({ displayCurrency: e.target.value }),
      );
    document
      .getElementById('roi-trend-mode')
      .addEventListener('change', (e) =>
        handleFilterChange({ roiTrendMode: e.target.value }),
      );

    document
      .getElementById('refresh-all-btn')
      .addEventListener('click', handleRefreshAll);

    // txSearch 只存在記憶體中，不寫入 storage.saveUiFilters（它只序列化 state.filters）。
    document
      .getElementById('tx-search-input')
      .addEventListener('input', (e) => {
        state.txSearch = e.target.value;
        render();
      });

    document
      .querySelectorAll('#symbol-pnl-table thead th[data-sort-key]')
      .forEach((th) => {
        th.addEventListener('click', () => {
          const key = th.dataset.sortKey;
          if (state.sort.column === key) {
            state.sort.direction =
              state.sort.direction === 'asc' ? 'desc' : 'asc';
          } else {
            state.sort = { column: key, direction: 'asc' };
          }
          render();
        });
      });

    document
      .querySelectorAll('#transactions-table thead th[data-sort-key]')
      .forEach((th) => {
        th.addEventListener('click', () => {
          const key = th.dataset.sortKey;
          if (state.txSort.column === key) {
            state.txSort.direction =
              state.txSort.direction === 'asc' ? 'desc' : 'asc';
          } else {
            state.txSort = { column: key, direction: 'asc' };
          }
          render();
        });
      });

    document
      .getElementById('add-transaction-form')
      .addEventListener('submit', (e) => {
        e.preventDefault();
        const form = e.target;
        const data = new FormData(form);
        const market = data.get('market');
        const added = handleAddTransaction(market, {
          date: data.get('date'),
          symbol: data.get('symbol'),
          name: data.get('name') || '',
          action: data.get('action'),
          quantity: data.get('quantity'),
          price: data.get('price'),
          fee: data.get('fee') || 0,
        });
        if (added) form.reset();
      });

    document.querySelectorAll('#export-menu .dropdown-item').forEach((item) => {
      item.addEventListener('click', () => handleExport(item.dataset.market));
    });
    document
      .getElementById('backup-reminder-export-btn')
      .addEventListener('click', () => {
        handleExport('TW');
        handleExport('US');
      });

    document
      .getElementById('demo-mode-toggle')
      .addEventListener('change', (e) => setDemoMode(e.target.checked));

    document
      .getElementById('empty-state-demo-btn')
      .addEventListener('click', () => {
        const toggle = document.getElementById('demo-mode-toggle');
        toggle.checked = true;
        // 走與使用者手動勾選完全相同的 change 事件路徑
        toggle.dispatchEvent(new Event('change'));
      });

    document
      .getElementById('empty-state-add-tx-btn')
      .addEventListener('click', () => {
        // 重用 initTabs 綁定的分頁切換邏輯
        document.querySelector('.tab-btn[data-tab="add-tx"]').click();
      });

    document.getElementById('theme-select').addEventListener('change', (e) => {
      const theme = e.target.value;
      document.documentElement.setAttribute('data-theme', theme);
      storage.saveTheme(theme);
    });

    let pendingImportMarket = null;
    document.querySelectorAll('#import-menu .dropdown-item').forEach((item) => {
      item.addEventListener('click', () => {
        pendingImportMarket = item.dataset.market;
        document.getElementById('import-csv-input').click();
      });
    });

    document
      .getElementById('import-csv-input')
      .addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        handleImportFile(file, pendingImportMarket);
        e.target.value = '';
      });

    document.getElementById('goto-import-btn').addEventListener('click', () => {
      // 重用 initTabs 綁定的分頁切換邏輯
      document.querySelector('.tab-btn[data-tab="transactions"]').click();
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
      const [tw, us] = await Promise.all([
        csv.fetchInitialCsv('TW'),
        csv.fetchInitialCsv('US'),
      ]);
      tw.rows.forEach((row) => storage.addTransaction('TW', row));
      us.rows.forEach((row) => storage.addTransaction('US', row));
      reloadTransactionsFromStorage();
    }

    state.priceOverrides = storage.loadPriceOverrides();
    state.priceCache = storage.loadPriceCache();
    state.historicalPriceCache = storage.loadHistoricalPriceCache();

    const savedFilters = storage.loadUiFilters();
    if (savedFilters) Object.assign(state.filters, savedFilters);

    wireStaticHandlers();

    state.fxResult = await exchangeRate.getExchangeRate();
    render();

    await refreshAllPrices();
    await refreshHistoricalPrices();
  }

  window.PFD = window.PFD || {};
  window.PFD.app = {
    state,
    init,
    render,
    setDemoMode,
    handleFilterChange,
    handleAddTransaction,
    handleDeleteTransaction,
    handleEditStart,
    handleEditCancel,
    handleEditSave,
    handleImportFile,
    handlePriceOverrideChange,
    handlePriceOverrideClear,
    handleExport,
    filterBySearch,
  };
})();
