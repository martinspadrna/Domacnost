(function () {
  'use strict';

  // Kalendář: render + měsíční mřížka + event/dashboard helpery +
  // zdroje + CRUD událostí + cloud načtení (cloudLoadCalendar / cloudLoadCalendarSources)
  // + ICS/iCal sync bez dalsiho prihlaseni.
  // Realtime sync mezi zařízeními ZŮSTÁVÁ v app.js (generický kanál, ne kalendářový kód);
  //   - cloudLoadCalendar / cloudLoadCalendarSources: state.X -> getState().X, aby časování
  //     zápisu (state.calendar/calendarCloud -> saveState) zůstalo IDENTICKÉ –
  //     realtime reload v app.js je volá a sync mezi zařízeními se nesmí rozbít.
  function createCalendar(deps) {
    const getState = deps.getState || (() => ({}));
    const getNow = deps.getNow || (() => new Date());
    const getCalendarViewMonth = deps.getCalendarViewMonth || (() => new Date().toISOString().slice(0, 7));
    const getDetailsOpen = deps.getDetailsOpen || (() => false);
    const escapeHtml = deps.escapeHtml || ((v) => String(v ?? ''));
    const normalizeText = deps.normalizeText || ((v) => String(v || '').trim());
    const uid = deps.uid || (() => Math.random().toString(36).slice(2));
    const todayISO = deps.todayISO || (() => new Date().toISOString().slice(0, 10));
    const formatDate = deps.formatDate || ((v) => String(v || ''));
    const formatDateTime = deps.formatDateTime || ((v) => String(v || ''));
    const shortDateText = deps.shortDateText || ((v) => String(v || ''));
    const field = deps.field || (() => '');
    const selectField = deps.selectField || (() => '');
    const renderSectionTabs = deps.renderSectionTabs || (() => '');
    const renderEmpty = deps.renderEmpty || (() => '');
    const renderEmptyCta = deps.renderEmptyCta || (() => '');
    const getModuleTab = deps.getModuleTab || ((area, fallback) => fallback);
    const currentHouseholdId = deps.currentHouseholdId || (() => '');
    const currentProfileId = deps.currentProfileId || (() => '');
    const showToast = deps.showToast || (() => {});
    const saveState = deps.saveState || (() => {});
    const touchState = deps.touchState || (() => {});
    const render = deps.render || (() => {});
    const renderOverlays = deps.renderOverlays || render;
    const toSafeDate = deps.toSafeDate || ((v, f) => f || new Date());
    const addDaysIso = deps.addDaysIso || ((iso) => iso);
    const dateOffsetISO = deps.dateOffsetISO || (() => '');
    const localISODate = deps.localISODate || ((d) => new Date(d).toISOString().slice(0, 10));
    const czechPublicHolidayName = deps.czechPublicHolidayName || (() => '');
    const pragueOffsetForLocalDateTime = deps.pragueOffsetForLocalDateTime || (() => '+01:00');
    const getSupabaseClient = deps.getSupabaseClient || (() => null);
    const refreshCloudSession = deps.refreshCloudSession || (async () => null);
    const cloudReady = deps.cloudReady || (() => false);
    const runWhenUiQuiet = deps.runWhenUiQuiet || ((cb) => setTimeout(cb, 0));
    const requestRender = deps.requestRender || render;

    const DEFAULT_CALENDAR_EVENT_MINUTES = deps.DEFAULT_CALENDAR_EVENT_MINUTES || 60;
    const APP_TIME_ZONE = deps.APP_TIME_ZONE || 'Europe/Prague';
    const CALENDAR_AUTO_SYNC_MAX_AGE_MS = 30 * 60 * 1000;
    const CALENDAR_AUTO_SYNC_CHECK_MS = 30 * 60 * 1000;
    const CALENDAR_SOURCE_COLOR_OPTIONS = [
      ['#3b82f6', 'Modrá'],
      ['#8b5cf6', 'Fialová'],
      ['#ec4899', 'Růžová'],
      ['#ef4444', 'Červená'],
      ['#f97316', 'Oranžová'],
      ['#f59e0b', 'Žlutá'],
      ['#22c55e', 'Zelená'],
      ['#14b8a6', 'Tyrkysová'],
      ['#64748b', 'Šedá']
    ];

    let calendarAutoSyncTimer = null;
    let calendarAutoSyncRunning = false;
    let calendarDetailEventId = '';

    function getCalendarSources() {
      return Array.isArray(getState().calendarCloud?.sources) ? getState().calendarCloud.sources : [];
    }

    function normalizeCalendarSourceProvider(provider = '') {
      const value = String(provider || '').toLowerCase();
      if (['manual', 'family', 'work', 'ical', 'other'].includes(value)) return value;
      return 'manual';
    }

    function calendarSourceProviderLabel(provider = '') {
      const labels = {
        manual: 'Ruční',
        family: 'Rodinný',
        work: 'Práce',
        ical: 'iCal',
        other: 'Jiný'
      };
      return labels[normalizeCalendarSourceProvider(provider)] || 'Kalendář';
    }

    function calendarSourceIcon(provider = '') {
      const icons = { manual: '✍️', family: '👨‍👩‍👧', work: '🏭', ical: '📥', other: '📅' };
      return icons[normalizeCalendarSourceProvider(provider)] || '📅';
    }

    function calendarKey(value = '') {
      return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function normalizeCalendarUrl(value = '') {
      const text = String(value || '').trim();
      if (!text) return '';
      try {
        const url = new URL(text);
        url.hash = '';
        return url.toString();
      } catch (_) {
        return text;
      }
    }

    function normalizeCalendarSourceColor(value = '') {
      const color = String(value || '').trim().toLowerCase();
      const allowed = new Set(CALENDAR_SOURCE_COLOR_OPTIONS.map(([item]) => item));
      if (allowed.has(color)) return color;
      if (/^#[0-9a-f]{6}$/i.test(color)) return color;
      return CALENDAR_SOURCE_COLOR_OPTIONS[0][0];
    }

    function calendarSourceColorPicker(selected = '') {
      const current = normalizeCalendarSourceColor(selected || CALENDAR_SOURCE_COLOR_OPTIONS[0][0]);
      return `
        <div class="field calendar-color-field">
          <span>Barva</span>
          <div class="calendar-color-picker" role="radiogroup" aria-label="Barva kalendáře">
            ${CALENDAR_SOURCE_COLOR_OPTIONS.map(([color, label]) => `
              <label class="calendar-color-option" title="${escapeHtml(label)}">
                <input type="radio" name="color" value="${escapeHtml(color)}" ${color === current ? 'checked' : ''}>
                <span class="calendar-color-swatch" style="--calendar-source-color: ${escapeHtml(color)}"></span>
              </label>
            `).join('')}
          </div>
        </div>
      `;
    }

    function calendarSourceDedupeKeys(source = {}) {
      const normalized = mapCalendarSource(source);
      const keys = [];
      const add = (key) => {
        if (key && !keys.includes(key)) keys.push(key);
      };
      add(normalized.cloudId ? `cloud:${normalized.cloudId}` : '');
      add(normalized.id ? `id:${normalized.id}` : '');
      const provider = normalizeCalendarSourceProvider(normalized.provider);
      const providerCalendarId = normalizeCalendarUrl(normalized.providerCalendarId);
      if (providerCalendarId && provider === 'ical') add(`${provider}:${providerCalendarId}`);
      if (providerCalendarId) add(`url:${providerCalendarId}`);
      add(`${provider}:name:${calendarKey(normalized.name)}`);
      return keys;
    }

    function mapCalendarSource(row = {}) {
      return {
        id: row.id || row.cloudId || uid(),
        cloudId: row.cloudId || row.id || '',
        householdId: row.household_id || row.householdId || currentHouseholdId(),
        profileId: row.profile_id || row.profileId || '',
        name: row.name || 'Kalendář',
        provider: normalizeCalendarSourceProvider(row.provider),
        providerCalendarId: row.provider_calendar_id || row.providerCalendarId || row.calendar_id || row.external_calendar_id || '',
        providerConnectionId: row.provider_connection_id || row.providerConnectionId || '',
        color: normalizeCalendarSourceColor(row.color),
        isEnabled: row.is_enabled !== undefined ? Boolean(row.is_enabled) : row.isEnabled !== false,
        syncEnabled: row.sync_enabled !== undefined ? Boolean(row.sync_enabled) : Boolean(row.syncEnabled),
        lastSyncedAt: row.last_synced_at || row.lastSyncedAt || '',
        note: row.note || '',
        createdAt: row.created_at || row.createdAt || new Date().toISOString()
      };
    }

    function getCalendarSource(sourceId) {
      const id = String(sourceId || '');
      if (!id) return null;
      return getCalendarSources().find((source) => [source.id, source.cloudId].filter(Boolean).map(String).includes(id)) || null;
    }

    function isCalendarSourceEnabled(sourceId) {
      const source = getCalendarSource(sourceId);
      return !source || source.isEnabled !== false;
    }

    // Cache pro visibleCalendarEvents() a upcomingCalendarEvents(). Signature
    // bere state.calendar (id/cloudId/sourceId/date/time/endDate/endTime/
    // updatedAt) + calendarCloud.sources (id/cloudId + isEnabled), takže
    // změna zdrojů nebo jejich toggle invaliduje stejně jako edit události.
    // Cache padne i po reassignu state (loadState / hydrate) — signature
    // z čerstvého getState() nesedne k předchozí.
    let cachedCalendarSignature = '';
    let cachedVisibleEvents = null;
    let cachedUpcomingRefKey = null;
    let cachedUpcomingList = null;

    function computeCalendarSignature() {
      const events = getState().calendar || [];
      const sources = getCalendarSources();
      const eventParts = new Array(events.length);
      for (let i = 0; i < events.length; i += 1) {
        const e = events[i] || {};
        // title patří do signature — sortCalendarEventsByStart používá
        // localeCompare(title) jako tie-breaker při stejném startMs, takže
        // přejmenování události se stejným časem musí invalidovat cache.
        // updatedAt většinou stačí, ale nepolehneme na to (starý stav v IDB
        // nemusí updatedAt mít, migrace ho nastaví lazy).
        eventParts[i] = `${e.id || ''}:${e.cloudId || ''}:${e.sourceId || ''}:${e.date || ''}:${e.time || ''}:${e.endDate || ''}:${e.endTime || ''}:${e.updatedAt || ''}:${e.title || ''}`;
      }
      const sourceParts = new Array(sources.length);
      for (let i = 0; i < sources.length; i += 1) {
        const s = sources[i] || {};
        sourceParts[i] = `${s.id || ''}:${s.cloudId || ''}:${s.isEnabled !== false ? '1' : '0'}`;
      }
      return `${events.length}#${eventParts.join('|')}##${sources.length}#${sourceParts.join('|')}`;
    }

    function ensureCalendarFresh() {
      const sig = computeCalendarSignature();
      if (sig !== cachedCalendarSignature) {
        cachedCalendarSignature = sig;
        cachedVisibleEvents = null;
        cachedUpcomingRefKey = null;
        cachedUpcomingList = null;
      }
    }

    function visibleCalendarEvents() {
      ensureCalendarFresh();
      if (cachedVisibleEvents) return cachedVisibleEvents;
      cachedVisibleEvents = (getState().calendar || []).filter((event) => isCalendarSourceEnabled(event.sourceId));
      return cachedVisibleEvents;
    }

    function calendarSourceName(sourceId) {
      const source = getCalendarSource(sourceId);
      return source?.name || 'Ruční kalendář';
    }

    function calendarSourceColor(sourceId) {
      const source = getCalendarSource(sourceId);
      return normalizeCalendarSourceColor(source?.color || CALENDAR_SOURCE_COLOR_OPTIONS[0][0]);
    }

    function calendarSourceIdSet(source = {}) {
      return new Set([source.id, source.cloudId].filter(Boolean).map(String));
    }

    function isEventFromSourceSet(event = {}, sourceIds = new Set()) {
      const sourceId = String(event.sourceId || '');
      return Boolean(sourceId && sourceIds.has(sourceId));
    }

    function calendarSourceOptions(selected = '') {
      const sources = getCalendarSources().filter((source) => source.isEnabled !== false);
      const options = [['manual', 'Sdílený kalendář domácnosti']];
      sources.forEach((source) => {
        const id = source.id || source.cloudId;
        if (!id || String(id) === 'manual') return;
        options.push([id, `${source.name} · ${calendarSourceProviderLabel(source.provider)}`]);
      });
      return selectField('Uložit do', 'sourceId', options, selected || 'manual');
    }

    function buildCalendarDateTime(date, time, fallbackTime = '00:00') {
      const d = String(date || todayISO()).slice(0, 10);
      const t = String(time || fallbackTime || '00:00').slice(0, 5);
      return `${d}T${t}:00${pragueOffsetForLocalDateTime(d, t)}`;
    }

    function zonedDateTimeParts(value, timeZone = APP_TIME_ZONE) {
      const date = toSafeDate(value);
      if (!date) return { date: '', time: '' };
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(date).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
      }, {});
      return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}`
      };
    }

    function splitCalendarDateTime(value, options = {}) {
      if (!value) return { date: '', time: '' };
      const text = String(value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { date: text, time: '' };
      const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
      if (hasExplicitZone) {
        const parts = zonedDateTimeParts(text, APP_TIME_ZONE);
        return { date: parts.date, time: options.allDay ? '' : parts.time };
      }
      return { date: text.slice(0, 10), time: options.allDay ? '' : (text.length >= 16 ? text.slice(11, 16) : '') };
    }

    function normalizeCalendarType(value) {
      const map = { rodina: 'family', prace: 'event', domacnost: 'event', ostatni: 'other' };
      const next = map[value] || value || 'event';
      return ['event', 'shift', 'family', 'reminder', 'holiday', 'other'].includes(next) ? next : 'event';
    }

    function calendarEventStartMs(event) {
      if (!event?.date) return Number.MAX_SAFE_INTEGER;
      if (!event.time) return new Date(buildCalendarDateTime(event.date, '00:00')).getTime();
      return new Date(buildCalendarDateTime(event.date, event.time)).getTime();
    }

    function calendarEventEndMs(event) {
      if (!event?.date) return Number.MAX_SAFE_INTEGER;
      const startMs = calendarEventStartMs(event);
      if (!Number.isFinite(startMs)) return Number.MAX_SAFE_INTEGER;
      const endDate = normalizeText(event.endDate) || event.date;
      if (!event.time) {
        const allDayEndDate = event.endDate && event.endDate > event.date ? addDaysIso(event.endDate, -1) : event.date;
        return new Date(buildCalendarDateTime(allDayEndDate, '23:59')).getTime() + 59999;
      }
      if (event.endTime || event.endDate) {
        let endMs = new Date(buildCalendarDateTime(endDate, event.endTime || event.time, event.time)).getTime();
        if (Number.isFinite(endMs) && endMs <= startMs) endMs += 24 * 60 * 60 * 1000;
        return endMs;
      }
      return startMs + DEFAULT_CALENDAR_EVENT_MINUTES * 60 * 1000;
    }

    function calendarEventIsRunning(event, referenceDate = getNow()) {
      const refMs = toSafeDate(referenceDate, new Date()).getTime();
      return calendarEventStartMs(event) <= refMs && calendarEventEndMs(event) > refMs;
    }

    function calendarEventIsRelevant(event, referenceDate = getNow()) {
      if (!event?.date) return true;
      const refMs = toSafeDate(referenceDate, new Date()).getTime();
      return calendarEventEndMs(event) > refMs;
    }

    function sortCalendarEventsByStart(rows) {
      return [...(rows || [])].sort((a, b) => calendarEventStartMs(a) - calendarEventStartMs(b) || String(a.title || '').localeCompare(String(b.title || '')));
    }

    function upcomingCalendarEvents(referenceDate = getNow()) {
      ensureCalendarFresh();
      const refMs = toSafeDate(referenceDate, new Date()).getTime();
      // Klíč na minuty: v jednom renderu se často volá s "now" vytvořeným
      // opakovaně (různé getTime v desítkách ms). Per-minute klíč dedupuje
      // volání v témže renderu; rozdíl <60 s výsledek fakticky nemění
      // (calendarEventIsRelevant test na koncový čas události v ms).
      const refKey = Number.isFinite(refMs) ? Math.floor(refMs / 60000) : 0;
      if (cachedUpcomingRefKey === refKey && cachedUpcomingList) return cachedUpcomingList;
      cachedUpcomingList = sortCalendarEventsByStart(
        visibleCalendarEvents().filter((event) => calendarEventIsRelevant(event, referenceDate))
      );
      cachedUpcomingRefKey = refKey;
      return cachedUpcomingList;
    }

    function calendarEventTimeLabel(event, referenceDate = getNow()) {
      if (!event) return '';
      const running = calendarEventIsRunning(event, referenceDate);
      const endDate = calendarEventDisplayEndDate(event);
      const dateRange = endDate && endDate !== event.date ? `${shortDateText(event.date)}–${shortDateText(endDate)}` : shortDateText(event.date);
      if (!event.time) return event.date === todayISO() && endDate === event.date ? 'dnes · celý den' : `${dateRange} · celý den`;
      const range = event.endTime ? `${event.time}–${event.endTime}` : event.time;
      if (running) return event.endTime ? `probíhá do ${event.endTime}` : `probíhá od ${event.time}`;
      if (event.date === todayISO()) return `dnes ${range}`;
      return `${shortDateText(event.date)} · ${range}`;
    }

    function calendarEventMetaLabel(event, referenceDate = getNow()) {
      const timeLabel = calendarEventTimeLabel(event, referenceDate);
      return `${timeLabel}${event?.location ? ` · ${event.location}` : ''}${event?.note ? ` · ${event.note}` : ''}`;
    }

    function findCalendarEventById(id) {
      const key = String(id || '');
      if (!key) return null;
      return (getState().calendar || []).find((event) => String(event.id || '') === key || String(event.cloudId || '') === key) || null;
    }

    function renderCalendarEventDetailModal() {
      const event = findCalendarEventById(calendarDetailEventId);
      if (!event) return '';
      const running = calendarEventIsRunning(event, getNow());
      const source = calendarSourceName(event.sourceId);
      return `
        <div class="app-modal-backdrop" data-modal-backdrop role="presentation">
          <section class="app-modal calendar-event-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-event-title">
            <div class="app-modal-head">
              <div>
                <span class="badge ${running ? 'good' : ''}">${running ? 'probíhá' : event.date ? formatDate(event.date) : 'bez data'}</span>
                <h2 id="calendar-event-title">${escapeHtml(event.title || 'Událost')}</h2>
                <p>${escapeHtml(calendarEventMetaLabel(event, getNow()))} · ${escapeHtml(source)}</p>
              </div>
              <button class="icon-btn" type="button" data-action="close-modal" aria-label="Zavřít detail události">×</button>
            </div>
            <div class="modal-detail-grid">
              <div class="modal-detail-card"><span>Datum</span><strong>${escapeHtml(calendarEventDateLabel(event))}</strong></div>
              <div class="modal-detail-card"><span>Čas</span><strong>${escapeHtml(calendarEventTimeLabel(event, getNow()) || '—')}</strong></div>
              <div class="modal-detail-card"><span>Typ</span><strong>${escapeHtml(event.type || 'událost')}</strong></div>
              <div class="modal-detail-card"><span>Zdroj</span><strong>${escapeHtml(source)}</strong></div>
            </div>
            ${event.location ? `<div class="inline-note"><strong>Místo:</strong> ${escapeHtml(event.location)}</div>` : ''}
            ${event.note ? `<div class="inline-note"><strong>Poznámka:</strong> ${escapeHtml(event.note)}</div>` : ''}
            <div class="form-actions modal-actions">
              <button class="ghost-btn" type="button" data-action="close-modal">Zavřít</button>
              ${!event.cloudId ? `<button class="danger-btn" type="button" data-action="delete-calendar" data-id="${escapeHtml(event.id || '')}">Smazat událost</button>` : ''}
            </div>
          </section>
        </div>
      `;
    }

    function openCalendarEventDetail(eventId) {
      const event = findCalendarEventById(eventId);
      if (!event) return false;
      calendarDetailEventId = String(event.id || event.cloudId || '');
      renderOverlays();
      return true;
    }

    function isCalendarEventDetailOpen() {
      return Boolean(findCalendarEventById(calendarDetailEventId));
    }

    function closeCalendarEventDetail(options = {}) {
      if (!calendarDetailEventId) return false;
      calendarDetailEventId = '';
      if (options.render !== false) renderOverlays();
      return true;
    }

    function normalizeCalendarMonth(value) {
      const clean = String(value || '').slice(0, 7);
      return /^\d{4}-\d{2}$/.test(clean) ? clean : todayISO().slice(0, 7);
    }

    function shiftCalendarMonth(monthKey, delta = 0) {
      const clean = normalizeCalendarMonth(monthKey);
      const [year, month] = clean.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1 + Number(delta || 0), 1));
      return date.toISOString().slice(0, 7);
    }

    function calendarMonthTitle(monthKey) {
      const clean = normalizeCalendarMonth(monthKey);
      const [year, month] = clean.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, 1));
      return new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(date);
    }

    function calendarDayNumber(isoDate) {
      const day = Number(String(isoDate || '').slice(8, 10));
      return Number.isFinite(day) ? day : '';
    }

    function calendarDayHeaderText(isoDate) {
      const date = new Date(`${String(isoDate || '').slice(0, 10)}T00:00:00`);
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' }).format(date);
    }

    function calendarCellEventTime(event) {
      if (!event?.time) return 'celý den';
      return event.endTime ? `${event.time}–${event.endTime}` : event.time;
    }

    function calendarEventDisplayEndDate(event = {}) {
      const startDate = String(event.date || '').slice(0, 10);
      let endDate = String(event.endDate || '').slice(0, 10);
      if (!startDate) return '';
      if (!endDate) {
        const endMs = calendarEventEndMs(event);
        if (Number.isFinite(endMs) && endMs !== Number.MAX_SAFE_INTEGER) {
          endDate = localISODate(new Date(endMs));
        }
      }
      if (!endDate || endDate < startDate) return startDate;
      if (!event.time && event.endDate && endDate > startDate) {
        endDate = addDaysIso(endDate, -1);
      }
      return endDate < startDate ? startDate : endDate;
    }

    function calendarEventDateRange(event = {}, gridStart = '', gridEnd = '') {
      const startDate = String(event.date || '').slice(0, 10);
      if (!startDate) return [];
      let endDate = calendarEventDisplayEndDate(event);
      if (!endDate) endDate = startDate;
      let cursor = startDate < gridStart ? gridStart : startDate;
      const last = endDate > gridEnd ? gridEnd : endDate;
      const days = [];
      while (cursor && last && cursor <= last && days.length < 366) {
        days.push(cursor);
        cursor = addDaysIso(cursor, 1);
      }
      return days;
    }

    function calendarEventDateLabel(event = {}) {
      const startDate = String(event.date || '').slice(0, 10);
      const endDate = calendarEventDisplayEndDate(event);
      if (!startDate) return '—';
      if (!endDate || endDate === startDate) return formatDate(startDate);
      return `${formatDate(startDate)} – ${formatDate(endDate)}`;
    }

    function renderCalendarMonthGrid(events = [], monthKey = getCalendarViewMonth()) {
      const month = normalizeCalendarMonth(monthKey);
      const [year, rawMonth] = month.split('-').map(Number);
      const firstDay = new Date(Date.UTC(year, rawMonth - 1, 1));
      const lastDay = new Date(Date.UTC(year, rawMonth, 0));
      const leadingDays = (firstDay.getUTCDay() + 6) % 7;
      const trailingDays = 6 - ((lastDay.getUTCDay() + 6) % 7);
      const gridStart = addDaysIso(`${month}-01`, -leadingDays);
      const gridEnd = addDaysIso(lastDay.toISOString().slice(0, 10), trailingDays);
      const monthEvents = sortCalendarEventsByStart(events).filter((event) => {
        const startDate = String(event.date || '').slice(0, 10);
        const endDate = calendarEventDisplayEndDate(event) || startDate;
        return startDate && startDate <= gridEnd && endDate >= gridStart;
      });
      const eventsByDate = monthEvents.reduce((acc, event) => {
        calendarEventDateRange(event, gridStart, gridEnd).forEach((key) => {
          if (!acc[key]) acc[key] = [];
          acc[key].push(event);
        });
        return acc;
      }, {});
      const days = [];
      let cursor = gridStart;
      while (cursor <= gridEnd) {
        days.push(cursor);
        cursor = addDaysIso(cursor, 1);
      }
      while (days.length < 35) days.push(addDaysIso(days[days.length - 1], 1));
      const weeks = [];
      for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));
      const monthStart = `${month}-01`;
      const monthEnd = lastDay.toISOString().slice(0, 10);
      const monthEventCount = monthEvents.filter((event) => {
        const startDate = String(event.date || '').slice(0, 10);
        const endDate = calendarEventDisplayEndDate(event) || startDate;
        return startDate && startDate <= monthEnd && endDate >= monthStart;
      }).length;
      const today = todayISO();
      const dayNames = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
      return `
        <div class="calendar-month-view">
          <div class="calendar-month-toolbar">
            <div>
              <span class="badge">Měsíční přehled</span>
              <h3>${escapeHtml(calendarMonthTitle(month))}</h3>
              <p>${monthEventCount ? `${monthEventCount} událostí v měsíci` : 'Žádné události v tomto měsíci'}</p>
            </div>
            <div class="calendar-month-actions">
              <button class="ghost-btn" type="button" data-action="calendar-month-prev">‹</button>
              <button class="ghost-btn" type="button" data-action="calendar-month-today">Dnes</button>
              <button class="ghost-btn" type="button" data-action="calendar-month-next">›</button>
            </div>
          </div>
          <div class="calendar-grid" data-no-swipe role="table" aria-label="Kalendář ${escapeHtml(calendarMonthTitle(month))}">
            <div class="calendar-weekdays" role="row">
              ${dayNames.map((day) => `<div class="calendar-weekday" role="columnheader">${day}</div>`).join('')}
            </div>
            ${weeks.map((week, weekIndex) => `
              <div class="calendar-week-row" role="row" aria-label="Týden ${weekIndex + 1}">
                ${week.map((dayIso) => {
                  const dayEvents = eventsByDate[dayIso] || [];
                  const visible = dayEvents.slice(0, 3);
                  const hidden = dayEvents.length - visible.length;
                  const outside = !dayIso.startsWith(month);
                  const weekend = [0, 6].includes((new Date(`${dayIso}T00:00:00Z`)).getUTCDay());
                  const holiday = czechPublicHolidayName(dayIso);
                  return `
                    <div class="calendar-day ${outside ? 'outside-month' : ''} ${dayIso === today ? 'today' : ''} ${weekend ? 'weekend' : ''} ${holiday ? 'holiday' : ''}" role="cell">
                      <div class="calendar-day-head">
                        <span class="calendar-day-number">${calendarDayNumber(dayIso)}</span>
                        <span class="calendar-day-name">${escapeHtml(calendarDayHeaderText(dayIso))}</span>
                      </div>
                      <div class="calendar-day-events">
                        ${visible.map((event) => `
                          <button class="calendar-day-event ${event.cloudId ? 'cloud-event' : ''} ${dayIso !== String(event.date || '').slice(0, 10) ? 'continued-event' : ''}" type="button" data-action="calendar-event-detail" data-id="${escapeHtml(event.id || event.cloudId || '')}" title="${escapeHtml(event.title)}" style="--calendar-source-color: ${escapeHtml(calendarSourceColor(event.sourceId))}">
                            <strong>${dayIso !== String(event.date || '').slice(0, 10) ? '↳ ' : ''}${escapeHtml(event.title)}</strong>
                            <span>${escapeHtml(dayIso !== String(event.date || '').slice(0, 10) ? 'pokračuje' : calendarCellEventTime(event))}${event.location ? ` · ${escapeHtml(event.location)}` : ''}</span>
                          </button>
                        `).join('')}
                        ${hidden > 0 ? `<div class="calendar-more-events">+${hidden} další</div>` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    function renderCalendarSourceList(sources = getCalendarSources()) {
      if (!sources.length) {
        return renderEmptyCta({ icon: '📅', title: 'Zatím žádné zdroje', text: 'Přidej ruční domácí zdroj nebo sdílený ICS/iCal odkaz.', nav: 'calendar', tab: 'sources', label: 'Přidat zdroj' });
      }
      return `<details class="compact-edit-details calendar-source-list-details" data-details-key="calendar-source-list" ${getDetailsOpen('calendar-source-list') ? 'open' : ''}><summary><span>Aktivní zdroje</span><em>${sources.length} zdrojů</em></summary><div class="list compact-list calendar-source-list">${sources.map((source) => {
        const linkedEvents = (getState().calendar || []).filter((event) => String(event.sourceId || '') === String(source.id || source.cloudId || '')).length;
        const ical = normalizeCalendarSourceProvider(source.provider) === 'ical';
        return `
          <div class="item calendar-source-item ${source.isEnabled === false ? 'muted-item' : ''}">
            <div class="item-top">
              <div class="item-title"><span class="calendar-source-color-dot" style="--calendar-source-color: ${escapeHtml(normalizeCalendarSourceColor(source.color))}"></span><span class="calendar-source-icon">${escapeHtml(calendarSourceIcon(source.provider))}</span> ${escapeHtml(source.name)}</div>
              <span class="badge ${source.isEnabled === false ? '' : 'good'}">${source.isEnabled === false ? 'skrytý' : 'aktivní'}</span>
            </div>
            <div class="item-meta">${escapeHtml(calendarSourceProviderLabel(source.provider))}${source.providerCalendarId ? ` · ${escapeHtml(source.providerCalendarId)}` : ''}${source.lastSyncedAt ? ` · sync ${formatDateTime(source.lastSyncedAt)}` : ''}</div>
            ${source.note ? `<div class="item-meta">${escapeHtml(source.note)}</div>` : ''}
            <div class="cloud-status-grid compact-cloud-stats source-mini-stats">
              <div class="mini-stat"><span>Události</span><strong>${linkedEvents}</strong></div>
              <div class="mini-stat"><span>Typ</span><strong>${escapeHtml(calendarSourceProviderLabel(source.provider))}</strong></div>
              <div class="mini-stat"><span>Stav</span><strong>${source.isEnabled === false ? 'skrytý' : 'viditelný'}</strong></div>
            </div>
            <div class="item-actions">
              <button class="ghost-btn" type="button" data-action="calendar-toggle-source" data-source-id="${escapeHtml(source.id || source.cloudId || '')}" data-enabled="${source.isEnabled === false ? 'true' : 'false'}">${source.isEnabled === false ? 'Zobrazit' : 'Skrýt'}</button>
              ${ical && getState().cloud?.householdId ? `<button class="ghost-btn" type="button" data-action="ics-calendar-sync" data-source-id="${escapeHtml(source.cloudId || source.id || '')}">Sync</button>` : ''}
              <button class="danger-btn" type="button" data-action="calendar-delete-source" data-source-id="${escapeHtml(source.id || source.cloudId || '')}">Odebrat</button>
            </div>
          </div>
        `;
      }).join('')}</div></details>`;
    }

    function renderCalendar() {
      const sourceList = getCalendarSources();
      const enabledSourceIds = new Set(sourceList.filter((source) => source.isEnabled !== false).map((source) => String(source.id || source.cloudId || '')));
      const events = [...visibleCalendarEvents()].sort((a, b) => `${a.date || ''}${a.time || ''}`.localeCompare(`${b.date || ''}${b.time || ''}`));
      // today/soonCutoff se počítají JEDNOU: todayISO()/dateOffsetISO() staví
      // nový Intl.DateTimeFormat při každém volání, a volání uvnitř filter()
      // callbacku (jednou na událost) u stovek událostí znamenalo stovky
      // zbytečných Intl instancí za render - měřeno ~140 ms jen na tenhle blok.
      const today = todayISO();
      const soonCutoff = dateOffsetISO(7);
      const todayEvents = events.filter((event) => event.date === today);
      const upcoming = events.filter((event) => !event.date || event.date >= today).slice(0, 12);
      const soonCount = events.filter((event) => event.date && event.date > today && event.date <= soonCutoff).length;
      const past = events.filter((event) => event.date && event.date < today).reverse().slice(0, 8);
      const hiddenEvents = (getState().calendar || []).filter((event) => event.sourceId && !enabledSourceIds.has(String(event.sourceId)) && getCalendarSource(event.sourceId)).length;
      const cloudReadyFlag = Boolean(getState().cloud?.householdId);
      const localOnly = events.filter((event) => !event.cloudId).length;
      const cloudCount = events.filter((event) => event.cloudId).length;
      const activeSources = sourceList.filter((source) => source.isEnabled !== false).length;
      const activeCalendarTab = getModuleTab('calendar', 'overview');
      const monthGridHtml = renderCalendarMonthGrid(events, getCalendarViewMonth());
      const sourceListHtml = renderCalendarSourceList(sourceList);
      const pastListHtml = past.length ? renderEventList(past, true) : renderEmpty('Historie je zatím prázdná.');
      return `
        ${renderSectionTabs('calendar', [
          { id: 'overview', label: 'Přehled', icon: '📅', count: todayEvents.length },
          { id: 'sources', label: 'Zdroje', icon: '🧩', count: sourceList.length },
          { id: 'add', label: 'Přidat', icon: '➕' },
          { id: 'history', label: 'Historie', icon: '🕘', count: past.length }
        ], 'overview')}
        <div class="grid two module-tabbed calendar-tab-${activeCalendarTab}" data-tab-area="calendar">
          <section class="card desktop-span-2 calendar-panel panel-overview">
            <div class="card-header">
              <div><h2>Přehled</h2></div>
              <span class="badge ${cloudCount ? 'good' : ''}">${events.length} událostí</span>
            </div>
            <details class="compact-edit-details calendar-overview-summary-details" data-details-key="calendar-overview-summary" ${getDetailsOpen('calendar-overview-summary') ? 'open' : ''}>
              <summary><span>Souhrn kalendáře</span><em>${events.length} událostí · ${activeSources}/${sourceList.length || 0} zdrojů</em></summary>
              <div class="cloud-status-grid compact-cloud-stats calendar-overview-stats">
                <div class="mini-stat"><span>Celkem</span><strong>${events.length}</strong></div>
                <div class="mini-stat"><span>Dnes</span><strong>${todayEvents.length}</strong></div>
                <div class="mini-stat"><span>Brzy</span><strong>${soonCount}</strong></div>
                <div class="mini-stat"><span>Zdroje</span><strong>${activeSources}/${sourceList.length || 0}</strong></div>
              </div>
            </details>
            ${hiddenEvents ? `<div class="inline-note">${hiddenEvents} událostí je schovaných, protože jejich kalendář je vypnutý.</div>` : ''}
            ${monthGridHtml}
            ${events.length ? '' : renderEmptyCta({ icon: '📅', title: 'Kalendář je prázdný', text: 'Přidej první sdílenou domácí událost.', nav: 'calendar', tab: 'add', label: 'Přidat událost' })}
          </section>

          <section class="card desktop-span-2 calendar-panel panel-sources">
            <div class="card-header">
              <div><h2>Zdroje kalendáře</h2></div>
              <span class="badge ${cloudReadyFlag ? 'good' : ''}">${cloudReadyFlag ? 'cloud' : 'lokálně'}</span>
            </div>
            <details class="compact-edit-details calendar-manual-source-details" data-details-key="calendar-add-source" ${getDetailsOpen('calendar-add-source') ? 'open' : ''}>
              <summary><span>Přidat ruční zdroj kalendáře</span><em>domácí / sdílený ICS/iCal odkaz</em></summary>
              <form data-form="add-calendar-source" class="compact-form">
                <div class="form-grid two">
                  ${field('Název kalendáře', 'name', 'text', 'Rodina / Práce / Sdílený kalendář', true)}
                  ${selectField('Typ', 'provider', [['manual', 'Ruční domácí'], ['family', 'Rodinný'], ['work', 'Práce'], ['ical', 'ICS/iCal odkaz (sdílený kalendář)'], ['other', 'Jiný']])}
                  ${field('ICS odkaz (jen typ „iCal“)', 'providerCalendarId', 'text', 'https://.../calendar.ics')}
                  ${calendarSourceColorPicker('#3b82f6')}
                  ${field('Poznámka', 'note', 'text', 'volitelné')}
                </div>
                <div class="inline-note compact-note">Typ „iCal“: vlož tajný/veřejný ICS odkaz kalendáře. Appka ho umí načíst tlačítkem „Sync“ a při používání ho průběžně obnovuje bez dalšího přihlášení.</div>
                <div class="form-actions"><button class="primary-btn" type="submit">Přidat zdroj</button></div>
              </form>
            </details>
            ${sourceListHtml}
          </section>

          <section class="card calendar-panel panel-add">
            <div class="card-header">
              <div><h2>Přidat událost</h2><p>Událost může být sdílená v domácnosti nebo doplněná z ICS/iCal zdrojů.</p></div>
              <span class="badge ${cloudCount ? 'good' : ''}">${cloudReadyFlag ? 'sdílené v domácnosti' : 'lokálně'}</span>
            </div>
            <form data-form="add-event">
              <div class="form-grid two">
                ${field('Název', 'title', 'text', 'Doktor / návštěva / výlet', true)}
                ${calendarSourceOptions('manual')}
                ${field('Datum', 'date', 'date', '', true, todayISO())}
                ${field('Konec vícedenní události', 'endDate', 'date', '')}
                ${field('Začátek', 'time', 'time', '')}
                ${field('Konec', 'endTime', 'time', '')}
                ${selectField('Typ', 'type', [['event', 'Událost'], ['family', 'Rodina'], ['shift', 'Směna'], ['reminder', 'Připomínka'], ['holiday', 'Volno/svátek'], ['other', 'Ostatní']])}
                ${field('Místo', 'location', 'text', 'volitelné')}
                ${field('Poznámka', 'note', 'text', 'volitelné')}
              </div>
              <div class="form-actions">
                <button class="primary-btn" type="submit">Uložit událost</button>
              </div>
            </form>
          </section>

          <section class="card desktop-span-2 calendar-panel panel-history">
            <div class="card-header"><div><h2>Historie</h2><p>Poslední starší události, aby hlavní přehled nebyl zbytečně dlouhý.</p></div></div>
            ${pastListHtml}
          </section>
        </div>
      `;
    }

    function renderEventList(events, withDelete = false) {
      return `<div class="list">${events.map((event) => `
        <div class="item calendar-event-list-item" style="--calendar-source-color: ${escapeHtml(calendarSourceColor(event.sourceId))}">
          <div class="item-top">
            <div class="item-title">${escapeHtml(event.title)}</div>
            <span class="badge ${event.cloudId ? 'good' : ''}">${event.cloudId ? 'cloud' : 'lokálně'}</span>
          </div>
          <div class="item-meta">${escapeHtml(calendarEventMetaLabel(event, getNow()))} · ${escapeHtml(calendarSourceName(event.sourceId))}</div>
          ${withDelete ? `<div class="item-actions"><button class="danger-btn" type="button" data-action="delete-calendar" data-id="${event.id}">Smazat</button></div>` : ''}
        </div>
      `).join('')}</div>`;
    }

    function cloudCalendarPayload(event, userId, sourceId = null) {
      const start = buildCalendarDateTime(event.date, event.time, '00:00');
      const endDate = normalizeText(event.endDate) || event.date;
      const end = event.endTime || event.endDate ? buildCalendarDateTime(endDate, event.endTime || event.time || '23:59', event.time || '00:00') : null;
      return {
        household_id: getState().cloud.householdId,
        source_id: sourceId || event.sourceId || null,
        profile_id: event.profileId && String(event.profileId).startsWith('profile-') ? null : event.profileId || null,
        title: event.title || 'Událost',
        description: event.note || null,
        location: event.location || null,
        starts_at: start,
        ends_at: end,
        all_day: !event.time,
        event_type: normalizeCalendarType(event.type),
        status: 'confirmed',
        visibility: 'household',
        created_by: event.cloudId ? undefined : userId,
        updated_by: userId
      };
    }

    async function cloudLoadCalendarSources(showMessage = false) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) {
        if (showMessage) showToast('Nejdřív napoj domácnost na cloud');
        return [];
      }
      const { data, error } = await client
        .from('calendar_sources')
        .select('id,household_id,profile_id,name,provider,provider_calendar_id,provider_connection_id,color,is_enabled,sync_enabled,last_synced_at,note,created_at')
        .eq('household_id', getState().cloud.householdId)
        .order('created_at', { ascending: true });
      if (error) {
        if (showMessage) showToast(error.message || 'Zdroje kalendáře se nepovedlo načíst');
        return getCalendarSources();
      }
      const sources = (data || []).map(mapCalendarSource);
      // Lokálně přidaný zdroj (ještě bez cloudId, čeká na dokončení
      // cloudAddCalendarSource na pozadí) se nesmí ztratit jen proto, že
      // zrovna proběhlo načtení z cloudu - dřív se sem sources přiřadilo
      // natvrdo a smazalo to i čerstvě přidaný ruční/ICS zdroj.
      const localOnly = getCalendarSources().filter((source) => !source.cloudId);
      getState().calendarCloud = {
        ...(getState().calendarCloud || {}),
        sources: mergeCalendarSources(localOnly, sources),
        sourcesLoadedAt: new Date().toISOString()
      };
      touchState();
      saveState();
      if (sources.some((source) => normalizeCalendarSourceProvider(source.provider) === 'ical')) {
        scheduleCalendarAutoSync('sources-loaded', { delay: showMessage ? 1800 : 9000 });
      }
      if (showMessage) {
        render();
        showToast('Zdroje kalendáře načtené');
      }
      return sources;
    }

    async function ensureManualCalendarSource() {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return null;
      let sources = getCalendarSources();
      let cached = sources.find((source) => source.provider === 'manual' && source.isEnabled !== false);
      if (cached?.id) return cached.id;
      if (!sources.length) sources = await cloudLoadCalendarSources(false);
      cached = sources.find((source) => source.provider === 'manual' && source.isEnabled !== false);
      if (cached?.id) return cached.id;
      const user = await refreshCloudSession(false);
      if (!user) return null;
      const { data: existing, error: existingError } = await client
        .from('calendar_sources')
        .select('id,household_id,profile_id,name,provider,provider_calendar_id,provider_connection_id,color,is_enabled,sync_enabled,last_synced_at,note,created_at')
        .eq('household_id', getState().cloud.householdId)
        .eq('provider', 'manual')
        .limit(1);
      if (existingError) {
        showToast(existingError.message || 'Zdroj kalendáře se nepovedlo načíst');
        return null;
      }
      if (existing?.[0]?.id) {
        const source = mapCalendarSource(existing[0]);
        getState().calendarCloud = { ...(getState().calendarCloud || {}), sources: mergeCalendarSources(getCalendarSources(), [source]) };
        return source.id;
      }
      const { data, error } = await client.from('calendar_sources').insert({
        household_id: getState().cloud.householdId,
        name: 'Ruční kalendář',
        provider: 'manual',
        is_enabled: true,
        sync_enabled: false,
        created_by: user.id,
        updated_by: user.id
      }).select('id,household_id,profile_id,name,provider,provider_calendar_id,provider_connection_id,color,is_enabled,sync_enabled,last_synced_at,note,created_at').single();
      if (error) {
        showToast(error.message || 'Zdroj kalendáře se nepovedlo vytvořit');
        return null;
      }
      const source = mapCalendarSource(data);
      getState().calendarCloud = { ...(getState().calendarCloud || {}), sources: mergeCalendarSources(getCalendarSources(), [source]) };
      return source.id;
    }

    function mergeCalendarSources(current = [], incoming = []) {
      const map = new Map();
      [...current, ...incoming].forEach((source) => {
        const normalized = mapCalendarSource(source);
        const keys = calendarSourceDedupeKeys(normalized);
        const key = keys.find((candidate) => map.has(candidate)) || keys[0] || String(normalized.id || normalized.cloudId || normalized.name);
        const existing = map.get(key);
        const merged = existing
          ? {
              ...existing,
              ...normalized,
              id: normalized.cloudId || normalized.id || existing.id,
              cloudId: normalized.cloudId || existing.cloudId || '',
              name: normalized.name || existing.name,
              color: normalizeCalendarSourceColor(normalized.color || existing.color),
              providerCalendarId: normalizeCalendarUrl(normalized.providerCalendarId || existing.providerCalendarId),
              isEnabled: normalized.isEnabled !== false && existing.isEnabled !== false,
              syncEnabled: normalized.syncEnabled !== false || existing.syncEnabled !== false
            }
          : normalized;
        [...keys, key, ...calendarSourceDedupeKeys(merged)].filter(Boolean).forEach((candidate) => map.set(candidate, merged));
      });
      return Array.from(new Set(map.values())).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    }

    async function addCalendarSourceFromForm(data, form) {
      const provider = normalizeCalendarSourceProvider(data.provider);
      const providerCalendarId = provider === 'ical' ? normalizeCalendarUrl(data.providerCalendarId) : normalizeText(data.providerCalendarId);
      if (provider === 'ical' && !providerCalendarId) return showToast('Vlož ICS/iCal odkaz kalendáře');
      const duplicate = getCalendarSources().find((item) => normalizeCalendarSourceProvider(item.provider) === provider && provider === 'ical' && normalizeCalendarUrl(item.providerCalendarId) === providerCalendarId);
      if (duplicate) {
        showToast('Tento ICS kalendář už je přidaný');
        icsCalendarSync(duplicate.cloudId || duplicate.id || '', { showMessage: true }).catch((error) => console.warn('ICS sync duplicate source failed', error));
        return;
      }
      const source = mapCalendarSource({
        id: uid(),
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        name: normalizeText(data.name),
        provider,
        providerCalendarId,
        color: normalizeCalendarSourceColor(data.color),
        isEnabled: true,
        // iCal zdroj se rovnou synchronizuje - jinak by
        // ho icsCalendarSync() bez ruční akce navíc nikdy neposbíral.
        syncEnabled: provider === 'ical',
        note: normalizeText(data.note),
        createdAt: new Date().toISOString()
      });
      if (!source.name) return showToast('Doplň název kalendáře');
      getState().calendarCloud = { ...(getState().calendarCloud || {}), sources: mergeCalendarSources(getCalendarSources(), [source]) };
      touchState();
      saveState();
      form.reset();
      render();
      showToast('Zdroj kalendáře uložen');
      cloudAddCalendarSource(source).then((saved) => {
        if (saved?.id) {
          source.id = saved.id;
          source.cloudId = saved.id;
          getState().calendarCloud = { ...(getState().calendarCloud || {}), sources: mergeCalendarSources(getCalendarSources(), [source]) };
          saveState();
          requestRender();
          if (normalizeCalendarSourceProvider(source.provider) === 'ical') {
            icsCalendarSync(source.cloudId || source.id || '', { showMessage: true }).catch((error) => console.warn('ICS sync after source save failed', error));
          }
        }
      }).catch((error) => console.warn('Cloud sync (zdroj kalendáře) na pozadí selhal', error));
    }

    async function cloudAddCalendarSource(source) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return null;
      const user = await refreshCloudSession(false);
      if (!user) return null;
      const provider = normalizeCalendarSourceProvider(source.provider);
      const providerCalendarId = provider === 'ical' ? normalizeCalendarUrl(source.providerCalendarId) : normalizeText(source.providerCalendarId);
      if (provider === 'ical' && providerCalendarId) {
        const { data: existing, error: existingError } = await client
          .from('calendar_sources')
          .select('id,household_id,profile_id,name,provider,provider_calendar_id,provider_connection_id,color,is_enabled,sync_enabled,last_synced_at,note,created_at')
          .eq('household_id', getState().cloud.householdId)
          .eq('provider', provider)
          .eq('provider_calendar_id', providerCalendarId)
          .limit(1);
        if (!existingError && existing?.[0]?.id) return existing[0];
      }
      const payload = {
        household_id: getState().cloud.householdId,
        profile_id: source.profileId && String(source.profileId).startsWith('profile-') ? null : source.profileId || null,
        name: source.name || 'Kalendář',
        provider,
        provider_calendar_id: providerCalendarId || null,
        color: normalizeCalendarSourceColor(source.color),
        is_enabled: source.isEnabled !== false,
        sync_enabled: provider === 'ical' ? source.syncEnabled !== false : Boolean(source.syncEnabled),
        note: source.note || null,
        created_by: user.id,
        updated_by: user.id
      };
      const { data, error } = await client
        .from('calendar_sources')
        .insert(payload)
        .select('id,household_id,profile_id,name,provider,provider_calendar_id,provider_connection_id,color,is_enabled,sync_enabled,last_synced_at,note,created_at')
        .single();
      if (error) {
        showToast(error.message || 'Zdroj kalendáře se nepovedlo uložit do cloudu');
        return null;
      }
      return data;
    }

    async function cloudSyncLocalCalendarSources(showMessage = false) {
      if (!cloudReady()) return 0;
      const localSources = getCalendarSources().filter((source) => !source.cloudId);
      if (!localSources.length) {
        if (showMessage) showToast('Žádné lokální zdroje kalendáře k odeslání');
        return 0;
      }
      let count = 0;
      const savedSources = [];
      for (const source of localSources) {
        try {
          const saved = await cloudAddCalendarSource(source);
          if (saved?.id) {
            source.id = saved.id;
            source.cloudId = saved.id;
            savedSources.push(mapCalendarSource(saved));
            count += 1;
          }
        } catch (error) {
          console.warn('Cloud calendar source sync failed', error);
        }
      }
      getState().calendarCloud = { ...(getState().calendarCloud || {}), sources: mergeCalendarSources(getCalendarSources(), savedSources) };
      touchState();
      saveState();
      if (showMessage) showToast(`Odesláno zdrojů kalendáře: ${count}`);
      return count;
    }

    async function toggleCalendarSource(sourceId, enabled) {
      const source = getCalendarSource(sourceId);
      if (!source) return showToast('Zdroj kalendáře nenalezen');
      const nextEnabled = enabled !== undefined ? enabled : source.isEnabled === false;
      source.isEnabled = Boolean(nextEnabled);
      getState().calendarCloud = { ...(getState().calendarCloud || {}), sources: mergeCalendarSources(getCalendarSources(), [source]) };
      touchState();
      saveState();
      render();
      showToast(source.isEnabled ? 'Kalendář zobrazen' : 'Kalendář skrytý');
      const client = getSupabaseClient();
      if (client && getState().cloud?.householdId && source.cloudId) {
        (async () => {
          const user = await refreshCloudSession(false);
          const { error } = await client
            .from('calendar_sources')
            .update({ is_enabled: source.isEnabled, updated_by: user?.id || undefined })
            .eq('id', source.cloudId)
            .eq('household_id', getState().cloud.householdId);
          if (error) console.warn('Cloud sync (zdroj kalendáře toggle) na pozadí selhal', error.message);
        })().catch((error) => console.warn('Cloud sync (zdroj kalendáře toggle) na pozadí selhal', error));
      }
    }

    async function deleteCalendarSource(sourceId) {
      const source = getCalendarSource(sourceId);
      if (!source) return showToast('Zdroj kalendáře nenalezen');
      const label = source.name || 'kalendář';
      const ok = window.confirm(`Odebrat kalendář „${label}“ a jeho události z Domácnost+?`);
      if (!ok) return;

      const sourceKeys = [source.id, source.cloudId].filter(Boolean).map(String);
      getState().calendarCloud = {
        ...(getState().calendarCloud || {}),
        sources: getCalendarSources().filter((item) => !sourceKeys.includes(String(item.id || '')) && !sourceKeys.includes(String(item.cloudId || ''))),
        sourcesLoadedAt: new Date().toISOString()
      };
      getState().calendar = (getState().calendar || []).filter((event) => !sourceKeys.includes(String(event.sourceId || '')));
      touchState();
      saveState();
      render();
      showToast('Kalendář odebraný');

      const client = getSupabaseClient();
      if (client && getState().cloud?.householdId && source.cloudId) {
        (async () => {
          const { error: eventsError } = await client
            .from('calendar_events')
            .delete()
            .eq('source_id', source.cloudId)
            .eq('household_id', getState().cloud.householdId);
          if (eventsError) { console.warn('Cloud sync (smazání událostí kalendáře) na pozadí selhal', eventsError.message); return; }
          const { error } = await client
            .from('calendar_sources')
            .delete()
            .eq('id', source.cloudId)
            .eq('household_id', getState().cloud.householdId);
          if (error) { console.warn('Cloud sync (smazání zdroje kalendáře) na pozadí selhal', error.message); return; }
          if (getState().cloud) { getState().cloud.lastSyncAt = new Date().toISOString(); saveState(); }
        })().catch((error) => console.warn('Cloud sync (smazání zdroje kalendáře) na pozadí selhal', error));
      }
    }

    async function cloudAddCalendarEvent(event) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return null;
      const user = await refreshCloudSession(false);
      if (!user) return null;
      let sourceId = event.sourceId || '';
      let source = getCalendarSource(sourceId);
      if (source && !source.cloudId) {
        const savedSource = await cloudAddCalendarSource(source);
        if (savedSource?.id) {
          source.cloudId = savedSource.id;
          source.id = savedSource.id;
          sourceId = savedSource.id;
          getState().calendarCloud = { ...(getState().calendarCloud || {}), sources: mergeCalendarSources(getCalendarSources(), [source, mapCalendarSource(savedSource)]) };
        }
      }
      source = getCalendarSource(sourceId);
      if (source?.cloudId) sourceId = source.cloudId;
      if (sourceId === 'manual' || !sourceId || !getCalendarSource(sourceId)) {
        sourceId = await ensureManualCalendarSource();
      }
      const { data, error } = await client.from('calendar_events').insert(cloudCalendarPayload(event, user.id, sourceId)).select('id,source_id').single();
      if (error) {
        showToast(error.message || 'Událost se nepovedlo uložit do cloudu');
        return null;
      }
      event.cloudId = data.id;
      event.sourceId = data.source_id || sourceId || '';
      getState().cloud.lastSyncAt = new Date().toISOString();
      return data;
    }

    async function cloudDeleteCalendarEvent(event) {
      const client = getSupabaseClient();
      if (!client || !event?.cloudId || !getState().cloud?.householdId) return true;
      const { error } = await client.from('calendar_events').delete().eq('id', event.cloudId).eq('household_id', getState().cloud.householdId);
      if (error) {
        showToast(error.message || 'Cloud událost se nepovedlo smazat');
        return false;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return true;
    }

    async function cloudLoadCalendar(showMessage = true) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) {
        if (showMessage) showToast('Nejdřív napoj domácnost na cloud');
        return false;
      }
      await cloudLoadCalendarSources(false);
      const { data, error } = await client
        .from('calendar_events')
        .select('id,source_id,title,description,location,starts_at,ends_at,all_day,event_type,provider_event_id,provider_status,created_at')
        .eq('household_id', getState().cloud.householdId)
        .neq('status', 'cancelled')
        .order('starts_at', { ascending: true });
      if (error) {
        showToast(error.message || 'Kalendář se nepovedlo načíst');
        return false;
      }
      const cloudBackedIcsSourceIds = new Set();
      getCalendarSources()
        .filter((source) => normalizeCalendarSourceProvider(source.provider) === 'ical')
        .forEach((source) => calendarSourceIdSet(source).forEach((id) => cloudBackedIcsSourceIds.add(id)));
      const localOnly = getState().calendar.filter((event) => !event.cloudId && !isEventFromSourceSet(event, cloudBackedIcsSourceIds));
      const cloudItems = (data || []).map((item) => {
        const start = splitCalendarDateTime(item.starts_at, { allDay: item.all_day });
        const end = splitCalendarDateTime(item.ends_at, { allDay: item.all_day });
        return {
          id: getState().calendar.find((event) => event.cloudId === item.id)?.id || `event-cloud-${item.id}`,
          cloudId: item.id,
          externalId: item.provider_event_id || '',
          sourceId: item.source_id || '',
          householdId: currentHouseholdId(),
          profileId: currentProfileId(),
          createdAt: item.created_at || new Date().toISOString(),
          title: item.title || 'Událost',
          date: start.date,
          time: item.all_day ? '' : start.time,
          endDate: end.date && end.date !== start.date ? end.date : '',
          endTime: item.all_day ? '' : end.time || '',
          type: normalizeCalendarType(item.event_type),
          location: item.location || '',
          note: item.description || ''
        };
      });
      getState().calendar = [...cloudItems, ...localOnly];
      getState().calendarCloud = { ...(getState().calendarCloud || {}), loadedAt: new Date().toISOString(), sourcesLoadedAt: getState().calendarCloud?.sourcesLoadedAt || new Date().toISOString() };
      touchState();
      saveState();
      render();
      if (showMessage) showToast('Cloud kalendář načten');
      return true;
    }

    async function cloudSyncCalendarById(id) {
      const event = getState().calendar.find((entry) => entry.id === id);
      if (!event) return;
      await cloudAddCalendarEvent(event);
      touchState();
      saveState();
      render();
      showToast(event.cloudId ? 'Událost odeslána do cloudu' : 'Událost zůstala lokálně');
    }

    async function cloudSyncLocalCalendar() {
      const local = getState().calendar.filter((event) => !event.cloudId);
      if (!local.length) return showToast('Žádné lokální události k odeslání');
      let count = 0;
      for (const event of local) {
        const saved = await cloudAddCalendarEvent(event);
        if (saved?.id) count += 1;
      }
      touchState();
      saveState();
      render();
      showToast(`Odesláno událostí: ${count}`);
    }

    async function addEventFromForm(data, form) {
      const event = {
        id: uid(),
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        title: normalizeText(data.title),
        date: normalizeText(data.date),
        endDate: normalizeText(data.endDate),
        time: normalizeText(data.time),
        endTime: normalizeText(data.endTime),
        type: normalizeCalendarType(data.type),
        sourceId: normalizeText(data.sourceId) || 'manual',
        location: normalizeText(data.location),
        note: normalizeText(data.note)
      };
      if (!event.title || !event.date) return showToast('Doplň název a datum');
      getState().calendar.push(event);
      touchState();
      saveState();
      form.reset();
      render();
      showToast('Událost uložena');
      cloudAddCalendarEvent(event).then((saved) => {
        if (saved?.id) { event.cloudId = saved.id; saveState(); requestRender(); }
      }).catch((error) => console.warn('Cloud sync (událost) na pozadí selhal', error));
    }

    async function deleteCalendarEvent(id) {
      const event = getState().calendar.find((entry) => entry.id === id);
      if (!event) return;
      getState().calendar = getState().calendar.filter((entry) => entry.id !== id);
      if (calendarDetailEventId === id || calendarDetailEventId === event.cloudId) calendarDetailEventId = '';
      touchState();
      saveState();
      render();
      showToast('Událost smazána');
      cloudDeleteCalendarEvent(event).catch((error) => console.warn('Cloud sync (smazání události) na pozadí selhal', error));
    }

    async function readFunctionErrorMessage(error, fallback = 'Backend zatím není připravený') {
      if (!error) return fallback;
      const context = error.context;
      try {
        if (context?.clone && typeof context.clone === 'function') {
          const cloned = context.clone();
          const body = await cloned.json().catch(() => null);
          const message = body?.error || body?.message || body?.hint;
          if (message) return message;
        }
        if (context?.json && typeof context.json === 'function') {
          const body = await context.json().catch(() => null);
          const message = body?.error || body?.message || body?.hint;
          if (message) return message;
        }
        if (context?.text && typeof context.text === 'function') {
          const text = await context.text().catch(() => '');
          if (text) return text.slice(0, 220);
        }
      } catch (_) {
        // Supabase FunctionsHttpError nemusí vždy dovolit přečíst body odpovědi.
      }
      return error.message || fallback;
    }

    // Lehký invoke pro ICS zdroje: žádné přihlašovací fallbacky, jen existující
    // přihlášená cloud domácnost a volání edge funkce calendar-ics-sync.
    async function invokeCalendarEdgeFunction(functionName, body = {}, showMessage = true) {
      const client = getSupabaseClient();
      if (!client?.functions?.invoke) {
        if (showMessage) showToast('Supabase funkce nejsou dostupné');
        return null;
      }
      if (!cloudReady()) {
        if (showMessage) showToast('Nejdřív napoj domácnost na cloud');
        return null;
      }
      const user = await refreshCloudSession(false);
      if (!user) {
        if (showMessage) showToast('Nejdřív se přihlas');
        return null;
      }
      const payload = {
        householdId: getState().cloud.householdId,
        profileId: currentProfileId(),
        ...body
      };
      try {
        const { data, error } = await client.functions.invoke(functionName, { body: payload });
        if (error || data?.error || data?.ok === false) {
          const payloadError = data || {};
          const message = payloadError?.error || payloadError?.message || await readFunctionErrorMessage(error, 'Backend zatím není připravený');
          console.warn(`${functionName} failed`, error || payloadError?.error || payloadError);
          if (showMessage) showToast(message);
          return null;
        }
        return data || {};
      } catch (error) {
        console.warn(`${functionName} failed`, error);
        const message = await readFunctionErrorMessage(error, 'Backend zatím není nasazený nebo nemá credentials');
        if (showMessage) showToast(message);
        return null;
      }
    }

    function hashCalendarText(value = '') {
      let hash = 0x811c9dc5;
      const text = String(value || '');
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(36);
    }

    function unfoldIcsText(text = '') {
      return String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    function parseIcsLine(line = '') {
      const index = line.indexOf(':');
      if (index < 0) return null;
      const head = line.slice(0, index);
      const value = line.slice(index + 1);
      const [rawName, ...rawParams] = head.split(';');
      const params = {};
      rawParams.forEach((part) => {
        const eq = part.indexOf('=');
        if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
      });
      return { name: rawName.toUpperCase(), params, value };
    }

    function decodeIcsValue(value = '') {
      return String(value || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
    }

    function icsDateToIsoDate(value = '') {
      const text = String(value || '').replace(/Z$/i, '');
      if (!/^\d{8}/.test(text)) return '';
      return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }

    function icsDateToIsoTime(value = '') {
      const text = String(value || '').replace(/Z$/i, '');
      if (!/^\d{8}T\d{4}/.test(text)) return '';
      return `${text.slice(9, 11)}:${text.slice(11, 13)}`;
    }

    function parseIcsDateValue(value = '', params = {}) {
      const text = String(value || '').trim();
      if (!text) return { date: '', time: '', allDay: false };
      if (params.VALUE === 'DATE' || /^\d{8}$/.test(text)) return { date: icsDateToIsoDate(text), time: '', allDay: true };
      if (/^\d{8}T\d{6}Z$/i.test(text)) {
        const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(9, 11)}:${text.slice(11, 13)}:${text.slice(13, 15)}Z`;
        return { ...splitCalendarDateTime(iso), allDay: false };
      }
      return { date: icsDateToIsoDate(text), time: icsDateToIsoTime(text), allDay: false };
    }

    function parseIcsDuration(value = '') {
      const match = String(value || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i);
      if (!match) return 0;
      return (Number(match[1] || 0) * 24 * 60) + (Number(match[2] || 0) * 60) + Number(match[3] || 0);
    }

    function addMonthsClampedIso(isoDate = '', months = 0) {
      const date = new Date(`${String(isoDate || '').slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return '';
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, lastDay));
      return date.toISOString().slice(0, 10);
    }

    function diffDaysIso(a = '', b = '') {
      const start = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
      const end = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
      return Math.round((end - start) / 86400000);
    }

    function parseIcsRrule(value = '') {
      const result = {};
      String(value || '').split(';').forEach((part) => {
        const eq = part.indexOf('=');
        if (eq > 0) result[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
      });
      return result;
    }

    function weekdayCode(isoDate = '') {
      const date = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
      return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][date.getUTCDay()] || '';
    }

    function shouldIncludeRecurringDate(dateIso, startIso, rule = {}) {
      const interval = Math.max(1, Number(rule.INTERVAL || 1) || 1);
      const freq = String(rule.FREQ || '').toUpperCase();
      if (freq === 'DAILY') return diffDaysIso(startIso, dateIso) % interval === 0;
      if (freq === 'WEEKLY') {
        const days = String(rule.BYDAY || weekdayCode(startIso)).split(',').map((item) => item.replace(/^-?\d+/, '')).filter(Boolean);
        const weeks = Math.floor(diffDaysIso(startIso, dateIso) / 7);
        return weeks % interval === 0 && days.includes(weekdayCode(dateIso));
      }
      if (freq === 'MONTHLY') {
        const start = new Date(`${startIso}T00:00:00Z`);
        const current = new Date(`${dateIso}T00:00:00Z`);
        const months = (current.getUTCFullYear() - start.getUTCFullYear()) * 12 + current.getUTCMonth() - start.getUTCMonth();
        const allowedDays = String(rule.BYMONTHDAY || String(start.getUTCDate())).split(',').map(Number);
        return months >= 0 && months % interval === 0 && allowedDays.includes(current.getUTCDate());
      }
      if (freq === 'YEARLY') {
        const start = new Date(`${startIso}T00:00:00Z`);
        const current = new Date(`${dateIso}T00:00:00Z`);
        return (current.getUTCFullYear() - start.getUTCFullYear()) % interval === 0 && current.getUTCMonth() === start.getUTCMonth() && current.getUTCDate() === start.getUTCDate();
      }
      return false;
    }

    function buildIcsEvent(raw = {}, source = {}, occurrenceDate = '') {
      const start = raw.dtstart || {};
      const end = raw.dtend || {};
      const startDate = occurrenceDate || start.date;
      if (!startDate) return null;
      let endDate = end.date || '';
      let endTime = end.time || '';
      if (!endDate && raw.durationMinutes) {
        const startMs = Date.parse(buildCalendarDateTime(startDate, start.time || '00:00'));
        if (Number.isFinite(startMs)) {
          const endParts = splitCalendarDateTime(new Date(startMs + raw.durationMinutes * 60000).toISOString());
          endDate = endParts.date;
          endTime = start.allDay ? '' : endParts.time;
        }
      }
      if (occurrenceDate && raw.dtstart?.date && endDate) endDate = addDaysIso(occurrenceDate, Math.max(0, diffDaysIso(raw.dtstart.date, endDate)));
      const uidKey = `${raw.uid || raw.summary || startDate}-${start.time || ''}-${occurrenceDate || start.date}`;
      return {
        id: `event-ics-${hashCalendarText(`${source.id || source.cloudId || source.name}-${uidKey}`)}`,
        cloudId: '',
        externalId: raw.uid || '',
        sourceId: source.id || source.cloudId || '',
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        title: raw.summary || source.name || 'Udalost',
        date: startDate,
        time: start.allDay ? '' : start.time,
        endDate: endDate && endDate !== startDate ? endDate : '',
        endTime: start.allDay ? '' : endTime,
        type: 'event',
        location: raw.location || '',
        note: raw.description || ''
      };
    }

    function expandIcsEvent(raw = {}, source = {}, cancelledRecurrenceIds = new Map()) {
      if (!raw.dtstart?.date) return [];
      if (String(raw.status || '').toUpperCase() === 'CANCELLED') return [];
      const rule = raw.rrule ? parseIcsRrule(raw.rrule) : null;
      if (!rule?.FREQ) return [buildIcsEvent(raw, source)].filter(Boolean);
      const startIso = raw.dtstart.date;
      const windowStart = addDaysIso(todayISO(), -370);
      const windowEnd = addDaysIso(todayISO(), 730);
      const until = rule.UNTIL ? parseIcsDateValue(rule.UNTIL, {}).date : '';
      const countLimit = Math.min(Math.max(Number(rule.COUNT || 0) || 1500, 1), 1500);
      const exdates = new Set((raw.exdates || []).flatMap((item) => String(item.value || '').split(',').map((value) => parseIcsDateValue(value, item.params || {}).date)).filter(Boolean));
      (cancelledRecurrenceIds.get(raw.uid) || new Set()).forEach((date) => exdates.add(date));
      const events = [];
      let cursor = startIso;
      let produced = 0;
      let guard = 0;
      while (cursor && cursor <= windowEnd && guard < 1500 && produced < countLimit) {
        guard += 1;
        if ((!until || cursor <= until) && shouldIncludeRecurringDate(cursor, startIso, rule)) {
          produced += 1;
          if (cursor >= windowStart && !exdates.has(cursor)) {
            const event = buildIcsEvent(raw, source, cursor);
            if (event) events.push(event);
          }
        }
        if (String(rule.FREQ).toUpperCase() === 'MONTHLY') cursor = addMonthsClampedIso(cursor, 1);
        else if (String(rule.FREQ).toUpperCase() === 'YEARLY') cursor = addMonthsClampedIso(cursor, 12);
        else cursor = addDaysIso(cursor, 1);
      }
      return events;
    }

    function parseIcsEvents(text = '', source = {}) {
      const lines = unfoldIcsText(text).split('\n');
      const rawEvents = [];
      let current = null;
      lines.forEach((line) => {
        const clean = line.trimEnd();
        if (clean === 'BEGIN:VEVENT') { current = { exdates: [] }; return; }
        if (clean === 'END:VEVENT') {
          if (current) rawEvents.push(current);
          current = null;
          return;
        }
        if (!current) return;
        const parsed = parseIcsLine(clean);
        if (!parsed) return;
        if (parsed.name === 'UID') current.uid = decodeIcsValue(parsed.value);
        if (parsed.name === 'SUMMARY') current.summary = decodeIcsValue(parsed.value);
        if (parsed.name === 'DESCRIPTION') current.description = decodeIcsValue(parsed.value);
        if (parsed.name === 'LOCATION') current.location = decodeIcsValue(parsed.value);
        if (parsed.name === 'STATUS') current.status = normalizeText(parsed.value).toUpperCase();
        if (parsed.name === 'DTSTART') current.dtstart = parseIcsDateValue(parsed.value, parsed.params);
        if (parsed.name === 'DTEND') current.dtend = parseIcsDateValue(parsed.value, parsed.params);
        if (parsed.name === 'RECURRENCE-ID') current.recurrenceId = parseIcsDateValue(parsed.value, parsed.params).date;
        if (parsed.name === 'DURATION') current.durationMinutes = parseIcsDuration(parsed.value);
        if (parsed.name === 'RRULE') current.rrule = parsed.value;
        if (parsed.name === 'EXDATE') current.exdates.push(parsed);
      });
      const cancelledRecurrenceIds = new Map();
      rawEvents.forEach((event) => {
        if (String(event.status || '').toUpperCase() !== 'CANCELLED' || !event.uid || !event.recurrenceId) return;
        if (!cancelledRecurrenceIds.has(event.uid)) cancelledRecurrenceIds.set(event.uid, new Set());
        cancelledRecurrenceIds.get(event.uid).add(event.recurrenceId);
      });
      const events = rawEvents.flatMap((event) => expandIcsEvent(event, source, cancelledRecurrenceIds));
      const byId = new Map();
      events.filter((event) => event?.date && event.title).forEach((event) => byId.set(event.id, event));
      return Array.from(byId.values()).sort((a, b) => calendarEventStartMs(a) - calendarEventStartMs(b));
    }

    async function syncIcsSourcesInBrowser(sources = [], showMessage = true) {
      let total = 0;
      let removed = 0;
      let attempted = 0;
      let succeeded = 0;
      const syncedAt = new Date().toISOString();
      const sourceIds = new Set();
      for (const source of sources) {
        const url = normalizeCalendarUrl(source.providerCalendarId);
        if (!url) continue;
        attempted += 1;
        try {
          const response = await fetch(url, { cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const text = await response.text();
          const events = parseIcsEvents(text, source);
          const keys = [source.id, source.cloudId].filter(Boolean).map(String);
          keys.forEach((key) => sourceIds.add(key));
          const beforeCount = (getState().calendar || []).length;
          getState().calendar = (getState().calendar || []).filter((event) => !keys.includes(String(event.sourceId || '')));
          removed += Math.max(0, beforeCount - getState().calendar.length);
          getState().calendar.push(...events);
          source.lastSyncedAt = syncedAt;
          total += events.length;
          succeeded += 1;
        } catch (error) {
          console.warn('Browser ICS sync failed', source.name || source.providerCalendarId, error);
          if (showMessage) showToast('ICS odkaz nejde načíst. Zkontroluj odkaz nebo sdílení kalendáře.');
        }
      }
      if (sourceIds.size) {
        getState().calendarCloud = { ...(getState().calendarCloud || {}), sources: mergeCalendarSources(getCalendarSources(), sources), calendarLastSyncAt: syncedAt };
        touchState();
        saveState({ immediate: true });
        requestRender();
      }
      return attempted && !succeeded ? { ok: false, total: -1, removed: 0 } : { ok: true, total, removed, attempted, succeeded };
    }

    async function icsCalendarSync(sourceId = '', options = {}) {
      const showMessage = options.showMessage !== false;
      const sourceKey = String(sourceId || '');
      const enabledIcsSources = getCalendarSources().filter((source) => {
        if (normalizeCalendarSourceProvider(source.provider) !== 'ical' || source.isEnabled === false) return false;
        if (!sourceKey) return true;
        return [source.id, source.cloudId].filter(Boolean).map(String).includes(sourceKey);
      });
      if (!enabledIcsSources.length) {
        if (showMessage) showToast('Nemáš žádný zapnutý ICS/iCal zdroj k synchronizaci');
        return false;
      }

      const body = sourceKey
        ? { sourceId: sourceKey }
        : { sourceIds: enabledIcsSources.map((source) => source.cloudId || source.id).filter(Boolean) };
      const data = cloudReady() ? await invokeCalendarEdgeFunction('calendar-ics-sync', body, showMessage) : null;
      if (data) {
        const edgeSupportsRemovedCount = Object.prototype.hasOwnProperty.call(data, 'eventsRemoved');
        await cloudLoadCalendarSources(false);
        await cloudLoadCalendar(false);
        const browserPruneResult = edgeSupportsRemovedCount
          ? null
          : await syncIcsSourcesInBrowser(enabledIcsSources, false).catch((error) => {
              console.warn('Browser ICS prune after legacy edge sync failed', error);
              return null;
            });
        getState().calendarCloud = { ...(getState().calendarCloud || {}), calendarLastSyncAt: new Date().toISOString() };
        touchState();
        saveState({ immediate: true });
        requestRender();
        if (showMessage) {
          const count = Number(data.eventsUpserted || 0);
          const removed = Number(data.eventsRemoved || data.eventsPruned || browserPruneResult?.removed || 0);
          showToast(count || removed ? `ICS kalendář synchronizován (${count} událostí, odstraněno ${removed})` : 'ICS kalendář synchronizován');
        }
        return browserPruneResult?.ok
          ? { ...data, fallbackPruned: true, eventsRemoved: Number(data.eventsRemoved || data.eventsPruned || browserPruneResult.removed || 0) }
          : data;
      }

      const browserResult = await syncIcsSourcesInBrowser(enabledIcsSources, showMessage);
      if (browserResult?.ok) {
        if (showMessage) showToast(browserResult.total || browserResult.removed ? `ICS kalendář načten (${browserResult.total} událostí, odstraněno ${browserResult.removed})` : 'ICS kalendář načten');
        return { ok: true, fallback: 'browser', eventsUpserted: browserResult.total, eventsRemoved: browserResult.removed };
      }
      return false;
    }

    function calendarSourceSyncMs(source = {}) {
      const raw = source.lastSyncedAt || source.last_synced_at || getState().calendarCloud?.calendarLastSyncAt || '';
      const ms = raw ? Date.parse(raw) : 0;
      return Number.isFinite(ms) ? ms : 0;
    }

    // iCal zdroj je potřeba průběžně obnovovat, ale bez rušivého spinneru.
    function icsCalendarAutoSyncNeeded(sources = getCalendarSources()) {
      const icsSources = (sources || []).filter((source) => normalizeCalendarSourceProvider(source.provider) === 'ical' && source.isEnabled !== false);
      if (!icsSources.length) return false;
      const nowMs = Date.now();
      return icsSources.some((source) => {
        const syncedMs = calendarSourceSyncMs(source);
        return !syncedMs || nowMs - syncedMs > CALENDAR_AUTO_SYNC_MAX_AGE_MS;
      });
    }

    function hasEnabledIcsSources(sources = getCalendarSources()) {
      return (sources || []).some((source) => normalizeCalendarSourceProvider(source.provider) === 'ical' && source.isEnabled !== false);
    }

    function scheduleCalendarAutoSync(reason = 'auto', options = {}) {
      if (calendarAutoSyncTimer || calendarAutoSyncRunning || !cloudReady()) return;
      calendarAutoSyncTimer = runWhenUiQuiet(async () => {
        calendarAutoSyncTimer = null;
        if (calendarAutoSyncRunning || !cloudReady()) return;
        calendarAutoSyncRunning = true;
        try {
          let sources = getCalendarSources();
          if (!sources.length || options.forceLoadSources) sources = await cloudLoadCalendarSources(false);
          if (options.force || icsCalendarAutoSyncNeeded(sources)) {
            await icsCalendarSync('', { showMessage: false, auto: true, reason });
          }
        } catch (error) {
          console.warn('Calendar auto sync failed', reason, error);
        } finally {
          calendarAutoSyncRunning = false;
          if (cloudReady() && hasEnabledIcsSources()) {
            scheduleCalendarAutoSync('periodic', { delay: CALENDAR_AUTO_SYNC_CHECK_MS, quietMs: 5000, forceLoadSources: true });
          }
        }
      }, { delay: Number(options.delay || 12000), quietMs: Number(options.quietMs || 2200), timeout: Number(options.timeout || 12000) });
    }


    return {
      // dashboard / čtení
      upcomingCalendarEvents,
      calendarEventIsRunning,
      sortCalendarEventsByStart,
      calendarEventStartMs,
      calendarEventTimeLabel,
      calendarEventMetaLabel,
      visibleCalendarEvents,
      getCalendarSources,
      normalizeCalendarSourceProvider,
      getCalendarSource,
      mapCalendarSource,
      mergeCalendarSources,
      // render
      renderCalendar,
      renderCalendarEventDetailModal,
      openCalendarEventDetail,
      closeCalendarEventDetail,
      renderEventList,
      findCalendarEventById,
      shiftCalendarMonth,
      // cloud (volané z realtime / cloudLoadAllModules / nav)
      cloudLoadCalendar,
      cloudLoadCalendarSources,
      cloudSyncLocalCalendar,
      cloudSyncLocalCalendarSources,
      cloudSyncCalendarById,
      // handlery
      addEventFromForm,
      deleteCalendarEvent,
      addCalendarSourceFromForm,
      toggleCalendarSource,
      deleteCalendarSource,
      icsCalendarSync,
      scheduleCalendarAutoSync,
      ui: {
        overlay: {
          isOpen: isCalendarEventDetailOpen,
          render: renderCalendarEventDetailModal,
          close: closeCalendarEventDetail
        }
      }
    };
  }

  window.DomacnostCalendar = { createCalendar };
})();
