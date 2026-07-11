import { describe, it, expect } from 'vitest';
import '../src/csv.js';
import '../src/importer.js';

const importer = window.PFD.importer;

function bufferOf(bytes) {
  return new Uint8Array(bytes).buffer;
}

function utf8Buffer(text) {
  return new TextEncoder().encode(text).buffer;
}

describe('importer.decodeCsvBytes', () => {
  it('decodes plain UTF-8 content and reports the encoding', () => {
    const { text, encoding } = importer.decodeCsvBytes(
      utf8Buffer('date,symbol\n2024-01-01,2330'),
    );
    expect(encoding).toBe('utf-8');
    expect(text).toBe('date,symbol\n2024-01-01,2330');
  });

  it('strips a UTF-8 BOM so the first header field is clean', () => {
    const bom = [0xef, 0xbb, 0xbf];
    const body = [...new TextEncoder().encode('date,symbol')];
    const { text, encoding } = importer.decodeCsvBytes(
      bufferOf([...bom, ...body]),
    );
    expect(encoding).toBe('utf-8');
    expect(text).toBe('date,symbol');
  });

  it('falls back to Big5 when the bytes are not valid UTF-8', () => {
    // 「台積電」in Big5: A5 78 / BF 6E / B9 71
    const big5 = [0xa5, 0x78, 0xbf, 0x6e, 0xb9, 0x71];
    const ascii = [...new TextEncoder().encode(',buy\n')];
    const { text, encoding } = importer.decodeCsvBytes(
      bufferOf([...big5, ...ascii]),
    );
    expect(encoding).toBe('big5');
    expect(text).toBe('台積電,buy\n');
  });

  it('accepts a Uint8Array as well as an ArrayBuffer', () => {
    const { text } = importer.decodeCsvBytes(new TextEncoder().encode('abc'));
    expect(text).toBe('abc');
  });
});

describe('importer.readHeader / headerSignature', () => {
  it('parses the first non-empty line into trimmed fields', () => {
    expect(importer.readHeader('\n date , symbol \n2024,2330')).toEqual([
      'date',
      'symbol',
    ]);
  });

  it('returns an empty array for empty content', () => {
    expect(importer.readHeader('')).toEqual([]);
    expect(importer.readHeader('  \n  ')).toEqual([]);
  });

  it('produces distinct signatures for different splits of the same text', () => {
    expect(importer.headerSignature(['ab', 'c'])).not.toBe(
      importer.headerSignature(['a', 'bc']),
    );
  });
});

describe('importer.guessMapping', () => {
  it('recognizes the exact standard schema and skips the wizard', () => {
    const { mapping, isExactSchema } = importer.guessMapping([
      'date',
      'symbol',
      'name',
      'action',
      'quantity',
      'price',
      'fee',
    ]);
    expect(isExactSchema).toBe(true);
    expect(mapping).toEqual({
      date: 0,
      symbol: 1,
      name: 2,
      action: 3,
      quantity: 4,
      price: 5,
      fee: 6,
    });
  });

  it('guesses Taiwanese broker column names via aliases', () => {
    const { mapping, isExactSchema } = importer.guessMapping([
      '成交日期',
      '證券代號',
      '證券名稱',
      '買賣別',
      '成交股數',
      '成交價',
      '手續費',
    ]);
    expect(isExactSchema).toBe(false);
    expect(mapping).toEqual({
      date: 0,
      symbol: 1,
      name: 2,
      action: 3,
      quantity: 4,
      price: 5,
      fee: 6,
    });
  });

  it('guesses common English broker aliases case-insensitively', () => {
    const { mapping } = importer.guessMapping([
      'Trade Date',
      'Ticker',
      'Side',
      'Qty',
      'Price',
      'Commission',
    ]);
    expect(mapping.date).toBe(0);
    expect(mapping.symbol).toBe(1);
    expect(mapping.action).toBe(2);
    expect(mapping.quantity).toBe(3);
    expect(mapping.price).toBe(4);
    expect(mapping.fee).toBe(5);
    expect(mapping.name).toBeNull();
  });

  it('leaves unrecognized fields unmapped instead of guessing wrong', () => {
    const { mapping, isExactSchema } = importer.guessMapping([
      'foo',
      'bar',
      'price',
    ]);
    expect(isExactSchema).toBe(false);
    expect(mapping.date).toBeNull();
    expect(mapping.symbol).toBeNull();
    expect(mapping.price).toBe(2);
  });

  it('does not map one source column onto two target fields', () => {
    // 「日期」 must not be consumed twice even though several aliases could match it
    const { mapping } = importer.guessMapping(['日期', '代號']);
    const used = Object.values(mapping).filter((v) => v !== null);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('importer.normalizeRow', () => {
  it('maps Chinese and single-letter action aliases to buy/sell', () => {
    expect(importer.normalizeRow({ action: '買進' }).action).toBe('buy');
    expect(importer.normalizeRow({ action: '現賣' }).action).toBe('sell');
    expect(importer.normalizeRow({ action: 'B' }).action).toBe('buy');
    expect(importer.normalizeRow({ action: 'Sell' }).action).toBe('sell');
  });

  it('leaves unknown actions untouched so validation can reject them', () => {
    expect(importer.normalizeRow({ action: '轉帳' }).action).toBe('轉帳');
  });

  it('normalizes slash and compact dates to YYYY-MM-DD', () => {
    expect(importer.normalizeRow({ date: '2024/1/9' }).date).toBe('2024-01-09');
    expect(importer.normalizeRow({ date: '2024/11/25' }).date).toBe(
      '2024-11-25',
    );
    expect(importer.normalizeRow({ date: '20240109' }).date).toBe('2024-01-09');
    expect(importer.normalizeRow({ date: '2024-1-9' }).date).toBe('2024-01-09');
  });

  it('leaves unparseable dates untouched so validation can reject them', () => {
    expect(importer.normalizeRow({ date: '09/01/2024' }).date).toBe(
      '09/01/2024',
    );
  });

  it('strips thousand separators and spaces from numeric fields', () => {
    const row = importer.normalizeRow({
      quantity: '1,000',
      price: ' 1,087.5 ',
      fee: '20',
    });
    expect(row.quantity).toBe('1000');
    expect(row.price).toBe('1087.5');
    expect(row.fee).toBe('20');
  });
});

describe('importer.parseWithMapping', () => {
  const header = '成交日期,證券代號,買賣別,成交股數,成交價,手續費';
  const mapping = {
    date: 0,
    symbol: 1,
    name: null,
    action: 2,
    quantity: 3,
    price: 4,
    fee: 5,
  };

  it('parses broker-style rows through mapping + normalization', () => {
    const text = `${header}\n2024/1/10,2330,買進,"1,000",560,20\n`;
    const { rows, errors } = importer.parseWithMapping(text, mapping, 'TW');
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2024-01-10',
      symbol: '2330',
      name: '',
      action: 'buy',
      quantity: 1000,
      price: 560,
      fee: 20,
      market: 'TW',
    });
    expect(rows[0].id).toBeTruthy();
  });

  it('reports invalid rows with their line numbers and keeps the valid ones', () => {
    const text = `${header}\n2024/1/10,2330,買進,0,560,20\nbad-date,2330,買進,10,560,20\n2024/1/11,2317,賣出,5,100,0\n`;
    const { rows, errors } = importer.parseWithMapping(text, mapping, 'TW');
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('2317');
    expect(errors).toHaveLength(2);
    expect(errors[0].line).toBe(2);
    expect(errors[1].line).toBe(3);
  });

  it('treats unmapped optional fields as empty/zero', () => {
    const text = `${header}\n2024/1/10,2330,買進,10,560,\n`;
    const { rows } = importer.parseWithMapping(text, mapping, 'TW');
    expect(rows[0].name).toBe('');
    expect(rows[0].fee).toBe(0);
  });
});

describe('importer.analyzeImport', () => {
  const tx = (over = {}) => ({
    date: '2024-01-10',
    symbol: '2330',
    action: 'buy',
    quantity: 100,
    price: 560,
    fee: 20,
    ...over,
  });

  it('re-importing the identical dataset yields zero new rows', () => {
    const existing = [tx(), tx({ date: '2024-02-01', action: 'sell' })];
    const result = importer.analyzeImport(
      existing.map((t) => ({ ...t })),
      [...existing],
    );
    expect(result.newRows).toHaveLength(0);
    expect(result.duplicateCount).toBe(2);
  });

  it('adds only the rows missing from the store', () => {
    const existing = [tx()];
    const incoming = [tx(), tx({ date: '2024-03-01' })];
    const result = importer.analyzeImport(incoming, existing);
    expect(result.newRows).toHaveLength(1);
    expect(result.newRows[0].date).toBe('2024-03-01');
    expect(result.duplicateCount).toBe(1);
  });

  it('matches as a multiset: two identical file rows vs one stored row adds exactly one', () => {
    const existing = [tx()];
    const incoming = [tx(), tx()]; // same-day same-price double fill is legitimate
    const result = importer.analyzeImport(incoming, existing);
    expect(result.newRows).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
  });

  it('compares symbols case-insensitively', () => {
    const existing = [tx({ symbol: 'aapl' })];
    const incoming = [tx({ symbol: 'AAPL' })];
    const result = importer.analyzeImport(incoming, existing);
    expect(result.newRows).toHaveLength(0);
    expect(result.duplicateCount).toBe(1);
  });

  it('summarizes total, date range, and distinct symbol count', () => {
    const incoming = [
      tx({ date: '2024-03-01' }),
      tx({ date: '2024-01-05', symbol: 'AAPL' }),
      tx({ date: '2024-02-01', symbol: 'aapl' }),
    ];
    const { stats } = importer.analyzeImport(incoming, []);
    expect(stats.total).toBe(3);
    expect(stats.dateRange).toEqual({ from: '2024-01-05', to: '2024-03-01' });
    expect(stats.symbolCount).toBe(2);
  });

  it('reports a null date range for an empty file', () => {
    const { stats, newRows } = importer.analyzeImport([], []);
    expect(stats.dateRange).toBeNull();
    expect(newRows).toEqual([]);
  });
});
