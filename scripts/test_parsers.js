// scripts/test_parsers.js
// 簡易テスト: 公開 parsers と event-app 内 parsers の import を試みる
(async function(){
  try {
    const pub = await import('../parsers/gatya.js');
    console.log('public.parseGatya:', typeof pub.parseGatya === 'function');
  } catch (e) {
    console.warn('public parser load failed:', e.message);
  }

  try {
    const priv = await import('../../KBC-rakv0-event-app/src/parsers/gatya.js');
    console.log('event-app.parseGatya:', typeof priv.parseGatya === 'function');
  } catch (e) {
    console.warn('event-app parser load failed:', e.message);
  }

  process.exit(0);
})();
