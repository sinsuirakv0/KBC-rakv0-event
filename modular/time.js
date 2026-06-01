// modular/time.js
// 公開タイムヘルパー: 時計同期、表示、UTC選択など（公開して問題ない部分）
(function(){
  let _offset = 0; // ms
  let _started = false;
  let selectedUtcOffset = (window.selectedUtcOffset !== undefined) ? window.selectedUtcOffset : 'local';
  let currentLocale = window.currentLocale || 'ja';

  async function syncAccurateTime(){
    try{
      const t0 = Date.now();
      const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Tokyo');
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const t1 = Date.now();
      const data = await res.json();
      const serverTime = new Date(data.datetime).getTime();
      if(!Number.isFinite(serverTime)) throw new Error('invalid datetime');
      const rtt = t1 - t0;
      const oneWayDelay = rtt / 2;
      _offset = serverTime + oneWayDelay - Date.now();
    }catch(e){
      console.warn('Time sync failed, using local clock:', e && e.message ? e.message : e);
    }
  }

  function getAccurateDate(){
    return new Date(Date.now() + _offset);
  }

  function formatDate(d){
    const y = d.getFullYear();
    const mon = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const h = String(d.getHours()).padStart(2,'0');
    const m = String(d.getMinutes()).padStart(2,'0');
    const s = String(d.getSeconds()).padStart(2,'0');
    return `${y}/${mon}/${day} ${h}:${m}:${s}`;
  }

  function formatDateUtc(d){
    const y = d.getUTCFullYear();
    const mon = String(d.getUTCMonth()+1).padStart(2,'0');
    const day = String(d.getUTCDate()).padStart(2,'0');
    const h = String(d.getUTCHours()).padStart(2,'0');
    const m = String(d.getUTCMinutes()).padStart(2,'0');
    const s = String(d.getUTCSeconds()).padStart(2,'0');
    return `${y}/${mon}/${day} ${h}:${m}:${s}`;
  }

  function getDisplayDate(){
    const accurateMs = Date.now() + _offset;
    if (selectedUtcOffset === 'local') return new Date(accurateMs);
    return new Date(accurateMs + Number(selectedUtcOffset) * 3600000);
  }

  function getCalcNow(){
    if (selectedUtcOffset === 'local') return getAccurateDate();
    const d = getDisplayDate();
    return new Date(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()
    );
  }

  function updateNow(){
    const LABEL = { ja:'jp', en:'en', kr:'kr', tw:'tw' };
    const activeLabel = LABEL[currentLocale] ?? currentLocale;

    let timeStr;
    if (selectedUtcOffset === 'local') {
      timeStr = formatDate(getAccurateDate());
    } else {
      const label = Number(selectedUtcOffset) >= 0 ? `(UTC+${selectedUtcOffset})` : `(UTC${selectedUtcOffset})`;
      timeStr = `${label}${formatDateUtc(getDisplayDate())}`;
    }

    const localeEl = document.getElementById('locale-display');
    if (localeEl) localeEl.textContent = `地域: ${activeLabel}　`;
    const nowEl = document.getElementById('now-display');
    if (nowEl) nowEl.textContent = `現在時刻:${timeStr}`;
  }

  function initUtcSelect(){
    const sel = document.getElementById('utc-select');
    if(!sel) return;
    sel.innerHTML = '';
    for(let u = -12; u <= 14; u++){
      const opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u >= 0 ? `UTC+${u}` : `UTC${u}`;
      if(u === 9) opt.textContent += ' (JST)';
      sel.appendChild(opt);
    }
  }

  function onUtcChange(val){
    selectedUtcOffset = val === 'local' ? 'local' : parseInt(val);
    updateNow();
    // trigger renderAll if present
    try{ if(typeof window.renderAll === 'function') window.renderAll(); else if(window.KBCPublic && typeof window.KBCPublic.renderAll === 'function') window.KBCPublic.renderAll(); }catch(e){}
  }

  function startClock(){
    if(_started) return;
    initUtcSelect();
    syncAccurateTime().finally(()=>{
      updateNow();
    });
    setInterval(updateNow, 1000);
    setInterval(syncAccurateTime, 5 * 60 * 1000);
    _started = true;
  }

  // expose globals and register to KBCPublic
  const map = { startClock, syncAccurateTime, getAccurateDate, getDisplayDate, getCalcNow, updateNow, initUtcSelect, onUtcChange, formatDate, formatDateUtc };
  try{ if(window.KBCPublic && typeof window.KBCPublic.register === 'function') window.KBCPublic.register(map); }catch(e){}

  // Also set window-level names so inline calls work immediately
  Object.assign(window, map);

  // Start clock now so UI shows time immediately
  try{ startClock(); }catch(e){ console.warn('startClock failed', e); }

})();
