// modular/ui.js
// 公開UIヘルパー: テーマ、タブ切替、簡易スクリーンショット、オーバーレイ制御など
(function(){
  // Theme
  function setTheme(theme){
    try{
      if(theme === 'original') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('kbc-theme', theme);
      _updateThemeBtns(theme);
    }catch(e){ console.error('setTheme', e); }
  }

  function _updateThemeBtns(theme){
    ['original','dark','light'].forEach(t => {
      const btn = document.getElementById(`theme-btn-${t}`);
      if(btn) btn.classList.toggle('active', t === theme);
    });
  }

  function _initThemeBtns(){
    const saved = localStorage.getItem('kbc-theme') || 'original';
    const attr = document.documentElement.getAttribute('data-theme');
    const current = attr || saved || 'original';
    _updateThemeBtns(current);
  }

  // Tabs
  function showTab(tabName){
    try{
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
      document.querySelectorAll('.content').forEach(c => c.classList.toggle('active', c.id === tabName));
      const fbSale = document.getElementById('filter-btn-sale');
      const fbMission = document.getElementById('filter-btn-mission');
      if(fbSale) fbSale.style.display = (tabName === 'sale') ? '' : 'none';
      if(fbMission) fbMission.style.display = (tabName === 'mission') ? '' : 'none';

      if(tabName === 'settings') return;
      // defer rendering to main implementation if available
      try{ if(typeof window.renderAll === 'function') window.renderAll(); else if(window.KBCPublic && typeof window.KBCPublic.renderAll === 'function') window.KBCPublic.renderAll(); }catch(e){}
    }catch(e){ console.error('showTab', e); }
  }

  // Filter overlay: basic show/hide; full content generation expected from main bundle
  function openFilter(tabName){
    const title = tabName === 'mission' ? 'mission フィルター' : 'sale フィルター';
    const el = document.getElementById('filter-title'); if(el) el.textContent = title;
    const overlay = document.getElementById('filter-overlay'); if(overlay) overlay.classList.add('show');
    // let main populate list if available
    try{ if(window.KBCPublic && typeof window.KBCPublic.openFilter === 'function') window.KBCPublic.openFilter(tabName); }catch(e){}
  }
  function closeFilter(){ const overlay = document.getElementById('filter-overlay'); if(overlay) overlay.classList.remove('show'); }
  function onFilterChange(label, checked){ try{ if(window.KBCPublic && typeof window.KBCPublic.onFilterChange === 'function') window.KBCPublic.onFilterChange(label, checked); }catch(e){} }
  function filterSelectAll(){ try{ if(window.KBCPublic && typeof window.KBCPublic.filterSelectAll === 'function') window.KBCPublic.filterSelectAll(); }catch(e){} }
  function filterSelectNone(){ try{ if(window.KBCPublic && typeof window.KBCPublic.filterSelectNone === 'function') window.KBCPublic.filterSelectNone(); }catch(e){} }

  // Overlay close helpers
  function closeOverlay(){ document.body.classList.remove('overlay-open'); const o = document.getElementById('overlay'); if(o) o.classList.remove('show'); }
  function closeSubOverlay(){ const o = document.getElementById('overlay-sub'); if(o) o.classList.remove('show'); }

  // Screenshot helpers (simplified from main)
  let _ssTarget = null;
  let _ssRestoreFn = null;

  function confirmScreenshot(){ _ssTarget = 'tab'; const msgEl = document.getElementById('ss-confirm-msg'); if(msgEl) msgEl.textContent = `「${document.querySelector('.tab.active')?.dataset.tab || ''}」をスクリーンショットしますか？`; const ov = document.getElementById('ss-confirm-overlay'); if(ov) ov.classList.add('show'); }
  function cancelScreenshot(){ const ov = document.getElementById('ss-confirm-overlay'); if(ov) ov.classList.remove('show'); _ssTarget = null; }

  async function doScreenshot(){
    const ov = document.getElementById('ss-confirm-overlay'); if(ov) ov.classList.remove('show');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    if(!_ssTarget) return;
    if(typeof html2canvas === 'undefined'){ alert('html2canvas が読み込まれていません。'); return; }

    let targetEl = null; let filename = 'screenshot.png';
    if(_ssTarget === 'tab'){ targetEl = document.querySelector('.content.active'); filename = `${document.querySelector('.tab.active')?.dataset.tab || 'tab'}_screenshot.png`; }
    else { targetEl = document.querySelector('.overlay-panel'); filename = `overlay_screenshot.png`; }
    if(!targetEl) { _ssTarget = null; return; }

    const rootCs = window.getComputedStyle(document.documentElement);
    const CSS_VAR_NAMES = ['--bg-primary','--bg-secondary','--card','--border','--text-primary'];
    const resolvedVars = {};
    CSS_VAR_NAMES.forEach(v => { const val = rootCs.getPropertyValue(v).trim(); if(val) resolvedVars[v] = val; });
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const bgColor = resolvedVars['--bg-primary'] || bodyBg || '#0a1931';
    const textColor = resolvedVars['--text-primary'] || '#eeeeee';

    try{
      const canvas = await html2canvas(targetEl, {
        allowTaint: true, useCORS: true, backgroundColor: bgColor, scale: Math.min(window.devicePixelRatio || 1, 2), logging: false,
        onclone: (clonedDoc, clonedEl) => {
          let css = ':root {';
          Object.entries(resolvedVars).forEach(([k,v]) => { css += `${k}:${v};`; });
          css += `} body { background:${bgColor} !important; color:${textColor} !important; } * { backdrop-filter:none !important; }`;
          const s = clonedDoc.createElement('style'); s.textContent = css; clonedDoc.head.appendChild(s);
        }
      });
      const link = document.createElement('a'); link.download = filename; link.href = canvas.toDataURL('image/png'); link.click();
    }catch(e){ console.error('Screenshot error:', e); alert('スクリーンショットに失敗しました: ' + (e && e.message ? e.message : e)); }
    finally { _ssTarget = null; if(_ssRestoreFn){ try{ _ssRestoreFn(); }catch(e){} _ssRestoreFn = null; } }
  }

  async function screenshotOverlay(){ _ssTarget = 'overlay'; const title = document.getElementById('overlay-title')?.textContent || ''; const msgEl = document.getElementById('ss-confirm-msg'); if(msgEl) msgEl.textContent = `「${title}」をスクリーンショットしますか？`; const ov = document.getElementById('ss-confirm-overlay'); if(ov) ov.classList.add('show'); }
  async function screenshotHistSection(secId){
    const bodyEl = document.getElementById(secId); if(!bodyEl) return; if(typeof html2canvas === 'undefined'){ alert('html2canvas が読み込まれていません。'); return; }
    const wasHidden = bodyEl.style.display === 'none'; if(wasHidden) bodyEl.style.display = 'block';
    const origMaxH = bodyEl.style.maxHeight; const origOverY = bodyEl.style.overflowY; bodyEl.style.maxHeight = 'none'; bodyEl.style.overflowY = 'visible';
    try{
      const canvas = await html2canvas(bodyEl, { allowTaint:true, useCORS:true, backgroundColor: window.getComputedStyle(document.body).backgroundColor, scale: Math.min(window.devicePixelRatio||1,2), logging:false });
      const link = document.createElement('a'); link.download = `hist_section_${secId}.png`; link.href = canvas.toDataURL('image/png'); link.click();
    }catch(e){ console.error('Hist section screenshot error:', e); alert('スクリーンショットに失敗しました: ' + (e && e.message ? e.message : e)); }
    finally { bodyEl.style.maxHeight = origMaxH; bodyEl.style.overflowY = origOverY; if(wasHidden) bodyEl.style.display = 'none'; }
  }

  // Basic event wiring so UI is interactive before main bundle loads
  function _attachListeners(){
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
    ['showCurrent','showPast','sortByDate','sortById'].forEach(id => { const el = document.getElementById(id); if(el) el.addEventListener('change', () => { try{ if(typeof window.renderAll === 'function') window.renderAll(); else if(window.KBCPublic && typeof window.KBCPublic.renderAll === 'function') window.KBCPublic.renderAll(); }catch(e){} }); });
    const sortByDate = document.getElementById('sortByDate'); if(sortByDate) sortByDate.addEventListener('change', function(){ if(this.checked){ const s = document.getElementById('sortById'); if(s) s.checked = false; } });
    const sortById = document.getElementById('sortById'); if(sortById) sortById.addEventListener('change', function(){ if(this.checked){ const s = document.getElementById('sortByDate'); if(s) s.checked = false; } });
    const rawLoadBtn = document.getElementById('raw-load-btn'); if(rawLoadBtn) rawLoadBtn.addEventListener('click', () => { try{ if(window.KBCPublic && typeof window.KBCPublic.loadSelectedRawFiles === 'function') window.KBCPublic.loadSelectedRawFiles(); }catch(e){} });
    const overlay = document.getElementById('overlay'); if(overlay) overlay.addEventListener('click', e => { if(e.target === e.currentTarget) closeOverlay(); });
    const overlayClose = document.getElementById('overlay-close'); if(overlayClose) overlayClose.addEventListener('click', closeOverlay);
    const overlaySub = document.getElementById('overlay-sub'); if(overlaySub) overlaySub.addEventListener('click', e => { if(e.target === e.currentTarget) closeSubOverlay(); });
  }

  // register and expose
  const map = { setTheme, _updateThemeBtns, _initThemeBtns, showTab, openFilter, closeFilter, onFilterChange, filterSelectAll, filterSelectNone, closeOverlay, closeSubOverlay, confirmScreenshot, cancelScreenshot, doScreenshot, screenshotOverlay, screenshotHistSection };
  try{ if(window.KBCPublic && typeof window.KBCPublic.register === 'function') window.KBCPublic.register(map); }catch(e){}
  Object.assign(window, map);

  // init
  try{ _initThemeBtns(); _attachListeners(); }catch(e){ console.warn('ui init failed', e); }

})();
