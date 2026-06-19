import { describe, it, expect } from 'vitest';
import '../src/ui.js';

const { escapeHtml } = window.PFD.ui;

describe('ui.escapeHtml', () => {
  it('escapes tags so injected markup cannot execute', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes quotes to prevent breaking out of an HTML attribute', () => {
    expect(escapeHtml('"><script>1</script>')).toBe('&quot;&gt;&lt;script&gt;1&lt;/script&gt;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('2330')).toBe('2330');
  });
});
