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
  await import('../src/fields.js');
  await import('../src/storage.js');
  await import('../src/csv.js');
  await import('../src/importer.js');
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

// jsdom 的 File.arrayBuffer 支援度不一，統一用最小介面的假檔案物件
function fakeCsvFile(text) {
  return { arrayBuffer: async () => new TextEncoder().encode(text).buffer };
}

function importModalBody() {
  return document.getElementById('import-modal-body');
}

// 走完整匯入流程（標準 schema：直接進預覽 → 確認）
async function importCsv(app, csvText, market, { replace = false } = {}) {
  await app.handleImportFile(fakeCsvFile(csvText), market);
  if (replace) {
    const checkbox = document.getElementById('import-replace-checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
  }
  document.getElementById('import-confirm-btn').click();
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
    await importCsv(app, importedCsv, 'TW');
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
    await importCsv(app, importedCsv, 'TW');

    await app.setDemoMode(true);

    const replacementCsv =
      'date,symbol,name,action,quantity,price,fee\n2026-02-01,2330,台積電,buy,50,600,30\n';
    await app.handleImportFile(fakeCsvFile(replacementCsv), 'TW');
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

  it('also blocks export and import while demo mode is on', async () => {
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
    await app.handleImportFile(
      fakeCsvFile(
        'date,symbol,name,action,quantity,price,fee\n2026-02-01,XYZ,,buy,1,1,0\n',
      ),
      'TW',
    );
    expect(global.alert).not.toHaveBeenCalled();
    expect(demoBlockToastCount()).toBe(2);
    expect(document.getElementById('import-modal').hidden).toBe(true); // 連預覽都不該打開

    await app.setDemoMode(false);
    expect(app.state.transactions).toHaveLength(1); // import was blocked, nothing extra landed
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

  it('import preview and success toast use the US market label', async () => {
    const app = await setupApp();
    const csvText =
      'date,symbol,name,action,quantity,price,fee\n2024-01-01,AAPL,,buy,1,1,0\n';
    await app.handleImportFile(fakeCsvFile(csvText), 'US');
    expect(importModalBody().textContent).toContain('美股');
    document.getElementById('import-confirm-btn').click();
    expect(toastMessages().some((m) => m.includes('美股'))).toBe(true);
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

  it('importing adds new rows on top of existing data for that market without replacing it', async () => {
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
    await importCsv(app, appendCsv, 'TW');

    expect(txTableRowCount()).toBe(2);
    expect(toastMessages()).toContain('已新增 1 筆台股交易');
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

describe('app: first-run empty state on the overview tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function emptyStateEl() {
    return document.getElementById('onboarding-empty-state');
  }

  it('shows the empty state instead of summary cards when there are no transactions and demo mode is off', async () => {
    await setupApp();
    expect(emptyStateEl().hidden).toBe(false);
    expect(document.getElementById('summary-cards').hidden).toBe(true);
    expect(document.getElementById('charts').hidden).toBe(true);
  });

  it('hides the empty state as soon as a transaction exists', async () => {
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
    expect(emptyStateEl().hidden).toBe(true);
    expect(document.getElementById('summary-cards').hidden).toBe(false);
    expect(document.getElementById('charts').hidden).toBe(false);
  });

  it('hides the empty state while demo mode is on and restores it when demo mode turns off with no real data', async () => {
    const app = await setupApp();
    await app.setDemoMode(true);
    expect(emptyStateEl().hidden).toBe(true);
    await app.setDemoMode(false);
    expect(emptyStateEl().hidden).toBe(false);
  });

  it('its demo button checks the header toggle and enables demo mode through the normal change path', async () => {
    const app = await setupApp();
    document.getElementById('empty-state-demo-btn').click();

    await vi.waitFor(() =>
      expect(document.getElementById('demo-mode-banner').hidden).toBe(false),
    );
    expect(app.state.demoMode).toBe(true);
    expect(document.getElementById('demo-mode-toggle').checked).toBe(true);
    expect(emptyStateEl().hidden).toBe(true);
  });

  it('its add-transaction button switches to the 新增交易 tab', async () => {
    await setupApp();
    document.getElementById('empty-state-add-tx-btn').click();

    expect(
      document.querySelector('.tab-panel[data-tab-panel="add-tx"]').hidden,
    ).toBe(false);
    expect(
      document.querySelector('.tab-panel[data-tab-panel="overview"]').hidden,
    ).toBe(true);
    expect(
      document
        .querySelector('.tab-btn[data-tab="add-tx"]')
        .classList.contains('active'),
    ).toBe(true);
  });
});

describe('app: estimate/stale price warning on the overview tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function warningEl() {
    return document.getElementById('price-quality-warning');
  }

  it('shows the warning when a held symbol falls back to an estimate price', async () => {
    const app = await setupApp();
    // no /api/stock-price data in the mock, so the price resolves to an estimate
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '',
      action: 'buy',
      quantity: 10,
      price: 500,
      fee: 0,
    });
    expect(warningEl().hidden).toBe(false);
  });

  it('hides the warning when the only held symbol has a manual override', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '',
      action: 'buy',
      quantity: 10,
      price: 500,
      fee: 0,
    });
    app.handlePriceOverrideChange('2330', 520);
    expect(warningEl().hidden).toBe(true);
  });

  it('shows the warning for a stale cached quote and hides it again once the quote is fresh', async () => {
    const app = await setupApp();
    app.handleAddTransaction('US', {
      date: '2024-01-01',
      symbol: 'AAPL',
      name: '',
      action: 'buy',
      quantity: 10,
      price: 100,
      fee: 0,
    });

    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    app.state.priceCache = {
      AAPL: { price: 105, source: 'live', fetchedAt: old },
    };
    app.render();
    expect(warningEl().hidden).toBe(false);

    app.state.priceCache = {
      AAPL: { price: 105, source: 'live', fetchedAt: new Date().toISOString() },
    };
    app.render();
    expect(warningEl().hidden).toBe(true);
  });

  it('ignores estimate prices on fully-sold symbols (no false warning)', async () => {
    const app = await setupApp();
    app.handleAddTransaction('US', {
      date: '2024-01-01',
      symbol: 'SOLD',
      name: '',
      action: 'buy',
      quantity: 10,
      price: 100,
      fee: 0,
    });
    app.handleAddTransaction('US', {
      date: '2024-02-01',
      symbol: 'SOLD',
      name: '',
      action: 'sell',
      quantity: 10,
      price: 120,
      fee: 0,
    });
    app.handleAddTransaction('US', {
      date: '2024-03-01',
      symbol: 'HELD',
      name: '',
      action: 'buy',
      quantity: 5,
      price: 100,
      fee: 0,
    });
    app.state.priceCache = {
      HELD: { price: 105, source: 'live', fetchedAt: new Date().toISOString() },
    };
    app.render();
    // SOLD is an estimate but no longer held, HELD is fresh → no warning
    expect(warningEl().hidden).toBe(true);
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
    await import('../src/fields.js');
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
    await import('../src/fields.js');
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
    expect(document.getElementById('import-modal').hidden).toBe(true);
  });

  it('picking a market from the import dropdown then choosing a file opens the preview and imports on confirm', async () => {
    await setupApp();
    document
      .querySelector('#import-menu .dropdown-item[data-market="TW"]')
      .click();

    const input = document.getElementById('import-csv-input');
    Object.defineProperty(input, 'files', {
      value: [
        fakeCsvFile(
          'date,symbol,name,action,quantity,price,fee\n2024-01-01,2330,,buy,1,1,0\n',
        ),
      ],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() =>
      expect(document.getElementById('import-modal').hidden).toBe(false),
    );
    document.getElementById('import-confirm-btn').click();
    expect(txTableRowCount()).toBe(1);
    expect(
      document.querySelector('#transactions-table tbody tr').textContent,
    ).toContain('2330');
  });

  it('the add-tx tab button navigates to the transactions tab where import lives', async () => {
    await setupApp();
    document.querySelector('.tab-btn[data-tab="add-tx"]').click();
    document.getElementById('goto-import-btn').click();
    expect(
      document.querySelector('.tab-panel[data-tab-panel="transactions"]')
        .hidden,
    ).toBe(false);
  });
});

describe('app: import flow (dedupe, mapping wizard, replace, cancel)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const STANDARD_CSV =
    'date,symbol,name,action,quantity,price,fee\n' +
    '2024-01-10,2330,台積電,buy,1000,560,20\n' +
    '2024-02-01,2317,鴻海,sell,500,100,10\n';

  it('re-importing the same file shows zero rows to add and disables confirm', async () => {
    const app = await setupApp();
    await importCsv(app, STANDARD_CSV, 'TW');
    expect(txTableRowCount()).toBe(2);

    await app.handleImportFile(fakeCsvFile(STANDARD_CSV), 'TW');
    expect(importModalBody().textContent).toContain('重複');
    expect(document.getElementById('import-add-count').textContent).toBe('0');
    expect(document.getElementById('import-confirm-btn').disabled).toBe(true);

    document.querySelector('.modal-cancel-btn').click();
    expect(txTableRowCount()).toBe(2); // nothing changed
  });

  it('imports only the rows missing from the store and reports skipped duplicates', async () => {
    const app = await setupApp();
    await importCsv(app, STANDARD_CSV, 'TW');

    const withOneNew =
      STANDARD_CSV + '2024-03-01,0050,元大台灣50,buy,100,150,5\n';
    await importCsv(app, withOneNew, 'TW');

    expect(txTableRowCount()).toBe(3);
    expect(toastMessages()).toContain('已新增 1 筆台股交易（略過重複 2 筆）');
  });

  it('replace mode wipes the market and shows a red warning first', async () => {
    const app = await setupApp();
    await importCsv(app, STANDARD_CSV, 'TW');

    const replacement =
      'date,symbol,name,action,quantity,price,fee\n2025-01-01,0056,,buy,10,35,1\n';
    await app.handleImportFile(fakeCsvFile(replacement), 'TW');

    const warning = document.getElementById('import-replace-warning');
    expect(warning.hidden).toBe(true);
    const checkbox = document.getElementById('import-replace-checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(warning.hidden).toBe(false);
    expect(warning.textContent).toContain('2 筆'); // 現有筆數
    expect(document.getElementById('import-add-count').textContent).toBe('1');

    document.getElementById('import-confirm-btn').click();
    expect(txTableRowCount()).toBe(1);
    expect(
      document.querySelector('#transactions-table tbody tr').textContent,
    ).toContain('0056');
  });

  it('cancel closes the modal without writing anything', async () => {
    const app = await setupApp();
    await app.handleImportFile(fakeCsvFile(STANDARD_CSV), 'TW');
    expect(document.getElementById('import-modal').hidden).toBe(false);

    document.querySelector('.modal-cancel-btn').click();
    expect(document.getElementById('import-modal').hidden).toBe(true);
    expect(txTableRowCount()).toBe(0);
  });

  it('shows an error toast for an empty file instead of opening the modal', async () => {
    const app = await setupApp();
    await app.handleImportFile(fakeCsvFile('   \n  '), 'TW');
    expect(document.getElementById('import-modal').hidden).toBe(true);
    expect(toastMessages().some((m) => m.includes('讀不到標題列'))).toBe(true);
  });

  it('a broker-style header opens the mapping wizard prefilled by alias guessing, then imports', async () => {
    const app = await setupApp();
    const brokerCsv =
      '成交日期,證券代號,證券名稱,買賣別,成交股數,成交價,手續費\n' +
      '2024/1/10,2330,台積電,買進,"1,000",560,20\n';

    await app.handleImportFile(fakeCsvFile(brokerCsv), 'TW');

    // 精靈步驟：自動猜測應已把每個欄位選好
    const dateSelect = importModalBody().querySelector(
      '.mapping-select[data-field="date"]',
    );
    expect(dateSelect).not.toBeNull();
    expect(dateSelect.value).toBe('0');
    expect(
      importModalBody().querySelector('.mapping-select[data-field="action"]')
        .value,
    ).toBe('3');

    importModalBody().querySelector('.mapping-apply-btn').click();

    // 預覽步驟：正規化後的資料
    expect(importModalBody().textContent).toContain('解析成功');
    document.getElementById('import-confirm-btn').click();

    expect(txTableRowCount()).toBe(1);
    const rowText = document.querySelector(
      '#transactions-table tbody tr',
    ).textContent;
    expect(rowText).toContain('2330');
    expect(rowText).toContain('2024-01-10');
    expect(rowText).toContain('1000');
  });

  it('remembers the applied mapping for the same header signature next time', async () => {
    const app = await setupApp();
    const header = '成交日期,證券代號,證券名稱,買賣別,成交股數,成交價,手續費';
    const brokerCsv = `${header}\n2024/1/10,2330,台積電,買進,100,560,20\n`;

    await app.handleImportFile(fakeCsvFile(brokerCsv), 'TW');
    // 手動改掉 name 欄的對應為（略過），套用後應被記住
    const nameSelect = importModalBody().querySelector(
      '.mapping-select[data-field="name"]',
    );
    nameSelect.value = '';
    importModalBody().querySelector('.mapping-apply-btn').click();
    document.getElementById('import-confirm-btn').click();

    await app.handleImportFile(fakeCsvFile(brokerCsv), 'TW');
    expect(
      importModalBody().querySelector('.mapping-select[data-field="name"]')
        .value,
    ).toBe('');
    document.querySelector('.modal-cancel-btn').click();
  });

  it('the wizard blocks applying while a required field is unmapped', async () => {
    const app = await setupApp();
    const brokerCsv = '成交日期,證券代號,亂欄位,成交股數,成交價\n';

    await app.handleImportFile(fakeCsvFile(brokerCsv), 'TW');
    // action 無法猜出 → 未選
    const actionSelect = importModalBody().querySelector(
      '.mapping-select[data-field="action"]',
    );
    expect(actionSelect.value).toBe('');

    importModalBody().querySelector('.mapping-apply-btn').click();
    const err = importModalBody().querySelector('.mapping-error');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('買賣');
    // 仍停在精靈步驟
    expect(
      importModalBody().querySelector('.mapping-apply-btn'),
    ).not.toBeNull();
  });

  it('imports a Big5-encoded broker file and mentions the detected encoding in the preview', async () => {
    const app = await setupApp();
    // 「日期,代號,買賣,股數,單價」+ 一列「2024/1/10,2330,買進,100,560」，以 Big5 位元組表示
    const b5 = (pairs) => pairs.flat();
    const 日期 = [
      [0xa4, 0xe9],
      [0xb4, 0xc1],
    ];
    const 代號 = [
      [0xa5, 0x4e],
      [0xb8, 0xb9],
    ];
    const 買賣 = [
      [0xb6, 0x52],
      [0xbd, 0xe6],
    ];
    const 股數 = [
      [0xaa, 0xd1],
      [0xbc, 0xc6],
    ];
    const 單價 = [
      [0xb3, 0xe6],
      [0xbb, 0xf9],
    ];
    const 買進 = [
      [0xb6, 0x52],
      [0xb6, 0x69],
    ];
    const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
    const bytes = [
      ...b5(日期),
      ...ascii(','),
      ...b5(代號),
      ...ascii(','),
      ...b5(買賣),
      ...ascii(','),
      ...b5(股數),
      ...ascii(','),
      ...b5(單價),
      ...ascii('\n2024/1/10,2330,'),
      ...b5(買進),
      ...ascii(',100,560\n'),
    ];
    const file = {
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    };

    await app.handleImportFile(file, 'TW');
    // 中文欄名 → 精靈；別名應能全數猜中必填欄位
    importModalBody().querySelector('.mapping-apply-btn').click();
    expect(importModalBody().textContent).toContain('Big5');
    document.getElementById('import-confirm-btn').click();
    expect(txTableRowCount()).toBe(1);
    expect(
      document.querySelector('#transactions-table tbody tr').textContent,
    ).toContain('2330');
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

describe('app: overview summary cards (merged cost, total value, market breakdown)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function summaryText() {
    return document.getElementById('summary-cards').textContent;
  }

  it('renders three cards with the held cost as a sub-field on the total-value card', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '',
      action: 'buy',
      quantity: 10,
      price: 100,
      fee: 0,
    });
    const cards = document.querySelectorAll('#summary-cards .summary-card');
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain('目前總價值');
    expect(cards[0].textContent).toContain('目前持股成本');
  });

  it('shows 目前總價值 = 持股成本 + 未實現損益 on the cost card, next to held cost', async () => {
    const app = await setupApp();
    // 沒有 API 現價 → estimate（=平均成本）→ 未實現 0，總價值 = 持股成本 = 1,000
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '',
      action: 'buy',
      quantity: 10,
      price: 100,
      fee: 0,
    });
    const cards = document.querySelectorAll('#summary-cards .summary-card');
    expect(cards[0].textContent).toContain('目前總價值');
    expect(cards[0].textContent).toContain('1,000 TWD');
    // ROI 卡維持純比率：只有年化，沒有絕對金額
    expect(cards[2].textContent).toContain('年化（簡易）');
    expect(cards[2].textContent).not.toContain('目前總價值');
  });

  it('shows per-market gain sub-fields for 市場=全部 and hides them for a single market', async () => {
    const app = await setupApp();
    app.handleAddTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '',
      action: 'buy',
      quantity: 10,
      price: 100,
      fee: 0,
    });
    app.handleAddTransaction('US', {
      date: '2024-01-01',
      symbol: 'AAPL',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 100,
      fee: 0,
    });

    expect(app.state.filters.market).toBe('all');
    expect(summaryText()).toContain('台股');
    expect(summaryText()).toContain('美股');

    app.handleFilterChange({ market: 'TW' });
    expect(summaryText()).not.toContain('台股');
    expect(summaryText()).not.toContain('美股');
  });
});
