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

  function signedClass(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '';
    return value > 0 ? 'positive' : value < 0 ? 'negative' : '';
  }

  function withSign(text, value) {
    return value > 0 ? `+${text}` : text;
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
    const totalGain = summary.realizedGain + summary.unrealizedGain;
    const cards = [
      ['總投入成本', formatMoney(summary.totalInvested, summary.currency), '', null],
      ['目前持股成本', formatMoney(summary.costBasisHeld, summary.currency), '', null],
      [
        '總損益',
        withSign(formatMoney(totalGain, summary.currency), totalGain),
        signedClass(totalGain),
        [
          ['已實現', withSign(formatMoney(summary.realizedGain, summary.currency), summary.realizedGain), signedClass(summary.realizedGain)],
          ['未實現', withSign(formatMoney(summary.unrealizedGain, summary.currency), summary.unrealizedGain), signedClass(summary.unrealizedGain)],
        ],
      ],
      ['ROI%', withSign(formatPct(summary.roiPct), summary.roiPct), signedClass(summary.roiPct), null],
    ];
    container.innerHTML = cards
      .map(([label, value, cls, subFields]) => {
        const subHtml = subFields
          ? `<div class="sub-fields">${subFields
              .map(([sLabel, sValue, sCls]) => `<div class="sub-field"><span class="sub-label">${sLabel}</span><span class="sub-value ${sCls}">${sValue}</span></div>`)
              .join('')}</div>`
          : '';
        return `<div class="summary-card"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${subHtml}</div>`;
      })
      .join('');
  }

  function renderTransactionTable(transactions, onDelete) {
    const tbody = document.querySelector('#transactions-table tbody');
    const sorted = [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    tbody.innerHTML = sorted
      .map(
        (tx) => `<tr data-id="${tx.id}" data-market="${tx.market}">
          <td>${tx.date}</td>
          <td><span class="badge badge-${tx.market === 'TW' ? 'tw' : 'us'}">${tx.market === 'TW' ? '台股' : '美股'}</span></td>
          <td>${tx.symbol}</td>
          <td>${tx.name || ''}</td>
          <td><span class="badge badge-${tx.action === 'buy' ? 'buy' : 'sell'}">${tx.action === 'buy' ? '買進' : '賣出'}</span></td>
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

  function renderSymbolPnlTable(perSymbolStats, displayCurrency) {
    const tbody = document.querySelector('#symbol-pnl-table tbody');
    tbody.innerHTML = perSymbolStats
      .map((stat) => {
        const currency = stat.market === 'TW' ? 'TWD' : 'USD';
        const badgeClass = `badge badge-${stat.priceSource}`;
        return `<tr data-symbol="${stat.symbol}" data-market="${stat.market}">
          <td>${stat.symbol} ${stat.name || ''}</td>
          <td><span class="badge badge-${stat.market === 'TW' ? 'tw' : 'us'}">${stat.market === 'TW' ? '台股' : '美股'}</span></td>
          <td class="${signedClass(stat.roiPct)}">${withSign(formatPct(stat.roiPct), stat.roiPct)}</td>
          <td class="${signedClass(stat.realizedGain)}">${withSign(formatMoney(stat.realizedGain, displayCurrency), stat.realizedGain)}</td>
          <td class="${signedClass(stat.unrealizedGain)}">${withSign(formatMoney(stat.unrealizedGain, displayCurrency), stat.unrealizedGain)}</td>
          <td>${stat.remainingQty}</td>
          <td>${stat.currentPrice.toFixed(2)} ${currency} <span class="${badgeClass}">${SOURCE_LABEL[stat.priceSource] || stat.priceSource}</span></td>
          <td>${formatMoney(stat.marketValue, displayCurrency)}</td>
          <td>${stat.avgCost.toFixed(2)} ${currency}</td>
          <td>${formatMoney(stat.costBasisHeld, displayCurrency)}</td>
        </tr>`;
      })
      .join('');
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

  function renderDemoModeBanner(enabled) {
    document.getElementById('demo-mode-banner').hidden = !enabled;
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

  function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.tab-panel');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        tabBtns.forEach((b) => {
          const isActive = b === btn;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-selected', String(isActive));
        });
        panels.forEach((panel) => {
          panel.hidden = panel.dataset.tabPanel !== target;
        });
        if (target === 'overview') {
          window.PFD.charts.resizeCharts();
        }
      });
    });
  }

  function renderImportFeedback(elId, { notice, errors } = {}) {
    const el = document.getElementById(elId);
    const parts = [];
    if (notice) parts.push(`<div class="import-notice">${notice}</div>`);
    if (errors && errors.length) {
      parts.push(
        `<div class="import-error-list">匯入時略過 ${errors.length} 列：<ul>${errors
          .map((e) => `<li>第 ${e.line} 列：${e.reason}</li>`)
          .join('')}</ul></div>`
      );
    }
    if (!parts.length) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = parts.join('');
  }

  window.PFD = window.PFD || {};
  window.PFD.ui = {
    renderFilterControls,
    renderFxStatusPanel,
    renderSummaryCards,
    renderTransactionTable,
    renderSymbolPnlTable,
    renderPriceOverridePanel,
    renderBackupReminderBanner,
    renderDemoModeBanner,
    renderImportFeedback,
    initTabs,
    formatMoney,
    formatPct,
  };
})();
