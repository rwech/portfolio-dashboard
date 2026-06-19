import { describe, it, expect } from 'vitest';
import '../src/csv.js';

const { parseCsv, stringifyCsv } = window.PFD.csv;

describe('csv.parseCsv', () => {
  it('parses valid rows into transactions', () => {
    const text = 'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,台積電,buy,300,560,20\n';
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
    const text = 'date,symbol,name,action,quantity,price,fee\n2024/01/10,2330,,buy,300,560,0\n';
    const { rows, errors } = parseCsv(text, 'TW');
    expect(rows).toHaveLength(0);
    expect(errors).toEqual([{ line: 2, reason: 'date 格式必須為 YYYY-MM-DD' }]);
  });

  it('rejects a non-positive quantity', () => {
    const text = 'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,,buy,0,560,0\n';
    const { errors } = parseCsv(text, 'TW');
    expect(errors[0].reason).toMatch(/quantity/);
  });

  it('rejects an action other than buy/sell', () => {
    const text = 'date,symbol,name,action,quantity,price,fee\n2024-01-10,2330,,hold,10,560,0\n';
    const { errors } = parseCsv(text, 'TW');
    expect(errors[0].reason).toMatch(/action/);
  });

  it('round-trips fields containing commas through stringifyCsv', () => {
    const tx = { date: '2024-01-10', symbol: '2330', name: '台積電,股份', action: 'buy', quantity: 300, price: 560, fee: 20 };
    const csvText = stringifyCsv([tx]);
    const { rows, errors } = parseCsv(csvText, 'TW');
    expect(errors).toHaveLength(0);
    expect(rows[0].name).toBe('台積電,股份');
  });
});
