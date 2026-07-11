(function () {
  function filterTransactions(allTx, { year, market }) {
    return allTx.filter((tx) => {
      if (market && market !== 'all' && tx.market !== market) return false;
      if (year && year !== 'all' && tx.date.slice(0, 4) !== String(year))
        return false;
      return true;
    });
  }

  function resolveYearFilter(allTx, year) {
    if (year === 'all') return 'all';
    const years = new Set(allTx.map((tx) => tx.date.slice(0, 4)));
    return years.has(String(year)) ? year : 'all';
  }

  function groupBySymbol(transactions) {
    const map = new Map();
    transactions.forEach((tx) => {
      if (!map.has(tx.symbol)) map.set(tx.symbol, []);
      map.get(tx.symbol).push(tx);
    });
    return map;
  }

  function filterByMarket(allTx, market) {
    if (!market || market === 'all') return allTx;
    return allTx.filter((tx) => tx.market === market);
  }

  function computeOneSymbolStat(symbolTransactions, year = 'all') {
    const sorted = [...symbolTransactions].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    const first = sorted[0];
    const state = { qty: 0, avgCost: 0, totalInvested: 0, realizedGain: 0 };
    const isInYear = (tx) =>
      year === 'all' || tx.date.slice(0, 4) === String(year);

    sorted.forEach((tx) => {
      if (tx.action === 'buy') {
        const newQty = state.qty + tx.quantity;
        const costOfThisBuy = tx.price * tx.quantity + tx.fee;
        const totalCostBefore = state.avgCost * state.qty;
        state.avgCost =
          newQty > 0 ? (totalCostBefore + costOfThisBuy) / newQty : 0;
        state.qty = newQty;
        state.totalInvested += costOfThisBuy;
      } else if (tx.action === 'sell') {
        // Sold quantity/gain is always computed against the full-history running
        // avgCost, even if this sell's own year is outside the report's year filter.
        const sellQty = Math.min(tx.quantity, state.qty);
        const gain = (tx.price - state.avgCost) * sellQty - tx.fee;
        if (isInYear(tx)) state.realizedGain += gain;
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

  function computeSymbolStats(transactions, year = 'all') {
    const grouped = groupBySymbol(transactions);
    const result = new Map();
    grouped.forEach((txs, symbol) => {
      const hasActivityInYear =
        year === 'all' ||
        txs.some((tx) => tx.date.slice(0, 4) === String(year));
      if (hasActivityInYear)
        result.set(symbol, computeOneSymbolStat(txs, year));
    });
    return result;
  }

  function currencyForMarket(market) {
    return market === 'TW' ? 'TWD' : 'USD';
  }

  function lastDayOfMonth(yearNum, monthIdx) {
    return new Date(Date.UTC(yearNum, monthIdx + 1, 0))
      .toISOString()
      .slice(0, 10);
  }

  function generateMonthEndSnapshotDates(earliestDate, year, today) {
    const windowStart = year === 'all' ? earliestDate : `${year}-01-01`;
    const windowEndCandidate = year === 'all' ? today : `${year}-12-31`;
    const windowEnd = windowEndCandidate < today ? windowEndCandidate : today;
    const start = windowStart > earliestDate ? windowStart : earliestDate;

    if (start > windowEnd) return [];

    const dates = [];
    let cursorYear = Number(start.slice(0, 4));
    let cursorMonth = Number(start.slice(5, 7)) - 1;

    while (true) {
      const monthStart = `${cursorYear}-${String(cursorMonth + 1).padStart(2, '0')}-01`;
      if (monthStart > windowEnd) break;

      const monthEnd = lastDayOfMonth(cursorYear, cursorMonth);
      const cappedMonthEnd = monthEnd < windowEnd ? monthEnd : windowEnd;
      if (cappedMonthEnd >= start) dates.push(cappedMonthEnd);

      cursorMonth += 1;
      if (cursorMonth > 11) {
        cursorMonth = 0;
        cursorYear += 1;
      }
    }

    return dates;
  }

  function computeRoiTrend(
    allTx,
    { year, mode, resolveHistoricalPrice, fxRate, displayCurrency, today },
  ) {
    if (allTx.length === 0) return [];

    const earliestDate = allTx.reduce(
      (min, tx) => (tx.date < min ? tx.date : min),
      allTx[0].date,
    );
    const snapshotDates = generateMonthEndSnapshotDates(
      earliestDate,
      year,
      today,
    );

    const points = [];
    snapshotDates.forEach((snapshotDate) => {
      const txsUpToD = allTx.filter((tx) => tx.date <= snapshotDate);
      if (txsUpToD.length === 0) return;

      const txsForStats =
        mode === 'year-scoped' && year !== 'all'
          ? txsUpToD.filter((tx) => tx.date.slice(0, 4) === String(year))
          : txsUpToD;
      if (txsForStats.length === 0) return;

      const statsMap = computeSymbolStats(txsForStats, 'all');

      let totalInvested = 0;
      let realizedGain = 0;
      let unrealizedGain = 0;
      let costBasisHeld = 0;

      statsMap.forEach((stat) => {
        const currency = currencyForMarket(stat.market);
        const priceAsOfDate = resolveHistoricalPrice(stat.symbol, snapshotDate);
        const price =
          typeof priceAsOfDate === 'number' ? priceAsOfDate : stat.avgCost;
        const symbolUnrealized = (price - stat.avgCost) * stat.remainingQty;

        totalInvested += convertAmount(
          stat.totalInvested,
          currency,
          displayCurrency,
          fxRate,
        );
        realizedGain += convertAmount(
          stat.realizedGain,
          currency,
          displayCurrency,
          fxRate,
        );
        unrealizedGain += convertAmount(
          symbolUnrealized,
          currency,
          displayCurrency,
          fxRate,
        );
        costBasisHeld += convertAmount(
          stat.costBasisHeld,
          currency,
          displayCurrency,
          fxRate,
        );
      });

      if (totalInvested === 0) return;

      points.push({
        date: snapshotDate,
        roiPct: roiPct(realizedGain, unrealizedGain, totalInvested),
        totalAssets: costBasisHeld + unrealizedGain,
      });
    });

    return points;
  }

  function roiPct(realizedGain, unrealizedGain, totalInvested) {
    if (totalInvested === 0) return null;
    return ((realizedGain + unrealizedGain) / totalInvested) * 100;
  }

  // 以最早交易日起算的簡易複利年化：((1 + roi)^(365.25/days) - 1)。
  // 平均成本法下沒有逐筆現金流，這只是近似值（非 XIRR）；
  // 期間不足 30 天時外插會產生荒謬數字，直接回傳 null 不顯示。
  const MIN_ANNUALIZE_DAYS = 30;

  function annualizedRoiPct(roiPctValue, fromDate, today) {
    if (roiPctValue === null || roiPctValue === undefined) return null;
    if (!Number.isFinite(roiPctValue)) return null;
    const from = new Date(fromDate);
    const to = new Date(today);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    const days = (to - from) / (24 * 60 * 60 * 1000);
    if (days < MIN_ANNUALIZE_DAYS) return null;
    const growth = 1 + roiPctValue / 100;
    if (growth <= 0) return -100; // 虧損 100% 以上，年化沒有意義，鉗在 -100%
    return (Math.pow(growth, 365.25 / days) - 1) * 100;
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

  function computePortfolioSummary(
    allTx,
    { priceOverrides, priceCache },
    filters,
  ) {
    const marketFiltered = filterByMarket(allTx, filters.market);
    const twTx = marketFiltered.filter((tx) => tx.market === 'TW');
    const usTx = marketFiltered.filter((tx) => tx.market === 'US');

    const twStats = computeSymbolStats(twTx, filters.year);
    const usStats = computeSymbolStats(usTx, filters.year);

    const resolvePrice = window.PFD.stockPrice.resolveCurrentPrice;

    const perSymbol = [];
    [twStats, usStats].forEach((statsMap) => {
      statsMap.forEach((stat) => {
        const resolved = resolvePrice(stat.symbol, {
          priceOverrides,
          priceCache,
          avgCost: stat.avgCost,
        });
        stat.currentPrice = resolved.value;
        stat.priceSource = resolved.source;
        stat.priceFetchedAt = resolved.fetchedAt;
        stat.unrealizedGain =
          (resolved.value - stat.avgCost) * stat.remainingQty;
        stat.marketValue = resolved.value * stat.remainingQty;
        stat.roiPct = roiPct(
          stat.realizedGain,
          stat.unrealizedGain,
          stat.totalInvested,
        );
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
    if (fromCurrency === 'USD' && toCurrency === 'TWD')
      return exchangeRate.usdToTwd(amount, fxRate);
    if (fromCurrency === 'TWD' && toCurrency === 'USD')
      return exchangeRate.twdToUsd(amount, fxRate);
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
      const factor = (field) =>
        convertAmount(
          summary[field],
          summary.currency,
          displayCurrency,
          fxRate,
        );
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
    resolveYearFilter,
    computeSymbolStats,
    computePortfolioSummary,
    convertSummaryToDisplayCurrency,
    convertAmount,
    roiPct,
    annualizedRoiPct,
    generateMonthEndSnapshotDates,
    computeRoiTrend,
  };
})();
