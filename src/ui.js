(function () {
  const SOURCE_LABEL = {
    live: '即時',
    cache: '快取',
    estimate: '估計值',
    override: '手動覆寫',
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  }

  function formatMoney(value, currency) {
    if (value === null || value === undefined || Number.isNaN(value))
      return '—';
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
  }

  function formatPct(value) {
    if (value === null || value === undefined || Number.isNaN(value))
      return '—';
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
    const years = Array.from(
      new Set(allTx.map((tx) => tx.date.slice(0, 4))),
    ).sort((a, b) => b.localeCompare(a));
    const options = ['<option value="all">全部年度</option>'].concat(
      years.map((y) => `<option value="${y}">${y}</option>`),
    );
    selectEl.innerHTML = options.join('');
    selectEl.value =
      selectedYear &&
      (selectedYear === 'all' || years.includes(String(selectedYear)))
        ? selectedYear
        : 'all';
  }

  function renderFilterControls(state) {
    populateYearOptions(
      document.getElementById('filter-year'),
      state.transactions,
      state.filters.year,
    );
    document.getElementById('filter-market').value = state.filters.market;
    document.getElementById('filter-currency').value =
      state.filters.displayCurrency;
    document.getElementById('roi-trend-mode').value =
      state.filters.roiTrendMode;
  }

  function renderFxStatusPanel(fxResult) {
    const el = document.getElementById('fx-status-text');
    if (!fxResult) {
      el.textContent = '匯率不可用';
      return;
    }
    const time = new Date(fxResult.fetchedAt).toLocaleString();
    const sourceLabel =
      { live: '即時', cache: '快取', 'stale-cache': '過期快取（離線中）' }[
        fxResult.source
      ] || fxResult.source;
    el.textContent = `1 USD = ${fxResult.rate.toFixed(4)} TWD（${sourceLabel}，更新於 ${time}）`;
  }

  function renderSummaryCards(summary) {
    const container = document.getElementById('summary-cards');
    const totalGain = summary.realizedGain + summary.unrealizedGain;
    const cards = [
      [
        '總投入成本',
        formatMoney(summary.totalInvested, summary.currency),
        '',
        null,
      ],
      [
        '目前持股成本',
        formatMoney(summary.costBasisHeld, summary.currency),
        '',
        null,
      ],
      [
        '總損益',
        withSign(formatMoney(totalGain, summary.currency), totalGain),
        signedClass(totalGain),
        [
          [
            '已實現',
            withSign(
              formatMoney(summary.realizedGain, summary.currency),
              summary.realizedGain,
            ),
            signedClass(summary.realizedGain),
          ],
          [
            '未實現',
            withSign(
              formatMoney(summary.unrealizedGain, summary.currency),
              summary.unrealizedGain,
            ),
            signedClass(summary.unrealizedGain),
          ],
        ],
      ],
      [
        'ROI%',
        withSign(formatPct(summary.roiPct), summary.roiPct),
        signedClass(summary.roiPct),
        null,
      ],
    ];
    container.innerHTML = cards
      .map(([label, value, cls, subFields]) => {
        const subHtml = subFields
          ? `<div class="sub-fields">${subFields
              .map(
                ([sLabel, sValue, sCls]) =>
                  `<div class="sub-field"><span class="sub-label">${sLabel}</span><span class="sub-value ${sCls}">${sValue}</span></div>`,
              )
              .join('')}</div>`
          : '';
        return `<div class="summary-card"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${subHtml}</div>`;
      })
      .join('');
  }

  function priceUpdatedTitle(stat) {
    if (!stat.priceFetchedAt) return '尚未取得即時報價';
    return `最後更新：${new Date(stat.priceFetchedAt).toLocaleString()}`;
  }

  function staleBadge(stat) {
    const isStale = window.PFD.stockPrice.isPriceStale(
      stat.priceSource,
      stat.priceFetchedAt,
    );
    return isStale
      ? ` <span class="badge badge-stale" title="${escapeHtml(priceUpdatedTitle(stat))}">報價已過期</span>`
      : '';
  }

  function svgIcon(paths) {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }

  const ICON_EDIT = svgIcon(
    '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>',
  );
  const ICON_DELETE = svgIcon(
    '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>',
  );
  const ICON_SAVE = svgIcon('<polyline points="20 6 9 17 4 12"></polyline>');
  const ICON_CANCEL = svgIcon(
    '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
  );

  function renderTxRow(tx) {
    return `<tr data-id="${tx.id}" data-market="${tx.market}">
      <td><div class="tx-actions"><button type="button" class="icon-btn edit-tx-btn" title="編輯" aria-label="編輯">${ICON_EDIT}</button><button type="button" class="icon-btn delete-tx-btn" title="刪除" aria-label="刪除">${ICON_DELETE}</button></div></td>
      <td>${tx.date}</td>
      <td><span class="badge badge-${tx.action === 'buy' ? 'buy' : 'sell'}">${tx.action === 'buy' ? '買進' : '賣出'}</span></td>
      <td>${escapeHtml(tx.symbol)}</td>
      <td><span class="badge badge-${tx.market === 'TW' ? 'tw' : 'us'}">${tx.market === 'TW' ? '台股' : '美股'}</span></td>
      <td>${escapeHtml(tx.name || '')}</td>
      <td>${tx.quantity}</td>
      <td>${tx.price}</td>
      <td>${tx.fee}</td>
    </tr>`;
  }

  function renderEditableTxRow(tx) {
    return `<tr data-id="${tx.id}" data-market="${tx.market}" class="editing-row">
      <td><div class="tx-actions"><button type="button" class="icon-btn save-edit-btn" title="儲存" aria-label="儲存">${ICON_SAVE}</button><button type="button" class="icon-btn cancel-edit-btn" title="取消" aria-label="取消">${ICON_CANCEL}</button></div></td>
      <td><input type="date" class="edit-date" value="${escapeHtml(tx.date)}" required></td>
      <td><select class="edit-action">
        <option value="buy" ${tx.action === 'buy' ? 'selected' : ''}>買進</option>
        <option value="sell" ${tx.action === 'sell' ? 'selected' : ''}>賣出</option>
      </select></td>
      <td><input type="text" class="edit-symbol" value="${escapeHtml(tx.symbol)}" required></td>
      <td><span class="badge badge-${tx.market === 'TW' ? 'tw' : 'us'}">${tx.market === 'TW' ? '台股' : '美股'}</span></td>
      <td><input type="text" class="edit-name" value="${escapeHtml(tx.name || '')}"></td>
      <td><input type="number" class="edit-quantity" min="0" step="any" value="${escapeHtml(String(tx.quantity))}" required></td>
      <td><input type="number" class="edit-price" min="0" step="any" value="${escapeHtml(String(tx.price))}" required></td>
      <td><input type="number" class="edit-fee" min="0" step="any" value="${escapeHtml(String(tx.fee))}"></td>
    </tr>`;
  }

  function renderTransactionTable(
    transactions,
    { onDelete, onEditStart, onEditCancel, onEditSave, editingId } = {},
  ) {
    const tbody = document.querySelector('#transactions-table tbody');
    tbody.innerHTML = transactions
      .map((tx) =>
        tx.id === editingId ? renderEditableTxRow(tx) : renderTxRow(tx),
      )
      .join('');

    tbody.querySelectorAll('.edit-tx-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        onEditStart(tr.dataset.id);
      });
    });
    tbody.querySelectorAll('.delete-tx-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        onDelete(tr.dataset.id, tr.dataset.market);
      });
    });
    tbody.querySelectorAll('.cancel-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => onEditCancel());
    });
    tbody.querySelectorAll('.save-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        onEditSave(tr.dataset.id, tr.dataset.market, {
          date: tr.querySelector('.edit-date').value,
          action: tr.querySelector('.edit-action').value,
          symbol: tr.querySelector('.edit-symbol').value,
          name: tr.querySelector('.edit-name').value,
          quantity: Number(tr.querySelector('.edit-quantity').value),
          price: Number(tr.querySelector('.edit-price').value),
          fee: Number(tr.querySelector('.edit-fee').value || 0),
        });
      });
    });
  }

  function renderSymbolPnlTable(perSymbolStats, displayCurrency) {
    const tbody = document.querySelector('#symbol-pnl-table tbody');
    tbody.innerHTML = perSymbolStats
      .map((stat) => {
        const currency = stat.market === 'TW' ? 'TWD' : 'USD';
        const badgeClass = `badge badge-${stat.priceSource}`;
        return `<tr data-symbol="${escapeHtml(stat.symbol)}" data-market="${stat.market}">
          <td>${escapeHtml(stat.symbol)} ${escapeHtml(stat.name || '')}</td>
          <td><span class="badge badge-${stat.market === 'TW' ? 'tw' : 'us'}">${stat.market === 'TW' ? '台股' : '美股'}</span></td>
          <td class="${signedClass(stat.roiPct)}">${withSign(formatPct(stat.roiPct), stat.roiPct)}</td>
          <td class="${signedClass(stat.realizedGain)}">${withSign(formatMoney(stat.realizedGain, displayCurrency), stat.realizedGain)}</td>
          <td class="${signedClass(stat.unrealizedGain)}">${withSign(formatMoney(stat.unrealizedGain, displayCurrency), stat.unrealizedGain)}</td>
          <td>${stat.remainingQty}</td>
          <td>${stat.currentPrice.toFixed(2)} ${currency} <span class="${badgeClass}" title="${priceUpdatedTitle(stat)}">${SOURCE_LABEL[stat.priceSource] || stat.priceSource}</span>${staleBadge(stat)}</td>
          <td>${formatMoney(stat.marketValue, displayCurrency)}</td>
          <td>${stat.avgCost.toFixed(2)} ${currency}</td>
          <td>${formatMoney(stat.costBasisHeld, displayCurrency)}</td>
        </tr>`;
      })
      .join('');
  }

  function updateSortIndicators(tableId, sort) {
    document
      .querySelectorAll(`#${tableId} thead th[data-sort-key]`)
      .forEach((th) => {
        if (th.dataset.sortKey === sort.column) {
          th.dataset.sortDirection = sort.direction;
        } else {
          delete th.dataset.sortDirection;
        }
      });
  }

  function renderPriceOverridePanel(perSymbolStats, priceOverrides, handlers) {
    const tbody = document.querySelector('#price-override-table tbody');
    const held = perSymbolStats.filter((s) => s.remainingQty > 0);

    tbody.innerHTML = held
      .map((stat) => {
        const hasOverride = typeof priceOverrides[stat.symbol] === 'number';
        const badgeClass = `badge badge-${stat.priceSource}`;
        return `<tr data-symbol="${escapeHtml(stat.symbol)}" data-market="${stat.market}">
          <td>${escapeHtml(stat.symbol)} ${escapeHtml(stat.name || '')}</td>
          <td>${stat.market === 'TW' ? '台股' : '美股'}</td>
          <td>${stat.currentPrice.toFixed(2)}</td>
          <td><span class="${badgeClass}" title="${priceUpdatedTitle(stat)}">${SOURCE_LABEL[stat.priceSource] || stat.priceSource}</span>${staleBadge(stat)}</td>
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

  function initDropdownMenus() {
    const dropdowns = document.querySelectorAll('.dropdown');
    function closeAll() {
      dropdowns.forEach((d) => {
        d.querySelector('.dropdown-menu').hidden = true;
        d.querySelector('.dropdown-toggle').setAttribute(
          'aria-expanded',
          'false',
        );
      });
    }
    dropdowns.forEach((dropdown) => {
      const toggle = dropdown.querySelector('.dropdown-toggle');
      const menu = dropdown.querySelector('.dropdown-menu');
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = !menu.hidden;
        closeAll();
        if (!wasOpen) {
          menu.hidden = false;
          toggle.setAttribute('aria-expanded', 'true');
        }
      });
    });
    document.addEventListener('click', closeAll);
  }

  function renderImportFeedback(elId, { notice, errors } = {}) {
    const el = document.getElementById(elId);
    const parts = [];
    if (notice) parts.push(`<div class="import-notice">${notice}</div>`);
    if (errors && errors.length) {
      parts.push(
        `<div class="import-error-list">匯入時略過 ${errors.length} 列：<ul>${errors
          .map((e) => `<li>第 ${e.line} 列：${e.reason}</li>`)
          .join('')}</ul></div>`,
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

  const TOAST_DEFAULT_DURATION_MS = 5000;

  function showToast(
    message,
    {
      type = 'info',
      actionLabel,
      onAction,
      durationMs = TOAST_DEFAULT_DURATION_MS,
    } = {},
  ) {
    const container = document.getElementById('toast-container');
    if (!container) return null;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = message;
    toast.appendChild(text);

    let timer = null;
    function dismiss() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }

    if (actionLabel && typeof onAction === 'function') {
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'toast-action-btn';
      actionBtn.textContent = actionLabel;
      actionBtn.addEventListener('click', () => {
        dismiss();
        onAction();
      });
      toast.appendChild(actionBtn);
    }

    container.appendChild(toast);
    timer = setTimeout(dismiss, durationMs);
    return { dismiss, el: toast };
  }

  window.PFD = window.PFD || {};
  window.PFD.ui = {
    renderFilterControls,
    renderFxStatusPanel,
    renderSummaryCards,
    renderTransactionTable,
    renderSymbolPnlTable,
    updateSortIndicators,
    renderPriceOverridePanel,
    renderBackupReminderBanner,
    renderDemoModeBanner,
    renderImportFeedback,
    showToast,
    initTabs,
    initDropdownMenus,
    formatMoney,
    formatPct,
    escapeHtml,
  };
})();
