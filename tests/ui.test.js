import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../src/stockPrice.js';
import '../src/fields.js';
import '../src/csv.js';
import '../src/importer.js';
import '../src/ui.js';

const ui = window.PFD.ui;
const { escapeHtml } = ui;

describe('ui.escapeHtml', () => {
  it('escapes tags so injected markup cannot execute', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('escapes quotes to prevent breaking out of an HTML attribute', () => {
    expect(escapeHtml('"><script>1</script>')).toBe(
      '&quot;&gt;&lt;script&gt;1&lt;/script&gt;',
    );
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('2330')).toBe('2330');
  });

  it('treats null/undefined as an empty string instead of the literal text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('ui.formatMoney / formatPct', () => {
  it('renders a long dash for null, undefined, or NaN amounts', () => {
    expect(ui.formatMoney(null, 'TWD')).toBe('—');
    expect(ui.formatMoney(undefined, 'TWD')).toBe('—');
    expect(ui.formatMoney(NaN, 'TWD')).toBe('—');
    expect(ui.formatPct(NaN)).toBe('—');
  });

  it('formats a finite amount with its currency code', () => {
    expect(ui.formatMoney(1234.5, 'TWD')).toBe('1,234.5 TWD');
  });

  it('formats a percentage with two decimal places', () => {
    expect(ui.formatPct(4.5)).toBe('4.50%');
  });
});

describe('ui.updateSortIndicators', () => {
  function setupTable() {
    document.body.innerHTML = `
      <table id="symbol-pnl-table">
        <thead>
          <tr>
            <th data-sort-key="symbol">標的</th>
            <th data-sort-key="roiPct">ROI%</th>
          </tr>
        </thead>
      </table>
    `;
  }

  it('sets data-sort-direction on the matching header and clears any others', () => {
    setupTable();
    const symbolTh = document.querySelector('th[data-sort-key="symbol"]');
    const roiTh = document.querySelector('th[data-sort-key="roiPct"]');

    ui.updateSortIndicators('symbol-pnl-table', {
      column: 'symbol',
      direction: 'asc',
    });
    expect(symbolTh.dataset.sortDirection).toBe('asc');
    expect(roiTh.dataset.sortDirection).toBeUndefined();

    ui.updateSortIndicators('symbol-pnl-table', {
      column: 'roiPct',
      direction: 'desc',
    });
    expect(symbolTh.dataset.sortDirection).toBeUndefined();
    expect(roiTh.dataset.sortDirection).toBe('desc');
  });

  it('clears all indicators when no column is sorted', () => {
    setupTable();
    const symbolTh = document.querySelector('th[data-sort-key="symbol"]');
    ui.updateSortIndicators('symbol-pnl-table', {
      column: 'symbol',
      direction: 'asc',
    });
    ui.updateSortIndicators('symbol-pnl-table', {
      column: null,
      direction: 'asc',
    });
    expect(symbolTh.dataset.sortDirection).toBeUndefined();
  });
});

describe('ui.renderFilterControls', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="filter-year"></select>
      <select id="filter-market"><option value="all">全部</option><option value="TW">台股</option></select>
      <select id="filter-currency"><option value="TWD">TWD</option><option value="USD">USD</option></select>
      <select id="roi-trend-mode"><option value="cumulative">累積</option><option value="year-scoped">年度重置</option></select>
    `;
  });

  it('populates the year dropdown from the transactions and syncs market/currency/roi-trend-mode selects', () => {
    const state = {
      transactions: [{ date: '2024-05-01' }, { date: '2023-01-01' }],
      filters: {
        year: '2024',
        market: 'TW',
        displayCurrency: 'USD',
        roiTrendMode: 'year-scoped',
      },
    };
    ui.renderFilterControls(state);
    const yearSelect = document.getElementById('filter-year');
    expect([...yearSelect.options].map((o) => o.value)).toEqual([
      'all',
      '2024',
      '2023',
    ]);
    expect(yearSelect.value).toBe('2024');
    expect(document.getElementById('filter-market').value).toBe('TW');
    expect(document.getElementById('filter-currency').value).toBe('USD');
    expect(document.getElementById('roi-trend-mode').value).toBe('year-scoped');
  });

  it('falls back the year select to "all" when the selected year no longer exists', () => {
    const state = {
      transactions: [{ date: '2023-01-01' }],
      filters: {
        year: '2099',
        market: 'all',
        displayCurrency: 'TWD',
        roiTrendMode: 'cumulative',
      },
    };
    ui.renderFilterControls(state);
    expect(document.getElementById('filter-year').value).toBe('all');
  });
});

describe('ui.renderFxStatusPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<span id="fx-status-text"></span>';
  });

  it('shows an unavailable message when there is no fx result', () => {
    ui.renderFxStatusPanel(null);
    expect(document.getElementById('fx-status-text').textContent).toBe(
      '匯率不可用',
    );
  });

  it('labels a live rate', () => {
    ui.renderFxStatusPanel({
      rate: 32.1234,
      source: 'live',
      fetchedAt: new Date().toISOString(),
    });
    expect(document.getElementById('fx-status-text').textContent).toContain(
      '即時',
    );
    expect(document.getElementById('fx-status-text').textContent).toContain(
      '32.1234',
    );
  });

  it('labels a stale cached rate', () => {
    ui.renderFxStatusPanel({
      rate: 32,
      source: 'stale-cache',
      fetchedAt: new Date().toISOString(),
    });
    expect(document.getElementById('fx-status-text').textContent).toContain(
      '過期快取',
    );
  });

  it('falls back to the raw source string for an unrecognized source', () => {
    ui.renderFxStatusPanel({
      rate: 32,
      source: 'mystery',
      fetchedAt: new Date().toISOString(),
    });
    expect(document.getElementById('fx-status-text').textContent).toContain(
      'mystery',
    );
  });
});

describe('ui.renderSummaryCards', () => {
  beforeEach(() => {
    document.body.innerHTML = '<section id="summary-cards"></section>';
  });

  const baseSummary = {
    currency: 'TWD',
    totalInvested: 1000,
    costBasisHeld: 800,
    realizedGain: 100,
    unrealizedGain: 50,
    roiPct: 15,
    totalValue: 850,
    annualizedRoiPct: 7.5,
    marketBreakdown: null,
  };

  function cards() {
    return document.querySelectorAll('#summary-cards .summary-card');
  }

  it('renders exactly three cards: cost (with held-cost and total-value sub-fields), gain, and ROI', () => {
    ui.renderSummaryCards(baseSummary);
    expect(cards()).toHaveLength(3);
    const costCard = cards()[0];
    expect(costCard.querySelector('.label').textContent).toBe('總投入成本');
    expect(costCard.querySelector('.value').textContent).toContain('1,000');
    expect(costCard.textContent).toContain('目前持股成本');
    expect(costCard.textContent).toContain('800 TWD');
    // 總價值與持股成本並排對照（差額即未實現損益）
    expect(costCard.textContent).toContain('目前總價值');
    expect(costCard.textContent).toContain('850 TWD');
  });

  it('renders the gain with a positive sign and class', () => {
    ui.renderSummaryCards(baseSummary);
    const html = document.getElementById('summary-cards').innerHTML;
    expect(html).toContain('+150');
    expect(html).toContain('positive');
    expect(html).toContain('+15.00%');
  });

  it('keeps the ROI card ratios-only: annualized ROI present, total value absent', () => {
    ui.renderSummaryCards(baseSummary);
    const roiCard = cards()[2];
    expect(roiCard.textContent).toContain('年化（簡易）');
    expect(roiCard.textContent).toContain('7.50%');
    expect(roiCard.textContent).not.toContain('目前總價值');
  });

  it('renders a dash when the annualized ROI is unavailable', () => {
    ui.renderSummaryCards({ ...baseSummary, annualizedRoiPct: null });
    expect(cards()[2].textContent).toContain('—');
  });

  it('shows per-market gain sub-fields only when a marketBreakdown is provided', () => {
    ui.renderSummaryCards(baseSummary);
    expect(cards()[1].textContent).not.toContain('台股');

    ui.renderSummaryCards({
      ...baseSummary,
      marketBreakdown: [
        { label: '台股', gain: 120 },
        { label: '美股', gain: -20 },
      ],
    });
    const gainCard = cards()[1];
    expect(gainCard.textContent).toContain('台股');
    expect(gainCard.textContent).toContain('+120 TWD');
    expect(gainCard.textContent).toContain('美股');
    expect(gainCard.textContent).toContain('-20 TWD');
    const marketValues = [...gainCard.querySelectorAll('.sub-value')];
    expect(
      marketValues.some(
        (el) =>
          el.textContent === '+120 TWD' && el.classList.contains('positive'),
      ),
    ).toBe(true);
    expect(
      marketValues.some(
        (el) =>
          el.textContent === '-20 TWD' && el.classList.contains('negative'),
      ),
    ).toBe(true);
  });

  it('renders losses with a negative class and no leading plus sign', () => {
    ui.renderSummaryCards({
      ...baseSummary,
      realizedGain: -100,
      unrealizedGain: -50,
      roiPct: -15,
      annualizedRoiPct: -8,
    });
    const html = document.getElementById('summary-cards').innerHTML;
    expect(html).toContain('negative');
    expect(html).not.toContain('+-150');
  });
});

describe('ui.renderEmptyState', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="onboarding-empty-state" hidden></section>
      <section id="summary-cards"></section>
      <section id="charts"></section>
    `;
  });

  it('shows the empty state instead of the summary cards and charts', () => {
    ui.renderEmptyState(true);
    expect(document.getElementById('onboarding-empty-state').hidden).toBe(
      false,
    );
    expect(document.getElementById('summary-cards').hidden).toBe(true);
    expect(document.getElementById('charts').hidden).toBe(true);
  });

  it('restores the summary cards and charts once data exists', () => {
    ui.renderEmptyState(true);
    ui.renderEmptyState(false);
    expect(document.getElementById('onboarding-empty-state').hidden).toBe(true);
    expect(document.getElementById('summary-cards').hidden).toBe(false);
    expect(document.getElementById('charts').hidden).toBe(false);
  });
});

describe('ui.renderPriceQualityWarning', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="price-quality-warning" hidden></div>';
  });

  it('shows the warning when prices are unreliable and hides it otherwise', () => {
    ui.renderPriceQualityWarning(true);
    expect(document.getElementById('price-quality-warning').hidden).toBe(false);
    ui.renderPriceQualityWarning(false);
    expect(document.getElementById('price-quality-warning').hidden).toBe(true);
  });
});

describe('ui.renderDemoModeBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="demo-mode-banner" hidden></div>';
  });

  it('shows the banner when enabled and hides it when disabled', () => {
    ui.renderDemoModeBanner(true);
    expect(document.getElementById('demo-mode-banner').hidden).toBe(false);
    ui.renderDemoModeBanner(false);
    expect(document.getElementById('demo-mode-banner').hidden).toBe(true);
  });
});

describe('ui.renderBackupReminderBanner', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="backup-reminder-banner" hidden><span id="backup-reminder-text"></span></div>';
  });

  it('stays hidden below the threshold', () => {
    ui.renderBackupReminderBanner(4, 5);
    expect(document.getElementById('backup-reminder-banner').hidden).toBe(true);
  });

  it('shows the count once the threshold is reached', () => {
    ui.renderBackupReminderBanner(5, 5);
    expect(document.getElementById('backup-reminder-banner').hidden).toBe(
      false,
    );
    expect(
      document.getElementById('backup-reminder-text').textContent,
    ).toContain('5');
  });
});

describe('ui import modal', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="import-modal" hidden><div id="import-modal-body"></div></div>';
  });

  function body() {
    return document.getElementById('import-modal-body');
  }

  it('openImportModal / closeImportModal toggle visibility and clear the body', () => {
    ui.openImportModal();
    expect(document.getElementById('import-modal').hidden).toBe(false);
    body().innerHTML = 'stale';
    ui.closeImportModal();
    expect(document.getElementById('import-modal').hidden).toBe(true);
    expect(body().innerHTML).toBe('');
  });

  describe('renderImportMappingStep', () => {
    const headerFields = ['成交日期', '證券代號', '買賣別', '股數', '價格'];
    const mapping = {
      date: 0,
      symbol: 1,
      name: null,
      action: 2,
      quantity: 3,
      price: 4,
      fee: null,
    };

    it('renders one select per target field, preselected from the mapping', () => {
      ui.renderImportMappingStep({ headerFields, mapping }, {});
      const selects = body().querySelectorAll('.mapping-select');
      expect(selects).toHaveLength(7);
      expect(body().querySelector('[data-field="date"]').value).toBe('0');
      expect(body().querySelector('[data-field="name"]').value).toBe('');
    });

    it('escapes header field names in the options', () => {
      ui.renderImportMappingStep(
        { headerFields: ['<img src=x onerror=alert(1)>'], mapping },
        {},
      );
      expect(body().querySelector('img')).toBeNull();
    });

    it('apply passes the selected mapping; cancel fires onCancel', () => {
      const onApply = vi.fn();
      const onCancel = vi.fn();
      ui.renderImportMappingStep(
        { headerFields, mapping },
        { onApply, onCancel },
      );
      body().querySelector('.mapping-apply-btn').click();
      expect(onApply).toHaveBeenCalledWith(mapping);
      body().querySelector('.modal-cancel-btn').click();
      expect(onCancel).toHaveBeenCalled();
    });

    it('blocks apply and shows which required fields are missing', () => {
      const onApply = vi.fn();
      ui.renderImportMappingStep(
        { headerFields, mapping: { ...mapping, date: null, action: null } },
        { onApply },
      );
      body().querySelector('.mapping-apply-btn').click();
      expect(onApply).not.toHaveBeenCalled();
      const err = body().querySelector('.mapping-error');
      expect(err.hidden).toBe(false);
      expect(err.textContent).toContain('日期');
      expect(err.textContent).toContain('買賣');
    });
  });

  describe('renderImportPreviewStep', () => {
    const basePreview = {
      marketLabel: '台股',
      validCount: 12,
      errors: [],
      dateRange: { from: '2024-01-01', to: '2024-06-30' },
      symbolCount: 3,
      duplicateCount: 10,
      newCount: 2,
      existingCount: 40,
      previewRows: [
        {
          date: '2024-01-01',
          symbol: '2330',
          name: '台積電',
          action: 'buy',
          quantity: 100,
          price: 560,
          fee: 20,
        },
      ],
      encoding: 'utf-8',
    };

    it('renders the headline stats and the will-add count', () => {
      ui.renderImportPreviewStep(basePreview, {});
      const text = body().textContent;
      expect(text).toContain('12');
      expect(text).toContain('2024-01-01 ～ 2024-06-30');
      expect(text).toContain('3 檔標的');
      expect(document.getElementById('import-add-count').textContent).toBe('2');
      expect(body().querySelector('.import-preview-table')).not.toBeNull();
    });

    it('mentions Big5 only when that encoding was detected', () => {
      ui.renderImportPreviewStep(basePreview, {});
      expect(body().textContent).not.toContain('Big5');
      ui.renderImportPreviewStep({ ...basePreview, encoding: 'big5' }, {});
      expect(body().textContent).toContain('Big5');
    });

    it('caps the displayed error list and notes how many are omitted', () => {
      const errors = Array.from({ length: 14 }, (_, i) => ({
        line: i + 2,
        reason: 'quantity 必須是大於 0 的數字',
      }));
      ui.renderImportPreviewStep({ ...basePreview, errors }, {});
      const list = body().querySelector('.import-error-list');
      expect(list.querySelectorAll('li')).toHaveLength(10);
      expect(list.textContent).toContain('14');
      expect(list.textContent).toContain('其餘 4 列');
    });

    it('replace checkbox switches the add count, shows the warning, and reaches onConfirm', () => {
      const onConfirm = vi.fn();
      ui.renderImportPreviewStep(basePreview, { onConfirm });
      const checkbox = document.getElementById('import-replace-checkbox');
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      expect(document.getElementById('import-add-count').textContent).toBe(
        '12',
      );
      const warning = document.getElementById('import-replace-warning');
      expect(warning.hidden).toBe(false);
      expect(warning.textContent).toContain('40');
      document.getElementById('import-confirm-btn').click();
      expect(onConfirm).toHaveBeenCalledWith({ replace: true });
    });

    it('disables confirm when nothing would be written', () => {
      ui.renderImportPreviewStep({ ...basePreview, newCount: 0 }, {});
      const confirmBtn = document.getElementById('import-confirm-btn');
      expect(confirmBtn.disabled).toBe(true);
      // 勾選取代後有有效列可寫入 → 恢復可按
      const checkbox = document.getElementById('import-replace-checkbox');
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      expect(confirmBtn.disabled).toBe(false);
    });

    it('disables confirm in replace mode when the file has no valid rows', () => {
      ui.renderImportPreviewStep(
        { ...basePreview, validCount: 0, newCount: 0, previewRows: [] },
        {},
      );
      const checkbox = document.getElementById('import-replace-checkbox');
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      expect(document.getElementById('import-confirm-btn').disabled).toBe(true);
    });
  });
});

describe('ui.renderPriceOverridePanel', () => {
  const baseStat = {
    symbol: 'AAPL',
    name: 'Apple',
    market: 'US',
    remainingQty: 10,
    currentPrice: 200,
    priceSource: 'live',
    priceFetchedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    document.body.innerHTML =
      '<table id="price-override-table"><tbody></tbody></table>';
  });

  it('only lists currently-held symbols and disables clear when there is no override', () => {
    ui.renderPriceOverridePanel(
      [baseStat, { ...baseStat, symbol: 'SOLD', remainingQty: 0 }],
      {},
      { onOverrideChange: vi.fn(), onOverrideClear: vi.fn() },
    );
    const rows = document.querySelectorAll('#price-override-table tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.override-clear-btn').disabled).toBe(true);
  });

  it('saves a valid manually-entered price and ignores an invalid one', () => {
    const onOverrideChange = vi.fn();
    ui.renderPriceOverridePanel(
      [baseStat],
      {},
      { onOverrideChange, onOverrideClear: vi.fn() },
    );
    const row = document.querySelector('#price-override-table tbody tr');

    row.querySelector('.override-input').value = '-5';
    row.querySelector('.override-save-btn').click();
    expect(onOverrideChange).not.toHaveBeenCalled();

    row.querySelector('.override-input').value = '210';
    row.querySelector('.override-save-btn').click();
    expect(onOverrideChange).toHaveBeenCalledWith('AAPL', 210);
  });

  it('clears an existing override and enables the clear button when one is set', () => {
    const onOverrideClear = vi.fn();
    ui.renderPriceOverridePanel(
      [baseStat],
      { AAPL: 199 },
      { onOverrideChange: vi.fn(), onOverrideClear },
    );
    const row = document.querySelector('#price-override-table tbody tr');
    expect(row.querySelector('.override-clear-btn').disabled).toBe(false);
    row.querySelector('.override-clear-btn').click();
    expect(onOverrideClear).toHaveBeenCalledWith('AAPL');
  });
});

describe('ui.showToast', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="toast-container"></div>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the message as an info toast and auto-dismisses after the default 5s', () => {
    ui.showToast('已新增 2330 買進 1000 股');
    const toast = document.querySelector('#toast-container .toast');
    expect(toast).not.toBeNull();
    expect(toast.classList.contains('toast-info')).toBe(true);
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.querySelector('.toast-message').textContent).toBe(
      '已新增 2330 買進 1000 股',
    );

    vi.advanceTimersByTime(4999);
    expect(document.querySelector('#toast-container .toast')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.querySelector('#toast-container .toast')).toBeNull();
  });

  it('marks an error toast with the error class and an assertive alert role', () => {
    ui.showToast('symbol 不可為空', { type: 'error' });
    const toast = document.querySelector('.toast');
    expect(toast.classList.contains('toast-error')).toBe(true);
    expect(toast.getAttribute('role')).toBe('alert');
  });

  it('respects a custom durationMs instead of the default', () => {
    ui.showToast('稍縱即逝', { durationMs: 1000 });
    vi.advanceTimersByTime(999);
    expect(document.querySelector('.toast')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('renders an action button that fires the callback and dismisses the toast immediately', () => {
    const onAction = vi.fn();
    ui.showToast('已刪除 2330 買進 1000 股', {
      actionLabel: '復原',
      onAction,
      durationMs: 6000,
    });
    const btn = document.querySelector('.toast .toast-action-btn');
    expect(btn.textContent).toBe('復原');

    btn.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.toast')).toBeNull();

    // the auto-dismiss timer must have been cleared; advancing time is a no-op
    vi.advanceTimersByTime(10000);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders no action button when actionLabel is given without a callback', () => {
    ui.showToast('無動作', { actionLabel: '復原' });
    expect(document.querySelector('.toast')).not.toBeNull();
    expect(document.querySelector('.toast-action-btn')).toBeNull();
  });

  it('stacks multiple toasts and dismissing one is idempotent and leaves the rest', () => {
    const first = ui.showToast('first');
    ui.showToast('second');
    expect(document.querySelectorAll('.toast')).toHaveLength(2);

    first.dismiss();
    expect(document.querySelectorAll('.toast')).toHaveLength(1);
    first.dismiss(); // second dismiss is a harmless no-op
    expect(document.querySelectorAll('.toast')).toHaveLength(1);
    expect(document.querySelector('.toast-message').textContent).toBe('second');
  });

  it('returns null and does nothing when the toast container is missing', () => {
    document.body.innerHTML = '';
    expect(ui.showToast('nowhere to go')).toBeNull();
  });
});

describe('ui.initTabs', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav>
        <button class="tab-btn active" data-tab="overview" aria-selected="true">總覽</button>
        <button class="tab-btn" data-tab="symbols" aria-selected="false">個股損益</button>
      </nav>
      <div class="tab-panel" data-tab-panel="overview"></div>
      <div class="tab-panel" data-tab-panel="symbols" hidden></div>
    `;
    window.PFD.charts = { resizeCharts: vi.fn() };
  });

  it('switches the active tab, toggles panel visibility, and updates aria-selected', () => {
    ui.initTabs();
    document.querySelector('[data-tab="symbols"]').click();

    expect(
      document
        .querySelector('[data-tab="symbols"]')
        .classList.contains('active'),
    ).toBe(true);
    expect(
      document
        .querySelector('[data-tab="overview"]')
        .classList.contains('active'),
    ).toBe(false);
    expect(
      document
        .querySelector('[data-tab="overview"]')
        .getAttribute('aria-selected'),
    ).toBe('false');
    expect(document.querySelector('[data-tab-panel="overview"]').hidden).toBe(
      true,
    );
    expect(document.querySelector('[data-tab-panel="symbols"]').hidden).toBe(
      false,
    );
  });

  it('resizes the charts when switching back to the overview tab', () => {
    ui.initTabs();
    document.querySelector('[data-tab="symbols"]').click();
    document.querySelector('[data-tab="overview"]').click();
    expect(window.PFD.charts.resizeCharts).toHaveBeenCalled();
  });
});

describe('ui.initDropdownMenus', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="dropdown">
        <button class="dropdown-toggle" aria-expanded="false">匯出</button>
        <div class="dropdown-menu" hidden></div>
      </div>
      <div class="dropdown">
        <button class="dropdown-toggle" aria-expanded="false">匯入</button>
        <div class="dropdown-menu" hidden></div>
      </div>
    `;
    ui.initDropdownMenus();
  });

  it('opens a menu on toggle click', () => {
    const [first] = document.querySelectorAll('.dropdown');
    first.querySelector('.dropdown-toggle').click();
    expect(first.querySelector('.dropdown-menu').hidden).toBe(false);
    expect(
      first.querySelector('.dropdown-toggle').getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('closes an open menu when its own toggle is clicked again', () => {
    const [first] = document.querySelectorAll('.dropdown');
    first.querySelector('.dropdown-toggle').click();
    first.querySelector('.dropdown-toggle').click();
    expect(first.querySelector('.dropdown-menu').hidden).toBe(true);
  });

  it('closes the first menu when a second dropdown is opened', () => {
    const [first, second] = document.querySelectorAll('.dropdown');
    first.querySelector('.dropdown-toggle').click();
    second.querySelector('.dropdown-toggle').click();
    expect(first.querySelector('.dropdown-menu').hidden).toBe(true);
    expect(second.querySelector('.dropdown-menu').hidden).toBe(false);
  });

  it('closes an open menu on an outside click', () => {
    const [first] = document.querySelectorAll('.dropdown');
    first.querySelector('.dropdown-toggle').click();
    document.body.click();
    expect(first.querySelector('.dropdown-menu').hidden).toBe(true);
  });
});
