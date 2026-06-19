import { describe, it, expect } from 'vitest';
import '../src/ui.js';

const { escapeHtml } = window.PFD.ui;

describe('ui.escapeHtml', () => {
  it('escapes tags so injected markup cannot execute', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes quotes to prevent breaking out of an HTML attribute', () => {
    expect(escapeHtml('"><script>1</script>')).toBe('&quot;&gt;&lt;script&gt;1&lt;/script&gt;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('2330')).toBe('2330');
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

    window.PFD.ui.updateSortIndicators('symbol-pnl-table', { column: 'symbol', direction: 'asc' });
    expect(symbolTh.dataset.sortDirection).toBe('asc');
    expect(roiTh.dataset.sortDirection).toBeUndefined();

    window.PFD.ui.updateSortIndicators('symbol-pnl-table', { column: 'roiPct', direction: 'desc' });
    expect(symbolTh.dataset.sortDirection).toBeUndefined();
    expect(roiTh.dataset.sortDirection).toBe('desc');
  });

  it('clears all indicators when no column is sorted', () => {
    setupTable();
    const symbolTh = document.querySelector('th[data-sort-key="symbol"]');
    window.PFD.ui.updateSortIndicators('symbol-pnl-table', { column: 'symbol', direction: 'asc' });
    window.PFD.ui.updateSortIndicators('symbol-pnl-table', { column: null, direction: 'asc' });
    expect(symbolTh.dataset.sortDirection).toBeUndefined();
  });
});
