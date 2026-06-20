import { describe, it, expect, vi, afterEach } from 'vitest';
import '../src/csv.js';

const {
  parseCsv,
  stringifyCsv,
  fetchInitialCsv,
  fetchExampleCsv,
  downloadCsv,
  fileNameFor,
  validateRow,
} = window.PFD.csv;

describe('csv.parseCsv', () => {
  it('parses valid rows into transactions', () => {
    const text =
      'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,台積電,buy,300,560,20\n';
    const { rows, errors } = parseCsv(text, 'TW');
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      symbol: '2330',
      name: '台積電',
      action: 'buy',
      quantity: 300,
      price: 560,
      fee: 20,
      market: 'TW',
    });
  });

  it('rejects an invalid date format', () => {
    const text =
      'date,symbol,name,action,quantity,price,fee\n2024/01/10,2330,,buy,300,560,0\n';
    const { rows, errors } = parseCsv(text, 'TW');
    expect(rows).toHaveLength(0);
    expect(errors).toEqual([{ line: 2, reason: 'date 格式必須為 YYYY-MM-DD' }]);
  });

  it('rejects a non-positive quantity', () => {
    const text =
      'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,,buy,0,560,0\n';
    const { errors } = parseCsv(text, 'TW');
    expect(errors[0].reason).toMatch(/quantity/);
  });

  it('rejects an action other than buy/sell', () => {
    const text =
      'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,,hold,10,560,0\n';
    const { errors } = parseCsv(text, 'TW');
    expect(errors[0].reason).toMatch(/action/);
  });

  it('accepts an action regardless of letter case and normalizes it to lowercase', () => {
    const text =
      'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,,Buy,10,560,0\n2024-01-11,2330,,SELL,5,560,0\n';
    const { rows, errors } = parseCsv(text, 'TW');
    expect(errors).toHaveLength(0);
    expect(rows.map((r) => r.action)).toEqual(['buy', 'sell']);
  });

  it('rejects an empty symbol', () => {
    const text =
      'date,symbol,name,action,quantity,price,fee\n2024-01-10,,,buy,10,560,0\n';
    const { errors } = parseCsv(text, 'TW');
    expect(errors[0].reason).toMatch(/symbol/);
  });

  it('rejects a negative price', () => {
    const text =
      'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,,buy,10,-1,0\n';
    const { errors } = parseCsv(text, 'TW');
    expect(errors[0].reason).toMatch(/price/);
  });

  it('rejects a negative fee but allows a blank fee to default to 0', () => {
    const negativeFee = parseCsv(
      'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,,buy,10,560,-5\n',
      'TW',
    );
    expect(negativeFee.errors[0].reason).toMatch(/fee/);

    const blankFee = parseCsv(
      'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,,buy,10,560,\n',
      'TW',
    );
    expect(blankFee.errors).toHaveLength(0);
    expect(blankFee.rows[0].fee).toBe(0);
  });

  it('returns no rows or errors for an empty file', () => {
    expect(parseCsv('', 'TW')).toEqual({ rows: [], errors: [] });
  });

  it('parses a quoted field containing a comma and an escaped quote', () => {
    const text =
      'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,"台積電, ""股份""",buy,300,560,20\n';
    const { rows, errors } = parseCsv(text, 'TW');
    expect(errors).toHaveLength(0);
    expect(rows[0].name).toBe('台積電, "股份"');
  });

  it('keeps valid rows even when other rows in the same file are invalid', () => {
    const text =
      'date,symbol,name,action,quantity,price,fee\n' +
      '2024-01-10,2330,,buy,300,560,20\n' +
      'not-a-date,9999,,buy,1,1,0\n' +
      '2024-02-01,AAPL,,sell,5,150,1\n';
    const { rows, errors } = parseCsv(text, 'US');
    expect(rows).toHaveLength(2);
    expect(errors).toEqual([{ line: 3, reason: 'date 格式必須為 YYYY-MM-DD' }]);
  });
});

describe('csv.validateRow', () => {
  const baseRow = {
    date: '2024-01-10',
    symbol: '2330',
    action: 'buy',
    quantity: '10',
    price: '560',
    fee: '0',
  };

  it('accepts buy/sell regardless of letter case', () => {
    expect(validateRow({ ...baseRow, action: 'Buy' })).toBeNull();
    expect(validateRow({ ...baseRow, action: 'SELL' })).toBeNull();
    expect(validateRow({ ...baseRow, action: 'sElL' })).toBeNull();
  });

  it('still rejects an action that is not buy/sell in any case', () => {
    expect(validateRow({ ...baseRow, action: 'Hold' })).toMatch(/action/);
  });
});

describe('csv.stringifyCsv', () => {
  it('round-trips fields containing commas through stringifyCsv', () => {
    const tx = {
      date: '2024-01-10',
      symbol: '2330',
      name: '台積電,股份',
      action: 'buy',
      quantity: 300,
      price: 560,
      fee: 20,
    };
    const csvText = stringifyCsv([tx]);
    const { rows, errors } = parseCsv(csvText, 'TW');
    expect(errors).toHaveLength(0);
    expect(rows[0].name).toBe('台積電,股份');
  });

  it('produces just the header row when given no transactions', () => {
    expect(stringifyCsv([])).toBe(
      'date,symbol,name,action,quantity,price,fee\n',
    );
  });

  it('treats a missing field as an empty string instead of the literal "undefined"', () => {
    const tx = {
      date: '2024-01-10',
      symbol: '2330',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    };
    expect(stringifyCsv([tx])).toBe(
      'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,,buy,1,1,0\n',
    );
  });
});

describe('csv.fileNameFor', () => {
  it('builds the TW and US filenames with an optional suffix', () => {
    expect(fileNameFor('TW', '')).toBe('tw-stock.csv');
    expect(fileNameFor('US', '.example')).toBe('us-stock.example.csv');
  });
});

describe('csv.fetchInitialCsv / fetchExampleCsv', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses the response body when the fetch succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,,buy,1,1,0\n',
      }),
    );
    const { rows, errors } = await fetchInitialCsv('TW');
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it('returns empty rows/errors when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, text: async () => '' }),
    );
    expect(await fetchInitialCsv('TW')).toEqual({ rows: [], errors: [] });
  });

  it('returns empty rows/errors when fetch throws (e.g. offline)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    expect(await fetchInitialCsv('TW')).toEqual({ rows: [], errors: [] });
  });

  it('treats a row with fewer fields than the header as blank for the missing columns', () => {
    const text =
      'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,,buy,1,1\n';
    const { rows, errors } = parseCsv(text, 'TW');
    expect(errors).toHaveLength(0);
    expect(rows[0].fee).toBe(0);
  });

  it('fetchExampleCsv returns empty rows/errors when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, text: async () => '' }),
    );
    expect(await fetchExampleCsv('TW')).toEqual({ rows: [], errors: [] });
  });

  it('fetchExampleCsv returns empty rows/errors when fetch throws (e.g. offline)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    expect(await fetchExampleCsv('TW')).toEqual({ rows: [], errors: [] });
  });

  it('fetchExampleCsv parses the example dataset response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          'date,symbol,name,action,quantity,price,fee\n2024-03-01,AAPL,Apple,buy,10,180,1\n',
      }),
    );
    const { rows } = await fetchExampleCsv('US');
    expect(rows[0].symbol).toBe('AAPL');
  });
});

describe('csv.downloadCsv', () => {
  it('creates a Blob, triggers a download link, and revokes the object URL', () => {
    // jsdom doesn't implement URL.createObjectURL/revokeObjectURL, so they must be
    // defined (not just spied on) before they can be stubbed.
    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    downloadCsv('tw-stock.csv', 'date,symbol\n');

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);

    clickSpy.mockRestore();
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });
});
