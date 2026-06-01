// modular/loader.js
// 既存のインラインローダーを外部化したもの。
// /api/app-bundle を取得して CryptoJS で復号し、復号されたJSを実行します。
(async()=>{
  try{
    const r = await fetch('/api/app-bundle');
    if(!r.ok) return;
    const { b, k } = await r.json();
    const [ivH, enc] = b.split(':');
    const key = CryptoJS.enc.Hex.parse(CryptoJS.SHA256(k).toString());
    const iv = CryptoJS.enc.Hex.parse(ivH);
    const dec = CryptoJS.AES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(enc) },
      key,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
    );
    const js = dec.toString(CryptoJS.enc.Utf8);
    if(!js) return;
    const s = document.createElement('script');
    s.textContent = js;
    document.head.appendChild(s);

    // decrypted script executed synchronously on appendChild; if it defined
    // global functions, register them to KBCPublic so queued inline calls run.
    try{
      if(window.KBCPublic && typeof window.KBCPublic.register === 'function'){
        const NAMES = [
          'setTheme','confirmScreenshot','cancelScreenshot','doScreenshot','onSearchInput','onSearchKeydown','showSuggestions','closeSuggestions','selectSuggestion',
          'openFilter','closeFilter','onFilterChange','filterSelectAll','filterSelectNone','downloadTsv','onUtcChange','toggleLastmod',
          'devHandleLocalFile','devUndo','devRedo','devAddRows','devAddCol','devDeleteRow','devDeleteCol','devClearCell','devZoom','devSearchDebounce','devGoSearch',
          'devLoadCurrentToList','devOpenSaveOverlay','devDownloadPlain','devDownloadEncrypted','devDownloadJson',
          'fetchRawFileList','loadSelectedRawFiles','handleTsvUpload','handleIframeLoad','handleIframeError','showTab','renderAll',
          // time/screenshot
          'startClock','syncAccurateTime','getAccurateDate','getDisplayDate','getCalcNow','updateNow','initUtcSelect','formatDate','formatDateUtc',
          'screenshotOverlay','screenshotHistSection'
        ];
        const map = {};
        for(const name of NAMES){ if(typeof window[name] === 'function') map[name] = window[name].bind(window); }
        if(Object.keys(map).length) window.KBCPublic.register(map);
      }
    }catch(e){ console.warn('KBCPublic register failed:', e); }
  }catch(e){
    console.error('modular/loader:', e);
  }
})();
