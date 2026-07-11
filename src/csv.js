(function () {
  const CSV_HEADER = [
    'date',
    'symbol',
    'name',
    'action',
    'quantity',
    'price',
    'fee',
  ];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function fileNameFor(market, suffix) {
    const prefix = market === 'TW' ? 'tw' : 'us';
    return `${prefix}-stock${suffix}.csv`;
  }

  function parseCsvLine(line) {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    return fields;
  }

  function escapeCsvField(value) {
    const str = String(value ?? '');
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function validateRow(obj) {
    if (!DATE_RE.test(obj.date)) return 'date 格式必須為 YYYY-MM-DD';
    if (!obj.symbol) return 'symbol 不可為空';
    const action = String(obj.action || '').toLowerCase();
    if (action !== 'buy' && action !== 'sell')
      return 'action 必須是 buy 或 sell';
    const quantity = Number(obj.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0)
      return 'quantity 必須是大於 0 的數字';
    const price = Number(obj.price);
    if (!Number.isFinite(price) || price < 0)
      return 'price 必須是大於等於 0 的數字';
    if (obj.fee) {
      const fee = Number(obj.fee);
      if (!Number.isFinite(fee) || fee < 0)
        return 'fee 必須是大於等於 0 的數字';
    }
    return null;
  }

  function parseCsv(text, market) {
    const lines = text
      .split(/\r\n|\n|\r/)
      .filter((line) => line.trim().length > 0);
    const rows = [];
    const errors = [];
    if (lines.length === 0) return { rows, errors };

    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    for (let i = 1; i < lines.length; i++) {
      const lineNum = i + 1;
      const fields = parseCsvLine(lines[i]);
      const obj = {};
      header.forEach((h, idx) => {
        obj[h] = (fields[idx] ?? '').trim();
      });

      const reason = validateRow(obj);
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

  function stringifyCsv(transactions) {
    const lines = [CSV_HEADER.join(',')];
    transactions.forEach((tx) => {
      lines.push(
        CSV_HEADER.map((field) => escapeCsvField(tx[field])).join(','),
      );
    });
    return lines.join('\n') + '\n';
  }

  async function fetchInitialCsv(market) {
    try {
      const res = await fetch(`db/${fileNameFor(market, '')}`);
      if (!res.ok) return { rows: [], errors: [] };
      const text = await res.text();
      return parseCsv(text, market);
    } catch {
      return { rows: [], errors: [] };
    }
  }

  async function fetchExampleCsv(market) {
    try {
      const res = await fetch(`db/${fileNameFor(market, '.example')}`);
      if (!res.ok) return { rows: [], errors: [] };
      const text = await res.text();
      return parseCsv(text, market);
    } catch {
      return { rows: [], errors: [] };
    }
  }

  function downloadCsv(filename, csvText) {
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.PFD = window.PFD || {};
  window.PFD.csv = {
    CSV_HEADER,
    parseCsv,
    parseCsvLine,
    stringifyCsv,
    fetchInitialCsv,
    fetchExampleCsv,
    downloadCsv,
    fileNameFor,
    validateRow,
  };
})();
