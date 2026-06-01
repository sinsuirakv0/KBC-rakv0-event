// modular/kbc_public_bridge.js
// KBCPublic ブリッジ: index の inline handler や外部モジュールから安全に呼べるように
// 関数呼び出しをキューイングして、復号済みメインスクリプトが提供する実装へ委譲します。
(function(){
  if(window.KBCPublic) return;

  const NAMES = [
    'setTheme','confirmScreenshot','cancelScreenshot','doScreenshot','onSearchInput','onSearchKeydown','showSuggestions','closeSuggestions','selectSuggestion',
    'openFilter','closeFilter','onFilterChange','filterSelectAll','filterSelectNone','downloadTsv','onUtcChange','toggleLastmod',
    'devHandleLocalFile','devUndo','devRedo','devAddRows','devAddCol','devDeleteRow','devDeleteCol','devClearCell','devZoom','devSearchDebounce','devGoSearch',
    'devLoadCurrentToList','devOpenSaveOverlay','devDownloadPlain','devDownloadEncrypted','devDownloadJson',
    'fetchRawFileList','loadSelectedRawFiles','handleTsvUpload','handleIframeLoad','handleIframeError','showTab','renderAll',
    // time helpers
    'startClock','syncAccurateTime','getAccurateDate','getDisplayDate','getCalcNow','updateNow','initUtcSelect','formatDate','formatDateUtc',
    // screenshots
    'screenshotOverlay','screenshotHistSection'
  ];

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

  // Define global thin wrappers so existing inline handlers keep working.
  for(const n of NAMES){
    if(typeof window[n] === 'undefined'){
      // wrapper forwards to KBCPublic (queued until register)
      window[n] = function(...args){ return window.KBCPublic._callOrQueue(n, args); };
    }
  }
})();
