import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../src/stockPrice.js';
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

  it('renders total/cost/gain/ROI cards with a positive sign and class on gains', () => {
    ui.renderSummaryCards({
      currency: 'TWD',
      totalInvested: 1000,
      costBasisHeld: 800,
      realizedGain: 100,
      unrealizedGain: 50,
      roiPct: 15,
    });
    const html = document.getElementById('summary-cards').innerHTML;
    expect(html).toContain('+150');
    expect(html).toContain('positive');
    expect(html).toContain('+15.00%');
  });

  it('renders losses with a negative class and no leading plus sign', () => {
    ui.renderSummaryCards({
      currency: 'TWD',
      totalInvested: 1000,
      costBasisHeld: 800,
      realizedGain: -100,
      unrealizedGain: -50,
      roiPct: -15,
    });
    const html = document.getElementById('summary-cards').innerHTML;
    expect(html).toContain('negative');
    expect(html).not.toContain('+-150');
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

describe('ui.renderImportFeedback', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="import-errors" hidden></div>';
  });

  it('hides and clears the panel when there is nothing to report', () => {
    const el = document.getElementById('import-errors');
    el.hidden = false;
    el.innerHTML = 'stale content';
    ui.renderImportFeedback('import-errors', {});
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe('');
  });

  it('shows a notice and lists skipped rows with their line numbers and reasons', () => {
    ui.renderImportFeedback('import-errors', {
      notice: '已匯入 3 筆',
      errors: [{ line: 4, reason: 'quantity 必須是大於 0 的數字' }],
    });
    const el = document.getElementById('import-errors');
    expect(el.hidden).toBe(false);
    expect(el.innerHTML).toContain('已匯入 3 筆');
    expect(el.innerHTML).toContain('第 4 列');
    expect(el.innerHTML).toContain('quantity 必須是大於 0 的數字');
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
