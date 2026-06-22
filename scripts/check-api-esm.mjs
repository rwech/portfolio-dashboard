// Loads every api/*.js file through Node's native ESM loader (not Vitest's bundler
// transform, which silently interoperates CommonJS/ESM and would hide this class of
// bug). This is what actually catches a `module.exports` vs `export default` mismatch
// under package.json's "type": "module" — the exact crash Vercel hit in production.
import { readdirSync } from 'node:fs';

const apiDir = new URL('../api/', import.meta.url);
const files = readdirSync(apiDir).filter((f) => f.endsWith('.js'));

let hasError = false;
for (const file of files) {
  const mod = await import(new URL(file, apiDir));
  if (typeof mod.default !== 'function') {
    console.error(
      `api/${file} must export a default handler function (export default ...).`,
    );
    hasError = true;
    continue;
  }
  console.log(`api/${file} loads correctly under the native ESM loader.`);
}

if (hasError) process.exit(1);
