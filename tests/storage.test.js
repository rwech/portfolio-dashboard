import { describe, it, expect, beforeEach } from 'vitest';
import '../src/storage.js';

const { loadTheme, saveTheme } = window.PFD.storage;

describe('storage theme persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to the neon theme when nothing is saved', () => {
    expect(loadTheme()).toBe('neon');
  });

  it('round-trips a saved theme', () => {
    saveTheme('midnight');
    expect(loadTheme()).toBe('midnight');
  });
});
