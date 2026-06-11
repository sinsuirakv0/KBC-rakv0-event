// 描画済みカードを絞り込む公開UI。詳細情報は暗号化側のKBCSearchBridgeから読み取る。
(() => {
  const STORAGE_KEY = 'kbc-advanced-filter-v1';
  const TARGET_CONTENT_IDS = ['gatya', 'sale', 'item', 'mission', 'all', 'list'];
  const panel = document.getElementById('advanced-filter');
  const queryInput = document.getElementById('advanced-filter-query');
  const queryMode = document.getElementById('advanced-filter-query-mode');
  const queryScope = document.getElementById('advanced-filter-scope');
  const extraTagSelect = document.getElementById('advanced-filter-extra-tag');
  const stageTypeSelect = document.getElementById('advanced-filter-stage-type');
  const sortSelect = document.getElementById('advanced-filter-sort');
  const rangeFields = {
    startFrom: document.getElementById('advanced-filter-start-from'),
    startTo: document.getElementById('advanced-filter-start-to'),
    endFrom: document.getElementById('advanced-filter-end-from'),
    endTo: document.getElementById('advanced-filter-end-to'),
    idMin: document.getElementById('advanced-filter-id-min'),
    idMax: document.getElementById('advanced-filter-id-max')
  };
  const countDisplay = document.getElementById('advanced-filter-count');
  const descriptionDisplay = document.getElementById('advanced-filter-description');
  const badge = document.getElementById('advanced-filter-badge');
  let pendingFrame = 0;
  let knownExtraTags = '';
  let knownStageTypes = '';
  const cardDataCache = new WeakMap();

  function normalize(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase('ja').replace(/\s+/g, ' ').trim();
  }

  function parseQuery(value) {
    const positive = [];
    const negative = [];
    const matcher = /(-?)"([^"]+)"|(-?)(\S+)/g;
    const fieldAliases = {
      id: 'id', name: 'name', '名前': 'name',
      status: 'status', state: 'status', '状態': 'status',
      type: 'type', '種類': 'type',
      tag: 'tag', 'タグ': 'tag',
      gacha: 'gacha', gatya: 'gacha', 'ガチャ': 'gacha',
      stage: 'stageType', map: 'stageType', class: 'stageType', '分類': 'stageType',
      start: 'start', '開始': 'start',
      end: 'end', '終了': 'end',
      detail: 'detail', data: 'detail', '詳細': 'detail'
    };
    let match;
    while ((match = matcher.exec(value)) !== null) {
      const isNegative = (match[1] || match[3]) === '-';
      const rawTerm = normalize(match[2] || match[4]);
      if (!rawTerm) continue;
      const separator = rawTerm.search(/[:：]/);
      const rawField = separator > 0 ? rawTerm.slice(0, separator) : '';
      const field = fieldAliases[rawField] || '';
      const term = field ? rawTerm.slice(separator + 1) : rawTerm;
      if (!term) continue;
      (isNegative ? negative : positive).push({ field, term });
    }
    return { positive, negative };
  }

  function selectedValues(groupName) {
    return Array.from(panel.querySelectorAll(`[data-filter-group="${groupName}"] input:checked`), input => input.value);
  }

  function setSelectedValues(groupName, values) {
    const selected = new Set(values);
    panel.querySelectorAll(`[data-filter-group="${groupName}"] input`).forEach(input => {
      input.checked = selected.has(input.value);
    });
  }

  function syncLegacySort(trigger = true) {
    const dateInput = document.getElementById('sortByDate');
    const idInput = document.getElementById('sortById');
    dateInput.checked = sortSelect.value === 'date';
    idInput.checked = sortSelect.value === 'id';
    if (trigger) {
      const target = dateInput.checked ? dateInput : idInput.checked ? idInput : dateInput;
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function collectIds(value, output = new Set(), key = '') {
    if (value == null) return output;
    if (Array.isArray(value)) {
      value.forEach(item => collectIds(item, output, key));
    } else if (typeof value === 'object') {
      Object.entries(value).forEach(([childKey, child]) => collectIds(child, output, childKey));
    } else if (/^(id|eventid|stageid|stageids|targetid|targetids|giftid|unitid)$/i.test(key)
      && (typeof value === 'number' || /^\d+$/.test(String(value)))) {
      output.add(String(value));
    }
    return output;
  }

  function compactDate(value) {
    return String(value ?? '').replace(/\D/g, '').slice(0, 8);
  }

  function parseEventDate(dateValue, timeValue = 0) {
    const date = compactDate(dateValue);
    if (date.length !== 8) return null;
    const time = String(timeValue ?? 0).padStart(6, '0').slice(-6);
    const parsed = new Date(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)),
      Number(time.slice(0, 2)),
      Number(time.slice(2, 4)),
      Number(time.slice(4, 6))
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function dayStart(value = new Date()) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  function getDetail(card) {
    const key = card.dataset.detailKey;
    return key ? window.KBCSearchBridge?.getDetail?.(key) || null : null;
  }

  function getStageType(id) {
    return window.KBCSearchBridge?.getStageType?.(id) || null;
  }

  function getStageCode(id) {
    return window.KBCSearchBridge?.getStageCode?.(id) || null;
  }

  function getCardType(card) {
    const content = card.closest('.content');
    if (!content) return '';
    if (content.id !== 'all') return content.id;
    const headers = Array.from(content.querySelectorAll('.all-section-header'));
    let latest = null;
    headers.forEach(header => {
      if (header.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) latest = header;
    });
    const label = normalize(latest?.textContent);
    return ['gatya', 'sale', 'item', 'mission'].find(type => label.includes(type)) || 'all';
  }

  function cardData(card) {
    const cached = cardDataCache.get(card);
    if (cached) return cached;
    const name = card.querySelector('.card-name')?.textContent || '';
    const period = card.querySelector('.card-period')?.textContent || '';
    const status = card.querySelector('.card-tag')?.textContent?.trim() || '';
    const gacha = card.querySelector('.gacha-type-tag')?.textContent?.trim() || '';
    const extraTags = Array.from(card.querySelectorAll('.stage-tag'), tag => tag.textContent.trim()).filter(Boolean);
    const tags = [status, gacha, ...extraTags].filter(Boolean).join(' ');
    const detail = getDetail(card) || {};
    const header = detail._header || {};
    const ids = [...collectIds(detail)];
    const isStageEvent = detail.type === 'sale' || detail.type === 'mission';
    const stageTypes = isStageEvent ? [...new Set(ids.map(getStageType).filter(Boolean))] : [];
    const stageCodes = isStageEvent ? [...new Set(ids.map(getStageCode).filter(Boolean))] : [];
    const detailText = normalize(JSON.stringify(detail));
    const startCompact = compactDate(header.startDate);
    const endCompact = compactDate(header.endDate);
    const startDate = parseEventDate(header.startDate, header.startTime);
    const endDate = parseEventDate(header.endDate, header.endTime);
    const permanent = detail.steady === true || endCompact === '20300101';
    const data = {
      name,
      period,
      status,
      gacha,
      extraTags,
      type: getCardType(card),
      detail,
      ids,
      stageTypes,
      stageCodes,
      startCompact,
      endCompact,
      startDate,
      endDate,
      permanent,
      detailText,
      allText: normalize(`${card.textContent} ${detailText} ${stageTypes.join(' ')} ${stageCodes.join(' ')}`),
      nameText: normalize(name),
      periodText: normalize(period),
      tagText: normalize(tags)
    };
    cardDataCache.set(card, data);
    return data;
  }

  function matchesFeatures(data, features) {
    return features.every(feature => {
      if (feature === 'guaranteed') return data.allText.includes('確定');
      if (feature === 'event-guaranteed') return data.allText.includes('確定枠あり');
      if (feature === 'one-time') return data.allText.includes('1回限り');
      if (feature === 'unknown') return /(?:^|\s)(?:id|名称不明)\s*[:：]?\s*\d*/i.test(data.nameText);
      if (feature === 'has-extra-tag') return data.extraTags.length > 0;
      if (feature === 'no-extra-tag') return data.extraTags.length === 0;
      if (feature === 'has-time-blocks') return Array.isArray(data.detail._timeBlocks) && data.detail._timeBlocks.length > 0;
      if (feature === 'has-popup') return Boolean(data.detail.popupText);
      if (feature === 'has-target-stages') return Array.isArray(data.detail.targetStages) && data.detail.targetStages.length > 0;
      if (feature === 'repeating') return data.detail.repeatFlag === 1;
      return true;
    });
  }

  function matchesRelative(data, relative) {
    if (!relative.length || (!data.startDate && !data.endDate)) return relative.length === 0;
    const today = dayStart();
    const tomorrow = new Date(today.getTime() + 86400000);
    const inThreeDays = new Date(today.getTime() + 4 * 86400000);
    const inSevenDays = new Date(today.getTime() + 8 * 86400000);
    const now = new Date();
    const isToday = date => date && date >= today && date < tomorrow;
    const isUpcoming = (date, limit) => date && date >= now && date < limit;
    return relative.some(value => {
      if (value === 'starts-today') return isToday(data.startDate);
      if (value === 'ends-today') return isToday(data.endDate);
      if (value === 'starts-3d') return isUpcoming(data.startDate, inThreeDays);
      if (value === 'ends-3d') return isUpcoming(data.endDate, inThreeDays);
      if (value === 'starts-7d') return isUpcoming(data.startDate, inSevenDays);
      if (value === 'ends-7d') return isUpcoming(data.endDate, inSevenDays);
      return false;
    });
  }

  function fieldText(data, field, fallbackText) {
    if (field === 'id') return normalize(data.ids.join(' '));
    if (field === 'name') return data.nameText;
    if (field === 'status') return normalize(data.status);
    if (field === 'type') return normalize(data.type);
    if (field === 'tag') return data.tagText;
    if (field === 'gacha') return normalize(data.gacha);
    if (field === 'stageType') return normalize(`${data.stageTypes.join(' ')} ${data.stageCodes.join(' ')}`);
    if (field === 'start') return normalize(`${data.startCompact} ${data.startDate?.toLocaleDateString('ja-JP') || ''}`);
    if (field === 'end') return normalize(`${data.endCompact} ${data.endDate?.toLocaleDateString('ja-JP') || ''}`);
    if (field === 'detail') return data.detailText;
    return fallbackText;
  }

  function matchesTerm(data, clause, fallbackText) {
    return fieldText(data, clause.field, fallbackText).includes(clause.term);
  }

  function withinDateRange(date, from, to) {
    if (!from && !to) return true;
    if (!date) return false;
    const value = dayStart(date).getTime();
    if (from && value < new Date(`${from}T00:00:00`).getTime()) return false;
    if (to && value > new Date(`${to}T23:59:59`).getTime()) return false;
    return true;
  }

  function cardMatches(card, conditions) {
    const data = cardData(card);
    const searchText = conditions.scope === 'name'
      ? data.nameText
      : conditions.scope === 'period'
        ? data.periodText
        : conditions.scope === 'tag'
          ? data.tagText
          : data.allText;

    if (conditions.statuses.length && !conditions.statuses.includes(data.status)) return false;
    if (conditions.types.length && !conditions.types.includes(data.type)) return false;
    if (conditions.gacha.length && !conditions.gacha.includes(data.gacha)) return false;
    if (data.permanent && !conditions.duration.includes('permanent')) return false;
    if (!data.permanent && conditions.duration.length && !conditions.duration.includes('limited')) return false;
    if (conditions.stageType && !data.stageTypes.includes(conditions.stageType)) return false;
    if (conditions.extraTag && !data.extraTags.includes(conditions.extraTag)) return false;
    if (!matchesFeatures(data, conditions.features)) return false;
    if (!matchesRelative(data, conditions.relative)) return false;
    if (!withinDateRange(data.startDate, conditions.startFrom, conditions.startTo)) return false;
    if (!withinDateRange(data.endDate, conditions.endFrom, conditions.endTo)) return false;
    if ((conditions.idMin != null || conditions.idMax != null) && !data.ids.some(id => {
      const value = Number(id);
      return Number.isFinite(value)
        && (conditions.idMin == null || value >= conditions.idMin)
        && (conditions.idMax == null || value <= conditions.idMax);
    })) return false;
    if (conditions.negative.some(clause => matchesTerm(data, clause, searchText))) return false;
    if (!conditions.positive.length) return true;
    return conditions.mode === 'any'
      ? conditions.positive.some(clause => matchesTerm(data, clause, searchText))
      : conditions.positive.every(clause => matchesTerm(data, clause, searchText));
  }

  function readConditions() {
    const terms = parseQuery(queryInput.value);
    return {
      ...terms,
      mode: queryMode.value,
      scope: queryScope.value,
      statuses: selectedValues('status'),
      types: selectedValues('type'),
      gacha: selectedValues('gacha'),
      duration: selectedValues('duration'),
      features: selectedValues('feature'),
      relative: selectedValues('relative'),
      extraTag: extraTagSelect.value,
      stageType: stageTypeSelect.value,
      startFrom: rangeFields.startFrom.value,
      startTo: rangeFields.startTo.value,
      endFrom: rangeFields.endFrom.value,
      endTo: rangeFields.endTo.value,
      idMin: rangeFields.idMin.value === '' ? null : Number(rangeFields.idMin.value),
      idMax: rangeFields.idMax.value === '' ? null : Number(rangeFields.idMax.value)
    };
  }

  function conditionCount(conditions) {
    return conditions.positive.length
      + conditions.negative.length
      + conditions.statuses.length
      + conditions.types.length
      + conditions.gacha.length
      + conditions.duration.length
      + conditions.features.length
      + conditions.relative.length
      + [conditions.startFrom, conditions.startTo, conditions.endFrom, conditions.endTo, conditions.idMin, conditions.idMax].filter(value => value !== '' && value != null).length
      + (conditions.stageType ? 1 : 0)
      + (conditions.extraTag ? 1 : 0);
  }

  function updateSectionVisibility() {
    document.querySelectorAll('.gatya-section').forEach(section => {
      const hasMatch = Array.from(section.querySelectorAll('.event-card')).some(card => !card.classList.contains('advanced-filter-hidden'));
      section.classList.toggle('advanced-filter-section-hidden', !hasMatch);
    });

    const allContent = document.getElementById('all');
    if (allContent) {
      const headers = Array.from(allContent.querySelectorAll('.all-section-header'));
      const cards = Array.from(allContent.querySelectorAll('.event-card'));
      headers.forEach((header, index) => {
        const nextHeader = headers[index + 1];
        const hasMatch = cards.some(card => {
          const afterHeader = header.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING;
          const beforeNext = !nextHeader || (nextHeader.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING);
          return afterHeader && beforeNext && !card.classList.contains('advanced-filter-hidden');
        });
        header.classList.toggle('advanced-filter-section-hidden', !hasMatch);
      });
    }

    document.querySelectorAll('.list-card-wrap').forEach(wrap => {
      const card = wrap.querySelector('.event-card');
      wrap.classList.toggle('advanced-filter-empty-wrap', Boolean(card?.classList.contains('advanced-filter-hidden')));
    });
  }

  function discoverExtraTags() {
    const tags = Array.from(document.querySelectorAll('.event-card .stage-tag'), tag => tag.textContent.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'ja'));
    const unique = [...new Set(tags)];
    const signature = unique.join('\n');
    if (signature === knownExtraTags) return;
    knownExtraTags = signature;
    const selected = extraTagSelect.value;
    extraTagSelect.replaceChildren(new Option('すべて', ''));
    unique.forEach(tag => extraTagSelect.add(new Option(tag, tag)));
    if (unique.includes(selected)) extraTagSelect.value = selected;
    if (extraTagSelect.dataset.restoreValue && unique.includes(extraTagSelect.dataset.restoreValue)) {
      extraTagSelect.value = extraTagSelect.dataset.restoreValue;
      delete extraTagSelect.dataset.restoreValue;
    }
  }

  function discoverStageTypes() {
    const types = window.KBCSearchBridge?.getStageTypes?.() || [];
    const signature = types.map(entry => `${entry.type}:${entry.from}-${entry.to}`).join('|');
    if (!signature || signature === knownStageTypes) return;
    knownStageTypes = signature;
    const selected = stageTypeSelect.value;
    stageTypeSelect.replaceChildren(new Option('ステージ分類: すべて', ''));
    types.forEach(entry => {
      stageTypeSelect.add(new Option(`${entry.type} (${entry.from}～${entry.to})`, entry.type));
    });
    if (types.some(entry => entry.type === selected)) stageTypeSelect.value = selected;
  }

  function describeConditions(conditions) {
    const parts = [];
    const clauseLabel = clause => `${clause.field ? `${clause.field}:` : ''}${clause.term}`;
    if (conditions.positive.length) parts.push(`検索: ${conditions.positive.map(clauseLabel).join(', ')}`);
    if (conditions.negative.length) parts.push(`除外: ${conditions.negative.map(clauseLabel).join(', ')}`);
    if (conditions.statuses.length) parts.push(`状態: ${conditions.statuses.join(', ')}`);
    if (conditions.types.length) parts.push(`種類: ${conditions.types.join(', ')}`);
    if (conditions.gacha.length) parts.push(`ガチャ: ${conditions.gacha.join(', ')}`);
    if (conditions.stageType) parts.push(`ステージ分類: ${conditions.stageType}`);
    if (conditions.duration.length) parts.push(`期間: ${conditions.duration.join(', ')}`);
    if (conditions.features.length) parts.push(`特徴: ${conditions.features.length}件`);
    if (conditions.relative.length) parts.push(`近日: ${conditions.relative.length}件`);
    if (conditions.extraTag) parts.push(`追加タグ: ${conditions.extraTag}`);
    if (conditions.startFrom || conditions.startTo) parts.push(`開始: ${conditions.startFrom || '指定なし'}～${conditions.startTo || '指定なし'}`);
    if (conditions.endFrom || conditions.endTo) parts.push(`終了: ${conditions.endFrom || '指定なし'}～${conditions.endTo || '指定なし'}`);
    if (conditions.idMin != null || conditions.idMax != null) parts.push(`ID: ${conditions.idMin ?? '指定なし'}～${conditions.idMax ?? '指定なし'}`);
    return parts.join(' / ') || '条件なし';
  }

  function saveState() {
    const state = {
      query: queryInput.value,
      mode: queryMode.value,
      scope: queryScope.value,
      status: selectedValues('status'),
      type: selectedValues('type'),
      gacha: selectedValues('gacha'),
      duration: selectedValues('duration'),
      feature: selectedValues('feature'),
      relative: selectedValues('relative'),
      extraTag: extraTagSelect.value,
      stageType: stageTypeSelect.value,
      sort: sortSelect.value,
      ranges: Object.fromEntries(Object.entries(rangeFields).map(([key, field]) => [key, field.value])),
      collapsed: panel.classList.contains('is-collapsed')
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function applyFilters() {
    pendingFrame = 0;
    discoverExtraTags();
    discoverStageTypes();
    const conditions = readConditions();
    const activeCount = conditionCount(conditions);
    let total = 0;
    let matched = 0;

    TARGET_CONTENT_IDS.forEach(id => {
      document.getElementById(id)?.querySelectorAll('.event-card').forEach(card => {
        total += 1;
        const matches = cardMatches(card, conditions);
        if (matches) matched += 1;
        card.classList.toggle('advanced-filter-hidden', !matches);
        card.classList.toggle('advanced-filter-card-match', matches && activeCount > 0);
      });
    });

    updateSectionVisibility();
    panel.classList.toggle('is-active', activeCount > 0);
    badge.textContent = String(activeCount);
    descriptionDisplay.textContent = describeConditions(conditions);

    const activeContent = document.querySelector('.content.active');
    if (activeContent && TARGET_CONTENT_IDS.includes(activeContent.id)) {
      const activeCards = Array.from(activeContent.querySelectorAll('.event-card'));
      const visible = activeCards.filter(card => !card.classList.contains('advanced-filter-hidden')).length;
      countDisplay.textContent = `${visible} / ${activeCards.length}件を表示`;
    } else {
      countDisplay.textContent = total ? `全体 ${matched} / ${total}件が一致` : 'カード待機中';
    }
    saveState();
  }

  function scheduleApply() {
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(applyFilters);
  }

  function resetFilters(keepQueryMode = false) {
    queryInput.value = '';
    if (!keepQueryMode) {
      queryMode.value = 'all';
      queryScope.value = 'all';
    }
    ['status', 'type', 'gacha', 'duration', 'feature', 'relative'].forEach(group => setSelectedValues(group, []));
    setSelectedValues('status', ['予定']);
    extraTagSelect.value = '';
    stageTypeSelect.value = '';
    Object.values(rangeFields).forEach(field => { field.value = ''; });
    sortSelect.value = 'default';
    syncLegacySort();
    document.querySelectorAll('.advanced-filter-preset').forEach(button => button.classList.remove('is-selected'));
  }

  function applyPreset(name, button) {
    resetFilters(true);
    const presets = {
      current: { status: ['開催中'] },
      within: { status: ['期間内'] },
      future: { status: ['予定'] },
      permanent: { duration: ['permanent'] },
      'ending-soon': { relative: ['ends-3d'] },
      'starting-soon': { relative: ['starts-3d'] },
      guaranteed: { type: ['gatya'], feature: ['guaranteed'] },
      'event-guaranteed': { type: ['gatya'], gacha: ['イベント'], feature: ['event-guaranteed'] },
      unknown: { feature: ['unknown'] },
      'one-time': { feature: ['one-time'] }
    };
    const preset = presets[name] || {};
    Object.entries(preset).forEach(([group, values]) => setSelectedValues(group, values));
    document.querySelectorAll('.advanced-filter-preset').forEach(item => item.classList.toggle('is-selected', item === button));
    scheduleApply();
  }

  function restoreState() {
    resetFilters(false);
    panel.classList.remove('is-collapsed');
    document.getElementById('advanced-filter-collapse').textContent = '⌃';
  }

  panel.addEventListener('input', event => {
    if (event.target.matches('input, select')) {
      document.querySelectorAll('.advanced-filter-preset').forEach(button => button.classList.remove('is-selected'));
      scheduleApply();
    }
  });
  panel.addEventListener('change', scheduleApply);
  document.getElementById('advanced-filter-reset').addEventListener('click', () => {
    resetFilters();
    scheduleApply();
    queryInput.focus();
  });
  const helpOverlay = document.getElementById('advanced-filter-help');
  document.getElementById('advanced-filter-help-open').addEventListener('click', () => {
    helpOverlay.classList.add('show');
    document.body.classList.add('overlay-open');
  });
  document.getElementById('advanced-filter-help-close').addEventListener('click', () => {
    helpOverlay.classList.remove('show');
    document.body.classList.remove('overlay-open');
  });
  helpOverlay.addEventListener('click', event => {
    if (event.target === helpOverlay) {
      helpOverlay.classList.remove('show');
      document.body.classList.remove('overlay-open');
    }
  });
  document.getElementById('advanced-filter-collapse').addEventListener('click', event => {
    panel.classList.toggle('is-collapsed');
    event.currentTarget.textContent = panel.classList.contains('is-collapsed') ? '⌄' : '⌃';
    saveState();
  });
  document.getElementById('advanced-filter-presets').addEventListener('click', event => {
    const button = event.target.closest('[data-preset]');
    if (button) applyPreset(button.dataset.preset, button);
  });
  document.getElementById('advanced-filter-query-tools').addEventListener('click', event => {
    const button = event.target.closest('[data-query-token]');
    if (!button) return;
    const token = button.dataset.queryToken;
    const start = queryInput.selectionStart ?? queryInput.value.length;
    const end = queryInput.selectionEnd ?? start;
    const before = queryInput.value.slice(0, start);
    const after = queryInput.value.slice(end);
    const spacer = before && !/\s$/.test(before) ? ' ' : '';
    queryInput.value = `${before}${spacer}${token}${after}`;
    const cursor = before.length + spacer.length + token.length;
    queryInput.focus();
    queryInput.setSelectionRange(cursor, cursor);
    scheduleApply();
  });
  sortSelect.addEventListener('change', () => syncLegacySort());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && helpOverlay.classList.contains('show')) {
      helpOverlay.classList.remove('show');
      document.body.classList.remove('overlay-open');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      panel.classList.remove('is-collapsed');
      document.getElementById('advanced-filter-collapse').textContent = '⌃';
      queryInput.focus();
      queryInput.select();
    }
  });
  document.querySelector('.tabs')?.addEventListener('click', () => setTimeout(scheduleApply, 0));
  document.querySelector('.controls')?.addEventListener('change', () => setTimeout(scheduleApply, 0));
  window.addEventListener('kbc:search-bridge-ready', scheduleApply);

  const observer = new MutationObserver(() => {
    if (extraTagSelect.dataset.restoreValue && extraTagSelect.options.length > 1) {
      extraTagSelect.value = extraTagSelect.dataset.restoreValue;
      delete extraTagSelect.dataset.restoreValue;
    }
    scheduleApply();
  });
  TARGET_CONTENT_IDS.forEach(id => {
    const content = document.getElementById(id);
    if (content) observer.observe(content, { childList: true, subtree: true, characterData: true });
  });

  restoreState();
  scheduleApply();
  window.KBCAdvancedFilter = {
    apply: scheduleApply,
    reset: resetFilters,
    inspect: card => cardData(card),
  };
})();
