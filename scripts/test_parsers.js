// scripts/test_parsers.js
// 簡易テスト: 公開 parsers の import を確認する。
(async function(){
  try {
    const gatya = await import('../parsers/gatya.js');
    const sale = await import('../parsers/sale.js');
    const item = await import('../parsers/item.js');
    console.log('public.parseGatya:', typeof gatya.parseGatya === 'function');
    console.log('public.parseSale:', typeof sale.parseSale === 'function');
    console.log('public.parseItem:', typeof item.parseItem === 'function');
  } catch (e) {
    console.warn('public parser load failed:', e.message);
  }

  process.exit(0);
})();
