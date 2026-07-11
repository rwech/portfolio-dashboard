(function () {
  const REQUIRED_FIELDS = ['date', 'symbol', 'action', 'quantity', 'price'];
  const OPTIONAL_FIELDS = ['name', 'fee'];
  const TARGET_FIELDS = [
    ...REQUIRED_FIELDS.slice(0, 2),
    'name',
    ...REQUIRED_FIELDS.slice(2),
    'fee',
  ];

  const FIELD_LABELS = {
    date: '日期',
    symbol: '代號',
    name: '名稱',
    action: '買賣',
    quantity: '股數',
    price: '單價',
    fee: '手續費',
  };

  // 常見券商匯出檔的欄名別名（比對時先 trim + 轉小寫）
  const FIELD_ALIASES = {
    date: [
      'date',
      'trade date',
      'tradedate',
      '成交日期',
      '交易日期',
      '委託日期',
      '日期',
    ],
    symbol: [
      'symbol',
      'ticker',
      'code',
      'stock code',
      '股票代號',
      '證券代號',
      '股票代碼',
      '證券代碼',
      '代號',
      '代碼',
    ],
    name: [
      'name',
      'description',
      'stock name',
      '股票名稱',
      '證券名稱',
      '商品名稱',
      '名稱',
    ],
    action: [
      'action',
      'side',
      'type',
      'transaction type',
      '買賣',
      '買賣別',
      '交易別',
      '交易類別',
      '交易種類',
    ],
    quantity: [
      'quantity',
      'qty',
      'shares',
      '股數',
      '成交股數',
      '成交數量',
      '數量',
    ],
    price: [
      'price',
      'unit price',
      '成交價',
      '成交價格',
      '成交單價',
      '單價',
      '價格',
    ],
    fee: ['fee', 'fees', 'commission', '手續費', '費用'],
  };

  const ACTION_ALIASES = {
    buy: 'buy',
    b: 'buy',
    買: 'buy',
    買進: 'buy',
    現買: 'buy',
    融買: 'buy',
    融資買進: 'buy',
    sell: 'sell',
    s: 'sell',
    賣: 'sell',
    賣出: 'sell',
    現賣: 'sell',
    融賣: 'sell',
    融券賣出: 'sell',
  };

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
  };
})();
