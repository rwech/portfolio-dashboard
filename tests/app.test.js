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
});
