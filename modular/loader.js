// modular/loader.js
// 既存のインラインローダーを外部化したもの。
// /api/app-bundle を取得して CryptoJS で復号し、復号されたJSを実行します。
(async()=>{
  try{
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

    function ensureKBCPublic(){
      if(window.KBCPublic) return;
      const K = {
        _queue: [],
        _ready: false,
        register(map){
          try{
            for(const k in map) if(typeof map[k] === 'function') this[k] = map[k];
            this._ready = true;
            while(this._queue.length){
              const {name,args} = this._queue.shift();
              try{ if(typeof this[name] === 'function') this[name].apply(null, args); }
              catch(e){ console.error('KBCPublic queued call error', name, e); }
            }
          }catch(e){ console.error('KBCPublic.register failed', e); }
        },
        _callOrQueue(name, args){
          if(this._ready && typeof this[name] === 'function') return this[name].apply(null, args);
          this._queue.push({name, args});
        }
      };
      window.KBCPublic = K;
      for(const n of NAMES){
        if(typeof window[n] === 'undefined'){
          window[n] = function(...args){ return window.KBCPublic._callOrQueue(n, args); };
        }
      }
    }

    ensureKBCPublic();
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
    const protectedGlobals = {
      fetch: window.fetch,
      performance: window.performance,
      KBCPublic: window.KBCPublic,
    };
    const protectedPublicFns = {};
    for(const name of NAMES){
      if(typeof window[name] === 'function') protectedPublicFns[name] = window[name];
    }
    const s = document.createElement('script');
    s.textContent = js;
    document.head.appendChild(s);

    // The private bundle is obfuscated and may accidentally shadow browser
    // globals/public bridge functions. Keep the public shell stable.
    for(const [name, value] of Object.entries(protectedGlobals)){
      if(value && typeof window[name] === 'undefined') window[name] = value;
    }
    for(const [name, fn] of Object.entries(protectedPublicFns)){
      if(typeof window[name] === 'undefined') window[name] = fn;
    }

    // decrypted script executed synchronously on appendChild; if it defined
    // global functions, register them to KBCPublic so queued inline calls run.
    try{
      if(window.KBCPublic && typeof window.KBCPublic.register === 'function'){
        const map = {};
        for(const name of NAMES){ if(typeof window[name] === 'function') map[name] = window[name].bind(window); }
        if(Object.keys(map).length) window.KBCPublic.register(map);
      }
    }catch(e){ console.warn('KBCPublic register failed:', e); }
  }catch(e){
    console.error('modular/loader:', e);
  }
})();
