(function () {
  function getSplitsForSymbol(symbol, splitEventsCache) {
    return splitEventsCache[symbol]?.splits || [];
  }

  // 分割比例是「該日期之後」所有分割的連乘積：分割日之前的交易需要換算到
  // 現在的股數基礎，分割當天或之後的交易已經是現在的基礎，不用調整。
  function splitFactorAsOf(dateStr, splits) {
    return splits.reduce(
      (factor, split) => (split.date > dateStr ? factor * split.ratio : factor),
      1,
    );
  }

  // 純函式：把分割前的交易換算成現在股數基礎的等值交易，從不修改原始交易紀錄。
  function normalizeForSplits(transactions, splitEventsCache) {
    return transactions.map((tx) => {
      const splits = getSplitsForSymbol(tx.symbol, splitEventsCache);
      if (splits.length === 0) return tx;
      const factor = splitFactorAsOf(tx.date, splits);
      if (factor === 1) return tx;
      return {
        ...tx,
        quantity: tx.quantity * factor,
        price: tx.price / factor,
      };
    });
  }

  // 把分割日之前的原始收盤價換算成現在股數基礎，讓歷史股價圖表在分割日
  // 不會出現斷崖式跳動；只調分割比例，不動用股息還原。
  function adjustPricesForSplits(prices, splits) {
    if (!Array.isArray(splits) || splits.length === 0) return prices;
    return prices.map((p) => {
      const factor = splitFactorAsOf(p.date, splits);
      return factor === 1 ? p : { ...p, close: p.close / factor };
    });
  }

  window.PFD = window.PFD || {};
  window.PFD.splitEvents = {
    getSplitsForSymbol,
    normalizeForSplits,
    adjustPricesForSplits,
  };
})();
