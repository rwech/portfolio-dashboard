(function () {
  const SOURCE_LABEL = {
    live: '即時',
    cache: '快取',
    estimate: '估計值',
    override: '手動覆寫',
  };

  function formatMoney(value, currency) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
  }

  function formatPct(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return `${value.toFixed(2)}%`;
  }

  function populateYearOptions(selectEl, allTx, selectedYear) {
    const years = Array.from(new Set(allTx.map((tx) => tx.date.slice(0, 4)))).sort((a, b) => b.localeCompare(a));
    const options = ['<option value="all">全部年度</option>']
      .concat(years.map((y) => `<option value="${y}">${y}</option>`));
    selectEl.innerHTML = options.join('');
    selectEl.value = selectedYear && (selectedYear === 'all' || years.includes(String(selectedYear))) ? selectedYear : 'all';
  }

  function renderFilterControls(state) {
    populateYearOptions(document.getElementById('filter-year'), state.transactions, state.filters.year);
    document.getElementById('filter-market').value = state.filters.market;
    document.getElementById('filter-currency').value = state.filters.displayCurrency;
  }

  function renderFxStatusPanel(fxResult) {
    const el = document.getElementById('fx-status-text');
    if (!fxResult) {
      el.textContent = '匯率不可用';
      return;
    }
    const time = new Date(fxResult.fetchedAt).toLocaleString();
    const sourceLabel = { live: '即時', cache: '快取', 'stale-cache': '過期快取（離線中）' }[fxResult.source] || fxResult.source;
    el.textContent = `1 USD = ${fxResult.rate.toFixed(4)} TWD（${sourceLabel}，更新於 ${time}）`;
  }

  function renderSummaryCards(summary) {
    const container = document.getElementById('summary-cards');
    const cards = [
      ['總投入成本', formatMoney(summary.totalInvested, summary.currency)],
      ['目前持股成本', formatMoney(summary.costBasisHeld, summary.currency)],
      ['已實現損益', formatMoney(summary.realizedGain, summary.currency)],
      ['未實現損益', formatMoney(summary.unrealizedGain, summary.currency)],
      ['ROI%', formatPct(summary.roiPct)],
    ];
    container.innerHTML = cards
      .map(([label, value]) => `<div class="summary-card"><div class="label">${label}</div><div class="value">${value}</div></div>`)
      .join('');
  }

  function renderTransactionTable(transactions, onDelete) {
    const tbody = document.querySelector('#transactions-table tbody');
    const sorted = [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    tbody.innerHTML = sorted
      .map(
        (tx) => `<tr data-id="${tx.id}" data-market="${tx.market}">
          <td>${tx.date}</td>
          <td>${tx.market === 'TW' ? '台股' : '美股'}</td>
          <td>${tx.symbol}</td>
          <td>${tx.name || ''}</td>
          <td>${tx.action === 'buy' ? '買進' : '賣出'}</td>
          <td>${tx.quantity}</td>
          <td>${tx.price}</td>
          <td>${tx.fee}</td>
          <td><button type="button" class="delete-tx-btn">刪除</button></td>
        </tr>`
      )
      .join('');

    tbody.querySelectorAll('.delete-tx-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        onDelete(tr.dataset.id, tr.dataset.market);
      });
    });
  }

  function renderPriceOverridePanel(perSymbolStats, priceOverrides, handlers) {
    const tbody = document.querySelector('#price-override-table tbody');
    const held = perSymbolStats.filter((s) => s.remainingQty > 0);

    tbody.innerHTML = held
      .map((stat) => {
        const hasOverride = typeof priceOverrides[stat.symbol] === 'number';
        const badgeClass = `badge badge-${stat.priceSource}`;
        return `<tr data-symbol="${stat.symbol}" data-market="${stat.market}">
          <td>${stat.symbol} ${stat.name || ''}</td>
          <td>${stat.market === 'TW' ? '台股' : '美股'}</td>
          <td>${stat.currentPrice.toFixed(2)}</td>
          <td><span class="${badgeClass}">${SOURCE_LABEL[stat.priceSource] || stat.priceSource}</span></td>
          <td><input type="number" class="override-input" min="0" step="any" value="${hasOverride ? priceOverrides[stat.symbol] : ''}" placeholder="手動輸入現價" /></td>
          <td>
            <button type="button" class="override-save-btn">儲存</button>
            <button type="button" class="override-clear-btn" ${hasOverride ? '' : 'disabled'}>清除</button>
          </td>
        </tr>`;
      })
      .join('');

    tbody.querySelectorAll('tr').forEach((tr) => {
      const symbol = tr.dataset.symbol;
      tr.querySelector('.override-save-btn').addEventListener('click', () => {
        const value = Number(tr.querySelector('.override-input').value);
        if (Number.isFinite(value) && value >= 0) {
          handlers.onOverrideChange(symbol, value);
        }
      });
      tr.querySelector('.override-clear-btn').addEventListener('click', () => {
        handlers.onOverrideClear(symbol);
      });
    });
  }

  function renderBackupReminderBanner(count, threshold) {
    const banner = document.getElementById('backup-reminder-banner');
    const text = document.getElementById('backup-reminder-text');
    if (count >= threshold) {
      text.textContent = `您有 ${count} 筆未匯出的異動，建議匯出備份`;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  function renderImportErrors(errors) {
    const el = document.getElementById('import-errors');
    if (!errors || errors.length === 0) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = `匯入時略過 ${errors.length} 列：<ul>${errors
      .map((e) => `<li>第 ${e.line} 列：${e.reason}</li>`)
      .join('')}</ul>`;
  }

  window.PFD = window.PFD || {};
  window.PFD.ui = {
    renderFilterControls,
    renderFxStatusPanel,
    renderSummaryCards,
    renderTransactionTable,
    renderPriceOverridePanel,
    renderBackupReminderBanner,
    renderImportErrors,
    formatMoney,
    formatPct,
  };
})();
