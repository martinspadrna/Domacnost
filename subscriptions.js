(function () {
  'use strict';

  // Předplatné: služby, lidé, sdílení, platby + měsíční matematika (kdo má platit,
  // kdo zaplatil, dluhy, přeplatky, kredity, "má se vrátit"). Extrahováno z app.js (fáze B).
  // KRITICKÉ: všechny peněžní výpočty jsou přesunuté VERBATIM, jen state.X -> getState().X.
  // 4 pole (state.subscriptions, state.subscriptionPeople, state.subscriptionPayments,
  // state.subscriptionsCloud) + UI předvolby v state.settings (subscriptionMonth/PaymentFilter/
  // PaymentDraft) se čtou i zapisují přes deps.getState() (živá reference). Dashboard widget
  // s dlužníky čte subscriptionMonthSummary() přes wrapper.
  function createSubscriptions(deps) {
    const getState = deps.getState || (() => ({}));
    const getActiveModule = deps.getActiveModule || (() => '');
    const getDetailsOpen = deps.getDetailsOpen || (() => false);
    const normalizeText = deps.normalizeText || ((v) => String(v || '').trim());
    const normalizeKey = deps.normalizeKey || ((v) => String(v || '').toLowerCase());
    const uid = deps.uid || (() => Math.random().toString(36).slice(2));
    const todayISO = deps.todayISO || (() => new Date().toISOString().slice(0, 10));
    const decimalValue = deps.decimalValue || ((v) => Number(v) || 0);
    const formatCurrency = deps.formatCurrency || ((v) => String(v || ''));
    const formatDate = deps.formatDate || ((v) => String(v || ''));
    const formatDateTime = deps.formatDateTime || ((v) => String(v || ''));
    const escapeHtml = deps.escapeHtml || ((v) => String(v ?? ''));
    const currentHouseholdId = deps.currentHouseholdId || (() => '');
    const currentProfileId = deps.currentProfileId || (() => '');
    const touchState = deps.touchState || (() => {});
    const saveState = deps.saveState || (() => {});
    const render = deps.render || (() => {});
    const renderOverlays = deps.renderOverlays || render;
    const showToast = deps.showToast || (() => {});
    const showUndoToast = deps.showUndoToast || ((text) => showToast(text));
    const persistStateSnapshot = deps.persistStateSnapshot || (() => {});
    const cloudReady = deps.cloudReady || (() => false);
    const cloudSaveHouseholdUiSettings = deps.cloudSaveHouseholdUiSettings || (() => Promise.resolve(false));
    const getModuleTab = deps.getModuleTab || ((area, fallback) => fallback);
    const field = deps.field || (() => '');
    const selectField = deps.selectField || (() => '');
    const renderSectionTabs = deps.renderSectionTabs || (() => '');
    const renderEmpty = deps.renderEmpty || (() => '');
    const renderEmptyCta = deps.renderEmptyCta || (() => '');
    const financeMonthLabel = deps.financeMonthLabel || ((v) => String(v || ''));

    const SUBSCRIPTION_SERVICE_OPTIONS = deps.SUBSCRIPTION_SERVICE_OPTIONS || [];

    // Id právě upravované služby — inline edit panel. Lokální UI stav, přežije
    // render (edit se otevírá/zavírá bez ztráty rozdělané úpravy).
    let subscriptionServiceEditId = '';
    // Id člověka, jehož dluh se právě vysvětluje v přehledu (klik na dlužníka).
    let debtorModalPersonId = '';

    function normalizeSubscriptionServiceKey(serviceKey = '') {
      const key = normalizeText(serviceKey || 'other') || 'other';
      return key === 'voyo' ? 'oneplay' : key;
    }

    function subscriptionServiceName(serviceKey = '', customName = '') {
      const key = normalizeSubscriptionServiceKey(serviceKey);
      const custom = normalizeText(customName);
      if (custom && normalizeKey(custom) !== 'voyo') return custom;
      const found = SUBSCRIPTION_SERVICE_OPTIONS.find((item) => item[0] === key);
      return found?.[1] || 'Předplatné';
    }

    function subscriptionServiceDefaultPrice(serviceKey = '') {
      const key = normalizeSubscriptionServiceKey(serviceKey);
      const found = SUBSCRIPTION_SERVICE_OPTIONS.find((item) => item[0] === key);
      return Number(found?.[2] || 0);
    }

    function subscriptionServiceDefaultMembers(serviceKey = '') {
      const key = normalizeSubscriptionServiceKey(serviceKey);
      const found = SUBSCRIPTION_SERVICE_OPTIONS.find((item) => item[0] === key);
      return Math.max(0, Math.floor(Number(found?.[3] || 0)));
    }

    function subscriptionServiceSelectOptions() {
      return SUBSCRIPTION_SERVICE_OPTIONS.map(([id, label, price, members]) => [id, `${label}${price ? ` · orientačně ${formatCurrency(price)}` : ''}${members ? ` · max ${members}` : ''}`]);
    }

    // Defaultní cena / max míst / název pro danou službu — pro autofill ve
    // formuláři, když uživatel vybere jinou službu a pole nechal prázdné.
    function subscriptionServiceDefaults(serviceKey = '') {
      const key = normalizeSubscriptionServiceKey(serviceKey);
      return {
        key,
        price: subscriptionServiceDefaultPrice(key),
        maxMembers: subscriptionServiceDefaultMembers(key),
        name: subscriptionServiceName(key, '')
      };
    }

    function subscriptionSelectedMonth() {
      const value = normalizeText(getState().settings?.subscriptionMonth);
      return /^\d{4}-\d{2}$/.test(value) ? value : todayISO().slice(0, 7);
    }

    function setSubscriptionMonth(month) {
      const safe = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : todayISO().slice(0, 7);
      getState().settings = { ...(getState().settings || {}), subscriptionMonth: safe };
      touchState();
      saveState();
      render();
    }

    function shiftSubscriptionMonth(offset) {
      const [year, month] = subscriptionSelectedMonth().split('-').map(Number);
      const date = new Date(year || new Date().getFullYear(), (month || 1) - 1 + Number(offset || 0), 1);
      setSubscriptionMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    }

    function normalizeSubscriptionPerson(person) {
      return {
        id: person.id || uid(),
        householdId: person.householdId || currentHouseholdId(),
        profileId: person.profileId || currentProfileId(),
        createdAt: person.createdAt || new Date().toISOString(),
        name: normalizeText(person.name) || 'Osoba',
        note: normalizeText(person.note)
      };
    }

    function normalizeSubscriptionService(item) {
      const serviceKey = normalizeSubscriptionServiceKey(item.serviceKey || item.service || 'other');
      const name = subscriptionServiceName(serviceKey, item.name);
      const shares = Array.isArray(item.shares) ? item.shares.filter(Boolean).map((share) => ({ personId: normalizeText(share.personId), amount: decimalValue(share.amount) })).filter((share) => share.personId && share.amount > 0) : [];
      const rawMaxMembers = item.maxMembers ?? item.memberLimit ?? item.membersLimit ?? subscriptionServiceDefaultMembers(serviceKey);
      const maxMembers = Math.max(0, Math.floor(Number(rawMaxMembers || 0)));
      return {
        id: item.id || uid(),
        householdId: item.householdId || currentHouseholdId(),
        profileId: item.profileId || currentProfileId(),
        createdAt: item.createdAt || new Date().toISOString(),
        serviceKey,
        name,
        price: decimalValue(item.price) || subscriptionServiceDefaultPrice(serviceKey) || 0,
        billingDay: Math.min(31, Math.max(1, Number(item.billingDay || 1))),
        maxMembers,
        enabled: item.enabled !== false,
        note: normalizeText(item.note),
        shares
      };
    }

    function normalizeSubscriptionPayment(item) {
      return {
        id: item.id || uid(),
        householdId: item.householdId || currentHouseholdId(),
        profileId: item.profileId || currentProfileId(),
        createdAt: item.createdAt || new Date().toISOString(),
        subscriptionId: normalizeText(item.subscriptionId),
        personId: normalizeText(item.personId),
        month: /^\d{4}-\d{2}$/.test(String(item.month || '')) ? String(item.month) : subscriptionSelectedMonth(),
        amount: decimalValue(item.amount),
        paidAt: item.paidAt || todayISO(),
        note: normalizeText(item.note)
      };
    }

    function getSubscriptionPeople() {
      getState().subscriptionPeople = Array.isArray(getState().subscriptionPeople) ? getState().subscriptionPeople.map(normalizeSubscriptionPerson) : [];
      return [...getState().subscriptionPeople].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    }

    function getSubscriptionServices() {
      getState().subscriptions = Array.isArray(getState().subscriptions) ? getState().subscriptions.map(normalizeSubscriptionService) : [];
      return [...getState().subscriptions].sort((a, b) => Number(a.enabled === false) - Number(b.enabled === false) || a.name.localeCompare(b.name, 'cs'));
    }

    function getSubscriptionPayments() {
      getState().subscriptionPayments = Array.isArray(getState().subscriptionPayments) ? getState().subscriptionPayments.map(normalizeSubscriptionPayment).filter((payment) => payment.subscriptionId && payment.personId && payment.amount > 0) : [];
      return [...getState().subscriptionPayments].sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.paidAt || '').localeCompare(String(a.paidAt || '')));
    }

    function persistSubscriptionsState({ renderView = true, toast = '' } = {}) {
      touchState();
      if (cloudReady()) getState().subscriptionsCloud = { ...(getState().subscriptionsCloud || {}), pendingAt: new Date().toISOString() };
      saveState();
      if (renderView) render();
      if (toast) showToast(toast);
      if (!cloudReady()) return Promise.resolve(true);
      return cloudSaveHouseholdUiSettings(false)
          .then((ok) => {
            if (ok && getActiveModule() === 'subscriptions' && !debtorModalPersonId) render();
            return ok;
          })
          .catch((error) => {
            console.warn('Subscription autosync failed', error);
            getState().subscriptionsCloud = { ...(getState().subscriptionsCloud || {}), pendingAt: new Date().toISOString(), error: error?.message || 'Automatická synchronizace selhala' };
            persistStateSnapshot();
            return false;
          });
    }

    function restoreSubscriptionsAfterDelete(deleteSync, restore, message) {
      restore();
      touchState();
      saveState();
      render();
      showToast(message);
      Promise.resolve(deleteSync)
        .catch(() => false)
        .then(() => persistSubscriptionsState({ renderView: false }))
        .then(() => { if (!debtorModalPersonId) render(); })
        .catch((error) => console.warn('Subscription restore cloud sync failed', error));
    }

    function subscriptionPersonName(personId) {
      return getSubscriptionPeople().find((person) => person.id === personId)?.name || 'Osoba';
    }

    function subscriptionById(id) {
      return getSubscriptionServices().find((item) => item.id === id) || null;
    }

    function subscriptionLabelById(id) {
      return subscriptionById(id)?.name || 'Služba';
    }

    function subscriptionServiceBrandMeta(serviceOrKey = '', customName = '') {
      const rawKey = typeof serviceOrKey === 'object' && serviceOrKey ? serviceOrKey.serviceKey : serviceOrKey;
      const key = normalizeSubscriptionServiceKey(rawKey || 'other');
      const name = typeof serviceOrKey === 'object' && serviceOrKey ? serviceOrKey.name : subscriptionServiceName(key, customName);
      const meta = {
        netflix: { className: 'brand-netflix' },
        disney: { className: 'brand-disney' },
        hbo: { className: 'brand-hbo' },
        skyshowtime: { className: 'brand-skyshowtime' },
        prime: { className: 'brand-prime' },
        'apple-tv': { className: 'brand-apple-tv' },
        spotify: { className: 'brand-spotify' },
        youtube: { className: 'brand-youtube' },
        oneplay: { className: 'brand-oneplay' },
        canal: { className: 'brand-canal' },
        'o2-tv': { className: 'brand-o2-tv' },
        telly: { className: 'brand-telly' },
        't-mobile': { className: 'brand-t-mobile' },
        other: { className: 'brand-other' }
      }[key] || { className: 'brand-other' };
      return { key, name, ...meta };
    }

    function renderSubscriptionBrandSvg(meta, size = 'md') {
      const variant = String(size || 'md') === 'xs' ? 'xs' : String(size || 'md') === 'sm' ? 'sm' : 'md';
      const wordSize = variant === 'xs' ? 5.2 : variant === 'sm' ? 6.2 : 7.2;
      const smallSize = variant === 'xs' ? 5.1 : variant === 'sm' ? 5.8 : 6.6;
      const mediumSize = variant === 'xs' ? 6.1 : variant === 'sm' ? 7.0 : 8.0;
      const key = meta?.key || 'other';
      const logos = {
        netflix: `<svg viewBox="0 0 44 24" role="img" aria-label="Netflix"><path d="M12 4v16h4.3V12l5.4 8H26V4h-4.3v8L16.3 4z" fill="#fff"/><path d="M14.8 4h2.8l8.3 16h-2.8z" fill="rgba(255,255,255,.18)"/></svg>`,
        disney: `<svg viewBox="0 0 44 24" role="img" aria-label="Disney Plus"><path d="M10 9.5c0-2.6 2.1-4.2 4.6-4.2 1.9 0 3.5.7 4.8 1.8" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/><text x="8" y="16.6" font-size="${wordSize}" font-weight="700" fill="#fff" font-family="Arial, sans-serif">Disney+</text></svg>`,
        hbo: `<svg viewBox="0 0 44 24" role="img" aria-label="Max"><text x="7" y="15.5" font-size="${mediumSize}" font-weight="800" fill="#fff" font-family="Arial, sans-serif">max</text></svg>`,
        skyshowtime: `<svg viewBox="0 0 44 24" role="img" aria-label="SkyShowtime"><path d="M8 7h10" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M26 17H16" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M12 6c5 1 8 4 9 9" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M32 8 34 12l4 .4-3 2.5 1 4-3-2-3 2 1-4-3-2.5 4-.4z" fill="#fff"/></svg>`,
        prime: `<svg viewBox="0 0 44 24" role="img" aria-label="Prime Video"><text x="7.5" y="13.3" font-size="${smallSize}" font-weight="700" fill="#fff" font-family="Arial, sans-serif">prime</text><path d="M12 16.2c5 2.2 10.5 2 17-.3" fill="none" stroke="#9be7ff" stroke-width="1.6" stroke-linecap="round"/><path d="m28.5 14.9 1.8 1.4-2.1.9" fill="#9be7ff"/></svg>`,
        'apple-tv': `<svg viewBox="0 0 44 24" role="img" aria-label="Apple TV Plus"><path d="M13.5 7.3c.7-.8 1.1-1.7 1-2.7-.9.1-1.9.7-2.5 1.5-.5.6-1 1.6-.9 2.5.9.1 1.8-.4 2.4-1.3Zm1.5 5.7c0-2.1 1.7-3.1 1.8-3.2-1-1.5-2.6-1.7-3.1-1.7-1.3-.1-2.6.8-3.2.8-.6 0-1.6-.8-2.6-.8-1.4 0-2.6.8-3.3 2-.7 1.2-.2 3 1.2 5 .5.7 1.2 1.6 2 1.6.8 0 1.1-.5 2.1-.5 1 0 1.3.5 2.1.5.9 0 1.4-.8 1.9-1.5.6-.8.9-1.6 1-1.7-.1 0-1.9-.7-1.9-2.5Z" fill="#fff" transform="translate(7,2) scale(.58)"/><text x="18" y="15.4" font-size="${smallSize}" font-weight="700" fill="#fff" font-family="Arial, sans-serif">tv+</text></svg>`,
        spotify: `<svg viewBox="0 0 44 24" role="img" aria-label="Spotify"><circle cx="12" cy="12" r="7" fill="#fff" opacity=".14"/><path d="M8.5 10.2c4.1-1 8.2-.4 11.5 1" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><path d="M9.4 13c3.3-.7 6.4-.2 9 1" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M10.5 15.6c2.2-.4 4.2-.1 5.9.8" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>`,
        youtube: `<svg viewBox="0 0 44 24" role="img" aria-label="YouTube Premium"><rect x="8" y="6.8" width="13" height="10.4" rx="3.3" fill="#fff"/><path d="m14 9.4 4.4 2.6-4.4 2.6z" fill="#d00"/><text x="23" y="15.4" font-size="${smallSize}" font-weight="700" fill="#fff" font-family="Arial, sans-serif">Premium</text></svg>`,
        oneplay: `<svg viewBox="0 0 44 24" role="img" aria-label="Oneplay"><path d="m10 7 8 5-8 5z" fill="#fff"/><text x="19.5" y="15.3" font-size="${smallSize}" font-weight="700" fill="#fff" font-family="Arial, sans-serif">oneplay</text></svg>`,
        canal: `<svg viewBox="0 0 44 24" role="img" aria-label="Canal Plus"><rect x="8" y="7" width="18" height="10" rx="2.2" fill="#fff" opacity=".17"/><text x="10.5" y="14.8" font-size="${smallSize}" font-weight="800" fill="#fff" font-family="Arial, sans-serif">CANAL+</text></svg>`,
        'o2-tv': `<svg viewBox="0 0 44 24" role="img" aria-label="O2 TV"><text x="8" y="15.3" font-size="${mediumSize}" font-weight="800" fill="#fff" font-family="Arial, sans-serif">O2</text><text x="22" y="15.3" font-size="${smallSize}" font-weight="700" fill="#fff" font-family="Arial, sans-serif">TV</text></svg>`,
        telly: `<svg viewBox="0 0 44 24" role="img" aria-label="Telly"><text x="10" y="15.3" font-size="${mediumSize}" font-weight="800" fill="#fff" font-family="Arial, sans-serif">telly</text></svg>`,
        't-mobile': `<svg viewBox="0 0 44 24" role="img" aria-label="T-Mobile"><text x="11" y="14.6" font-size="${mediumSize}" font-weight="800" fill="#fff" font-family="Arial, sans-serif">T</text><circle cx="23" cy="11.5" r="1.6" fill="#fff"/><circle cx="28.5" cy="11.5" r="1.6" fill="#fff"/></svg>`,
        other: `<svg viewBox="0 0 44 24" role="img" aria-label="Vlastní služba"><text x="11" y="15.2" font-size="${smallSize}" font-weight="700" fill="#fff" font-family="Arial, sans-serif">služba</text></svg>`
      };
      return logos[key] || logos.other;
    }

    function renderSubscriptionServiceIcon(serviceOrKey = '', options = {}) {
      const meta = subscriptionServiceBrandMeta(serviceOrKey, options.name || '');
      const size = options.size || 'md';
      const showName = options.showName !== false;
      const extraClass = options.extraClass ? ` ${options.extraClass}` : '';
      return `<span class="subscription-service-brand subscription-service-brand-${escapeHtml(String(size))} ${escapeHtml(meta.className)}${extraClass}" aria-hidden="true">${renderSubscriptionBrandSvg(meta, size)}</span>${showName ? `<span class="subscription-service-brand-name">${escapeHtml(meta.name)}</span>` : ''}`;
    }

    function subscriptionPaymentFilter() {
      const value = normalizeText(getState().settings?.subscriptionPaymentFilter || 'all');
      return ['all', 'unpaid', 'debtors'].includes(value) ? value : 'all';
    }

    function setSubscriptionPaymentFilter(filter) {
      getState().settings = { ...(getState().settings || {}), subscriptionPaymentFilter: ['all', 'unpaid', 'debtors'].includes(filter) ? filter : 'all' };
      touchState();
      saveState();
      render();
    }

    function subscriptionFilteredPeopleRows(summary, filter = subscriptionPaymentFilter()) {
      const rows = Array.isArray(summary?.peopleRows) ? summary.peopleRows : [];
      // Dlužník je i ten, kdo má zaplacený aktuální měsíc, ale visí mu starší
      // měsíc - proto kumulativní dluh, ne jen dluh zvoleného měsíce.
      if (filter === 'debtors' || filter === 'unpaid') return rows.filter((row) => row.cumulativeDebt > 0);
      return rows;
    }

    function subscriptionVisibleShares(service, month = subscriptionSelectedMonth(), filter = subscriptionPaymentFilter(), summary = subscriptionMonthSummary(month)) {
      const shares = Array.isArray(service?.shares) ? service.shares : [];
      if (filter === 'all') return shares;
      const debtPersonIds = new Set((summary.peopleRows || []).filter((row) => row.cumulativeDebt > 0).map((row) => row.person.id));
      return shares.filter((share) => {
        if (filter === 'debtors' && !debtPersonIds.has(share.personId)) return false;
        return !subscriptionIsPaid(share.personId, service.id, month) || subscriptionCumulativeDebt(share.personId, service.id, month) > 0;
      });
    }

    function subscriptionCapacity(service) {
      const maxMembers = Math.max(0, Math.floor(Number(service?.maxMembers || 0)));
      const used = Array.isArray(service?.shares) ? service.shares.length : 0;
      const free = maxMembers ? Math.max(0, maxMembers - used) : null;
      return { maxMembers, used, free, isFull: Boolean(maxMembers && used >= maxMembers) };
    }

    function subscriptionCapacityLabel(service) {
      const capacity = subscriptionCapacity(service);
      if (!capacity.maxMembers) return `${capacity.used} míst obsazeno · bez limitu`;
      return `${capacity.used}/${capacity.maxMembers} míst · volno ${capacity.free}`;
    }

    function subscriptionServiceOptions(includeEmpty = false) {
      const rows = getSubscriptionServices().map((item) => [item.id, `${item.name} · ${formatCurrency(item.price)} · ${subscriptionCapacityLabel(item)}`]);
      return includeEmpty ? [['', 'Vyber službu'], ...rows] : rows;
    }

    function subscriptionServiceOptionsForPerson(personId, includeEmpty = false) {
      const rows = getSubscriptionServices()
        .filter((service) => service.enabled !== false)
        .map((service) => {
          const share = (service.shares || []).find((entry) => entry.personId === personId);
          const capacity = subscriptionCapacity(service);
          if (!share && capacity.isFull) return null;
          const status = share
            ? `už přiřazeno · ${formatCurrency(share.amount)}`
            : capacity.maxMembers
              ? `volno ${capacity.free}/${capacity.maxMembers}`
              : 'bez limitu';
          return [service.id, `${service.name} · ${formatCurrency(service.price)} · ${status}`];
        })
        .filter(Boolean);
      return includeEmpty ? [['', rows.length ? 'Vyber službu' : 'Žádná služba nemá volné místo'], ...rows] : rows;
    }

    function subscriptionShareAmountForPerson(personId, subscriptionId) {
      const service = subscriptionById(subscriptionId);
      const share = service?.shares?.find((entry) => entry.personId === personId);
      return share ? decimalValue(share.amount) : 0;
    }

    function subscriptionPersonAssignedServices(personId) {
      return getSubscriptionServices().filter((service) => (service.shares || []).some((share) => share.personId === personId));
    }

    // Rozpočítání jedné přijaté částky mezi všechny služby dané osoby -
    // MĚSÍC PO MĚSÍCI, VŠECHNY SLUŽBY NAJEDNOU ("lockstep"), ne napřed
    // rozdělit celou částku podle poměru cen a pak dopočítávat historii
    // každé služby zvlášť. Ten druhý přístup (vyzkoušeno a zahozeno) vypadá
    // rozumně, ale při RŮZNÝCH cenách služeb (např. 240 a 70) a RŮZNÉ
    // historii plateb u každé z nich se jim rozjíždí kolik měsíců dopředu
    // je která "napřed" - výsledkem je, že se v jednom měsíci jedna služba
    // dopočítá a druhá ne, takže součet za osobu vyjde na divné číslo
    // (např. započteno 266 míso čistých 310 + 40 kredit).
    // Lockstep: pro KAŽDÝ měsíc od nejstaršího dluhu dál se napřed spočítá
    // nedoplatek VŠECH služeb za TEN měsíc; pokud peníze na celý měsíc
    // stačí, doplatí se všem službám současně a jde se na další měsíc;
    // pokud nestačí, rozdělí se zbytek poměrně jen mezi nedoplatky TOHO
    // posledního měsíce a končí se - obě/všechny služby tak mají vždy
    // zaplaceno přesně do stejného měsíce.
    function subscriptionBulkPaymentPlan(personId, amount) {
      const currentMonthKey = todayISO().slice(0, 7);
      const currentMonthIndex = subscriptionMonthToIndex(currentMonthKey);
      const shares = subscriptionPersonAssignedServices(personId)
        .map((service) => ({ service, expected: subscriptionShareAmountForPerson(personId, service.id) }))
        .filter((row) => row.expected > 0);
      if (!shares.length || !(amount > 0)) return [];
      const combinedExpected = shares.reduce((sum, row) => sum + row.expected, 0);
      if (!(combinedExpected > 0)) return [];

      const firstIndexes = shares
        .map((row) => subscriptionFirstPaymentIndex(personId, row.service.id))
        .filter((index) => index !== null);
      const startIndex = firstIndexes.length ? Math.min(...firstIndexes, currentMonthIndex) : currentMonthIndex;
      const maxIndex = startIndex + 239;

      const paidByServiceMonth = new Map();
      shares.forEach((row) => {
        const payments = getSubscriptionPayments().filter((payment) => payment.personId === personId && payment.subscriptionId === row.service.id);
        const monthTotals = new Map();
        payments.forEach((payment) => monthTotals.set(payment.month, (monthTotals.get(payment.month) || 0) + decimalValue(payment.amount)));
        paidByServiceMonth.set(row.service.id, monthTotals);
      });

      const entriesByService = new Map(shares.map((row) => [row.service.id, []]));
      let remaining = Math.round(amount);

      for (let index = startIndex; index <= maxIndex && remaining > 0; index += 1) {
        const monthKey = subscriptionIndexToMonth(index);
        const monthShortfalls = shares
          .map((row) => {
            const already = paidByServiceMonth.get(row.service.id).get(monthKey) || 0;
            return { service: row.service, shortfall: Math.max(0, Math.round(row.expected - already)) };
          })
          .filter((row) => row.shortfall > 0);
        if (!monthShortfalls.length) continue;
        const monthTotal = monthShortfalls.reduce((sum, row) => sum + row.shortfall, 0);
        if (remaining >= monthTotal) {
          monthShortfalls.forEach((row) => entriesByService.get(row.service.id).push({ month: monthKey, amount: row.shortfall }));
          remaining -= monthTotal;
        } else {
          // Poslední měsíc, na který už peníze nestačí celé: nejdřív doplatit
          // jednu službu do plna (v pořadí services), zbytek teprve do další -
          // ne poměrně rozpočítat mezi obě najednou.
          let partRemaining = remaining;
          monthShortfalls.forEach((row) => {
            if (partRemaining <= 0) return;
            const part = Math.min(row.shortfall, partRemaining);
            partRemaining -= part;
            if (part > 0) entriesByService.get(row.service.id).push({ month: monthKey, amount: part });
          });
          remaining = 0;
        }
      }

      return shares
        .map((row) => ({ service: row.service, entries: entriesByService.get(row.service.id) || [] }))
        .filter((row) => row.entries.length > 0);
    }

    function subscriptionPersonAvailableServiceCount(personId) {
      return subscriptionServiceOptionsForPerson(personId, false).length;
    }

    function subscriptionPersonOptions(includeEmpty = false) {
      const rows = getSubscriptionPeople().map((person) => [person.id, person.name]);
      return includeEmpty ? [['', 'Vyber člověka'], ...rows] : rows;
    }

    function subscriptionUnpaidShares(month = subscriptionSelectedMonth()) {
      return getSubscriptionServices()
        .filter((service) => service.enabled !== false)
        .flatMap((service) => (Array.isArray(service.shares) ? service.shares : [])
          .filter((share) => share.personId && decimalValue(share.amount) > 0 && !subscriptionIsPaid(share.personId, service.id, month))
          .map((share) => ({ service, share, person: getSubscriptionPeople().find((item) => item.id === share.personId) || null })));
    }

    function subscriptionRemainingAmount(personId, subscriptionId, month = subscriptionSelectedMonth()) {
      const expected = subscriptionShareAmountForPerson(personId, subscriptionId);
      const paid = subscriptionPaidAmount(personId, subscriptionId, month);
      return Math.max(0, decimalValue(expected) - decimalValue(paid));
    }

    function subscriptionPaymentDraft() {
      const draft = getState().settings?.subscriptionPaymentDraft || {};
      return {
        subscriptionId: normalizeText(draft.subscriptionId),
        personId: normalizeText(draft.personId),
        month: /^\d{4}-\d{2}$/.test(String(draft.month || '')) ? String(draft.month) : subscriptionSelectedMonth()
      };
    }

    function setSubscriptionPaymentDraft(partial = {}, options = {}) {
      const current = subscriptionPaymentDraft();
      const month = /^\d{4}-\d{2}$/.test(String((partial.month ?? current.month) || '')) ? String(partial.month ?? current.month) : subscriptionSelectedMonth();
      const draft = {
        subscriptionId: normalizeText(partial.subscriptionId ?? current.subscriptionId),
        personId: normalizeText(partial.personId ?? current.personId),
        month
      };
      getState().settings = { ...(getState().settings || {}), subscriptionPaymentDraft: draft };
      touchState();
      saveState();
      if (options.render !== false) render();
    }

    function clearSubscriptionPaymentDraft(keepMonth = subscriptionSelectedMonth()) {
      getState().settings = { ...(getState().settings || {}), subscriptionPaymentDraft: { subscriptionId: '', personId: '', month: keepMonth } };
    }

    function subscriptionPaymentServiceOptions(personId = '', month = subscriptionSelectedMonth(), includeEmpty = false) {
      const rows = getSubscriptionServices()
        .filter((service) => service.enabled !== false)
        .map((service) => {
          const shares = Array.isArray(service.shares) ? service.shares : [];
          // Kumulativní dluh: nabídnout i člověka, který má aktuální měsíc
          // zaplacený, ale visí mu starší měsíc.
          const matchingShares = shares.filter((share) => (!personId || share.personId === personId) && share.personId && subscriptionCumulativeDebt(share.personId, service.id, month) > 0);
          if (!matchingShares.length) return null;
          const labelPerson = personId ? subscriptionPersonName(personId) : `${matchingShares.length} nezapl.`;
          const amount = personId ? subscriptionCumulativeDebt(personId, service.id, month) : matchingShares.reduce((sum, share) => sum + subscriptionCumulativeDebt(share.personId, service.id, month), 0);
          return [service.id, `${service.name} · ${labelPerson} · zbývá ${formatCurrency(amount)}`];
        })
        .filter(Boolean);
      return includeEmpty ? [['', rows.length ? 'Vyber službu' : 'Vše je pro měsíc zaplacené'], ...rows] : rows;
    }

    function subscriptionPaymentPersonOptions(subscriptionId = '', month = subscriptionSelectedMonth(), includeEmpty = false) {
      const people = getSubscriptionPeople();
      const rows = people.map((person) => {
        const services = getSubscriptionServices().filter((service) => service.enabled !== false && (!subscriptionId || service.id === subscriptionId));
        const unpaidServices = services.filter((service) => {
          const share = (service.shares || []).find((entry) => entry.personId === person.id);
          return share && decimalValue(share.amount) > 0 && subscriptionCumulativeDebt(person.id, service.id, month) > 0;
        });
        if (!unpaidServices.length) return null;
        const amount = unpaidServices.reduce((sum, service) => sum + subscriptionCumulativeDebt(person.id, service.id, month), 0);
        const serviceLabel = subscriptionId ? subscriptionLabelById(subscriptionId) : `${unpaidServices.length} služ.`;
        return [person.id, `${person.name} · ${serviceLabel} · zbývá ${formatCurrency(amount)}`];
      }).filter(Boolean);
      return includeEmpty ? [['', rows.length ? 'Vyber člověka' : 'Nikdo nemá nezaplaceno'], ...rows] : rows;
    }

    function normalizeSubscriptionPaymentDraft(draft = subscriptionPaymentDraft()) {
      const month = /^\d{4}-\d{2}$/.test(String(draft.month || '')) ? String(draft.month) : subscriptionSelectedMonth();
      let subscriptionId = normalizeText(draft.subscriptionId);
      let personId = normalizeText(draft.personId);

      if (subscriptionId) {
        const allowedPeople = new Set(subscriptionPaymentPersonOptions(subscriptionId, month, false).map(([id]) => id));
        if (personId && !allowedPeople.has(personId)) personId = '';
      }
      if (personId) {
        const allowedServices = new Set(subscriptionPaymentServiceOptions(personId, month, false).map(([id]) => id));
        if (subscriptionId && !allowedServices.has(subscriptionId)) subscriptionId = '';
      }
      return { subscriptionId, personId, month };
    }

    function subscriptionExpectedForPerson(personId, month = subscriptionSelectedMonth()) {
      return getSubscriptionServices().filter((service) => service.enabled !== false).reduce((sum, service) => {
        const share = (service.shares || []).find((entry) => entry.personId === personId);
        return sum + (share ? decimalValue(share.amount) : 0);
      }, 0);
    }

    function subscriptionPaymentsForMonth(month = subscriptionSelectedMonth()) {
      return getSubscriptionPayments().filter((payment) => payment.month === month);
    }

    function normalizeSubscriptionMonthKey(month = subscriptionSelectedMonth()) {
      return /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : todayISO().slice(0, 7);
    }

    function subscriptionMonthToIndex(month = subscriptionSelectedMonth()) {
      const safe = normalizeSubscriptionMonthKey(month);
      const [year, monthIndex] = safe.split('-').map(Number);
      return (year * 12) + (monthIndex - 1);
    }

    function subscriptionIndexToMonth(index) {
      const year = Math.floor(Number(index || 0) / 12);
      const month = (Number(index || 0) % 12) + 1;
      return `${year}-${String(month).padStart(2, '0')}`;
    }

    function subscriptionDirectPaidAmount(personId, subscriptionId, month = subscriptionSelectedMonth()) {
      const safeMonth = normalizeSubscriptionMonthKey(month);
      return getSubscriptionPayments()
        .filter((payment) => payment.month === safeMonth && payment.personId === personId && payment.subscriptionId === subscriptionId)
        .reduce((sum, payment) => sum + decimalValue(payment.amount), 0);
    }

    function subscriptionCreditBeforeMonth(personId, subscriptionId, month = subscriptionSelectedMonth()) {
      const expected = subscriptionShareAmountForPerson(personId, subscriptionId);
      if (!(expected > 0)) return 0;
      const targetIndex = subscriptionMonthToIndex(month);
      const payments = getSubscriptionPayments().filter((payment) => payment.personId === personId && payment.subscriptionId === subscriptionId && subscriptionMonthToIndex(payment.month) < targetIndex);
      if (!payments.length) return 0;
      const firstIndex = Math.min(...payments.map((payment) => subscriptionMonthToIndex(payment.month)));
      let credit = 0;
      for (let index = firstIndex; index < targetIndex; index += 1) {
        const monthKey = subscriptionIndexToMonth(index);
        const paid = payments.filter((payment) => payment.month === monthKey).reduce((sum, payment) => sum + decimalValue(payment.amount), 0);
        credit = Math.max(0, credit + paid - expected);
      }
      return credit;
    }

    function subscriptionEffectivePaidAmount(personId, subscriptionId, month = subscriptionSelectedMonth()) {
      return subscriptionDirectPaidAmount(personId, subscriptionId, month) + subscriptionCreditBeforeMonth(personId, subscriptionId, month);
    }

    function subscriptionFirstPaymentIndex(personId, subscriptionId) {
      const payments = getSubscriptionPayments().filter((payment) => payment.personId === personId && payment.subscriptionId === subscriptionId && decimalValue(payment.amount) > 0);
      if (!payments.length) return null;
      return Math.min(...payments.map((payment) => subscriptionMonthToIndex(payment.month)));
    }

    // Kumulativní dluh: kolik člověk za službu dluží CELKEM ke zvolenému měsíci,
    // ne jen za ten jeden měsíc. "Používá službu" se počítá od měsíce jeho první
    // zadané platby - od té doby má každý měsíc platit podíl. Bez jediné platby
    // se počítá jen zvolený měsíc (žádný zpětný dluh za dobu před připojením).
    // Přeplatky se započítávají automaticky (suma všech plateb do zvoleného
    // měsíce včetně proti sumě očekávaných podílů).
    function subscriptionCumulativeDebt(personId, subscriptionId, month = subscriptionSelectedMonth()) {
      const expected = subscriptionShareAmountForPerson(personId, subscriptionId);
      if (!(expected > 0)) return 0;
      const targetIndex = subscriptionMonthToIndex(month);
      const firstIndex = subscriptionFirstPaymentIndex(personId, subscriptionId);
      const startIndex = firstIndex === null ? targetIndex : Math.min(firstIndex, targetIndex);
      // Pojistka proti rozbitému datu platby (překlep roku apod.) - dluh se
      // nepočítá dál než 10 let zpátky.
      const monthsCount = Math.min(120, targetIndex - startIndex + 1);
      const totalExpected = expected * monthsCount;
      const totalPaid = getSubscriptionPayments()
        .filter((payment) => payment.personId === personId && payment.subscriptionId === subscriptionId && subscriptionMonthToIndex(payment.month) <= targetIndex)
        .reduce((sum, payment) => sum + decimalValue(payment.amount), 0);
      return Math.max(0, totalExpected - totalPaid);
    }

    function subscriptionCumulativeDebtMonths(personId, subscriptionId, month = subscriptionSelectedMonth()) {
      const expected = subscriptionShareAmountForPerson(personId, subscriptionId);
      const debt = subscriptionCumulativeDebt(personId, subscriptionId, month);
      if (!(expected > 0) || !(debt > 0)) return 0;
      return Math.ceil(debt / expected);
    }

    function subscriptionPaidAmount(personId, subscriptionId, month = subscriptionSelectedMonth()) {
      return subscriptionEffectivePaidAmount(personId, subscriptionId, month);
    }

    function subscriptionIsPaid(personId, subscriptionId, month = subscriptionSelectedMonth()) {
      const service = subscriptionById(subscriptionId);
      const share = service?.shares?.find((entry) => entry.personId === personId);
      const expected = decimalValue(share?.amount);
      return expected > 0 && subscriptionEffectivePaidAmount(personId, subscriptionId, month) >= expected;
    }

    function subscriptionMonthSummary(month = subscriptionSelectedMonth()) {
      const services = getSubscriptionServices().filter((item) => item.enabled !== false);
      const people = getSubscriptionPeople();
      const payments = subscriptionPaymentsForMonth(month);
      const totalCost = services.reduce((sum, item) => sum + decimalValue(item.price), 0);
      const expectedReturn = services.reduce((sum, item) => sum + (item.shares || []).reduce((inner, share) => inner + decimalValue(share.amount), 0), 0);
      const paid = payments.reduce((sum, item) => sum + decimalValue(item.amount), 0);
      const netCost = totalCost - expectedReturn;
      const capacityRows = services.map(subscriptionCapacity);
      const maxSlots = capacityRows.reduce((sum, row) => sum + row.maxMembers, 0);
      const usedSlots = capacityRows.reduce((sum, row) => sum + row.used, 0);
      const freeSlots = capacityRows.reduce((sum, row) => sum + (row.free || 0), 0);
      const fullServices = capacityRows.filter((row) => row.isFull).length;
      const futurePayments = getSubscriptionPayments().filter((payment) => payment.month > month);
      const peopleRows = people.map((person) => {
        const serviceRows = services
          .map((service) => {
            const share = (service.shares || []).find((entry) => entry.personId === person.id);
            if (!share || !(decimalValue(share.amount) > 0)) return null;
            const expected = decimalValue(share.amount);
            const directPaid = subscriptionDirectPaidAmount(person.id, service.id, month);
            const creditApplied = Math.min(expected, subscriptionCreditBeforeMonth(person.id, service.id, month));
            const paidForService = directPaid + creditApplied;
            return {
              service,
              expected,
              paid: paidForService,
              directPaid,
              creditApplied,
              debt: Math.max(0, expected - paidForService),
              // Celkový dluh napříč měsíci (od první platby), ne jen zvolený měsíc.
              cumulativeDebt: subscriptionCumulativeDebt(person.id, service.id, month),
              debtMonths: subscriptionCumulativeDebtMonths(person.id, service.id, month),
              overpaid: Math.max(0, directPaid + subscriptionCreditBeforeMonth(person.id, service.id, month) - expected)
            };
          })
          .filter(Boolean);
        const expected = serviceRows.reduce((sum, row) => sum + row.expected, 0);
        const directPaidForMonth = payments.filter((payment) => payment.personId === person.id).reduce((sum, payment) => sum + decimalValue(payment.amount), 0);
        const paidForMonth = serviceRows.reduce((sum, row) => sum + row.paid, 0);
        const creditApplied = serviceRows.reduce((sum, row) => sum + row.creditApplied, 0);
        const debt = serviceRows.reduce((sum, row) => sum + row.debt, 0);
        const cumulativeDebt = serviceRows.reduce((sum, row) => sum + row.cumulativeDebt, 0);
        const serviceOverpaid = serviceRows.reduce((sum, row) => sum + row.overpaid, 0);
        const extraPayments = Math.max(0, directPaidForMonth - serviceRows.reduce((sum, row) => sum + row.directPaid, 0));
        const future = futurePayments.filter((payment) => payment.personId === person.id).reduce((sum, payment) => sum + decimalValue(payment.amount), 0);
        return { person, expected, paid: paidForMonth, directPaid: directPaidForMonth, creditApplied, debt, cumulativeDebt, overpaid: serviceOverpaid + extraPayments, future, serviceRows };
      });
      const owed = peopleRows.reduce((sum, row) => sum + decimalValue(row.debt), 0);
      const owedTotal = peopleRows.reduce((sum, row) => sum + decimalValue(row.cumulativeDebt), 0);
      const creditsApplied = peopleRows.reduce((sum, row) => sum + decimalValue(row.creditApplied), 0);
      return { month, services, people, payments, totalCost, expectedReturn, paid, creditsApplied, owed, owedTotal, netCost, maxSlots, usedSlots, freeSlots, fullServices, futurePayments, peopleRows };
    }

    function renderSubscriptions() {
      let activeTab = getModuleTab('subscriptions', 'overview');
      if (!['overview', 'services', 'people', 'payments'].includes(activeTab)) activeTab = 'overview';
      const month = subscriptionSelectedMonth();
      const summary = subscriptionMonthSummary(month);
      const services = summary.services;
      const people = summary.people;
      const allServices = getSubscriptionServices();
      const tabs = renderSectionTabs('subscriptions', [
        { id: 'overview', label: 'Přehled', icon: '🎬', count: services.length },
        { id: 'services', label: 'Služby', icon: '📺', count: allServices.length },
        { id: 'people', label: 'Lidé', icon: '👥', count: people.length },
        { id: 'payments', label: 'Platby', icon: '✅', count: summary.payments.length }
      ], 'overview');
      const wrap = (content) => `
        ${tabs}
        <div class="grid two module-tabbed subscriptions-tab-${escapeHtml(activeTab)} subscriptions-module" data-tab-area="subscriptions">
          ${content}
        </div>`;

      if (activeTab === 'services') {
        return wrap(`
          <section class="card desktop-span-2 subscription-panel panel-services">
            <div class="card-header"><div><h2>Služby</h2><p>Vyber službu, uprav cenu a potom nastav, kdo ti za ni kolik platí.</p></div><span class="badge">${allServices.length}</span></div>
            <details class="action-details compact-edit-details subscription-form-drawer" data-details-key="subscription-add-service" ${getDetailsOpen('subscription-add-service') ? 'open' : ''}>
              <summary><span>Přidat službu</span><em>Netflix, Disney+, Spotify nebo vlastní</em></summary>
              <form data-form="add-subscription" class="compact-form">
                <div class="form-grid two">
                  ${selectField('Služba', 'serviceKey', subscriptionServiceSelectOptions(), 'netflix')}
                  ${field('Vlastní název', 'name', 'text', 'vyplň jen u vlastní služby')}
                  ${field('Cena / měsíc', 'price', 'number', 'např. 319', true)}
                  ${field('Den stržení', 'billingDay', 'number', '1–31', false, '1')}
                  ${field('Max míst / členů', 'maxMembers', 'number', 'např. 5', false)}
                  ${field('Poznámka', 'note', 'text', 'např. rodinný tarif')}
                </div>
                <div class="form-actions"><button class="primary-btn" type="submit">Přidat službu</button></div>
              </form>
            </details>
            ${allServices.length ? `<div class="list compact-list">${allServices.map(renderSubscriptionServiceItem).join('')}</div>` : renderEmpty('Zatím není uložená žádná služba.')}
          </section>
          <section class="card subscription-panel panel-services">
            <div class="card-header"><div><h2>Přiřadit člověka ke službě</h2><p>Kolik ti má konkrétní člověk platit za konkrétní službu.</p></div></div>
            ${allServices.length && people.length ? `
              <form data-form="add-subscription-share" class="compact-form">
                <div class="form-grid two">
                  ${selectField('Služba', 'subscriptionId', subscriptionServiceOptions(true), '')}
                  ${selectField('Člověk', 'personId', subscriptionPersonOptions(true), '')}
                  ${field('Částka / měsíc', 'amount', 'number', 'např. 80', true)}
                </div>
                <div class="form-actions"><button class="primary-btn" type="submit">Přidat / upravit sdílení</button></div>
              </form>
            ` : renderEmpty('Nejdřív přidej aspoň jednu službu a jednoho člověka.')}
          </section>`);
      }

      if (activeTab === 'people') {
        return wrap(`
          <section class="card desktop-span-2 subscription-panel panel-people">
            <div class="card-header"><div><h2>Lidé</h2><p>Klikni na člověka a přiřaď mu službu včetně částky. Volná místa u služeb se přepočítají sama.</p></div><span class="badge">${people.length}</span></div>
            <details class="action-details compact-edit-details subscription-form-drawer" data-details-key="subscription-add-person" ${getDetailsOpen('subscription-add-person') ? 'open' : ''}>
              <summary><span>Přidat člověka</span><em>kamarád, rodina, kolega</em></summary>
              <form data-form="add-subscription-person" class="compact-form">
                <div class="form-grid two">
                  ${field('Jméno', 'name', 'text', 'např. Lukáš', true)}
                  ${field('Poznámka', 'note', 'text', 'volitelné')}
                </div>
                <div class="form-actions"><button class="primary-btn" type="submit">Přidat člověka</button></div>
              </form>
            </details>
            ${people.length ? `<div class="list compact-list">${summary.peopleRows.map(renderSubscriptionPersonDetail).join('')}</div>` : renderEmpty('Zatím tu nejsou žádní lidé.')}
          </section>`);
      }

      if (activeTab === 'payments') {
        const allPayments = getSubscriptionPayments();
        const paymentDraft = normalizeSubscriptionPaymentDraft(subscriptionPaymentDraft());
        const paymentServiceOptions = subscriptionPaymentServiceOptions(paymentDraft.personId, paymentDraft.month, true);
        const paymentPersonOptions = subscriptionPaymentPersonOptions(paymentDraft.subscriptionId, paymentDraft.month, true);
        const paymentDefaultAmount = paymentDraft.subscriptionId && paymentDraft.personId ? subscriptionRemainingAmount(paymentDraft.personId, paymentDraft.subscriptionId, paymentDraft.month) : 0;
        return wrap(`
          <section class="card subscription-panel panel-payments">
            <div class="card-header"><div><h2>Zapsat platbu / předplatné dopředu</h2><p>Když někdo zaplatí ručně nebo dopředu na další měsíc.</p></div></div>
            ${allServices.length && people.length ? `
              <form data-form="add-subscription-payment" class="compact-form subscription-smart-payment-form">
                <div class="form-grid two">
                  ${selectField('Služba', 'subscriptionId', paymentServiceOptions, paymentDraft.subscriptionId)}
                  ${selectField('Člověk', 'personId', paymentPersonOptions, paymentDraft.personId)}
                  ${field('Měsíc', 'month', 'month', '', false, paymentDraft.month)}
                  ${field('Částka', 'amount', 'number', 'např. 80', true, paymentDefaultAmount ? String(paymentDefaultAmount) : '')}
                  ${field('Poznámka', 'note', 'text', 'např. zaplaceno dopředu')}
                </div>
                <div class="inline-note compact-note subscription-payment-hint">Vybereš službu → nabídnou se jen lidi, kteří ji mají a ještě ji nemají zaplacenou. Vybereš člověka → nabídnou se jen jeho nezaplacené služby. Částka se předvyplní podle nastaveného sdílení.</div>
                <div class="form-actions"><button class="primary-btn" type="submit">Zapsat platbu</button></div>
              </form>
            ` : renderEmpty('Nejdřív přidej službu a člověka.')}
          </section>
          <section class="card subscription-panel panel-payments">
            <div class="card-header"><div><h2>Historie plateb</h2><p>Poslední zápisy plateb a přeplatků.</p></div><span class="badge">${allPayments.length}</span></div>
            ${allPayments.length ? `<div class="list compact-list">${allPayments.slice(0, 24).map(renderSubscriptionPaymentItem).join('')}</div>` : renderEmpty('Zatím není zapsaná žádná platba.')}
          </section>`);
      }

      const paymentFilter = subscriptionPaymentFilter();
      const visiblePeopleRows = subscriptionFilteredPeopleRows(summary, paymentFilter);
      const visiblePaymentServices = services
        .map((service) => ({ service, visibleShares: subscriptionVisibleShares(service, month, paymentFilter, summary) }))
        .filter((row) => paymentFilter === 'all' || row.visibleShares.length);
      const serviceOverviewCards = services.slice(0, 8).map((service) => {
        const shares = service.shares || [];
        const shareTotal = shares.reduce((sum, share) => sum + decimalValue(share.amount), 0);
        const capacity = subscriptionCapacity(service);
        const ownCost = Math.max(0, decimalValue(service.price) - shareTotal);
        return `
          <div class="subscription-overview-service">
            <div class="subscription-overview-service-head">${renderSubscriptionServiceIcon(service, { size: 'xs', showName: false })}<span class="badge ${capacity.isFull ? 'warn' : capacity.used ? 'good' : ''}">${capacity.maxMembers ? `${capacity.used}/${capacity.maxMembers}` : `${capacity.used}`}</span></div>
            <strong class="subscription-overview-service-name">${escapeHtml(service.name)}</strong>
            <div class="subscription-overview-service-meta"><span>Cena ${formatCurrency(service.price)}</span><span>Vrací se ${formatCurrency(shareTotal)}</span><span>Tvoje část ${formatCurrency(ownCost)}</span></div>
          </div>`;
      }).join('');

      return wrap(`
          <section class="card desktop-span-2 subscription-panel panel-overview">
            <div class="card-header"><div><h2>Tento měsíc</h2><p>Streamovací služby, sdílení s lidmi a měsíční kontrola, kdo už zaplatil.</p></div><span class="badge ${summary.owedTotal ? 'warn' : 'good'}">${summary.owedTotal ? `${formatCurrency(summary.owedTotal)} chybí` : 'srovnáno'}</span></div>
            <div class="kpi-grid compact-kpi-grid subscription-kpi-grid">
              <div class="kpi"><strong>${formatCurrency(summary.totalCost)}</strong><span>platím já za služby</span></div>
              <div class="kpi"><strong>${formatCurrency(summary.expectedReturn)}</strong><span>má se mi vrátit</span></div>
              <div class="kpi"><strong>${formatCurrency(summary.paid)}</strong><span>zaplaceno za ${escapeHtml(financeMonthLabel(month))}${summary.creditsApplied ? ` · kredit ${formatCurrency(summary.creditsApplied)}` : ''}</span></div>
              <div class="kpi"><strong>${formatCurrency(summary.netCost)}</strong><span>reálný náklad po rozpočítání</span></div>
              <div class="kpi"><strong>${summary.maxSlots ? `${summary.freeSlots}/${summary.maxSlots}` : '—'}</strong><span>volná místa / celkem</span></div>
            </div>
            <details class="action-details compact-edit-details subscription-form-drawer" data-details-key="subscription-overview-month" ${getDetailsOpen('subscription-overview-month') ? 'open' : ''}>
              <summary><span>Měsíc a synchronizace</span><em>${escapeHtml(financeMonthLabel(month))}</em></summary>
              ${cloudReady() ? `<div class="inline-note compact-note subscription-cloud-status"><span class="badge ${getState().subscriptionsCloud?.pendingAt ? 'warn' : getState().subscriptionsCloud?.loadedAt ? 'good' : ''}">${getState().subscriptionsCloud?.pendingAt ? 'automaticky ukládám' : getState().subscriptionsCloud?.loadedAt ? `cloud ${escapeHtml(formatDateTime(getState().subscriptionsCloud.loadedAt))}` : 'cloud aktivní'}</span><span>Předplatné se synchronizuje automaticky přes Supabase domácnost. Není potřeba nic ručně odesílat ani načítat.</span></div>` : `<div class="inline-note compact-note">Po přihlášení a napojení domácnosti na cloud se Předplatné začne synchronizovat automaticky.</div>`}
              <form data-form="subscription-month-filter" class="compact-filter-form subscription-month-form">
                <div class="form-grid two">
                  ${field('Měsíc přehledu', 'month', 'month', '', false, month)}
                  <div class="field"><label>Rychlý posun</label><div class="item-actions"><button class="ghost-btn" type="button" data-action="subscription-month-prev">Předchozí</button><button class="ghost-btn" type="button" data-action="subscription-month-current">Aktuální</button><button class="ghost-btn" type="button" data-action="subscription-month-next">Další</button></div></div>
                </div>
              </form>
            </details>
            ${services.length ? `
            <details class="action-details compact-edit-details subscription-form-drawer" data-details-key="subscription-overview-services" ${getDetailsOpen('subscription-overview-services') ? 'open' : ''}>
              <summary><span>Služby</span><em>${services.length} služeb · náklad ${formatCurrency(summary.totalCost)}</em></summary>
              <div class="subscription-overview-service-grid">${serviceOverviewCards}</div>
            </details>` : ''}
            <details class="action-details compact-edit-details subscription-form-drawer" data-details-key="subscription-overview-people" ${getDetailsOpen('subscription-overview-people', true) ? 'open' : ''}>
              <summary><span>Lidé a dluhy</span><em>${summary.owedTotal ? `${formatCurrency(summary.owedTotal)} chybí` : 'vše srovnané'}</em></summary>
              ${summary.peopleRows.length ? (visiblePeopleRows.length ? `<div class="list compact-list subscription-person-summary-list">${visiblePeopleRows.map(renderSubscriptionPersonSummary).join('')}</div>` : '<div class="empty">Podle filtru není potřeba nic řešit.</div>') : renderEmptyCta({ icon: '👥', title: 'Zatím tu nejsou lidé', text: 'Přidej člověka, se kterým sdílíš Netflix, Disney+, Spotify nebo jinou službu.', nav: 'subscriptions', tab: 'people', label: 'Přidat člověka' })}
            </details>
          </section>
          <section class="card desktop-span-2 subscription-panel panel-overview">
            <div class="card-header"><div><h2>Kontrola plateb</h2><p>Zaškrtni aktuální měsíc u každé služby/osoby. Budoucí platby se berou jako předplaceno.</p></div><span class="badge">${escapeHtml(financeMonthLabel(month))}</span></div>
            <details class="action-details compact-edit-details subscription-form-drawer" data-details-key="subscription-overview-payments" ${getDetailsOpen('subscription-overview-payments') ? 'open' : ''}>
              <summary><span>Zaškrtávání podle služeb</span><em>${services.length} služeb · filtr ${paymentFilter === 'all' ? 'vše' : paymentFilter === 'unpaid' ? 'nezaplacené' : 'dlužníci'}</em></summary>
              <div class="subscription-filter-row" role="group" aria-label="Filtr předplatného">
                ${[
                  ['all', 'Vše'],
                  ['unpaid', 'Nezaplacené'],
                  ['debtors', 'Dlužníci']
                ].map(([id, label]) => `<button class="quick-chip subscription-filter-chip ${paymentFilter === id ? 'active' : ''}" type="button" data-action="subscription-filter" data-filter="${id}">${label}</button>`).join('')}
              </div>
              ${services.length ? (visiblePaymentServices.length ? `<div class="subscription-payment-grid">${visiblePaymentServices.map((row) => renderSubscriptionPaymentCard(row.service, month, paymentFilter, summary)).join('')}</div>` : '<div class="empty">V tomhle filtru není nic k zaplacení.</div>') : renderEmptyCta({ icon: '🎬', title: 'Zatím žádná služba', text: 'Přidej předplatné a potom k němu přiřaď lidi.', nav: 'subscriptions', tab: 'services', label: 'Přidat službu' })}
            </details>
          </section>
          `);
    }

    function renderSubscriptionPersonSummary(row) {
      const owes = row.cumulativeDebt > 0;
      const tone = owes ? 'warn' : row.expected ? 'good' : '';
      const olderDebt = Math.max(0, row.cumulativeDebt - row.debt);
      const debtLabel = owes ? `⚠️ dluží ${formatCurrency(row.cumulativeDebt)}` : row.expected ? 'zaplaceno / OK' : 'bez služeb';
      const tag = owes ? 'button' : 'div';
      const attrs = owes ? `type="button" data-action="subscription-debtor-info" data-id="${escapeHtml(row.person.id)}"` : '';
      return `
        <${tag} class="item compact-item subscription-person-summary ${owes ? 'subscription-debt subscription-debt-prominent subscription-debtor-row' : ''}" ${attrs}>
          <div class="item-top"><div class="item-title">${owes ? `<strong class="subscription-debtor-name">${escapeHtml(row.person.name)}</strong>` : escapeHtml(row.person.name)}</div><span class="badge ${tone} ${owes ? 'subscription-debt-badge' : ''}">${debtLabel}</span></div>
          <div class="item-meta">Má platit ${formatCurrency(row.expected)} · započteno ${formatCurrency(row.paid)}${row.directPaid !== row.paid ? ` · z toho platba ${formatCurrency(row.directPaid)} + kredit ${formatCurrency(row.creditApplied)}` : ''}${olderDebt > 0 ? ` · z toho starší měsíce ${formatCurrency(olderDebt)}` : ''}${row.overpaid ? ` · přeplatek dál ${formatCurrency(row.overpaid)}` : ''}${row.future ? ` · předplaceno ${formatCurrency(row.future)}` : ''}</div>
        </${tag}>`;
    }

    function openDebtorModal(personId) {
      debtorModalPersonId = normalizeText(personId);
      setSubscriptionPaymentDraft({ personId: debtorModalPersonId, subscriptionId: '' }, { render: false });
      renderOverlays();
    }

    function closeDebtorModal(options = {}) {
      if (!debtorModalPersonId) return false;
      debtorModalPersonId = '';
      if (options.render !== false) renderOverlays();
      return true;
    }

    function isDebtorModalOpen() {
      return Boolean(debtorModalPersonId);
    }

    function renderDebtorModal(summary) {
      if (!debtorModalPersonId) return '';
      const row = summary.peopleRows.find((item) => item.person.id === debtorModalPersonId);
      if (!row) return '';
      const month = summary.month;
      const owedServices = subscriptionPersonAssignedServices(row.person.id)
        .map((service) => ({
          service,
          remaining: subscriptionCumulativeDebt(row.person.id, service.id, month),
          months: subscriptionCumulativeDebtMonths(row.person.id, service.id, month)
        }))
        .filter((entry) => entry.remaining > 0);
      const paymentDraft = normalizeSubscriptionPaymentDraft(subscriptionPaymentDraft());
      const paymentServiceOptions = subscriptionPaymentServiceOptions(paymentDraft.personId, paymentDraft.month, true);
      const paymentPersonOptions = subscriptionPaymentPersonOptions(paymentDraft.subscriptionId, paymentDraft.month, true);
      const paymentDefaultAmount = paymentDraft.subscriptionId && paymentDraft.personId
        ? subscriptionCumulativeDebt(paymentDraft.personId, paymentDraft.subscriptionId, paymentDraft.month)
        : row.cumulativeDebt;
      return `
        <div class="app-modal-backdrop" data-modal-backdrop role="presentation">
          <section class="app-modal subscription-debtor-modal" role="dialog" aria-modal="true" aria-labelledby="subscription-debtor-modal-title">
            <div class="app-modal-head">
              <div>
                <span class="badge warn">dluží celkem ${formatCurrency(row.cumulativeDebt)}</span>
                <h2 id="subscription-debtor-modal-title">${escapeHtml(row.person.name)}</h2>
                <p>Za co dluží a rovnou zápis platby.</p>
              </div>
              <button class="icon-btn" type="button" data-action="close-modal" aria-label="Zavřít">×</button>
            </div>
            ${owedServices.length ? `<div class="list compact-list subscription-debtor-service-list">${owedServices.map((entry) => `
              <div class="item compact-item">
                <div class="item-top"><div class="item-title">${escapeHtml(entry.service.name)}</div><span class="badge warn">${formatCurrency(entry.remaining)}</span></div>
                <div class="item-meta">Měsíční podíl ${formatCurrency(subscriptionShareAmountForPerson(row.person.id, entry.service.id))}${entry.months > 1 ? ` · dluh za ${entry.months} měsíce${entry.months >= 5 ? 'ů' : ''}` : ` · ${escapeHtml(financeMonthLabel(month))}`}</div>
              </div>
            `).join('')}</div>` : '<div class="empty">Nic nechybí.</div>'}
            <form data-form="add-subscription-bulk-payment" class="compact-form subscription-bulk-payment-form">
              <input type="hidden" name="personId" value="${escapeHtml(row.person.id)}">
              <div class="form-grid two">
                ${field('Přijatá částka', 'amount', 'number', 'např. 1000', true, row.cumulativeDebt ? String(row.cumulativeDebt) : '')}
                ${field('Poznámka', 'note', 'text', 'volitelné')}
              </div>
              <div class="form-actions modal-actions"><button class="primary-btn" type="submit">Zapsat a rozpočítat mezi služby</button><button class="ghost-btn" type="button" data-action="close-modal">Zavřít</button></div>
              <p class="small-muted">Částka se rozdělí podle měsíčního podílu mezi všechny služby ${escapeHtml(row.person.name)} - nejdřív doplatí dluh, zbytek se počítá jako záloha na další měsíce.</p>
            </form>
            <details class="compact-edit-details" data-details-key="subscription-manual-payment-${escapeHtml(row.person.id)}" ${getDetailsOpen(`subscription-manual-payment-${row.person.id}`) ? 'open' : ''}>
              <summary><span>Ruční zápis platby za jednu službu</span><em>konkrétní měsíc a služba</em></summary>
              <form data-form="add-subscription-payment" class="compact-form subscription-smart-payment-form">
                <div class="form-grid two">
                  ${selectField('Služba', 'subscriptionId', paymentServiceOptions, paymentDraft.subscriptionId)}
                  ${selectField('Člověk', 'personId', paymentPersonOptions, paymentDraft.personId)}
                  ${field('Měsíc', 'month', 'month', '', false, paymentDraft.month)}
                  ${field('Částka', 'amount', 'number', 'např. 80', true, paymentDefaultAmount ? String(paymentDefaultAmount) : '')}
                  ${field('Poznámka', 'note', 'text', 'volitelné')}
                </div>
                <div class="form-actions modal-actions"><button class="primary-btn" type="submit">Zapsat platbu</button></div>
              </form>
            </details>
          </section>
        </div>
      `;
    }

    function renderSubscriptionPersonDetail(row) {
      const services = subscriptionPersonAssignedServices(row.person.id);
      const availableCount = subscriptionPersonAvailableServiceCount(row.person.id);
      const canAssign = availableCount > 0;
      return `
        <details class="item compact-item subscription-person-detail-card ${row.cumulativeDebt ? 'subscription-debt' : ''}" data-details-key="subscription-person-${escapeHtml(row.person.id)}" ${getDetailsOpen(`subscription-person-${row.person.id}`) ? 'open' : ''}>
          <summary class="subscription-person-summary-toggle">
            <span class="subscription-person-summary-main">
              <strong>${escapeHtml(row.person.name)}</strong>
              <em>${services.length ? `${services.length} služeb · ${formatCurrency(row.expected)} / měsíc` : 'bez přiřazené služby'}</em>
            </span>
            <span class="badge ${row.cumulativeDebt ? 'warn' : row.expected ? 'good' : ''}">${row.cumulativeDebt ? `dluží ${formatCurrency(row.cumulativeDebt)}` : row.expected ? 'OK' : 'prázdné'}</span>
          </summary>
          <div class="subscription-person-detail-body">
            <div class="item-meta">${services.length ? services.map((service) => {
              const share = service.shares.find((entry) => entry.personId === row.person.id);
              return `<span class="subscription-person-service-chip"><span class="subscription-inline-service">${renderSubscriptionServiceIcon(service, { size: 'xs' })}</span><strong>${escapeHtml(service.name)}</strong><em>${formatCurrency(share.amount)} / měsíc</em><button type="button" data-action="delete-subscription-share" data-subscription-id="${escapeHtml(service.id)}" data-person-id="${escapeHtml(row.person.id)}" aria-label="Odebrat službu ${escapeHtml(service.name)}">×</button></span>`;
            }).join('') : 'Zatím s ním nesdílíš žádnou službu.'}${row.person.note ? ` <span class="subscription-person-note">${escapeHtml(row.person.note)}</span>` : ''}</div>
            ${services.length ? `
              <form data-form="add-subscription-bulk-payment" class="compact-form subscription-bulk-payment-form">
                <input type="hidden" name="personId" value="${escapeHtml(row.person.id)}">
                <div class="form-grid two">
                  ${field('Přijatá částka', 'amount', 'number', 'např. 1000', true, row.cumulativeDebt ? String(row.cumulativeDebt) : '')}
                  ${field('Poznámka', 'note', 'text', 'volitelné')}
                </div>
                <div class="form-actions"><button class="primary-btn" type="submit">Zapsat a rozpočítat mezi služby</button></div>
                <p class="small-muted">Rozdělí se podle měsíčního podílu mezi všechny služby - nejdřív doplatí dluh, zbytek jako záloha na další měsíce.</p>
              </form>
            ` : ''}
            <div class="subscription-person-assign-box">
              <h3>Přiřadit službu</h3>
              <p>Vyber jednu ze svých služeb a částku, kterou ti má ${escapeHtml(row.person.name)} měsíčně platit. Obsazenost služby se tím automaticky přepočítá.</p>
              ${canAssign ? `
                <form data-form="add-subscription-share" class="compact-form subscription-person-assign-form">
                  <input type="hidden" name="personId" value="${escapeHtml(row.person.id)}">
                  <div class="form-grid two">
                    ${selectField('Služba', 'subscriptionId', subscriptionServiceOptionsForPerson(row.person.id, true), '')}
                    ${field('Částka / měsíc', 'amount', 'number', 'např. 80', true)}
                  </div>
                  <div class="form-actions"><button class="primary-btn" type="submit">Uložit službu člověku</button></div>
                </form>
              ` : '<div class="inline-note compact-note">Nemáš žádnou další službu s volným místem. Uvolni místo odebráním sdílení, nebo zvyš limit míst u služby.</div>'}
            </div>
            <div class="item-actions"><button class="danger-btn" type="button" data-action="delete-subscription-person" data-id="${escapeHtml(row.person.id)}">Smazat člověka</button></div>
          </div>
        </details>`;
    }

    function renderSubscriptionServiceEditForm(service) {
      return `
        <form data-form="update-subscription" data-id="${escapeHtml(service.id)}" class="compact-form subscription-service-edit-form">
          <div class="form-grid two">
            ${selectField('Služba', 'serviceKey', subscriptionServiceSelectOptions(), service.serviceKey)}
            ${field('Vlastní název', 'name', 'text', 'vyplň jen u vlastní služby', false, service.name || '')}
            ${field('Cena / měsíc', 'price', 'number', 'např. 319', false, service.price || '')}
            ${field('Den stržení', 'billingDay', 'number', '1–31', false, service.billingDay || '')}
            ${field('Max míst / členů', 'maxMembers', 'number', 'např. 5', false, service.maxMembers || '')}
            ${field('Poznámka', 'note', 'text', 'např. rodinný tarif', false, service.note || '')}
          </div>
          <div class="form-actions compact-actions">
            <button class="primary-btn" type="submit">Uložit změny</button>
            <button class="ghost-btn" type="button" data-action="cancel-subscription-edit">Zrušit úpravu</button>
          </div>
        </form>`;
    }

    function renderSubscriptionServiceItem(service) {
      const shares = service.shares || [];
      const shareTotal = shares.reduce((sum, share) => sum + decimalValue(share.amount), 0);
      const capacity = subscriptionCapacity(service);
      const capacityText = capacity.maxMembers ? `Obsazeno ${capacity.used}/${capacity.maxMembers} · volno ${capacity.free}` : `Obsazeno ${capacity.used} · bez limitu`;
      const isEditing = subscriptionServiceEditId === service.id;
      return `
        <div class="item compact-item subscription-service-item ${service.enabled === false ? 'muted-item' : ''}">
          <div class="item-top"><div class="item-title subscription-service-title">${renderSubscriptionServiceIcon(service, { size: 'sm' })}</div><span class="badge ${capacity.isFull ? 'warn' : service.enabled === false ? '' : 'good'}">${escapeHtml(capacityText)}</span></div>
          <div class="item-meta">Cena ${formatCurrency(service.price)} · den stržení ${service.billingDay}. · Sdílení ${formatCurrency(shareTotal)} / měsíc · tvoje část ${formatCurrency(Math.max(0, decimalValue(service.price) - shareTotal))}${service.note ? ` · ${escapeHtml(service.note)}` : ''}</div>
          ${shares.length ? `<div class="subscription-share-list">${shares.map((share) => `<span class="quick-chip static-chip">${escapeHtml(subscriptionPersonName(share.personId))}: ${formatCurrency(share.amount)} <button type="button" data-action="delete-subscription-share" data-subscription-id="${escapeHtml(service.id)}" data-person-id="${escapeHtml(share.personId)}" aria-label="Odebrat sdílení">×</button></span>`).join('')}</div>` : '<div class="inline-note compact-note">Zatím není nikomu přiřazená.</div>'}
          <div class="item-actions"><button class="ghost-btn" type="button" data-action="edit-subscription-service" data-id="${escapeHtml(service.id)}">${isEditing ? 'Zavřít úpravu' : 'Upravit'}</button><button class="ghost-btn" type="button" data-action="subscription-toggle-service" data-id="${escapeHtml(service.id)}">${service.enabled === false ? 'Zapnout' : 'Vypnout'}</button><button class="danger-btn" type="button" data-action="delete-subscription" data-id="${escapeHtml(service.id)}">Smazat</button></div>
          ${isEditing ? renderSubscriptionServiceEditForm(service) : ''}
        </div>`;
    }

    function renderSubscriptionPaymentCard(service, month, filter = 'all', summary = subscriptionMonthSummary(month)) {
      const shares = subscriptionVisibleShares(service, month, filter, summary);
      return `
        <div class="subscription-payment-card">
          <div class="subscription-payment-head"><strong class="subscription-service-title subscription-service-title-sm">${renderSubscriptionServiceIcon(service, { size: 'sm' })}</strong><span>${formatCurrency(service.price)} · ${escapeHtml(subscriptionCapacityLabel(service))}</span></div>
          ${shares.length ? shares.map((share) => {
            const paid = subscriptionIsPaid(share.personId, service.id, month);
            const paidAmount = subscriptionPaidAmount(share.personId, service.id, month);
            return `<button class="subscription-pay-row ${paid ? 'paid' : ''}" type="button" data-action="subscription-toggle-paid" data-subscription-id="${escapeHtml(service.id)}" data-person-id="${escapeHtml(share.personId)}" data-month="${escapeHtml(month)}"><span><strong>${escapeHtml(subscriptionPersonName(share.personId))}</strong><em>${formatCurrency(share.amount)}${paidAmount && paidAmount !== share.amount ? ` · započteno ${formatCurrency(paidAmount)}` : ''}${subscriptionCreditBeforeMonth(share.personId, service.id, month) ? ` · kredit ${formatCurrency(subscriptionCreditBeforeMonth(share.personId, service.id, month))}` : ''}</em></span><b>${paid ? '✓' : '○'}</b></button>`;
          }).join('') : '<div class="inline-note compact-note">Nikdo není přiřazený.</div>'}
        </div>`;
    }

    function renderSubscriptionPaymentItem(payment) {
      return `
        <div class="item compact-item">
          <div class="item-top"><div class="item-title subscription-payment-item-title">${escapeHtml(subscriptionPersonName(payment.personId))} · <span class="subscription-inline-service">${renderSubscriptionServiceIcon(subscriptionById(payment.subscriptionId) || 'other', { size: 'xs' })}</span></div><span class="badge good">${formatCurrency(payment.amount)}</span></div>
          <div class="item-meta">${escapeHtml(financeMonthLabel(payment.month))} · zaplaceno ${escapeHtml(formatDate(payment.paidAt))}${payment.note ? ` · ${escapeHtml(payment.note)}` : ''}</div>
          <div class="item-actions"><button class="danger-btn" type="button" data-action="delete-subscription-payment" data-id="${escapeHtml(payment.id)}">Smazat platbu</button></div>
        </div>`;
    }

    function addSubscriptionPersonFromForm(data, form) {
      const name = normalizeText(data.name);
      if (!name) return showToast('Vyplň jméno člověka');
      getState().subscriptionPeople.push(normalizeSubscriptionPerson({ name, note: data.note }));
      form.reset();
      persistSubscriptionsState({ toast: 'Člověk přidaný' });
    }

    function addSubscriptionFromForm(data, form) {
      const serviceKey = normalizeText(data.serviceKey || 'other') || 'other';
      const price = decimalValue(data.price) || subscriptionServiceDefaultPrice(serviceKey);
      const name = normalizeText(data.name) || subscriptionServiceName(serviceKey, '');
      if (!name) return showToast('Vyplň název služby');
      if (!(price > 0)) return showToast('Vyplň cenu služby');
      const rawMaxMembers = Number(data.maxMembers || 0);
      const maxMembers = Number.isFinite(rawMaxMembers) && rawMaxMembers > 0 ? Math.floor(rawMaxMembers) : subscriptionServiceDefaultMembers(serviceKey);
      getState().subscriptions.push(normalizeSubscriptionService({ serviceKey, name, price, billingDay: data.billingDay, maxMembers, note: data.note, shares: [] }));
      form.reset();
      persistSubscriptionsState({ toast: 'Předplatné přidané' });
    }

    function setSubscriptionServiceEdit(id) {
      subscriptionServiceEditId = subscriptionServiceEditId === id ? '' : String(id || '');
      render();
    }

    // Úprava existující služby. NIKDY nemaže id, createdAt, shares ani
    // subscriptionPayments — mění jen serviceKey/name/price/billingDay/
    // maxMembers/note. Při změně serviceKey se ikonka a default název
    // přizpůsobí přes normalizeSubscriptionService.
    function updateSubscriptionServiceFromForm(id, data, form) {
      const service = getState().subscriptions.find((item) => item.id === id);
      if (!service) return showToast('Služba nenalezená');
      const nextKey = normalizeSubscriptionServiceKey(data.serviceKey || service.serviceKey || 'other');
      const keyChanged = nextKey !== service.serviceKey;
      // Vlastní název: když je prázdný a změnila se služba, vezmi default
      // názvu nové služby; jinak zachovej ručně zadaný.
      const rawName = normalizeText(data.name);
      const nextName = rawName || (keyChanged ? subscriptionServiceName(nextKey, '') : service.name);
      // Cena / max míst: nepřepisuj ručně zadané. Když pole prázdné a služba
      // se změnila, doplň default nové služby; jinak zachovej původní hodnotu.
      const rawPrice = normalizeText(data.price);
      const nextPrice = rawPrice !== '' ? decimalValue(data.price) : (keyChanged ? subscriptionServiceDefaultPrice(nextKey) : service.price);
      const rawMembers = normalizeText(data.maxMembers);
      const nextMembers = rawMembers !== '' ? Math.max(0, Math.floor(Number(data.maxMembers || 0))) : (keyChanged ? subscriptionServiceDefaultMembers(nextKey) : service.maxMembers);
      if (!(nextPrice > 0)) return showToast('Vyplň cenu služby');
      const updated = normalizeSubscriptionService({
        ...service,
        id: service.id,
        createdAt: service.createdAt,
        householdId: service.householdId,
        profileId: service.profileId,
        shares: service.shares,
        enabled: service.enabled,
        serviceKey: nextKey,
        name: nextName,
        price: nextPrice,
        billingDay: normalizeText(data.billingDay) !== '' ? data.billingDay : service.billingDay,
        maxMembers: nextMembers,
        note: data.note !== undefined ? data.note : service.note
      });
      const index = getState().subscriptions.findIndex((item) => item.id === id);
      if (index >= 0) getState().subscriptions[index] = updated;
      subscriptionServiceEditId = '';
      persistSubscriptionsState({ toast: 'Služba upravená' });
    }

    function addSubscriptionShareFromForm(data, form) {
      const service = getState().subscriptions.find((item) => item.id === data.subscriptionId);
      const person = getState().subscriptionPeople.find((item) => item.id === data.personId);
      const amount = decimalValue(data.amount);
      if (!service || !person) return showToast('Vyber službu a člověka');
      if (!(amount > 0)) return showToast('Vyplň částku');
      service.shares = Array.isArray(service.shares) ? service.shares : [];
      const existing = service.shares.find((share) => share.personId === person.id);
      const capacity = subscriptionCapacity(service);
      if (!existing && capacity.maxMembers && capacity.free <= 0) return showToast('U služby už nejsou volná místa');
      if (existing) existing.amount = amount;
      else service.shares.push({ personId: person.id, amount });
      form.reset();
      persistSubscriptionsState({ toast: 'Sdílení uložené' });
    }

    function addSubscriptionPaymentFromForm(data, form) {
      const service = getState().subscriptions.find((item) => item.id === data.subscriptionId);
      const person = getState().subscriptionPeople.find((item) => item.id === data.personId);
      const amount = decimalValue(data.amount);
      const month = /^\d{4}-\d{2}$/.test(String(data.month || '')) ? String(data.month) : subscriptionSelectedMonth();
      if (!service || !person) return showToast('Vyber službu a člověka');
      if (!(amount > 0)) return showToast('Vyplň částku');
      getState().subscriptionPayments.push(normalizeSubscriptionPayment({ subscriptionId: service.id, personId: person.id, month, amount, paidAt: todayISO(), note: data.note }));
      clearSubscriptionPaymentDraft(month);
      form.reset();
      persistSubscriptionsState({ toast: month > subscriptionSelectedMonth() ? 'Platba dopředu zapsaná' : 'Platba zapsaná' });
    }

    // Přijatá platba jedním číslem (např. "dostal jsem 1000 Kč") se rozpočítá
    // mezi VŠECHNY služby dané osoby podle poměru měsíčních podílů a zapíše
    // se jako samostatná platba ke KAŽDÉ službě, datovaná do aktuálního
    // kalendářního měsíce (ne do měsíce, který je zrovna prohlížený v
    // přehledu - platba přišla "teď", bez ohledu na to, jaký měsíc si
    // uživatel v UI zrovna prochází). Existující dluh (subscriptionCumulativeDebt)
    // i kredit do budoucích měsíců (subscriptionCreditBeforeMonth) se z toho
    // dopočítají automaticky, protože obě počítají se SOUČTEM všech plateb
    // dané služby/osoby bez ohledu na to, kolik jich bylo - není potřeba nic
    // ručně rozdělovat po měsících dopředu.
    function addSubscriptionBulkPaymentFromForm(data, form) {
      const person = getState().subscriptionPeople.find((item) => item.id === data.personId);
      const amount = decimalValue(data.amount);
      if (!person) return showToast('Vyber člověka');
      if (!(amount > 0)) return showToast('Vyplň částku');
      const plan = subscriptionBulkPaymentPlan(person.id, amount);
      if (!plan.length) return showToast(`${person.name} nemá přiřazenou žádnou placenou službu`);
      const paidAt = todayISO();
      getState().subscriptionPayments = Array.isArray(getState().subscriptionPayments) ? getState().subscriptionPayments : [];
      const breakdown = [];
      plan.forEach((row) => {
        const serviceTotal = row.entries.reduce((sum, entry) => sum + entry.amount, 0);
        if (!(serviceTotal > 0)) return;
        breakdown.push(`${row.service.name} ${formatCurrency(serviceTotal)}`);
        row.entries.forEach((entry) => {
          getState().subscriptionPayments.push(normalizeSubscriptionPayment({
            subscriptionId: row.service.id,
            personId: person.id,
            month: entry.month,
            amount: entry.amount,
            paidAt,
            note: data.note
          }));
        });
      });
      form.reset();
      persistSubscriptionsState({ toast: `Přijato ${formatCurrency(amount)} · rozpočítáno: ${breakdown.join(', ')}` });
    }

    function toggleSubscriptionPaid(subscriptionId, personId, month = subscriptionSelectedMonth()) {
      const service = getState().subscriptions.find((item) => item.id === subscriptionId);
      const share = service?.shares?.find((item) => item.personId === personId);
      if (!service || !share) return showToast('Sdílení nenalezené');
      getState().subscriptionPayments = Array.isArray(getState().subscriptionPayments) ? getState().subscriptionPayments : [];
      const indexes = getState().subscriptionPayments
        .map((payment, index) => ({ payment, index }))
        .filter(({ payment }) => payment.subscriptionId === subscriptionId && payment.personId === personId && payment.month === month)
        .map(({ index }) => index);
      if (indexes.length) {
        getState().subscriptionPayments = getState().subscriptionPayments.filter((_, index) => !indexes.includes(index));
        showToast('Platba odškrtnutá');
      } else if (subscriptionCreditBeforeMonth(personId, subscriptionId, month) >= decimalValue(share.amount)) {
        showToast('Platba je pokrytá přeplatkem z minulých měsíců');
        return;
      } else {
        getState().subscriptionPayments.push(normalizeSubscriptionPayment({ subscriptionId, personId, month, amount: subscriptionRemainingAmount(personId, subscriptionId, month) || decimalValue(share.amount), paidAt: todayISO(), note: 'zaškrtnuto v přehledu' }));
        showToast('Platba zaškrtnutá');
      }
      persistSubscriptionsState();
    }

    function deleteSubscription(id) {
      const service = (getState().subscriptions || []).find((item) => item.id === id);
      if (!service) return;
      const payments = (getState().subscriptionPayments || []).filter((payment) => payment.subscriptionId === id).map((payment) => ({ ...payment }));
      const serviceSnapshot = { ...service, shares: (service.shares || []).map((share) => ({ ...share })) };
      getState().subscriptions = (getState().subscriptions || []).filter((item) => item.id !== id);
      getState().subscriptionPayments = (getState().subscriptionPayments || []).filter((payment) => payment.subscriptionId !== id);
      const deleteSync = persistSubscriptionsState();
      showUndoToast('Předplatné smazané', () => restoreSubscriptionsAfterDelete(deleteSync, () => {
        if (!(getState().subscriptions || []).some((item) => item.id === id)) getState().subscriptions.push(serviceSnapshot);
        const known = new Set((getState().subscriptionPayments || []).map((payment) => payment.id));
        getState().subscriptionPayments.push(...payments.filter((payment) => !known.has(payment.id)));
      }, 'Předplatné obnovené'));
    }

    function deleteSubscriptionPerson(id) {
      const person = (getState().subscriptionPeople || []).find((item) => item.id === id);
      if (!person) return;
      const shares = (getState().subscriptions || []).map((service) => ({
        subscriptionId: service.id,
        shares: (service.shares || []).filter((share) => share.personId === id).map((share) => ({ ...share }))
      })).filter((entry) => entry.shares.length);
      const payments = (getState().subscriptionPayments || []).filter((payment) => payment.personId === id).map((payment) => ({ ...payment }));
      getState().subscriptionPeople = (getState().subscriptionPeople || []).filter((item) => item.id !== id);
      getState().subscriptions = (getState().subscriptions || []).map((service) => ({ ...service, shares: (service.shares || []).filter((share) => share.personId !== id) }));
      getState().subscriptionPayments = (getState().subscriptionPayments || []).filter((payment) => payment.personId !== id);
      const deleteSync = persistSubscriptionsState();
      showUndoToast('Člověk odebraný', () => restoreSubscriptionsAfterDelete(deleteSync, () => {
        if (!(getState().subscriptionPeople || []).some((item) => item.id === id)) getState().subscriptionPeople.push({ ...person });
        shares.forEach((entry) => {
          const service = (getState().subscriptions || []).find((item) => item.id === entry.subscriptionId);
          if (!service) return;
          const known = new Set((service.shares || []).map((share) => share.personId));
          service.shares = [...(service.shares || []), ...entry.shares.filter((share) => !known.has(share.personId))];
        });
        const knownPayments = new Set((getState().subscriptionPayments || []).map((payment) => payment.id));
        getState().subscriptionPayments.push(...payments.filter((payment) => !knownPayments.has(payment.id)));
      }, 'Člověk obnovený'));
    }

    function deleteSubscriptionShare(subscriptionId, personId) {
      const service = getState().subscriptions.find((item) => item.id === subscriptionId);
      if (!service) return;
      const share = (service.shares || []).find((item) => item.personId === personId);
      if (!share) return;
      const payments = (getState().subscriptionPayments || []).filter((payment) => payment.subscriptionId === subscriptionId && payment.personId === personId).map((payment) => ({ ...payment }));
      service.shares = (service.shares || []).filter((share) => share.personId !== personId);
      getState().subscriptionPayments = (getState().subscriptionPayments || []).filter((payment) => !(payment.subscriptionId === subscriptionId && payment.personId === personId));
      const deleteSync = persistSubscriptionsState();
      showUndoToast('Sdílení odebrané', () => restoreSubscriptionsAfterDelete(deleteSync, () => {
        const current = (getState().subscriptions || []).find((item) => item.id === subscriptionId);
        if (current && !(current.shares || []).some((item) => item.personId === personId)) current.shares = [...(current.shares || []), { ...share }];
        const known = new Set((getState().subscriptionPayments || []).map((payment) => payment.id));
        getState().subscriptionPayments.push(...payments.filter((payment) => !known.has(payment.id)));
      }, 'Sdílení obnovené'));
    }

    function deleteSubscriptionPayment(id) {
      const payment = (getState().subscriptionPayments || []).find((item) => item.id === id);
      if (!payment) return;
      getState().subscriptionPayments = (getState().subscriptionPayments || []).filter((payment) => payment.id !== id);
      const deleteSync = persistSubscriptionsState();
      showUndoToast('Platba smazaná', () => restoreSubscriptionsAfterDelete(deleteSync, () => {
        if (!(getState().subscriptionPayments || []).some((item) => item.id === id)) getState().subscriptionPayments.push({ ...payment });
      }, 'Platba obnovená'));
    }

    function toggleSubscriptionService(id) {
      const service = getState().subscriptions.find((item) => item.id === id);
      if (!service) return;
      service.enabled = service.enabled === false;
      persistSubscriptionsState();
      showToast(service.enabled ? 'Služba zapnutá' : 'Služba vypnutá');
    }

    return {
      // dashboard widget / čtení
      subscriptionMonthSummary,
      subscriptionCapacityLabel,
      subscriptionSelectedMonth,
      subscriptionPaymentFilter,
      // render
      renderSubscriptions,
      // normalizace (volané z cloud load / backup)
      normalizeSubscriptionService,
      normalizeSubscriptionPerson,
      normalizeSubscriptionPayment,
      getSubscriptionPeople,
      getSubscriptionServices,
      getSubscriptionPayments,
      // ovládání měsíc / filtr / draft
      setSubscriptionMonth,
      shiftSubscriptionMonth,
      setSubscriptionPaymentFilter,
      setSubscriptionPaymentDraft,
      openDebtorModal,
      closeDebtorModal,
      isDebtorModalOpen,
      // autofill defaults pro formulář
      subscriptionServiceDefaults,
      // handlery
      addSubscriptionPersonFromForm,
      addSubscriptionFromForm,
      updateSubscriptionServiceFromForm,
      setSubscriptionServiceEdit,
      addSubscriptionShareFromForm,
      addSubscriptionPaymentFromForm,
      addSubscriptionBulkPaymentFromForm,
      toggleSubscriptionPaid,
      toggleSubscriptionService,
      deleteSubscription,
      deleteSubscriptionPerson,
      deleteSubscriptionShare,
      deleteSubscriptionPayment,
      ui: {
        overlay: {
          isOpen: isDebtorModalOpen,
          render: () => renderDebtorModal(subscriptionMonthSummary()),
          close: closeDebtorModal
        }
      }
    };
  }

  window.DomacnostSubscriptions = { createSubscriptions };
})();
