import { describe, it, expect, beforeEach } from 'vitest';
import '../src/stockPrice.js';
import '../src/ui.js';

function setupDom() {
  document.body.innerHTML = `
    <table id="symbol-pnl-table"><tbody></tbody></table>
    <table id="transactions-table"><tbody></tbody></table>
    <table id="price-override-table"><tbody></tbody></table>
  `;
}

describe('renderTransactionTable XSS handling', () => {
  beforeEach(setupDom);

  it('renders a malicious symbol as inert text instead of executable markup', () => {
    const evilSymbol = '<img src=x onerror="window.__pwned = true">';
    window.PFD.ui.renderTransactionTable(
      [
        {
          id: '1',
          market: 'TW',
          date: '2024-01-01',
          symbol: evilSymbol,
          name: '',
          action: 'buy',
          quantity: 1,
          price: 1,
          fee: 0,
        },
      ],
      { onDelete: () => {} },
    );
    const tbody = document.querySelector('#transactions-table tbody');
    expect(tbody.querySelector('img')).toBeNull();
    expect(window.__pwned).toBeUndefined();
    expect(tbody.textContent).toContain(evilSymbol);
  });

  it('labels a sell action distinctly from a buy action', () => {
    window.PFD.ui.renderTransactionTable(
      [
        {
          id: '1',
          market: 'US',
          date: '2024-01-01',
          symbol: 'AAPL',
          name: '',
          action: 'sell',
          quantity: 1,
          price: 1,
          fee: 0,
        },
      ],
      { onDelete: () => {} },
    );
    const tbody = document.querySelector('#transactions-table tbody');
    expect(tbody.querySelector('.badge-sell')).not.toBeNull();
    expect(tbody.textContent).toContain('賣出');
  });

  it('renders the row matching editingId as an editable form row instead of a static row', () => {
    const evilSymbol = '<img src=x onerror="window.__pwned2 = true">';
    window.PFD.ui.renderTransactionTable(
      [
        {
          id: '1',
          market: 'TW',
          date: '2024-01-01',
          symbol: evilSymbol,
          name: 'n',
          action: 'buy',
          quantity: 3,
          price: 4,
          fee: 5,
        },
      ],
      { editingId: '1' },
    );
    const row = document.querySelector('#transactions-table tbody tr');
    expect(row.querySelector('.edit-tx-btn')).toBeNull();
    expect(row.querySelector('.save-edit-btn')).not.toBeNull();
    expect(row.querySelector('.cancel-edit-btn')).not.toBeNull();
    expect(row.querySelector('.edit-symbol').value).toBe(evilSymbol);
    expect(row.querySelector('.edit-quantity').value).toBe('3');
    expect(window.__pwned2).toBeUndefined();
  });

  it('escapes a quote-breakout attempt in the date field of an editable row instead of injecting an attribute', () => {
    const evilDate =
      '2024-01-01" onfocus="window.__pwned3 = true" autofocus x="';
    window.PFD.ui.renderTransactionTable(
      [
        {
          id: '1',
          market: 'TW',
          date: evilDate,
          symbol: 'AAA',
          name: 'n',
          action: 'buy',
          quantity: 3,
          price: 4,
          fee: 5,
        },
      ],
      { editingId: '1' },
    );
    const row = document.querySelector('#transactions-table tbody tr');
    expect(row.querySelector('.edit-date').getAttribute('value')).toBe(
      evilDate,
    );
    expect(row.querySelector('.edit-date').hasAttribute('autofocus')).toBe(
      false,
    );
    expect(window.__pwned3).toBeUndefined();
  });
});

describe('renderSymbolPnlTable stale price tag', () => {
  beforeEach(setupDom);

  const baseStat = {
    symbol: 'AAA',
    name: 'A Corp',
    market: 'US',
    remainingQty: 10,
    avgCost: 100,
    roiPct: null,
    realizedGain: 0,
    unrealizedGain: 0,
    marketValue: 1000,
    costBasisHeld: 1000,
  };

  it('shows only the 估計值 badge for an estimate row, never a redundant stale badge (an estimate is not a quote)', () => {
    window.PFD.ui.renderSymbolPnlTable(
      [
        {
          ...baseStat,
          currentPrice: 100,
          priceSource: 'estimate',
          priceFetchedAt: null,
        },
      ],
      'USD',
    );
    expect(
      document.querySelector('#symbol-pnl-table .badge-estimate'),
    ).not.toBeNull();
    expect(document.querySelector('#symbol-pnl-table .badge-stale')).toBeNull();
  });

  it('does not add a stale badge to an estimate row in the price-override panel either', () => {
    window.PFD.ui.renderPriceOverridePanel(
      [
        {
          ...baseStat,
          currentPrice: 100,
          priceSource: 'estimate',
          priceFetchedAt: null,
        },
      ],
      {},
      { onOverrideChange: () => {}, onOverrideClear: () => {} },
    );
    expect(
      document.querySelector('#price-override-table .badge-estimate'),
    ).not.toBeNull();
    expect(
      document.querySelector('#price-override-table .badge-stale'),
    ).toBeNull();
  });

  it('flags a cached price older than the stale threshold', () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    window.PFD.ui.renderSymbolPnlTable(
      [
        {
          ...baseStat,
          currentPrice: 100,
          priceSource: 'cache',
          priceFetchedAt: old,
        },
      ],
      'USD',
    );
    expect(
      document.querySelector('#symbol-pnl-table .badge-stale'),
    ).not.toBeNull();
  });

  it('does not flag a just-fetched live price as stale', () => {
    window.PFD.ui.renderSymbolPnlTable(
      [
        {
          ...baseStat,
          currentPrice: 105,
          priceSource: 'live',
          priceFetchedAt: new Date().toISOString(),
        },
      ],
      'USD',
    );
    expect(document.querySelector('#symbol-pnl-table .badge-stale')).toBeNull();
  });

  it('never flags a manual override as stale', () => {
    window.PFD.ui.renderSymbolPnlTable(
      [
        {
          ...baseStat,
          currentPrice: 110,
          priceSource: 'override',
          priceFetchedAt: null,
        },
      ],
      'USD',
    );
    expect(document.querySelector('#symbol-pnl-table .badge-stale')).toBeNull();
  });

  it('falls back to the raw source string for an unrecognized priceSource', () => {
    window.PFD.ui.renderSymbolPnlTable(
      [
        {
          ...baseStat,
          currentPrice: 100,
          priceSource: 'mystery',
          priceFetchedAt: new Date().toISOString(),
        },
      ],
      'USD',
    );
    expect(
      document.querySelector('#symbol-pnl-table tbody').textContent,
    ).toContain('mystery');
  });
});

describe('renderSymbolPnlTable totals row', () => {
  beforeEach(setupDom);

  function stat(overrides) {
    return {
      symbol: 'AAA',
      name: '',
      market: 'US',
      remainingQty: 10,
      avgCost: 100,
      currentPrice: 100,
      priceSource: 'live',
      priceFetchedAt: new Date().toISOString(),
      roiPct: 5,
      realizedGain: 0,
      unrealizedGain: 0,
      marketValue: 0,
      costBasisHeld: 0,
      ...overrides,
    };
  }

  it('renders a 合計 row as the first row of tbody, summing realized/unrealized gains, market value and cost basis', () => {
    window.PFD.ui.renderSymbolPnlTable(
      [
        stat({
          symbol: 'AAA',
          realizedGain: 100,
          unrealizedGain: -30,
          marketValue: 1000,
          costBasisHeld: 900,
        }),
        stat({
          symbol: 'BBB',
          realizedGain: 50,
          unrealizedGain: 80,
          marketValue: 2500,
          costBasisHeld: 2100,
        }),
      ],
      'TWD',
    );
    const tbody = document.querySelector('#symbol-pnl-table tbody');
    const rows = tbody.querySelectorAll('tr');
    expect(rows).toHaveLength(3); // totals row + 2 data rows
    expect(tbody.firstElementChild.classList.contains('totals-row')).toBe(true);
    // data rows remain in their original order after the totals row
    expect(rows[1].dataset.symbol).toBe('AAA');
    expect(rows[2].dataset.symbol).toBe('BBB');

    const cells = [...rows[0].querySelectorAll('td')].map(
      (td) => td.textContent,
    );
    expect(cells).toHaveLength(10);
    expect(cells[0]).toBe('合計');
    expect(cells[3]).toBe('+150 TWD'); // realized 100 + 50
    expect(cells[4]).toBe('+50 TWD'); // unrealized -30 + 80
    expect(cells[7]).toBe('3,500 TWD'); // market value 1000 + 2500
    expect(cells[9]).toBe('3,000 TWD'); // cost basis 900 + 2100
  });

  it('leaves non-summable columns (市場, ROI%, 股數, 最後價, 平均成本) as —', () => {
    window.PFD.ui.renderSymbolPnlTable([stat({})], 'TWD');
    const cells = [
      ...document.querySelectorAll('#symbol-pnl-table tbody tr.totals-row td'),
    ].map((td) => td.textContent);
    expect(cells[1]).toBe('—');
    expect(cells[2]).toBe('—');
    expect(cells[5]).toBe('—');
    expect(cells[6]).toBe('—');
    expect(cells[8]).toBe('—');
  });

  it('colors the summed gains with the positive/negative helpers', () => {
    window.PFD.ui.renderSymbolPnlTable(
      [stat({ realizedGain: 100, unrealizedGain: -30 })],
      'TWD',
    );
    const cells = document.querySelectorAll(
      '#symbol-pnl-table tbody tr.totals-row td',
    );
    expect(cells[3].classList.contains('positive')).toBe(true);
    expect(cells[4].classList.contains('negative')).toBe(true);
  });

  it('renders no totals row when there are no per-symbol stats', () => {
    window.PFD.ui.renderSymbolPnlTable([], 'TWD');
    expect(
      document.querySelector('#symbol-pnl-table tbody tr.totals-row'),
    ).toBeNull();
  });

  it('clears a previously rendered totals row when re-rendered with no stats', () => {
    window.PFD.ui.renderSymbolPnlTable([stat({ realizedGain: 1 })], 'TWD');
    expect(
      document.querySelector('#symbol-pnl-table tbody tr.totals-row'),
    ).not.toBeNull();
    window.PFD.ui.renderSymbolPnlTable([], 'TWD');
    expect(
      document.querySelector('#symbol-pnl-table tbody tr.totals-row'),
    ).toBeNull();
  });
});

describe('renderPriceOverridePanel unrecognized priceSource', () => {
  beforeEach(setupDom);

  it('falls back to the raw source string when it has no Chinese label', () => {
    window.PFD.ui.renderPriceOverridePanel(
      [
        {
          symbol: 'AAA',
          name: '',
          market: 'US',
          remainingQty: 10,
          currentPrice: 100,
          priceSource: 'mystery',
          priceFetchedAt: new Date().toISOString(),
        },
      ],
      {},
      { onOverrideChange: () => {}, onOverrideClear: () => {} },
    );
    expect(
      document.querySelector('#price-override-table tbody').textContent,
    ).toContain('mystery');
  });
});
