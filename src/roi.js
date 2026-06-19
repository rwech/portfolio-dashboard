(function () {
  function filterTransactions(allTx, { year, market }) {
    return allTx.filter((tx) => {
      if (market && market !== 'all' && tx.market !== market) return false;
      if (year && year !== 'all' && tx.date.slice(0, 4) !== String(year)) return false;
      return true;
    });
  }

  function groupBySymbol(transactions) {
    const map = new Map();
    transactions.forEach((tx) => {
      if (!map.has(tx.symbol)) map.set(tx.symbol, []);
      map.get(tx.symbol).push(tx);
    });
    return map;
  }

  function computeOneSymbolStat(symbolTransactions) {
    const sorted = [...symbolTransactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const first = sorted[0];
    const state = { qty: 0, avgCost: 0, totalInvested: 0, realizedGain: 0 };

    sorted.forEach((tx) => {
      if (tx.action === 'buy') {
        const newQty = state.qty + tx.quantity;
        const costOfThisBuy = tx.price * tx.quantity + tx.fee;
        const totalCostBefore = state.avgCost * state.qty;
        state.avgCost = newQty > 0 ? (totalCostBefore + costOfThisBuy) / newQty : 0;
        state.qty = newQty;
        state.totalInvested += costOfThisBuy;
      } else if (tx.action === 'sell') {
        const sellQty = Math.min(tx.quantity, state.qty);
        state.realizedGain += (tx.price - state.avgCost) * sellQty - tx.fee;
        state.qty -= sellQty;
      }
    });

    return {
      symbol: first.symbol,
      name: first.name,
      market: first.market,
      avgCost: state.avgCost,
      remainingQty: state.qty,
      totalInvested: state.totalInvested,
      realizedGain: state.realizedGain,
      costBasisHeld: state.avgCost * state.qty,
    };
  }

  function computeSymbolStats(transactions) {
    const grouped = groupBySymbol(transactions);
    const result = new Map();
    grouped.forEach((txs, symbol) => {
      result.set(symbol, computeOneSymbolStat(txs));
    });
    return result;
  }

  function roiPct(realizedGain, unrealizedGain, totalInvested) {
    if (totalInvested === 0) return null;
    return ((realizedGain + unrealizedGain) / totalInvested) * 100;
  }

  function summarizeMarket(statsMap) {
    let totalInvested = 0;
    let costBasisHeld = 0;
    let realizedGain = 0;
    let unrealizedGain = 0;
    statsMap.forEach((stat) => {
      totalInvested += stat.totalInvested;
      costBasisHeld += stat.costBasisHeld;
      realizedGain += stat.realizedGain;
      unrealizedGain += stat.unrealizedGain;
    });
    return {
      totalInvested,
      costBasisHeld,
      realizedGain,
      unrealizedGain,
      roiPct: roiPct(realizedGain, unrealizedGain, totalInvested),
    };
  }

  function computePortfolioSummary(allTx, { priceOverrides, priceCache }, filters) {
    const filtered = filterTransactions(allTx, filters);
    const twTx = filtered.filter((tx) => tx.market === 'TW');
    const usTx = filtered.filter((tx) => tx.market === 'US');

    const twStats = computeSymbolStats(twTx);
    const usStats = computeSymbolStats(usTx);

    const resolvePrice = window.PFD.stockPrice.resolveCurrentPrice;

    const perSymbol = [];
    [twStats, usStats].forEach((statsMap) => {
      statsMap.forEach((stat) => {
        const resolved = resolvePrice(stat.symbol, { priceOverrides, priceCache, avgCost: stat.avgCost });
        stat.currentPrice = resolved.value;
        stat.priceSource = resolved.source;
        stat.unrealizedGain = (resolved.value - stat.avgCost) * stat.remainingQty;
        perSymbol.push(stat);
      });
    });

    return {
      perSymbol,
      byMarket: {
        TW: { ...summarizeMarket(twStats), currency: 'TWD' },
        US: { ...summarizeMarket(usStats), currency: 'USD' },
      },
    };
  }

  function convertAmount(amount, fromCurrency, toCurrency, fxRate) {
    if (fromCurrency === toCurrency) return amount;
    if (typeof fxRate !== 'number') return NaN;
    const exchangeRate = window.PFD.exchangeRate;
    if (fromCurrency === 'USD' && toCurrency === 'TWD') return exchangeRate.usdToTwd(amount, fxRate);
    if (fromCurrency === 'TWD' && toCurrency === 'USD') return exchangeRate.twdToUsd(amount, fxRate);
    return amount;
  }

  function convertSummaryToDisplayCurrency(byMarket, displayCurrency, fxRate) {
    const markets = ['TW', 'US'];
    let totalInvested = 0;
    let costBasisHeld = 0;
    let realizedGain = 0;
    let unrealizedGain = 0;

    markets.forEach((m) => {
      const summary = byMarket[m];
      const factor = (field) => convertAmount(summary[field], summary.currency, displayCurrency, fxRate);
      totalInvested += factor('totalInvested');
      costBasisHeld += factor('costBasisHeld');
      realizedGain += factor('realizedGain');
      unrealizedGain += factor('unrealizedGain');
    });

    return {
      currency: displayCurrency,
      totalInvested,
      costBasisHeld,
      realizedGain,
      unrealizedGain,
      roiPct: roiPct(realizedGain, unrealizedGain, totalInvested),
    };
  }

  window.PFD = window.PFD || {};
  window.PFD.roi = {
    filterTransactions,
    computeSymbolStats,
    computePortfolioSummary,
    convertSummaryToDisplayCurrency,
    convertAmount,
  };
})();
