import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8');
const bodyHtml = indexHtml.match(/<body>([\s\S]*)<\/body>/)[1];

// Demo dataset deliberately covers a different year range than the "real" data
// imported in tests below (2026), mirroring the bundled db/*.example.csv files.
const EXAMPLE_TW_CSV = 'date,symbol,name,action,quantity,price,fee\n2024-03-01,2330,台積電,buy,1000,500,100\n';
const EXAMPLE_US_CSV = 'date,symbol,name,action,quantity,price,fee\n2024-03-01,AAPL,Apple Inc.,buy,10,180,1\n';

class FakeChart {
  resize() {}
  destroy() {}
}
FakeChart.defaults = {};

function makeFetchMock() {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('tw-stock.example.csv')) return { ok: true, text: async () => EXAMPLE_TW_CSV };
    if (u.includes('us-stock.example.csv')) return { ok: true, text: async () => EXAMPLE_US_CSV };
    if (u.includes('tw-stock.csv') || u.includes('us-stock.csv')) return { ok: false, text: async () => '' };
    if (u.includes('open.er-api.com')) return { ok: true, json: async () => ({ result: 'success', rates: { TWD: 32 } }) };
    if (u.includes('/api/stock-price')) return { ok: true, json: async () => ({}) };
    return { ok: false, text: async () => '', json: async () => ({}) };
  });
}

async function setupApp() {
  document.body.innerHTML = bodyHtml;
  localStorage.clear();
  delete window.PFD;
  vi.resetModules();
  global.Chart = FakeChart;
  global.fetch = makeFetchMock();
  global.alert = vi.fn();

  await import('../src/config.js');
  await import('../src/storage.js');
  await import('../src/csv.js');
  await import('../src/exchangeRate.js');
  await import('../src/stockPrice.js');
  await import('../src/roi.js');
  await import('../src/charts.js');
  await import('../src/ui.js');
  await import('../src/app.js');

  const app = window.PFD.app;
  await app.init();
  return app;
}

function txTableRowCount() {
  return document.querySelectorAll('#transactions-table tbody tr').length;
}

describe('app: demo mode / filter / import interaction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the demo dataset (not an empty table) after importing data filtered to a year demo data lacks', async () => {
    const app = await setupApp();
    expect(txTableRowCount()).toBe(0); // no seed files exist, so a fresh install starts empty

    const importedCsv = 'date,symbol,name,action,quantity,price,fee\n2026-01-15,0050,元大台灣50,buy,100,150,20\n';
    app.handleReplaceImportText(importedCsv, 'TW');
    app.handleFilterChange({ year: '2026' });
    expect(txTableRowCount()).toBe(1); // real imported row visible under the matching year filter

    await app.setDemoMode(true);

    expect(txTableRowCount()).toBeGreaterThan(0); // demo rows must render, not an empty table
    expect(document.getElementById('filter-year').value).toBe('all');
    expect(app.state.filters.year).toBe('all'); // underlying filter must match the dropdown, not just its display

    await app.setDemoMode(false);
    expect(txTableRowCount()).toBe(1); // real imported data survived the round trip through demo mode
  });

  it('blocks add/import/export while demo mode is on and leaves real data untouched', async () => {
    const app = await setupApp();
    const importedCsv = 'date,symbol,name,action,quantity,price,fee\n2026-01-15,0050,元大台灣50,buy,100,150,20\n';
    app.handleReplaceImportText(importedCsv, 'TW');

    await app.setDemoMode(true);

    const replacementCsv = 'date,symbol,name,action,quantity,price,fee\n2026-02-01,2330,台積電,buy,50,600,30\n';
    app.handleReplaceImportText(replacementCsv, 'TW');
    app.handleAddTransaction('TW', { date: '2026-03-01', symbol: 'XYZ', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });

    expect(global.alert).toHaveBeenCalled();

    await app.setDemoMode(false);
    expect(txTableRowCount()).toBe(1); // the original import, not the blocked replacement/add
    expect(document.querySelector('#transactions-table tbody tr').textContent).toContain('0050');
  });

  it('also blocks delete and price-override edits while demo mode is on', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', { date: '2026-01-01', symbol: '0050', name: '', action: 'buy', quantity: 10, price: 100, fee: 0 });
    await app.setDemoMode(true);

    const txId = app.state.transactions[0].id;
    app.handleDeleteTransaction(txId, 'TW');
    app.handlePriceOverrideChange('0050', 123);
    app.handlePriceOverrideClear('0050');
    expect(global.alert).toHaveBeenCalledTimes(3);

    await app.setDemoMode(false);
    expect(app.state.transactions).toHaveLength(1); // delete was blocked
  });

  it('also blocks export and append-import while demo mode is on', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', { date: '2026-01-01', symbol: '0050', name: '', action: 'buy', quantity: 10, price: 100, fee: 0 });
    await app.setDemoMode(true);

    app.handleExport('TW');
    app.handleAppendImportText('date,symbol,name,action,quantity,price,fee\n2026-02-01,XYZ,,buy,1,1,0\n', 'TW');
    expect(global.alert).toHaveBeenCalledTimes(2);

    await app.setDemoMode(false);
    expect(app.state.transactions).toHaveLength(1); // append was blocked, nothing extra landed
  });
});

describe('app: add / delete / price override (real, non-demo data)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handleAddTransaction appends a row and re-renders the table', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', { date: '2024-01-01', symbol: '2330', name: '台積電', action: 'buy', quantity: 100, price: 500, fee: 20 });
    expect(txTableRowCount()).toBe(1);
    expect(document.querySelector('#transactions-table tbody tr').textContent).toContain('2330');
  });

  it('handleReplaceImportText reports the US market label in its feedback notice', async () => {
    const app = await setupApp();
    const csvText = 'date,symbol,name,action,quantity,price,fee\n2024-01-01,AAPL,,buy,1,1,0\n';
    app.handleReplaceImportText(csvText, 'US');
    expect(document.getElementById('import-errors').textContent).toContain('美股');
  });

  it('clicking a row delete button removes that transaction via handleDeleteTransaction', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', { date: '2024-01-01', symbol: 'AAA', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });
    app.handleAddTransaction('US', { date: '2024-01-01', symbol: 'BBB', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });
    expect(txTableRowCount()).toBe(2);

    const row = [...document.querySelectorAll('#transactions-table tbody tr')].find((tr) => tr.textContent.includes('AAA'));
    row.querySelector('.delete-tx-btn').click();

    expect(txTableRowCount()).toBe(1);
    expect(document.querySelector('#transactions-table tbody tr').textContent).toContain('BBB');
  });

  it('saving a manual price override updates the override panel and clearing it removes the override', async () => {
    const app = await setupApp();
    app.handleAddTransaction('US', { date: '2024-01-01', symbol: 'AAPL', name: 'Apple', action: 'buy', quantity: 10, price: 100, fee: 0 });

    const row = document.querySelector('#price-override-table tbody tr');
    row.querySelector('.override-input').value = '210';
    row.querySelector('.override-save-btn').click();

    const updatedRow = document.querySelector('#price-override-table tbody tr');
    expect(updatedRow.querySelector('.override-clear-btn').disabled).toBe(false);
    expect(window.PFD.storage.loadPriceOverrides()).toEqual({ AAPL: 210 });

    updatedRow.querySelector('.override-clear-btn').click();
    expect(window.PFD.storage.loadPriceOverrides()).toEqual({});
  });
});

describe('app: export and append-import', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('handleExport triggers a CSV download and resets the unexported-change counter', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', { date: '2024-01-01', symbol: '2330', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });
    expect(window.PFD.storage.loadUnexportedChangeCount()).toBeGreaterThan(0);

    app.handleExport('TW');

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(window.PFD.storage.loadUnexportedChangeCount()).toBe(0);
  });

  it('handleAppendImportText adds new rows on top of existing data for that market without replacing it', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', { date: '2024-01-01', symbol: 'EXISTING', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });

    const appendCsv = 'date,symbol,name,action,quantity,price,fee\n2024-02-01,NEWROW,,buy,1,1,0\n';
    app.handleAppendImportText(appendCsv, 'TW');

    expect(txTableRowCount()).toBe(2);
    const feedback = document.getElementById('add-tx-import-feedback');
    expect(feedback.hidden).toBe(false);
    expect(feedback.textContent).toContain('1');
  });
});

describe('app: DOM-wired interactions (filters, sorting, theme, add-transaction form)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('changing the filter selects updates state.filters and persists them', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', { date: '2024-01-01', symbol: '2330', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });

    const marketSelect = document.getElementById('filter-market');
    marketSelect.value = 'TW';
    marketSelect.dispatchEvent(new Event('change'));
    expect(app.state.filters.market).toBe('TW');

    const currencySelect = document.getElementById('filter-currency');
    currencySelect.value = 'USD';
    currencySelect.dispatchEvent(new Event('change'));
    expect(app.state.filters.displayCurrency).toBe('USD');
  });

  it('clicking a transactions-table sort header toggles direction on repeated clicks', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', { date: '2024-01-01', symbol: 'A', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });
    app.handleAddTransaction('TW', { date: '2024-06-01', symbol: 'B', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });

    const dateHeader = document.querySelector('#transactions-table thead th[data-sort-key="date"]');
    dateHeader.click();
    expect(app.state.txSort).toEqual({ column: 'date', direction: 'asc' });
    dateHeader.click();
    expect(app.state.txSort).toEqual({ column: 'date', direction: 'desc' });
  });

  it('clicking a transactions-table sort header switches to it (asc) when a different column was previously sorted', async () => {
    const app = await setupApp();
    app.state.txSort = { column: 'symbol', direction: 'desc' };

    const dateHeader = document.querySelector('#transactions-table thead th[data-sort-key="date"]');
    dateHeader.click();
    expect(app.state.txSort).toEqual({ column: 'date', direction: 'asc' });
  });

  it('clicking a symbol-pnl-table sort header sorts by that column and toggles direction on repeated clicks', async () => {
    const app = await setupApp();
    app.handleAddTransaction('US', { date: '2024-01-01', symbol: 'AAA', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });
    app.handleAddTransaction('US', { date: '2024-01-01', symbol: 'BBB', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });

    const roiHeader = document.querySelector('#symbol-pnl-table thead th[data-sort-key="roiPct"]');
    roiHeader.click();
    expect(app.state.sort).toEqual({ column: 'roiPct', direction: 'asc' });
    roiHeader.click();
    expect(app.state.sort).toEqual({ column: 'roiPct', direction: 'desc' });
    roiHeader.click();
    expect(app.state.sort).toEqual({ column: 'roiPct', direction: 'asc' });

    const symbolHeader = document.querySelector('#symbol-pnl-table thead th[data-sort-key="symbol"]');
    symbolHeader.click();
    expect(app.state.sort).toEqual({ column: 'symbol', direction: 'asc' });
  });

  it('the backup-reminder banner export button exports both TW and US transactions', async () => {
    const app = await setupApp();
    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    app.handleAddTransaction('TW', { date: '2024-01-01', symbol: '2330', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });
    app.handleAddTransaction('US', { date: '2024-01-01', symbol: 'AAPL', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });

    document.getElementById('backup-reminder-export-btn').click();

    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(window.PFD.storage.loadUnexportedChangeCount()).toBe(0);
  });

  it('the add-transaction form rejects a non-positive quantity with an alert and does not add a row', async () => {
    await setupApp();
    const form = document.getElementById('add-transaction-form');
    form.elements.market.value = 'TW';
    form.elements.date.value = '2024-01-01';
    form.elements.symbol.value = 'BAD';
    form.elements.action.value = 'buy';
    form.elements.quantity.value = '0';
    form.elements.price.value = '10';

    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(global.alert).toHaveBeenCalled();
    expect(txTableRowCount()).toBe(0);
  });

  it('submitting a valid add-transaction form adds the row and resets the form', async () => {
    await setupApp();
    const form = document.getElementById('add-transaction-form');
    form.elements.market.value = 'US';
    form.elements.date.value = '2024-01-01';
    form.elements.symbol.value = 'GOOD';
    form.elements.action.value = 'buy';
    form.elements.quantity.value = '5';
    form.elements.price.value = '20';

    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(txTableRowCount()).toBe(1);
    expect(document.querySelector('#transactions-table tbody tr').textContent).toContain('GOOD');
    expect(form.elements.symbol.value).toBe('');
  });

  it('submitting the add-transaction form with an explicit fee uses that value instead of defaulting to 0', async () => {
    const app = await setupApp();
    const form = document.getElementById('add-transaction-form');
    form.elements.market.value = 'US';
    form.elements.date.value = '2024-01-01';
    form.elements.symbol.value = 'FEED';
    form.elements.action.value = 'buy';
    form.elements.quantity.value = '5';
    form.elements.price.value = '20';
    form.elements.fee.value = '3.5';

    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(app.state.transactions.find((tx) => tx.symbol === 'FEED').fee).toBe(3.5);
  });

  it('submitting the add-transaction form with a blank fee defaults it to 0', async () => {
    const app = await setupApp();
    const form = document.getElementById('add-transaction-form');
    form.elements.market.value = 'US';
    form.elements.date.value = '2024-01-01';
    form.elements.symbol.value = 'NOFEE';
    form.elements.action.value = 'buy';
    form.elements.quantity.value = '5';
    form.elements.price.value = '20';
    form.elements.fee.value = '';

    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(app.state.transactions.find((tx) => tx.symbol === 'NOFEE').fee).toBe(0);
  });

  it('changing the theme select updates the document attribute and persists the choice', async () => {
    await setupApp();
    const themeSelect = document.getElementById('theme-select');
    themeSelect.value = 'forest';
    themeSelect.dispatchEvent(new Event('change'));

    expect(document.documentElement.getAttribute('data-theme')).toBe('forest');
    expect(window.PFD.storage.loadTheme()).toBe('forest');
  });

  it('toggling the demo-mode checkbox in the DOM enables demo mode and shows the banner', async () => {
    const app = await setupApp();
    const checkbox = document.getElementById('demo-mode-toggle');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(document.getElementById('demo-mode-banner').hidden).toBe(false));
    expect(app.state.demoMode).toBe(true);
  });

  it('warns before unload only when there are unexported changes', async () => {
    await setupApp();
    const evt = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false); // nothing unexported yet

    window.PFD.app.handleAddTransaction('TW', { date: '2024-01-01', symbol: 'X', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });
    const evt2 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evt2);
    expect(evt2.defaultPrevented).toBe(true);
  });
});

describe('app: render with no usable fx rate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('still renders (no crash) when the fx fetch fails and there is no cached rate to fall back to', async () => {
    document.body.innerHTML = bodyHtml;
    localStorage.clear();
    delete window.PFD;
    vi.resetModules();
    global.Chart = FakeChart;
    global.alert = vi.fn();
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('open.er-api.com')) return { ok: false, text: async () => '' };
      return { ok: false, text: async () => '', json: async () => ({}) };
    });

    await import('../src/config.js');
    await import('../src/storage.js');
    await import('../src/csv.js');
    await import('../src/exchangeRate.js');
    await import('../src/stockPrice.js');
    await import('../src/roi.js');
    await import('../src/charts.js');
    await import('../src/ui.js');
    await import('../src/app.js');

    const app = window.PFD.app;
    await app.init();

    expect(app.state.fxResult).toBeNull();
    expect(document.getElementById('fx-status-text').textContent).toContain('不可用');
  });
});

describe('app: restoring saved UI filters on init', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('applies a previously saved market/currency filter on a fresh init', async () => {
    document.body.innerHTML = bodyHtml;
    localStorage.clear();
    localStorage.setItem('pfd.ui.lastFilters', JSON.stringify({ year: 'all', market: 'US', displayCurrency: 'USD' }));
    delete window.PFD;
    vi.resetModules();
    global.Chart = FakeChart;
    global.fetch = makeFetchMock();
    global.alert = vi.fn();

    await import('../src/config.js');
    await import('../src/storage.js');
    await import('../src/csv.js');
    await import('../src/exchangeRate.js');
    await import('../src/stockPrice.js');
    await import('../src/roi.js');
    await import('../src/charts.js');
    await import('../src/ui.js');
    await import('../src/app.js');

    const app = window.PFD.app;
    await app.init();

    expect(app.state.filters).toMatchObject({ market: 'US', displayCurrency: 'USD' });
    expect(document.getElementById('filter-market').value).toBe('US');
  });
});

describe('app: import via the file-input + dropdown wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when the import file input changes with no file selected', async () => {
    await setupApp();
    Object.defineProperty(document.getElementById('import-csv-input'), 'files', { value: [], configurable: true });
    document.getElementById('import-csv-input').dispatchEvent(new Event('change'));
    expect(txTableRowCount()).toBe(0);
  });

  it('does nothing when the add-tx import file input changes with no file selected', async () => {
    await setupApp();
    Object.defineProperty(document.getElementById('add-tx-import-csv-input'), 'files', { value: [], configurable: true });
    document.getElementById('add-tx-import-csv-input').dispatchEvent(new Event('change'));
    expect(txTableRowCount()).toBe(0);
  });

  it('picking a market from the import dropdown then choosing a file replaces that market\'s transactions', async () => {
    await setupApp();
    document.querySelector('#import-menu .dropdown-item[data-market="TW"]').click();

    const file = new File(['date,symbol,name,action,quantity,price,fee\n2024-01-01,2330,,buy,1,1,0\n'], 'tw.csv', { type: 'text/csv' });
    const input = document.getElementById('import-csv-input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(txTableRowCount()).toBe(1));
    expect(document.querySelector('#transactions-table tbody tr').textContent).toContain('2330');
  });

  it('picking a market for the add-tx CSV importer appends rows without replacing existing ones', async () => {
    const app = await setupApp();
    app.handleAddTransaction('US', { date: '2024-01-01', symbol: 'EXISTING', name: '', action: 'buy', quantity: 1, price: 1, fee: 0 });

    document.getElementById('add-tx-import-market-select').value = 'US';
    const file = new File(['date,symbol,name,action,quantity,price,fee\n2024-02-01,APPENDED,,buy,1,1,0\n'], 'add.csv', { type: 'text/csv' });
    const input = document.getElementById('add-tx-import-csv-input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(txTableRowCount()).toBe(2));
  });
});

describe('app: refresh-all-prices button', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('disables the refresh button while in flight and re-enables it once prices/fx are refreshed', async () => {
    await setupApp();
    const btn = document.getElementById('refresh-all-btn');
    btn.click();
    expect(btn.disabled).toBe(true);
    await vi.waitFor(() => expect(btn.disabled).toBe(false));
  });

  it('ignores a second concurrent invocation while a refresh is already in flight', async () => {
    await setupApp();
    const btn = document.getElementById('refresh-all-btn');
    const fetchSpy = global.fetch;
    fetchSpy.mockClear();

    // Dispatch directly (rather than btn.click() twice) so the second call isn't
    // blocked by the browser-level "disabled buttons ignore click()" behavior —
    // this isolates the isRefreshing in-code guard itself.
    btn.dispatchEvent(new Event('click'));
    btn.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(btn.disabled).toBe(false));

    const fxCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('open.er-api.com'));
    expect(fxCalls).toHaveLength(1);
  });
});
