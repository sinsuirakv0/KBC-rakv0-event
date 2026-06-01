// modular/app.modular.js
// モジュール分割のマニフェスト / 安全な公開関数のスタブ
// 既に公開して良い機能は modular/time.js と modular/ui.js に移動済です。
// このファイルは必要に応じて追加の公開ヘルパをここに置くための雛形です。

(function(){
  const map = {
    // 例:
    // lightweight helper を追加する場合はここに定義してから register します。
    // myHelper: function(a,b){ return a+b; }
  };

  try{
    if(window.KBCPublic && typeof window.KBCPublic.register === 'function'){
      window.KBCPublic.register(map);
    }
  }catch(e){ console.warn('app.modular register failed', e); }

  window.KBCModular = window.KBCModular || { registered: Object.keys(map) };
})();
