(function () {
  const {
    REQUIRED_FIELDS,
    OPTIONAL_FIELDS,
    TARGET_FIELDS,
    FIELD_LABELS,
    FIELD_ALIASES,
    ACTION_ALIASES,
  } = window.PFD.fields;

  // 先以 UTF-8 解碼；出現替換字元（U+FFFD）代表不是合法 UTF-8，
  // 對台灣券商匯出檔而言幾乎都是 Big5，改用 Big5 重解一次。
  function decodeCsvBytes(buffer) {
    const bytes =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    if (!utf8.includes('\uFFFD')) {
      return { text: utf8.replace(/^\uFEFF/, ''), encoding: 'utf-8' };
    }
    try {
      return { text: new TextDecoder('big5').decode(bytes), encoding: 'big5' };
    } catch {
      // 執行環境不支援 Big5 時退回 UTF-8 結果，讓逐列驗證回報錯誤
      return { text: utf8, encoding: 'utf-8' };
    }
  }

  function readHeader(text) {
    const firstLine = text
      .split(/\r\n|\n|\r/)
      .find((line) => line.trim().length > 0);
    if (!firstLine) return [];
    return window.PFD.csv.parseCsvLine(firstLine).map((h) => h.trim());
  }

  function headerSignature(headerFields) {
    return headerFields.join('\u001f');
  }

  function guessMapping(headerFields) {
    const normalized = headerFields.map((h) => h.trim().toLowerCase());
    const used = new Set();
    const mapping = {};

    TARGET_FIELDS.forEach((field) => {
      mapping[field] = null;
      for (const alias of FIELD_ALIASES[field]) {
        const idx = normalized.findIndex((h, i) => h === alias && !used.has(i));
        if (idx !== -1) {
          mapping[field] = idx;
          used.add(idx);
          break;
        }
      }
    });

    // header 已含全部標準必填欄名（英文 schema）時可跳過對應精靈
    const isExactSchema = REQUIRED_FIELDS.every((field) =>
      normalized.includes(field),
    );

    return { mapping, isExactSchema };
  }

  function normalizeDate(value) {
    const s = String(value).trim();
    let m =
      s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/) ||
      s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return s;
  }

  function normalizeNumber(value) {
    return String(value ?? '').replace(/[,\s]/g, '');
  }

  // 對應完欄位後、驗證前的值正規化：券商格式的買賣別、日期與千分位數字
  function normalizeRow(obj) {
    const action = String(obj.action || '').trim();
    return {
      ...obj,
      date: normalizeDate(obj.date || ''),
      action: ACTION_ALIASES[action.toLowerCase()] || action,
      quantity: normalizeNumber(obj.quantity),
      price: normalizeNumber(obj.price),
      fee: normalizeNumber(obj.fee),
    };
  }

  // 與 csv.parseCsv 相同的輸出格式（rows 含 id/market、errors 含行號），
  // 但欄位取值走 mapping、值先經 normalizeRow。
  function parseWithMapping(text, mapping, market) {
    const csv = window.PFD.csv;
    const lines = text
      .split(/\r\n|\n|\r/)
      .filter((line) => line.trim().length > 0);
    const rows = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const lineNum = i + 1;
      const fields = csv.parseCsvLine(lines[i]);
      const raw = {};
      TARGET_FIELDS.forEach((field) => {
        const idx = mapping[field];
        raw[field] =
          idx === null || idx === undefined ? '' : (fields[idx] ?? '').trim();
      });

      const obj = normalizeRow(raw);
      const reason = csv.validateRow(obj);
      if (reason) {
        errors.push({ line: lineNum, reason });
        continue;
      }

      rows.push({
        id: crypto.randomUUID(),
        date: obj.date,
        symbol: obj.symbol,
        name: obj.name || '',
        action: obj.action.toLowerCase(),
        quantity: Number(obj.quantity),
        price: Number(obj.price),
        fee: obj.fee ? Number(obj.fee) : 0,
        market,
      });
    }
    return { rows, errors };
  }

  function dedupeKey(tx) {
    return [
      tx.date,
      String(tx.symbol).toUpperCase(),
      tx.action,
      tx.quantity,
      tx.price,
      tx.fee,
    ].join('|');
  }

  // multiset 比對：現有資料的每個 key 記數、逐筆消耗，
  // 檔案內有兩筆相同而庫內只有一筆時，仍會新增一筆（同日同價兩筆成交是合法情境）。
  function analyzeImport(parsedRows, existingRows) {
    const existingCount = new Map();
    existingRows.forEach((tx) => {
      const key = dedupeKey(tx);
      existingCount.set(key, (existingCount.get(key) || 0) + 1);
    });

    const newRows = [];
    let duplicateCount = 0;
    parsedRows.forEach((tx) => {
      const key = dedupeKey(tx);
      const count = existingCount.get(key) || 0;
      if (count > 0) {
        existingCount.set(key, count - 1);
        duplicateCount++;
      } else {
        newRows.push(tx);
      }
    });

    const dates = parsedRows.map((tx) => tx.date).sort();
    return {
      newRows,
      duplicateCount,
      stats: {
        total: parsedRows.length,
        dateRange:
          parsedRows.length > 0
            ? { from: dates[0], to: dates[dates.length - 1] }
            : null,
        symbolCount: new Set(
          parsedRows.map((tx) => String(tx.symbol).toUpperCase()),
        ).size,
      },
    };
  }

  // 軟性一致性檢查（非阻擋）：若某標的已知有分割事件，比較分割前後交易的
  // 平均單價。分割前價格理論上應約為分割後的 ratio 倍；如果兩者接近，代表
  // 使用者很可能把分割前的交易誤填成分割後的等值股數/單價。
  const SPLIT_PRICE_RATIO_TOLERANCE = 0.5;

  function detectSplitWarnings(newRows, existingRows, splitEventsCache) {
    const bySymbol = new Map();
    [...existingRows, ...newRows].forEach((tx) => {
      if (!bySymbol.has(tx.symbol)) bySymbol.set(tx.symbol, []);
      bySymbol.get(tx.symbol).push(tx);
    });

    const avgPrice = (txs) =>
      txs.reduce((sum, tx) => sum + tx.price, 0) / txs.length;

    const warnings = [];
    bySymbol.forEach((txs, symbol) => {
      const splits = splitEventsCache?.[symbol]?.splits || [];
      splits.forEach((split) => {
        const before = txs.filter((tx) => tx.date < split.date);
        const after = txs.filter((tx) => tx.date >= split.date);
        if (before.length === 0 || after.length === 0) return;

        const observedRatio = avgPrice(before) / avgPrice(after);
        if (observedRatio < split.ratio * SPLIT_PRICE_RATIO_TOLERANCE) {
          warnings.push(
            `${symbol} 在 ${split.date} 有 ${split.numerator}:${split.denominator} 分割，` +
              `但分割前交易的價格看起來已經接近分割後的等值價格，` +
              `請確認分割前的股數/單價是否為當時實際成交數字（而非自行換算過的股數）。`,
          );
        }
      });
    });
    return warnings;
  }

  window.PFD = window.PFD || {};
  window.PFD.importer = {
    TARGET_FIELDS,
    REQUIRED_FIELDS,
    OPTIONAL_FIELDS,
    FIELD_LABELS,
    decodeCsvBytes,
    readHeader,
    headerSignature,
    guessMapping,
    normalizeRow,
    parseWithMapping,
    analyzeImport,
    detectSplitWarnings,
  };
})();
