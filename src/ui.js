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

  // summary 除了 convertSummaryToDisplayCurrency 的欄位外，還帶
  // totalValue（持股成本＋未實現）、annualizedRoiPct（可為 null）、
  // marketBreakdown（市場=全部時的各市場損益小計，否則為 null）。
  function renderSummaryCards(summary) {
    const container = document.getElementById('summary-cards');
    const totalGain = summary.realizedGain + summary.unrealizedGain;

    const gainSubGroups = [
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
    ];
    if (summary.marketBreakdown) {
      gainSubGroups.push(
        summary.marketBreakdown.map(({ label, gain }) => [
          label,
          withSign(formatMoney(gain, summary.currency), gain),
          signedClass(gain),
        ]),
      );
    }

    // 每張卡：[主標籤, 主值, 主值 class, 子欄位群組陣列]
    const cards = [
      [
        '總投入成本',
        formatMoney(summary.totalInvested, summary.currency),
        '',
        [
          // 持股成本與總價值並排對照，兩者差額即未實現損益
          [
            [
              '目前持股成本',
              formatMoney(summary.costBasisHeld, summary.currency),
              '',
            ],
            [
              '目前總價值',
              formatMoney(summary.totalValue, summary.currency),
              '',
            ],
          ],
        ],
      ],
      [
        '總損益',
        withSign(formatMoney(totalGain, summary.currency), totalGain),
        signedClass(totalGain),
        gainSubGroups,
      ],
      [
        'ROI%',
        withSign(formatPct(summary.roiPct), summary.roiPct),
        signedClass(summary.roiPct),
        [[['年化（簡易）', formatPct(summary.annualizedRoiPct), '']]],
      ],
    ];

    container.innerHTML = cards
      .map(([label, value, cls, subGroups]) => {
        const subHtml = (subGroups || [])
          .map(
            (group) =>
              `<div class="sub-fields">${group
                .map(
                  ([sLabel, sValue, sCls]) =>
                    `<div class="sub-field"><span class="sub-label">${sLabel}</span><span class="sub-value ${sCls}">${sValue}</span></div>`,
                )
                .join('')}</div>`,
          )
          .join('');
        return `<div class="summary-card"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${subHtml}</div>`;
      })
      .join('');
  }

  function priceUpdatedTitle(stat) {
    if (!stat.priceFetchedAt) return '尚未取得即時報價';
    return `最後更新：${new Date(stat.priceFetchedAt).toLocaleString()}`;
  }

  function staleBadge(stat) {
    // 「報價已過期」只對真正的報價（即時/快取）有意義；
    // 估計值與手動覆寫本來就不是報價，另外掛過期標籤只會造成雜訊。
    if (stat.priceSource !== 'live' && stat.priceSource !== 'cache') return '';
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

    renderSymbolPnlTotalsRow(perSymbolStats, displayCurrency);
  }

  // 合計列渲染於 tbody 最前面（而非 tfoot），讓使用者不必捲到表格
  // 最下面就能看到總覽數字；必須在資料列的 innerHTML 設定「之後」呼叫。
  function renderSymbolPnlTotalsRow(perSymbolStats, displayCurrency) {
    const tbody = document.querySelector('#symbol-pnl-table tbody');
    if (!tbody) return;
    if (perSymbolStats.length === 0) return;

    // 這些金額在 app.js render() 已轉為顯示幣別，可直接加總。
    const sum = (key) =>
      perSymbolStats.reduce((total, stat) => total + stat[key], 0);
    const realizedGain = sum('realizedGain');
    const unrealizedGain = sum('unrealizedGain');
    const marketValue = sum('marketValue');
    const costBasisHeld = sum('costBasisHeld');

    const totalsRow = document.createElement('tr');
    totalsRow.className = 'totals-row';
    totalsRow.innerHTML = `
      <td>合計</td>
      <td>—</td>
      <td>—</td>
      <td class="${signedClass(realizedGain)}">${withSign(formatMoney(realizedGain, displayCurrency), realizedGain)}</td>
      <td class="${signedClass(unrealizedGain)}">${withSign(formatMoney(unrealizedGain, displayCurrency), unrealizedGain)}</td>
      <td>—</td>
      <td>—</td>
      <td>${formatMoney(marketValue, displayCurrency)}</td>
      <td>—</td>
      <td>${formatMoney(costBasisHeld, displayCurrency)}</td>
    `;
    tbody.insertBefore(totalsRow, tbody.firstChild);
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

  function renderEmptyState(show) {
    document.getElementById('onboarding-empty-state').hidden = !show;
    document.getElementById('summary-cards').hidden = show;
    document.getElementById('charts').hidden = show;
  }

  function renderPriceQualityWarning(show) {
    document.getElementById('price-quality-warning').hidden = !show;
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

  function openImportModal() {
    document.getElementById('import-modal').hidden = false;
  }

  function closeImportModal() {
    document.getElementById('import-modal').hidden = true;
    document.getElementById('import-modal-body').innerHTML = '';
  }

  const IMPORT_ERROR_DISPLAY_LIMIT = 10;

  function importErrorListHtml(errors) {
    if (!errors.length) return '';
    const shown = errors.slice(0, IMPORT_ERROR_DISPLAY_LIMIT);
    const restCount = errors.length - shown.length;
    return `<div class="import-error-list">格式錯誤、將被略過的 ${errors.length} 列：<ul>${shown
      .map((e) => `<li>第 ${e.line} 列：${escapeHtml(e.reason)}</li>`)
      .join(
        '',
      )}</ul>${restCount > 0 ? `<p>…其餘 ${restCount} 列省略</p>` : ''}</div>`;
  }

  // 匯入精靈第一步：來源欄位 → 標準欄位的對應。
  function renderImportMappingStep({ headerFields, mapping }, handlers) {
    const importer = window.PFD.importer;
    const body = document.getElementById('import-modal-body');

    const optionsFor = (selectedIdx, optional) => {
      const skipLabel = optional ? '（略過）' : '（請選擇）';
      return (
        `<option value=""${selectedIdx === null ? ' selected' : ''}>${skipLabel}</option>` +
        headerFields
          .map(
            (h, i) =>
              `<option value="${i}"${i === selectedIdx ? ' selected' : ''}>${escapeHtml(h)}</option>`,
          )
          .join('')
      );
    };

    body.innerHTML = `
      <p>你的檔案欄位名稱與標準欄位不同，請確認以下自動猜測的對應：</p>
      <div class="mapping-grid">
        ${importer.TARGET_FIELDS.map((field) => {
          const optional = importer.OPTIONAL_FIELDS.includes(field);
          return `<label class="mapping-row">${importer.FIELD_LABELS[field]}（${field}${optional ? '，可略過' : ''}）
            <select class="mapping-select" data-field="${field}">${optionsFor(mapping[field], optional)}</select>
          </label>`;
        }).join('')}
      </div>
      <p class="mapping-error" hidden></p>
      <div class="modal-actions">
        <button type="button" class="mapping-apply-btn">套用</button>
        <button type="button" class="modal-cancel-btn">取消</button>
      </div>`;

    body.querySelector('.mapping-apply-btn').addEventListener('click', () => {
      const result = {};
      body.querySelectorAll('.mapping-select').forEach((sel) => {
        result[sel.dataset.field] = sel.value === '' ? null : Number(sel.value);
      });
      const missing = importer.REQUIRED_FIELDS.filter(
        (f) => result[f] === null,
      );
      if (missing.length) {
        const err = body.querySelector('.mapping-error');
        err.hidden = false;
        err.textContent = `請先為必填欄位選擇來源欄：${missing
          .map((f) => importer.FIELD_LABELS[f])
          .join('、')}`;
        return;
      }
      handlers.onApply(result);
    });
    body
      .querySelector('.modal-cancel-btn')
      .addEventListener('click', handlers.onCancel);
  }

  // 匯入精靈第二步：統計預覽與確認。
  function renderImportPreviewStep(preview, handlers) {
    const body = document.getElementById('import-modal-body');
    const {
      marketLabel,
      validCount,
      errors,
      dateRange,
      symbolCount,
      duplicateCount,
      newCount,
      existingCount,
      previewRows,
      encoding,
    } = preview;

    const rangeText = dateRange ? `${dateRange.from} ～ ${dateRange.to}、` : '';
    const previewTable = previewRows.length
      ? `<table class="import-preview-table">
          <thead><tr><th>日期</th><th>代號</th><th>名稱</th><th>買賣</th><th>股數</th><th>單價</th><th>手續費</th></tr></thead>
          <tbody>${previewRows
            .map(
              (tx) =>
                `<tr><td>${tx.date}</td><td>${escapeHtml(tx.symbol)}</td><td>${escapeHtml(tx.name || '')}</td><td>${tx.action === 'buy' ? '買進' : '賣出'}</td><td>${tx.quantity}</td><td>${tx.price}</td><td>${tx.fee}</td></tr>`,
            )
            .join('')}</tbody>
        </table>`
      : '';

    body.innerHTML = `
      ${encoding === 'big5' ? '<p class="import-encoding-note">已自動偵測為 Big5 編碼並轉換。</p>' : ''}
      <p class="import-stats">解析成功 <b>${validCount}</b> 筆（${rangeText}${symbolCount} 檔標的），與現有${marketLabel}資料重複 <b>${duplicateCount}</b> 筆。</p>
      ${importErrorListHtml(errors)}
      <p class="import-will-add">將新增 <b id="import-add-count">${newCount}</b> 筆${marketLabel}交易</p>
      ${previewRows.length ? `<p class="import-preview-caption">前 ${previewRows.length} 筆預覽：</p>${previewTable}` : ''}
      <label class="import-replace-option">
        <input type="checkbox" id="import-replace-checkbox" />
        清空${marketLabel}現有紀錄後匯入（進階）
      </label>
      <p id="import-replace-warning" class="import-replace-warning" hidden>
        ⚠ 現有 ${existingCount} 筆${marketLabel}紀錄將被刪除且無法復原
      </p>
      <div class="modal-actions">
        <button type="button" id="import-confirm-btn">確認匯入</button>
        <button type="button" class="modal-cancel-btn">取消</button>
      </div>`;

    const replaceCheckbox = body.querySelector('#import-replace-checkbox');
    const confirmBtn = body.querySelector('#import-confirm-btn');
    const syncConfirmState = () => {
      const replace = replaceCheckbox.checked;
      body.querySelector('#import-add-count').textContent = String(
        replace ? validCount : newCount,
      );
      body.querySelector('#import-replace-warning').hidden = !replace;
      // 沒有任何資料會被寫入（或取代模式下檔案沒有有效列）時不允許確認
      confirmBtn.disabled = replace ? validCount === 0 : newCount === 0;
    };
    replaceCheckbox.addEventListener('change', syncConfirmState);
    syncConfirmState();

    confirmBtn.addEventListener('click', () =>
      handlers.onConfirm({ replace: replaceCheckbox.checked }),
    );
    body
      .querySelector('.modal-cancel-btn')
      .addEventListener('click', handlers.onCancel);
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
    renderEmptyState,
    renderPriceQualityWarning,
    openImportModal,
    closeImportModal,
    renderImportMappingStep,
    renderImportPreviewStep,
    showToast,
    initTabs,
    initDropdownMenus,
    formatMoney,
    formatPct,
    escapeHtml,
  };
})();
