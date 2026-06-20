// Loads api/stock-price.js through Node's native ESM loader (not Vitest's bundler
// transform, which silently interoperates CommonJS/ESM and would hide this class of
// bug). This is what actually catches a `module.exports` vs `export default` mismatch
// under package.json's "type": "module" — the exact crash Vercel hit in production.
const mod = await import('../api/stock-price.js');

if (typeof mod.default !== 'function') {
  console.error(
    'api/stock-price.js must export a default handler function (export default ...).',
  );
  process.exit(1);
}

console.log('api/stock-price.js loads correctly under the native ESM loader.');
