(function () {
  'use strict';

  // HDO / nízký tarif. Extrahováno z app.js (fáze B). Stav přes deps.getState()
  // (živá reference). Dashboard widget (getHdoStatus, getHdoHeroPresentation) zůstává
  // volatelný z app.js přes wrappery. Sdílené time-utily (timeToMinutes, isTimeInWindow,
  // humanDuration, daysLabel, toSafeDate, isCzechPublicHolidayDate) se předávají přes deps.
  function createHdo(deps) {
    const getState = deps.getState || (() => ({}));
    const getNow = deps.getNow || (() => new Date());
    const getModuleTab = deps.getModuleTab || ((area, fallback) => fallback);
    const setModuleTab = deps.setModuleTab || (() => {});
    const renderSectionTabs = deps.renderSectionTabs || (() => '');
    const escapeHtml = deps.escapeHtml || ((v) => String(v ?? ''));
    const normalizeText = deps.normalizeText || ((v) => String(v || '').trim());
    const uid = deps.uid || (() => Math.random().toString(36).slice(2));
    const field = deps.field || (() => '');
    const selectField = deps.selectField || (() => '');
    const renderEmptyCta = deps.renderEmptyCta || (() => '');
    const showToast = deps.showToast || (() => {});
    const saveState = deps.saveState || (() => {});
    const render = deps.render || (() => {});
    const requestRender = deps.requestRender || render;
    const touchState = deps.touchState || (() => {});
    const currentHouseholdId = deps.currentHouseholdId || (() => '');
    const currentProfileId = deps.currentProfileId || (() => '');
    const toSafeDate = deps.toSafeDate || ((v, f) => f || null);
    const timeToMinutes = deps.timeToMinutes || (() => null);
    const isTimeInWindow = deps.isTimeInWindow || (() => false);
    const humanDuration = deps.humanDuration || ((m) => `${m} min`);
    const daysLabel = deps.daysLabel || (() => '');
    const isCzechPublicHolidayDate = deps.isCzechPublicHolidayDate || (() => false);
    const daysModeToArray = deps.daysModeToArray || (() => []);
    const getSupabaseClient = deps.getSupabaseClient || (() => null);
    const refreshCloudSession = deps.refreshCloudSession || (async () => null);

    function hdoTimeField(label, name, placeholder = '06:00', required = false, value = '') {
      const inputId = `field-${name}-${Math.random().toString(36).slice(2, 7)}`;
      return `
        <div class="field">
          <label for="${inputId}">${escapeHtml(label)}</label>
          <input class="input" id="${inputId}" name="${name}" type="text" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" ${required ? 'required' : ''} inputmode="numeric" pattern="[0-9:]*" autocomplete="off" data-hdo-time-input>
        </div>
      `;
    }

    function hdoAppliesToNormalDays(item) {
      const days = sanitizeHdoDays(item?.days);
      return days.some((day) => day >= 1 && day <= 5);
    }

    function hdoAppliesToWeekendHoliday(item) {
      const days = sanitizeHdoDays(item?.days);
      return days.includes(0) || days.includes(6);
    }

    function renderHdoOverviewTable(title, subtitle, rows = []) {
      const cleanRows = sortHdoWindowsForOverview(rows);
      return `
        <div class="hdo-overview-table-card">
          <div class="hdo-overview-table-head">
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(subtitle)}</span>
          </div>
          ${cleanRows.length ? `
            <div class="hdo-overview-table" role="table" aria-label="${escapeHtml(title)}">
              <div class="hdo-overview-table-row hdo-overview-table-row-head" role="row">
                <span role="columnheader">Čas</span>
                <span role="columnheader">Název</span>
                <span role="columnheader">Stav</span>
              </div>
              ${cleanRows.map((item) => {
                const isValidTime = timeToMinutes(item.start) !== null && timeToMinutes(item.end) !== null;
                return `
                  <div class="hdo-overview-table-row" role="row">
                    <span role="cell"><strong>${escapeHtml(isValidTime ? hdoWindowTimeLabel(item) : 'zkontrolovat')}</strong></span>
                    <span role="cell">${escapeHtml(item.label || 'HDO okno')}</span>
                    <span role="cell"><em class="hdo-overview-state ${item.enabled && isValidTime ? 'good' : 'warn'}">${item.enabled && isValidTime ? 'aktivní' : item.enabled ? 'čas?' : 'vypnuto'}</em></span>
                  </div>`;
              }).join('')}
            </div>` : `<div class="inline-note compact-note">Pro tuhle skupinu není nastavené žádné okno.</div>`}
        </div>`;
    }

    function renderHdoOverviewTables(rows = []) {
      const safeRows = getSafeHdoWindows().length ? rows : [];
      const normalRows = safeRows.filter(hdoAppliesToNormalDays);
      const weekendRows = safeRows.filter(hdoAppliesToWeekendHoliday);
      return `
        <div class="hdo-overview-table-grid">
          ${renderHdoOverviewTable('Normální dny', 'Po–Pá', normalRows)}
          ${renderHdoOverviewTable('Víkend + svátky', 'Sobota, neděle a české svátky', weekendRows)}
        </div>`;
    }

    function renderHdoModuleTable(title, subtitle, rows = []) {
      const cleanRows = sortHdoWindowsForOverview(rows);
      return `
        <div class="hdo-overview-table-card hdo-module-table-card">
          <div class="hdo-overview-table-head">
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(subtitle)}</span>
          </div>
          ${cleanRows.length ? `<div class="list hdo-module-list">${cleanRows.map((item) => `
            <div class="item hdo-module-row">
              <div class="item-top"><div class="item-title">${escapeHtml(item.label)}</div><span class="badge ${item.enabled ? 'good' : ''}">${item.enabled ? 'aktivní' : 'vypnuto'}</span></div>
              <div class="item-meta">${escapeHtml(item.start)}–${escapeHtml(item.end)} · ${escapeHtml(daysLabel(item.days))}${item.cloudId ? ' · cloud' : ' · lokálně'}</div>
              <div class="item-actions"><button class="ghost-btn" type="button" data-action="toggle-hdo" data-id="${item.id}">${item.enabled ? 'Vypnout' : 'Zapnout'}</button><button class="danger-btn" type="button" data-action="delete-hdo" data-id="${item.id}">Smazat</button></div>
            </div>`).join('')}</div>` : `<div class="inline-note compact-note">Pro tuhle skupinu není nastavené žádné okno.</div>`}
        </div>`;
    }

    function renderHdoModuleTables(rows = []) {
      const safeRows = getSafeHdoWindows().length ? rows : [];
      const normalRows = safeRows.filter(hdoAppliesToNormalDays);
      const weekendRows = safeRows.filter(hdoAppliesToWeekendHoliday);
      return `
        <div class="hdo-overview-table-grid hdo-module-table-grid">
          ${renderHdoModuleTable('Normální dny', 'Po–Pá', normalRows)}
          ${renderHdoModuleTable('Víkend + svátky', 'Sobota, neděle a české svátky', weekendRows)}
        </div>`;
    }

    function getHdoHeroPresentation(ctx, options = {}) {
      const safeDate = toSafeDate(getNow(), new Date());
      const minuteNow = safeDate.getHours() * 60 + safeDate.getMinutes();
      const extraLimit = options.density === 'large' ? 5 : options.density === 'medium' ? 2 : 0;
      const allEnabled = getSafeHdoWindows().filter((entry) => entry.enabled && timeToMinutes(entry.start) !== null && timeToMinutes(entry.end) !== null);
      const enabledToday = allEnabled.filter((entry) => hdoWindowMatchesDate(entry, safeDate));
      const enabled = enabledToday.length ? enabledToday : allEnabled;
      const extraRows = extraLimit ? sortHdoWindowsForOverview(enabled).slice(0, extraLimit).map((entry) => hdoWindowTimeLabel(entry)) : [];
      const active = enabledToday.find((entry) => isTimeInWindow(minuteNow, entry.start, entry.end));
      if (active) {
        const endMinutes = timeToMinutes(active.end);
        let diff = endMinutes - minuteNow;
        if (diff <= 0) diff += 1440;
        return {
          metric: 'Běží',
          text: `do ${active.end}`,
          detail: `ještě ${humanDuration(diff)}`,
          chips: [daysLabel(active.days)],
          extraRows,
          tone: 'good'
        };
      }
      const next = findNextHdoWindow(safeDate);
      if (next) {
        return {
          metric: `za ${humanDuration(next.diffMinutes)}`,
          text: hdoWindowTimeLabel(next.item),
          detail: '',
          chips: [daysLabel(next.item.days)],
          extraRows,
          tone: 'warn'
        };
      }
      return { metric: '—', text: 'HDO není nastavené', detail: 'Přidej okna nízkého tarifu', chips: [], extraRows: [], tone: 'neutral' };
    }

    function hdoWindowMatchesDate(item, date) {
      const safeDate = toSafeDate(date, new Date());
      if (!safeDate || !Number.isFinite(safeDate.getTime())) return false;
      const days = sanitizeHdoDays(item?.days);
      if (days.includes(safeDate.getDay())) return true;
      const isHoliday = isCzechPublicHolidayDate(safeDate);
      const hasWeekend = days.includes(0) || days.includes(6);
      return isHoliday && hasWeekend;
    }

    function getHdoStatus(date) {
      const safeDate = toSafeDate(date, new Date());
      if (!safeDate || !Number.isFinite(safeDate.getTime())) {
        return { active: false, label: 'není nastaveno', message: 'HDO se teď nepovedlo spočítat. Zkontroluj časová okna.' };
      }
      const day = safeDate.getDay();
      const minutesNow = safeDate.getHours() * 60 + safeDate.getMinutes();
      const enabled = getSafeHdoWindows().filter((item) => item.enabled && hdoWindowMatchesDate(item, safeDate) && timeToMinutes(item.start) !== null && timeToMinutes(item.end) !== null);
      const active = enabled.find((item) => isTimeInWindow(minutesNow, item.start, item.end));
      if (active) {
        return {
          active: true,
          label: active.label,
          activeStart: active.start,
          activeEnd: active.end,
          message: `Právě běží ${active.label} (${hdoWindowTimeLabel(active)}).`
        };
      }
      const next = findNextHdoWindow(safeDate);
      if (!next) return { active: false, label: 'není nastaveno', message: 'Není nastavené žádné aktivní HDO okno.' };
      return {
        active: false,
        label: next.item.label,
        message: `Další nízký tarif: ${next.item.label} za ${humanDuration(next.diffMinutes)} (${hdoWindowTimeLabel(next.item)}).`,
        nextLabel: next.item.label,
        nextStart: next.item.start,
        nextEnd: next.item.end,
        nextInMinutes: next.diffMinutes,
        nextInLabel: `za ${humanDuration(next.diffMinutes)}`
      };
    }

    function sanitizeHdoDays(days) {
      if (!Array.isArray(days)) return [];
      return [...new Set(days.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
    }

    function normalizeHdoWindowView(item) {
      if (!item || typeof item !== 'object') return null;
      const start = normalizeHdoTimeInput(item.start || item.start_time || item.from || '');
      const end = normalizeHdoTimeInput(item.end || item.end_time || item.to || '');
      return {
        ...item,
        label: normalizeText(item.label || item.title || 'HDO okno') || 'HDO okno',
        start,
        end,
        days: sanitizeHdoDays(item.days),
        enabled: item.enabled !== false && item.is_enabled !== false
      };
    }

    function getSafeHdoWindows() {
      return (Array.isArray(getState().hdoWindows) ? getState().hdoWindows : [])
        .map(normalizeHdoWindowView)
        .filter(Boolean);
    }

    function hdoWindowSortWeight(item) {
      const days = sanitizeHdoDays(item?.days);
      const hasWorkday = days.some((day) => day >= 1 && day <= 5);
      const hasWeekend = days.some((day) => day === 0 || day === 6);
      if (hasWorkday && !hasWeekend) return 0;
      if (hasWorkday && hasWeekend) return 1;
      if (hasWeekend) return 2;
      return 3;
    }

    function sortHdoWindowsForOverview(rows = []) {
      return [...rows].sort((a, b) => {
        const groupDiff = hdoWindowSortWeight(a) - hdoWindowSortWeight(b);
        if (groupDiff) return groupDiff;
        const timeDiff = (timeToMinutes(a?.start) ?? 9999) - (timeToMinutes(b?.start) ?? 9999);
        if (timeDiff) return timeDiff;
        return String(a?.label || '').localeCompare(String(b?.label || ''), 'cs');
      });
    }

    function hdoWindowTimeLabel(item) {
      const start = item?.start || '—';
      const end = item?.end || '—';
      return `${start}–${end}`;
    }

    function findNextHdoWindow(date) {
      const base = toSafeDate(date, new Date());
      if (!base || !Number.isFinite(base.getTime())) return null;
      const windows = getSafeHdoWindows().filter((item) => item.enabled && item.days.length);
      if (!windows.length) return null;
      const candidates = [];
      windows.forEach((item) => {
        const startMinutes = timeToMinutes(item.start);
        if (startMinutes === null) return;
        for (let offset = 0; offset <= 7; offset += 1) {
          const candidate = new Date(base);
          candidate.setDate(base.getDate() + offset);
          if (!hdoWindowMatchesDate(item, candidate)) continue;
          candidate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
          const diffMinutes = Math.round((candidate.getTime() - base.getTime()) / 60000);
          if (Number.isFinite(diffMinutes) && diffMinutes > 0) candidates.push({ item, diffMinutes });
        }
      });
      return candidates.sort((a, b) => a.diffMinutes - b.diffMinutes)[0] || null;
    }

    function cloudHdoDaysToDb(days) {
      const list = Array.isArray(days) ? days : [];
      return list.map((day) => Number(day) === 0 ? 7 : Number(day)).filter((day) => day >= 1 && day <= 7);
    }

    function cloudHdoDaysFromDb(days) {
      const list = Array.isArray(days) ? days : [];
      return list.map((day) => Number(day) === 7 ? 0 : Number(day)).filter((day) => day >= 0 && day <= 6);
    }

    async function ensureCloudHdoSetting() {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return null;
      const user = await refreshCloudSession(false);
      if (!user) return null;
      if (getState().hdoCloud?.settingId) return getState().hdoCloud.settingId;
      const payload = {
        household_id: getState().cloud.householdId,
        title: 'HDO / nízký tarif',
        created_by: user.id,
        updated_by: user.id
      };
      const { data, error } = await client
        .from('hdo_settings')
        .upsert(payload, { onConflict: 'household_id' })
        .select('id')
        .single();
      if (error) {
        showToast(error.message || 'Nastavení HDO se nepovedlo založit v cloudu');
        return null;
      }
      getState().hdoCloud = { ...(getState().hdoCloud || {}), settingId: data.id, loadedAt: new Date().toISOString() };
      return data.id;
    }

    function cloudHdoPayload(item, settingId, userId) {
      return {
        household_id: getState().cloud.householdId,
        setting_id: settingId,
        label: item.label || null,
        days: cloudHdoDaysToDb(item.days),
        start_time: item.start || '00:00',
        end_time: item.end || '00:00',
        is_enabled: item.enabled !== false,
        source: 'manual',
        created_by: item.cloudId ? undefined : userId,
        updated_by: userId
      };
    }

    async function cloudAddHdoWindow(item) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return null;
      const user = await refreshCloudSession(false);
      if (!user) return null;
      const settingId = await ensureCloudHdoSetting();
      if (!settingId) return null;
      const payload = cloudHdoPayload(item, settingId, user.id);
      const { data, error } = await client.from('hdo_windows').insert(payload).select('id').single();
      if (error) {
        showToast(error.message || 'HDO okno se nepovedlo uložit do cloudu');
        return null;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return data;
    }

    async function cloudUpdateHdoWindow(item) {
      const client = getSupabaseClient();
      if (!client || !item?.cloudId || !getState().cloud?.householdId) return true;
      const user = await refreshCloudSession(false);
      if (!user) return false;
      const settingId = await ensureCloudHdoSetting();
      if (!settingId) return false;
      const payload = cloudHdoPayload(item, settingId, user.id);
      delete payload.created_by;
      const { error } = await client.from('hdo_windows').update(payload).eq('id', item.cloudId).eq('household_id', getState().cloud.householdId);
      if (error) {
        showToast(error.message || 'HDO okno se nepovedlo aktualizovat v cloudu');
        return false;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return true;
    }

    async function cloudDeleteHdoWindow(item) {
      const client = getSupabaseClient();
      if (!client || !item?.cloudId || !getState().cloud?.householdId) return true;
      const { error } = await client.from('hdo_windows').delete().eq('id', item.cloudId).eq('household_id', getState().cloud.householdId);
      if (error) {
        showToast(error.message || 'HDO okno se nepovedlo smazat z cloudu');
        return false;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return true;
    }

    async function cloudLoadHdoData(showMessage = true) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) {
        if (showMessage) showToast('Nejdřív napoj domácnost na cloud');
        return;
      }
      const { data: settings, error: settingsError } = await client
        .from('hdo_settings')
        .select('id,title,note')
        .eq('household_id', getState().cloud.householdId)
        .maybeSingle();
      if (settingsError) {
        showToast(settingsError.message || 'HDO nastavení se nepovedlo načíst');
        return;
      }
      if (settings?.id) {
        getState().hdoCloud = {
          ...(getState().hdoCloud || {}),
          settingId: settings.id,
          loadedAt: new Date().toISOString()
        };
      }
      const { data, error } = await client
        .from('hdo_windows')
        .select('id,label,days,start_time,end_time,is_enabled')
        .eq('household_id', getState().cloud.householdId)
        .order('start_time', { ascending: true });
      if (error) {
        showToast(error.message || 'HDO okna se nepovedlo načíst');
        return;
      }
      const localOnly = getState().hdoWindows.filter((item) => !item.cloudId);
      const cloudItems = (data || []).map((item) => ({
        id: `hdo-cloud-${item.id}`,
        cloudId: item.id,
        householdId: getState().household.id,
        profileId: currentProfileId(),
        label: item.label || 'HDO okno',
        start: String(item.start_time || '').slice(0, 5),
        end: String(item.end_time || '').slice(0, 5),
        days: cloudHdoDaysFromDb(item.days),
        enabled: item.is_enabled !== false,
        createdAt: new Date().toISOString()
      }));
      getState().hdoWindows = [...cloudItems, ...localOnly];
      getState().cloud.lastSyncAt = new Date().toISOString();
      touchState();
      saveState();
      render();
      if (showMessage) showToast(`Načteno HDO oken: ${cloudItems.length}`);
    }

    async function cloudSyncHdoById(id) {
      const item = getState().hdoWindows.find((entry) => entry.id === id);
      if (!item) return;
      const saved = item.cloudId ? await cloudUpdateHdoWindow(item) : await cloudAddHdoWindow(item);
      if (saved?.id) item.cloudId = saved.id;
      touchState();
      saveState();
      render();
      showToast(item.cloudId ? 'HDO uloženo do cloudu' : 'HDO se nepovedlo odeslat');
    }

    async function cloudSyncLocalHdo() {
      const local = getState().hdoWindows.filter((item) => !item.cloudId);
      let synced = 0;
      for (const item of local) {
        const saved = await cloudAddHdoWindow(item);
        if (saved?.id) {
          item.cloudId = saved.id;
          synced += 1;
        }
      }
      touchState();
      saveState();
      render();
      showToast(synced ? `Odesláno HDO oken: ${synced}` : 'Žádné HDO se nepovedlo odeslat');
    }

    function normalizeHdoTimeInput(value) {
      const raw = normalizeText(value).replace(/\s+/g, '');
      if (!raw) return '';
      const colon = raw.match(/^(\d{1,2}):(\d{1,2})$/);
      if (colon) {
        const h = Number(colon[1]);
        const m = Number(colon[2]);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
      const digits = raw.replace(/\D/g, '');
      if (digits.length === 3 || digits.length === 4) {
        const h = Number(digits.slice(0, -2));
        const m = Number(digits.slice(-2));
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
      if (digits.length <= 2) {
        const h = Number(digits);
        if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:00`;
      }
      return '';
    }

    function formatHdoTimeInputLive(input, event = {}) {
      if (!input) return;
      const raw = String(input.value || '');
      if (!raw) return;
      if (raw.includes(':')) {
        const [h = '', m = ''] = raw.split(':');
        input.value = `${h.replace(/\D/g, '').slice(0, 2)}:${m.replace(/\D/g, '').slice(0, 2)}`;
        return;
      }
      const digits = raw.replace(/\D/g, '').slice(0, 4);
      if (!digits) {
        input.value = '';
        return;
      }
      if (digits.length === 2 && !String(event.inputType || '').startsWith('delete')) {
        input.value = `${digits}:`;
        return;
      }
      if (digits.length > 2) {
        input.value = `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
        return;
      }
      input.value = digits;
    }

    function normalizeHdoTimeInputOnBlur(input) {
      if (!input) return;
      const normalized = normalizeHdoTimeInput(input.value);
      if (normalized) input.value = normalized;
    }

    async function addHdoWindowFromForm(data, form) {
      const start = normalizeHdoTimeInput(data.start);
      const end = normalizeHdoTimeInput(data.end);
      if (!start || !end) return showToast('Zadej čas HDO jako 0600 nebo 06:00');
      const item = {
        id: uid(),
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        label: normalizeText(data.label),
        start,
        end,
        days: daysModeToArray(data.daysMode),
        enabled: true
      };
      getState().hdoWindows.push(item);
      touchState();
      saveState();
      form?.reset();
      render();
      showToast('HDO okno uloženo');
      cloudAddHdoWindow(item).then((saved) => {
        if (saved?.id) { item.cloudId = saved.id; saveState(); requestRender(); }
      }).catch((error) => console.warn('Cloud sync (HDO) na pozadí selhal', error));
    }

    async function toggleHdoWindow(id) {
      const item = getState().hdoWindows.find((entry) => entry.id === id);
      if (!item) return;
      item.enabled = !item.enabled;
      touchState();
      saveState();
      render();
      cloudUpdateHdoWindow(item).then((ok) => {
        if (!ok) {
          item.enabled = !item.enabled;
          touchState();
          saveState();
          requestRender();
        }
      }).catch((error) => console.warn('Cloud sync (HDO toggle) na pozadí selhal', error));
    }

    async function deleteHdoWindow(id) {
      const item = getState().hdoWindows.find((entry) => entry.id === id);
      if (!item) return;
      getState().hdoWindows = getState().hdoWindows.filter((entry) => entry.id !== id);
      touchState();
      saveState();
      render();
      showToast('HDO okno smazáno');
      cloudDeleteHdoWindow(item).catch((error) => console.warn('Cloud sync (smazání HDO) na pozadí selhal', error));
    }

    // Panel HDO pro renderHomecare (fast i main path měly identický obsah).
    function renderHdoAddForm() {
      const S = getState();
      return `
        <form data-form="add-hdo" class="compact-form hdo-manual-form">
          <div class="form-grid two">
            ${field('Název okna', 'label', 'text', 'např. Večerní tarif', true)}
            ${hdoTimeField('Od', 'start', '0600 nebo 06:00', true)}
            ${hdoTimeField('Do', 'end', '2200 nebo 22:00', true)}
            ${selectField('Dny', 'daysMode', [['all', 'Každý den'], ['workdays', 'Po–Pá'], ['weekend', 'Víkend']])}
          </div>
          <div class="form-actions"><button class="primary-btn" type="submit">Přidat HDO okno</button></div>
        </form>
      `;
    }

    function renderHdoPanel() {
      const S = getState();
      const hdo = getHdoStatus(getNow());
      const activeTab = getModuleTab('hdo', 'overview');
      const tabs = renderSectionTabs('hdo', [
        { id: 'overview', label: 'Přehled', icon: '💡', count: S.hdoWindows.length },
        { id: 'add', label: 'Přidat čas', icon: '➕' }
      ], 'overview');
      return `
        <section class="card homecare-panel panel-hdo">
          <div class="card-header">
            <div><h2>HDO / nízký tarif</h2><p>${escapeHtml(hdo.message)}</p></div>
            <span class="badge ${hdo.active ? 'good' : 'warn'}">${hdo.active ? 'běží' : 'neběží'} · ${S.hdoWindows.some((item) => item.cloudId) ? 'cloud' : 'lokálně'}</span>
          </div>
          ${tabs}
          <div class="module-tabbed hdo-tab-${escapeHtml(activeTab)}" data-tab-area="hdo">
            ${activeTab === 'add' ? renderHdoAddForm() : (S.hdoWindows.length ? renderHdoModuleTables(sortHdoWindowsForOverview(getSafeHdoWindows())) : renderEmptyCta({ icon: '💡', title: 'HDO není nastavené', text: 'Zadej časová okna nízkého tarifu a dashboard začne ukazovat aktuální stav.', nav: 'hdo', tab: 'add', label: 'Nastavit HDO' }))}
          </div>
        </section>`;
    }

    return {
      // dashboard / status
      getHdoStatus,
      getHdoHeroPresentation,
      getSafeHdoWindows,
      sortHdoWindowsForOverview,
      findNextHdoWindow,
      sanitizeHdoDays,
      // render
      renderHdoOverviewTables,
      renderHdoModuleTables,
      renderHdoPanel,
      // time input helpers
      normalizeHdoTimeInput,
      formatHdoTimeInputLive,
      normalizeHdoTimeInputOnBlur,
      // cloud
      cloudLoadHdoData,
      cloudSyncHdoById,
      cloudSyncLocalHdo,
      // handlery
      addHdoWindowFromForm,
      toggleHdoWindow,
      deleteHdoWindow
    };
  }

  window.DomacnostHdo = { createHdo };
})();
