// check-env.js - simple environment checker for dev setup
import { execSync } from 'child_process';

function exists(cmd) {
  try { execSync(cmd + ' --version', { stdio: 'ignore' }); return true; } catch (e) { return false; }
}

console.log('Checking environment...');
console.log('Node.js:', exists('node') ? 'OK' : 'MISSING');
console.log('npm:   ', exists('npm') ? 'OK' : 'MISSING');
console.log('npx:   ', exists('npx') ? 'OK' : 'MISSING');
try {
  execSync('npx vercel --version', { stdio: 'inherit' });
} catch (e) {
  console.log('Vercel CLI: not found as npx package (will be installed automatically by npm run dev if needed)');
}

console.log('\nIf any are MISSING, please install Node.js 22+ and retry.');
