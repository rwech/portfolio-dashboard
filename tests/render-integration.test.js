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
      [{ id: '1', market: 'TW', date: '2024-01-01', symbol: evilSymbol, name: '', action: 'buy', quantity: 1, price: 1, fee: 0 }],
      () => {}
    );
    const tbody = document.querySelector('#transactions-table tbody');
    expect(tbody.querySelector('img')).toBeNull();
    expect(window.__pwned).toBeUndefined();
    expect(tbody.textContent).toContain(evilSymbol);
  });
});

describe('renderSymbolPnlTable stale price tag', () => {
  beforeEach(setupDom);

  const baseStat = {
    symbol: 'AAA', name: 'A Corp', market: 'US', remainingQty: 10, avgCost: 100,
    roiPct: null, realizedGain: 0, unrealizedGain: 0, marketValue: 1000, costBasisHeld: 1000,
  };

  it('flags a position with no live price data (estimate) as stale', () => {
    window.PFD.ui.renderSymbolPnlTable(
      [{ ...baseStat, currentPrice: 100, priceSource: 'estimate', priceFetchedAt: null }],
      'USD'
    );
    expect(document.querySelector('#symbol-pnl-table .badge-stale')).not.toBeNull();
  });

  it('flags a cached price older than the stale threshold', () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    window.PFD.ui.renderSymbolPnlTable(
      [{ ...baseStat, currentPrice: 100, priceSource: 'cache', priceFetchedAt: old }],
      'USD'
    );
    expect(document.querySelector('#symbol-pnl-table .badge-stale')).not.toBeNull();
  });

  it('does not flag a just-fetched live price as stale', () => {
    window.PFD.ui.renderSymbolPnlTable(
      [{ ...baseStat, currentPrice: 105, priceSource: 'live', priceFetchedAt: new Date().toISOString() }],
      'USD'
    );
    expect(document.querySelector('#symbol-pnl-table .badge-stale')).toBeNull();
  });

  it('never flags a manual override as stale', () => {
    window.PFD.ui.renderSymbolPnlTable(
      [{ ...baseStat, currentPrice: 110, priceSource: 'override', priceFetchedAt: null }],
      'USD'
    );
    expect(document.querySelector('#symbol-pnl-table .badge-stale')).toBeNull();
  });
});
