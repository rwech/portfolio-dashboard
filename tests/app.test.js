import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(
  path.resolve(__dirname, '../index.html'),
  'utf-8',
);
const bodyHtml = indexHtml.match(/<body>([\s\S]*)<\/body>/)[1];

// Demo dataset deliberately covers a different year range than the "real" data
// imported in tests below (2026), mirroring the bundled db/*.example.csv files.
const EXAMPLE_TW_CSV =
  'date,symbol,name,action,quantity,price,fee\n2024-03-01,2330,台積電,buy,1000,500,100\n';
const EXAMPLE_US_CSV =
  'date,symbol,name,action,quantity,price,fee\n2024-03-01,AAPL,Apple Inc.,buy,10,180,1\n';

class FakeChart {
  resize() {}
  destroy() {}
}
FakeChart.defaults = {};

function makeFetchMock() {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('tw-stock.example.csv'))
      return { ok: true, text: async () => EXAMPLE_TW_CSV };
    if (u.includes('us-stock.example.csv'))
      return { ok: true, text: async () => EXAMPLE_US_CSV };
    if (u.includes('tw-stock.csv') || u.includes('us-stock.csv'))
      return { ok: false, text: async () => '' };
    if (u.includes('open.er-api.com'))
      return {
        ok: true,
        json: async () => ({ result: 'success', rates: { TWD: 32 } }),
      };
    if (u.includes('/api/stock-price'))
      return { ok: true, json: async () => ({}) };
    if (u.includes('/api/historical-price'))
      return { ok: true, json: async () => ({}) };
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
  await import('../src/historicalPrice.js');
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

function toastMessages() {
  return [
    ...document.querySelectorAll('#toast-container .toast .toast-message'),
  ].map((el) => el.textContent);
}

function demoBlockToastCount() {
  return toastMessages().filter((m) => m.includes('示範模式')).length;
}

describe('app: demo mode / filter / import interaction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the demo dataset (not an empty table) after importing data filtered to a year demo data lacks', async () => {
    const app = await setupApp();
    expect(txTableRowCount()).toBe(0); // no seed files exist, so a fresh install starts empty

    const importedCsv =
      'date,symbol,name,action,quantity,price,fee\n2026-01-15,0050,元大台灣50,buy,100,150,20\n';
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
    const importedCsv =
      'date,symbol,name,action,quantity,price,fee\n2026-01-15,0050,元大台灣50,buy,100,150,20\n';
    app.handleReplaceImportText(importedCsv, 'TW');

    await app.setDemoMode(true);

    const replacementCsv =
      'date,symbol,name,action,quantity,price,fee\n2026-02-01,2330,台積電,buy,50,600,30\n';
    app.handleReplaceImportText(replacementCsv, 'TW');
    app.handleAddTransaction('TW', {
      date: '2026-03-01',
      symbol: 'XYZ',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });

    expect(global.alert).not.toHaveBeenCalled(); // no jarring alert dialog
    expect(demoBlockToastCount()).toBe(2); // one toast per blocked operation

    await app.setDemoMode(false);
    expect(txTableRowCount()).toBe(1); // the original import, not the blocked replacement/add
    expect(
      document.querySelector('#transactions-table tbody tr').textContent,
    ).toContain('0050');
  });

  it('also blocks delete and price-override edits while demo mode is on', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2026-01-01',
      symbol: '0050',
      name: '',
      action: 'buy',
      quantity: 10,
      price: 100,
      fee: 0,
    });
    await app.setDemoMode(true);

    const txId = app.state.transactions[0].id;
    app.handleDeleteTransaction(txId, 'TW');
    app.handlePriceOverrideChange('0050', 123);
    app.handlePriceOverrideClear('0050');
    expect(global.alert).not.toHaveBeenCalled();
    expect(demoBlockToastCount()).toBe(3);

    await app.setDemoMode(false);
    expect(app.state.transactions).toHaveLength(1); // delete was blocked
  });

  it('also blocks starting an edit while demo mode is on', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2026-01-01',
      symbol: '0050',
      name: '',
      action: 'buy',
      quantity: 10,
      price: 100,
      fee: 0,
    });
    await app.setDemoMode(true);

    const txId = app.state.transactions[0].id;
    app.handleEditStart(txId);
    expect(global.alert).not.toHaveBeenCalled();
    expect(demoBlockToastCount()).toBe(1);
    expect(app.state.editingTxId).toBeNull();

    await app.setDemoMode(false);
  });

  it('also blocks export and append-import while demo mode is on', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2026-01-01',
      symbol: '0050',
      name: '',
      action: 'buy',
      quantity: 10,
      price: 100,
      fee: 0,
    });
    await app.setDemoMode(true);

    app.handleExport('TW');
    app.handleAppendImportText(
      'date,symbol,name,action,quantity,price,fee\n2026-02-01,XYZ,,buy,1,1,0\n',
      'TW',
    );
    expect(global.alert).not.toHaveBeenCalled();
    expect(demoBlockToastCount()).toBe(2);

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
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '台積電',
      action: 'buy',
      quantity: 100,
      price: 500,
      fee: 20,
    });
    expect(txTableRowCount()).toBe(1);
    expect(
      document.querySelector('#transactions-table tbody tr').textContent,
    ).toContain('2330');
  });

  it('handleAddTransaction shows a success toast naming the symbol, action, and quantity', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '台積電',
      action: 'buy',
      quantity: 1000,
      price: 500,
      fee: 20,
    });
    expect(toastMessages()).toContain('已新增 2330 買進 1000 股');
    expect(
      document.querySelector('#toast-container .toast-success'),
    ).not.toBeNull();

    app.handleAddTransaction('TW', {
      date: '2024-02-01',
      symbol: '2330',
      name: '台積電',
      action: 'sell',
      quantity: 200,
      price: 600,
      fee: 20,
    });
    expect(toastMessages()).toContain('已新增 2330 賣出 200 股');
  });

  it('deleting a transaction shows an undo toast, and undo restores the identical transaction and counter', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '台積電',
      action: 'buy',
      quantity: 1000,
      price: 500,
      fee: 20,
    });
    const original = window.PFD.storage.loadTransactions('TW')[0];
    const countBeforeDelete = window.PFD.storage.loadUnexportedChangeCount();

    app.handleDeleteTransaction(original.id, 'TW');
    expect(window.PFD.storage.loadTransactions('TW')).toHaveLength(0);
    expect(txTableRowCount()).toBe(0);
    expect(window.PFD.storage.loadUnexportedChangeCount()).toBe(
      countBeforeDelete + 1,
    );
    expect(toastMessages()).toContain('已刪除 2330 買進 1000 股');

    const undoToast = [
      ...document.querySelectorAll('#toast-container .toast'),
    ].find((t) => t.textContent.includes('已刪除'));
    const undoBtn = undoToast.querySelector('.toast-action-btn');
    expect(undoBtn.textContent).toBe('復原');
    undoBtn.click();

    const restored = window.PFD.storage.loadTransactions('TW');
    expect(restored).toHaveLength(1);
    expect(restored[0]).toEqual(original); // exact same object incl. id and market
    expect(window.PFD.storage.loadUnexportedChangeCount()).toBe(
      countBeforeDelete, // delete's increment was undone
    );
    expect(txTableRowCount()).toBe(1); // table re-rendered with the restored row
    expect(undoToast.parentNode).toBeNull(); // undo toast dismissed itself
  });

  it('handleDeleteTransaction with an unknown id shows no undo toast and does not crash', async () => {
    const app = await setupApp();
    app.handleDeleteTransaction('no-such-id', 'TW');
    expect(toastMessages().filter((m) => m.includes('已刪除'))).toHaveLength(0);
  });

  it('handleAddTransaction rejects an empty symbol and a malformed date the same way CSV import does', async () => {
    const app = await setupApp();

    const missingSymbol = app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    expect(missingSymbol).toBe(false);
    expect(toastMessages()).toContain('symbol 不可為空');

    const badDate = app.handleAddTransaction('TW', {
      date: '2024/01/01',
      symbol: 'AAA',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    expect(badDate).toBe(false);
    expect(toastMessages()).toContain('date 格式必須為 YYYY-MM-DD');
    expect(global.alert).not.toHaveBeenCalled(); // validation feedback is a toast, never an alert
    expect(txTableRowCount()).toBe(0);
  });

  it('handleEditSave rejects an empty symbol and a malformed date, not just bad quantity/price', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: 'AAA',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    const txId = app.state.transactions[0].id;

    document.querySelector('#transactions-table tbody tr .edit-tx-btn').click();
    let editingRow = document.querySelector('#transactions-table tbody tr');
    editingRow.querySelector('.edit-symbol').value = '';
    editingRow.querySelector('.save-edit-btn').click();
    expect(toastMessages()).toContain('symbol 不可為空');
    expect(app.state.editingTxId).toBe(txId);

    editingRow = document.querySelector('#transactions-table tbody tr');
    editingRow.querySelector('.edit-symbol').value = 'AAA';
    editingRow.querySelector('.edit-date').value = '';
    editingRow.querySelector('.save-edit-btn').click();
    expect(toastMessages()).toContain('date 格式必須為 YYYY-MM-DD');
    expect(global.alert).not.toHaveBeenCalled();
    expect(app.state.editingTxId).toBe(txId);
  });

  it('handleReplaceImportText reports the US market label in its feedback notice', async () => {
    const app = await setupApp();
    const csvText =
      'date,symbol,name,action,quantity,price,fee\n2024-01-01,AAPL,,buy,1,1,0\n';
    app.handleReplaceImportText(csvText, 'US');
    expect(document.getElementById('import-errors').textContent).toContain(
      '美股',
    );
  });

  it('clicking a row delete button removes that transaction via handleDeleteTransaction', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: 'AAA',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    app.handleAddTransaction('US', {
      date: '2024-01-01',
      symbol: 'BBB',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    expect(txTableRowCount()).toBe(2);

    const row = [
      ...document.querySelectorAll('#transactions-table tbody tr'),
    ].find((tr) => tr.textContent.includes('AAA'));
    row.querySelector('.delete-tx-btn').click();

    expect(txTableRowCount()).toBe(1);
    expect(
      document.querySelector('#transactions-table tbody tr').textContent,
    ).toContain('BBB');
  });

  it('clicking the edit icon turns a row editable, and saving persists the changes via handleEditSave', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: 'AAA',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });

    document.querySelector('#transactions-table tbody tr .edit-tx-btn').click();

    const editingRow = document.querySelector('#transactions-table tbody tr');
    expect(editingRow.querySelector('.edit-symbol').value).toBe('AAA');

    editingRow.querySelector('.edit-symbol').value = 'ZZZ';
    editingRow.querySelector('.edit-quantity').value = '5';
    editingRow.querySelector('.save-edit-btn').click();

    const savedRow = document.querySelector('#transactions-table tbody tr');
    expect(savedRow.textContent).toContain('ZZZ');
    expect(savedRow.querySelector('.edit-symbol')).toBeNull();
    const stored = window.PFD.storage.loadTransactions('TW')[0];
    expect(stored.symbol).toBe('ZZZ');
    expect(stored.quantity).toBe(5);
    expect(app.state.editingTxId).toBeNull();
  });

  it('canceling an in-progress edit discards changes and restores the static row', async () => {
    await setupApp();
    window.PFD.app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: 'AAA',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });

    document.querySelector('#transactions-table tbody tr .edit-tx-btn').click();
    const editingRow = document.querySelector('#transactions-table tbody tr');
    editingRow.querySelector('.edit-symbol').value = 'CHANGED';
    editingRow.querySelector('.cancel-edit-btn').click();

    const row = document.querySelector('#transactions-table tbody tr');
    expect(row.textContent).toContain('AAA');
    expect(window.PFD.storage.loadTransactions('TW')[0].symbol).toBe('AAA');
  });

  it('rejects saving an edit with invalid quantity/price and keeps the row in edit mode', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: 'AAA',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });

    document.querySelector('#transactions-table tbody tr .edit-tx-btn').click();
    const editingRow = document.querySelector('#transactions-table tbody tr');
    editingRow.querySelector('.edit-quantity').value = '0';
    editingRow.querySelector('.save-edit-btn').click();

    expect(toastMessages()).toContain('quantity 必須是大於 0 的數字');
    expect(app.state.editingTxId).not.toBeNull();
    expect(
      document.querySelector('#transactions-table tbody tr .edit-symbol'),
    ).not.toBeNull();
  });

  it('deleting the row currently being edited clears editingTxId instead of leaving the edit form orphaned', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: 'AAA',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });

    const txId = app.state.transactions[0].id;
    app.handleEditStart(txId);
    expect(app.state.editingTxId).toBe(txId);

    app.handleDeleteTransaction(txId, 'TW');

    expect(app.state.editingTxId).toBeNull();
    expect(window.PFD.storage.loadTransactions('TW')).toHaveLength(0);
  });

  it('saving a manual price override updates the override panel and clearing it removes the override', async () => {
    const app = await setupApp();
    app.handleAddTransaction('US', {
      date: '2024-01-01',
      symbol: 'AAPL',
      name: 'Apple',
      action: 'buy',
      quantity: 10,
      price: 100,
      fee: 0,
    });

    const row = document.querySelector('#price-override-table tbody tr');
    row.querySelector('.override-input').value = '210';
    row.querySelector('.override-save-btn').click();

    const updatedRow = document.querySelector('#price-override-table tbody tr');
    expect(updatedRow.querySelector('.override-clear-btn').disabled).toBe(
      false,
    );
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
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    expect(window.PFD.storage.loadUnexportedChangeCount()).toBeGreaterThan(0);

    app.handleExport('TW');

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(window.PFD.storage.loadUnexportedChangeCount()).toBe(0);
  });

  it('handleAppendImportText adds new rows on top of existing data for that market without replacing it', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: 'EXISTING',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });

    const appendCsv =
      'date,symbol,name,action,quantity,price,fee\n2024-02-01,NEWROW,,buy,1,1,0\n';
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
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });

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
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: 'A',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    app.handleAddTransaction('TW', {
      date: '2024-06-01',
      symbol: 'B',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });

    const dateHeader = document.querySelector(
      '#transactions-table thead th[data-sort-key="date"]',
    );
    dateHeader.click();
    expect(app.state.txSort).toEqual({ column: 'date', direction: 'asc' });
    dateHeader.click();
    expect(app.state.txSort).toEqual({ column: 'date', direction: 'desc' });
  });

  it('clicking a transactions-table sort header switches to it (asc) when a different column was previously sorted', async () => {
    const app = await setupApp();
    app.state.txSort = { column: 'symbol', direction: 'desc' };

    const dateHeader = document.querySelector(
      '#transactions-table thead th[data-sort-key="date"]',
    );
    dateHeader.click();
    expect(app.state.txSort).toEqual({ column: 'date', direction: 'asc' });
  });

  it('clicking a symbol-pnl-table sort header sorts by that column and toggles direction on repeated clicks', async () => {
    const app = await setupApp();
    app.handleAddTransaction('US', {
      date: '2024-01-01',
      symbol: 'AAA',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    app.handleAddTransaction('US', {
      date: '2024-01-01',
      symbol: 'BBB',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });

    const roiHeader = document.querySelector(
      '#symbol-pnl-table thead th[data-sort-key="roiPct"]',
    );
    roiHeader.click();
    expect(app.state.sort).toEqual({ column: 'roiPct', direction: 'asc' });
    roiHeader.click();
    expect(app.state.sort).toEqual({ column: 'roiPct', direction: 'desc' });
    roiHeader.click();
    expect(app.state.sort).toEqual({ column: 'roiPct', direction: 'asc' });

    const symbolHeader = document.querySelector(
      '#symbol-pnl-table thead th[data-sort-key="symbol"]',
    );
    symbolHeader.click();
    expect(app.state.sort).toEqual({ column: 'symbol', direction: 'asc' });
  });

  it('the backup-reminder banner export button exports both TW and US transactions', async () => {
    const app = await setupApp();
    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    app.handleAddTransaction('US', {
      date: '2024-01-01',
      symbol: 'AAPL',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });

    document.getElementById('backup-reminder-export-btn').click();

    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(window.PFD.storage.loadUnexportedChangeCount()).toBe(0);
  });

  it('the add-transaction form rejects a non-positive quantity with an error toast and does not add a row', async () => {
    await setupApp();
    const form = document.getElementById('add-transaction-form');
    form.elements.market.value = 'TW';
    form.elements.date.value = '2024-01-01';
    form.elements.symbol.value = 'BAD';
    form.elements.action.value = 'buy';
    form.elements.quantity.value = '0';
    form.elements.price.value = '10';

    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(global.alert).not.toHaveBeenCalled();
    expect(toastMessages()).toContain('quantity 必須是大於 0 的數字');
    expect(
      document.querySelector('#toast-container .toast-error'),
    ).not.toBeNull();
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
    expect(
      document.querySelector('#transactions-table tbody tr').textContent,
    ).toContain('GOOD');
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

    expect(app.state.transactions.find((tx) => tx.symbol === 'FEED').fee).toBe(
      3.5,
    );
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

    expect(app.state.transactions.find((tx) => tx.symbol === 'NOFEE').fee).toBe(
      0,
    );
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

    await vi.waitFor(() =>
      expect(document.getElementById('demo-mode-banner').hidden).toBe(false),
    );
    expect(app.state.demoMode).toBe(true);
  });

  it('warns before unload only when there are unexported changes', async () => {
    await setupApp();
    const evt = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false); // nothing unexported yet

    window.PFD.app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: 'X',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    const evt2 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evt2);
    expect(evt2.defaultPrevented).toBe(true);
  });
});

describe('app: transaction search', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function typeSearch(value) {
    const input = document.getElementById('tx-search-input');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    return input;
  }

  async function setupWithTransactions() {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '台積電',
      action: 'buy',
      quantity: 100,
      price: 500,
      fee: 20,
    });
    app.handleAddTransaction('TW', {
      date: '2024-02-01',
      symbol: '0050',
      name: '元大台灣50',
      action: 'buy',
      quantity: 10,
      price: 150,
      fee: 5,
    });
    app.handleAddTransaction('US', {
      date: '2025-03-01',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      action: 'buy',
      quantity: 5,
      price: 180,
      fee: 1,
    });
    return app;
  }

  it('filters rows by a case-insensitive symbol substring', async () => {
    const app = await setupWithTransactions();
    expect(txTableRowCount()).toBe(3);

    typeSearch('aapl');
    expect(app.state.txSearch).toBe('aapl');
    expect(txTableRowCount()).toBe(1);
    expect(
      document.querySelector('#transactions-table tbody tr').textContent,
    ).toContain('AAPL');
  });

  it('filters rows by a name substring (including Chinese names)', async () => {
    await setupWithTransactions();
    typeSearch('台積');
    expect(txTableRowCount()).toBe(1);
    expect(
      document.querySelector('#transactions-table tbody tr').textContent,
    ).toContain('2330');
  });

  it('restores all rows when the search text is cleared', async () => {
    await setupWithTransactions();
    typeSearch('AAPL');
    expect(txTableRowCount()).toBe(1);
    typeSearch('');
    expect(txTableRowCount()).toBe(3);
  });

  it('applies the search on top of the market and year filters', async () => {
    const app = await setupWithTransactions();
    app.handleFilterChange({ market: 'TW' });
    typeSearch('5'); // substring of symbol/name only — matches 0050 / 元大台灣50
    expect(txTableRowCount()).toBe(1); // 0050 only; other TW row (2330) has no "5"
    expect(
      document.querySelector('#transactions-table tbody tr').textContent,
    ).toContain('0050');

    app.handleFilterChange({ market: 'all', year: '2025' });
    typeSearch('a');
    expect(txTableRowCount()).toBe(1); // AAPL matches and is in 2025
  });

  it('keeps the filtered rows sorted according to the active sort', async () => {
    const app = await setupWithTransactions();
    app.state.txSort = { column: 'date', direction: 'asc' };
    typeSearch('台'); // matches 台積電 and 元大台灣50
    const rows = [
      ...document.querySelectorAll('#transactions-table tbody tr'),
    ].map((tr) => tr.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('2330'); // 2024-01-01 first under asc date sort
    expect(rows[1]).toContain('0050');
  });

  it('preserves the input value across the full re-render triggered by typing', async () => {
    await setupWithTransactions();
    const input = typeSearch('AAPL');
    expect(document.getElementById('tx-search-input')).toBe(input); // not re-created
    expect(input.value).toBe('AAPL');
  });

  it('does not persist txSearch into the saved UI filters', async () => {
    await setupWithTransactions();
    typeSearch('AAPL');
    const saved = JSON.parse(localStorage.getItem('pfd.ui.lastFilters'));
    expect(saved).not.toHaveProperty('txSearch');
  });

  it('matches nothing (empty table) for a query that hits neither symbol nor name', async () => {
    await setupWithTransactions();
    typeSearch('ZZZZ');
    expect(txTableRowCount()).toBe(0);
  });

  it('filterBySearch trims surrounding whitespace and returns all rows for a blank query', async () => {
    const app = await setupWithTransactions();
    const rows = app.state.transactions;
    expect(app.filterBySearch(rows, '   ')).toHaveLength(3);
    expect(app.filterBySearch(rows, ' aapl ')).toHaveLength(1);
    expect(app.filterBySearch([{ symbol: 'X', name: null }], 'x')).toHaveLength(
      1,
    ); // null name must not crash
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
      if (u.includes('open.er-api.com'))
        return { ok: false, text: async () => '' };
      return { ok: false, text: async () => '', json: async () => ({}) };
    });

    await import('../src/config.js');
    await import('../src/storage.js');
    await import('../src/csv.js');
    await import('../src/exchangeRate.js');
    await import('../src/stockPrice.js');
    await import('../src/historicalPrice.js');
    await import('../src/roi.js');
    await import('../src/charts.js');
    await import('../src/ui.js');
    await import('../src/app.js');

    const app = window.PFD.app;
    await app.init();

    expect(app.state.fxResult).toBeNull();
    expect(document.getElementById('fx-status-text').textContent).toContain(
      '不可用',
    );
  });
});

describe('app: restoring saved UI filters on init', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('applies a previously saved market/currency filter on a fresh init', async () => {
    document.body.innerHTML = bodyHtml;
    localStorage.clear();
    localStorage.setItem(
      'pfd.ui.lastFilters',
      JSON.stringify({ year: 'all', market: 'US', displayCurrency: 'USD' }),
    );
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
    await import('../src/historicalPrice.js');
    await import('../src/roi.js');
    await import('../src/charts.js');
    await import('../src/ui.js');
    await import('../src/app.js');

    const app = window.PFD.app;
    await app.init();

    expect(app.state.filters).toMatchObject({
      market: 'US',
      displayCurrency: 'USD',
    });
    expect(document.getElementById('filter-market').value).toBe('US');
  });
});

describe('app: import via the file-input + dropdown wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when the import file input changes with no file selected', async () => {
    await setupApp();
    Object.defineProperty(
      document.getElementById('import-csv-input'),
      'files',
      { value: [], configurable: true },
    );
    document
      .getElementById('import-csv-input')
      .dispatchEvent(new Event('change'));
    expect(txTableRowCount()).toBe(0);
  });

  it('does nothing when the add-tx import file input changes with no file selected', async () => {
    await setupApp();
    Object.defineProperty(
      document.getElementById('add-tx-import-csv-input'),
      'files',
      { value: [], configurable: true },
    );
    document
      .getElementById('add-tx-import-csv-input')
      .dispatchEvent(new Event('change'));
    expect(txTableRowCount()).toBe(0);
  });

  it("picking a market from the import dropdown then choosing a file replaces that market's transactions", async () => {
    await setupApp();
    document
      .querySelector('#import-menu .dropdown-item[data-market="TW"]')
      .click();

    const file = new File(
      [
        'date,symbol,name,action,quantity,price,fee\n2024-01-01,2330,,buy,1,1,0\n',
      ],
      'tw.csv',
      { type: 'text/csv' },
    );
    const input = document.getElementById('import-csv-input');
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(txTableRowCount()).toBe(1));
    expect(
      document.querySelector('#transactions-table tbody tr').textContent,
    ).toContain('2330');
  });

  it('picking a market for the add-tx CSV importer appends rows without replacing existing ones', async () => {
    const app = await setupApp();
    app.handleAddTransaction('US', {
      date: '2024-01-01',
      symbol: 'EXISTING',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });

    document
      .querySelector('#add-tx-import-menu .dropdown-item[data-market="US"]')
      .click();
    const file = new File(
      [
        'date,symbol,name,action,quantity,price,fee\n2024-02-01,APPENDED,,buy,1,1,0\n',
      ],
      'add.csv',
      { type: 'text/csv' },
    );
    const input = document.getElementById('add-tx-import-csv-input');
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
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

  it('swaps the button label to an in-progress state and shows a success toast when fx comes back live', async () => {
    await setupApp();
    const btn = document.getElementById('refresh-all-btn');
    const originalLabel = btn.textContent;

    btn.click();
    expect(btn.textContent).toBe('更新中…');
    expect(btn.classList.contains('is-refreshing')).toBe(true);

    await vi.waitFor(() => expect(btn.disabled).toBe(false));
    expect(btn.textContent).toBe(originalLabel);
    expect(btn.classList.contains('is-refreshing')).toBe(false);
    expect(toastMessages()).toContain('匯率與現價已更新');
    expect(
      document.querySelector('#toast-container .toast-success'),
    ).not.toBeNull();
  });

  it('shows a warning toast instead when the fx rate falls back to the stale cache (offline)', async () => {
    await setupApp(); // init fetches a live rate and caches it
    const btn = document.getElementById('refresh-all-btn');

    // subsequent fx fetches fail, forcing the stale-cache fallback
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('open.er-api.com')) throw new Error('offline');
      return { ok: true, json: async () => ({}), text: async () => '' };
    });

    btn.click();
    await vi.waitFor(() => expect(btn.disabled).toBe(false));

    expect(window.PFD.app.state.fxResult.source).toBe('stale-cache');
    expect(toastMessages().some((m) => m.includes('無法取得最新匯率'))).toBe(
      true,
    );
    expect(
      document.querySelector('#toast-container .toast-warning'),
    ).not.toBeNull();
    expect(toastMessages()).not.toContain('匯率與現價已更新');
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

    const fxCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('open.er-api.com'),
    );
    expect(fxCalls).toHaveLength(1);
  });
});
