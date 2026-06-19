import { describe, it, expect } from 'vitest';
import '../src/exchangeRate.js';

const { usdToTwd, twdToUsd } = window.PFD.exchangeRate;

describe('exchangeRate conversions', () => {
  it('converts USD to TWD', () => {
    expect(usdToTwd(100, 32)).toBe(3200);
  });

  it('converts TWD to USD', () => {
    expect(twdToUsd(3200, 32)).toBe(100);
  });

  it('returns NaN instead of Infinity when the rate is zero', () => {
    expect(twdToUsd(100, 0)).toBeNaN();
  });
});
