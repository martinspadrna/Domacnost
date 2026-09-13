(function () {
  'use strict';

  // Odpad / svoz. Extrahováno z app.js (fáze B). Stav přes deps.getState() (živá reference).
  // Dashboard widget (getUpcomingWasteRuntimeItems, renderWasteOverviewItem) zůstává
  // volatelný z app.js přes wrappery. Datové utily (addDaysIso, addMonthsIso, daysUntil,
  // dueBadge, todayISO) se předávají přes deps.
  function createWaste(deps) {
    const getState = deps.getState || (() => ({}));
    const getModuleTab = deps.getModuleTab || ((area, fallback) => fallback);
    const renderSectionTabs = deps.renderSectionTabs || (() => '');
    const escapeHtml = deps.escapeHtml || ((v) => String(v ?? ''));
    const normalizeText = deps.normalizeText || ((v) => String(v || '').trim());
    const uid = deps.uid || (() => Math.random().toString(36).slice(2));
    const todayISO = deps.todayISO || (() => new Date().toISOString().slice(0, 10));
    const daysUntil = deps.daysUntil || (() => null);
    const formatDate = deps.formatDate || ((v) => String(v || ''));
    const field = deps.field || (() => '');
    const selectField = deps.selectField || (() => '');
    const renderEmptyCta = deps.renderEmptyCta || (() => '');
    const renderOverviewItem = deps.renderOverviewItem || (() => '');
    const dueBadge = deps.dueBadge || ((d) => String(d ?? ''));
    const showToast = deps.showToast || (() => {});
    const saveState = deps.saveState || (() => {});
    const render = deps.render || (() => {});
    const requestRender = deps.requestRender || render;
    const touchState = deps.touchState || (() => {});
    const currentHouseholdId = deps.currentHouseholdId || (() => '');
    const currentProfileId = deps.currentProfileId || (() => '');
    const addDaysIso = deps.addDaysIso || (() => '');
    const addMonthsIso = deps.addMonthsIso || (() => '');
    const getSupabaseClient = deps.getSupabaseClient || (() => null);
    const refreshCloudSession = deps.refreshCloudSession || (async () => null);

    function normalizeWasteRepeatRule(value) {
      return ['none', 'weekly', 'biweekly', 'monthly', 'custom'].includes(value) ? value : 'none';
    }

    function isValidIsoDate(value) {
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));
    }

    function wasteRepeatLabel(value) {
      return ({ none: 'jednorázově', weekly: 'týdně', biweekly: 'každé 2 týdny', monthly: 'měsíčně', custom: 'vlastní opakování' })[value || 'none'] || 'jednorázově';
    }

    function getNextWasteDate(dateIso, repeatRule = 'none', referenceIso = todayISO()) {
      const date = String(dateIso || '').slice(0, 10);
      if (!isValidIsoDate(date)) return '';
      const rule = normalizeWasteRepeatRule(repeatRule);
      if (rule === 'none' || rule === 'custom') return date;
      const currentDaysUntil = daysUntil(date);
      if (currentDaysUntil === null || currentDaysUntil >= 0) return date;

      if (rule === 'weekly' || rule === 'biweekly') {
        const stepDays = rule === 'biweekly' ? 14 : 7;
        const startTime = Date.parse(`${date}T00:00:00Z`);
        const referenceTime = Date.parse(`${String(referenceIso || todayISO()).slice(0, 10)}T00:00:00Z`);
        if (!Number.isFinite(startTime) || !Number.isFinite(referenceTime)) return date;
        const diffDays = Math.max(0, Math.floor((referenceTime - startTime) / 86400000));
        const periods = Math.max(1, Math.ceil(diffDays / stepDays));
        return addDaysIso(date, periods * stepDays) || date;
      }

      if (rule === 'monthly') {
        let nextDate = date;
        for (let guard = 0; guard < 240 && daysUntil(nextDate) !== null && daysUntil(nextDate) < 0; guard += 1) {
          const moved = addMonthsIso(nextDate, 1);
          if (!moved || moved === nextDate) break;
          nextDate = moved;
        }
        return nextDate;
      }

      return date;
    }

    function getWasteRuntimeItem(item) {
      const baseDate = String(item?.date || '').slice(0, 10);
      const nextDate = getNextWasteDate(baseDate, item?.repeatRule || item?.repeat_rule || 'none');
      return {
        ...item,
        originalDate: baseDate,
        date: nextDate || baseDate,
        days: daysUntil(nextDate || baseDate),
        isProjected: Boolean(nextDate && baseDate && nextDate !== baseDate)
      };
    }

    function getWasteRuntimeItems(items = getState().waste || []) {
      return (items || []).map(getWasteRuntimeItem);
    }

    function getUpcomingWasteRuntimeItems({ maxDays = null, includeUnscheduled = false, limit = null } = {}) {
      let items = getWasteRuntimeItems()
        .filter((item) => (includeUnscheduled && item.days === null) || (item.days !== null && item.days >= 0));
      if (maxDays !== null && maxDays !== undefined) items = items.filter((item) => item.days === null || item.days <= Number(maxDays));
      items = items.sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));
      return limit ? items.slice(0, Number(limit)) : items;
    }

    function normalizeWasteStorageItems(items = []) {
      return (items || []).map((item) => ({
        ...item,
        repeatRule: normalizeWasteRepeatRule(item?.repeatRule || item?.repeat_rule || 'none'),
        notifyBeforeHours: item?.notifyBeforeHours === '' || item?.notifyBeforeHours === undefined ? 12 : Number(item.notifyBeforeHours),
        enabled: item?.enabled !== false
      }));
    }

    function cloudWastePayload(item, userId) {
      return {
        household_id: getState().cloud.householdId,
        title: item.type || 'Svoz odpadu',
        pickup_date: item.date || todayISO(),
        repeat_rule: item.repeatRule || 'none',
        repeat_interval: item.repeatRule === 'biweekly' ? 2 : 1,
        notify_before_hours: item.notifyBeforeHours === '' || item.notifyBeforeHours === undefined ? 12 : Number(item.notifyBeforeHours),
        is_enabled: item.enabled !== false,
        note: item.note || null,
        created_by: item.cloudId ? undefined : userId,
        updated_by: userId
      };
    }

    async function cloudAddWaste(item) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return null;
      const user = await refreshCloudSession(false);
      if (!user) return null;
      const payload = cloudWastePayload(item, user.id);
      const { data, error } = await client.from('waste_schedules').insert(payload).select('id').single();
      if (error) {
        showToast(error.message || 'Svoz se nepovedlo uložit do cloudu');
        return null;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return data;
    }

    async function cloudUpdateWaste(item) {
      const client = getSupabaseClient();
      if (!client || !item?.cloudId || !getState().cloud?.householdId) return true;
      const user = await refreshCloudSession(false);
      if (!user) return false;
      const payload = cloudWastePayload(item, user.id);
      delete payload.created_by;
      const { error } = await client.from('waste_schedules').update(payload).eq('id', item.cloudId).eq('household_id', getState().cloud.householdId);
      if (error) {
        showToast(error.message || 'Svoz se nepovedlo upravit v cloudu');
        return false;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return true;
    }

    async function cloudDeleteWaste(item) {
      const client = getSupabaseClient();
      if (!client || !item?.cloudId || !getState().cloud?.householdId) return true;
      const { error } = await client.from('waste_schedules').delete().eq('id', item.cloudId).eq('household_id', getState().cloud.householdId);
      if (error) {
        showToast(error.message || 'Svoz se nepovedlo smazat z cloudu');
        return false;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return true;
    }

    async function cloudLoadWaste(showMessage = true) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) {
        if (showMessage) showToast('Nejdřív napoj domácnost na cloud');
        return;
      }
      const { data, error } = await client
        .from('waste_schedules')
        .select('id,title,pickup_date,repeat_rule,notify_before_hours,is_enabled,note')
        .eq('household_id', getState().cloud.householdId)
        .order('pickup_date', { ascending: true });
      if (error) {
        showToast(error.message || 'Svoz odpadu se nepovedlo načíst');
        return;
      }
      const localOnly = normalizeWasteStorageItems(getState().waste.filter((item) => !item.cloudId));
      const cloudItems = normalizeWasteStorageItems((data || []).map((item) => ({
        id: getState().waste.find((entry) => entry.cloudId === item.id)?.id || `waste-cloud-${item.id}`,
        cloudId: item.id,
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        type: item.title || 'Svoz odpadu',
        date: item.pickup_date || '',
        repeatRule: item.repeat_rule || 'none',
        notifyBeforeHours: item.notify_before_hours ?? 12,
        enabled: item.is_enabled !== false,
        note: item.note || ''
      })));
      getState().waste = [...cloudItems, ...localOnly];
      getState().cloud.lastSyncAt = new Date().toISOString();
      touchState();
      saveState();
      render();
      if (showMessage) showToast(`Načteno svozů: ${cloudItems.length}`);
    }

    async function cloudSyncWasteById(id) {
      const item = getState().waste.find((entry) => entry.id === id);
      if (!item) return;
      const saved = item.cloudId ? await cloudUpdateWaste(item) : await cloudAddWaste(item);
      if (saved?.id) item.cloudId = saved.id;
      touchState();
      saveState();
      render();
      showToast(item.cloudId ? 'Svoz uložen do cloudu' : 'Svoz se nepovedlo odeslat');
    }

    async function cloudSyncLocalWaste() {
      const local = getState().waste.filter((item) => !item.cloudId);
      let synced = 0;
      for (const item of local) {
        const saved = await cloudAddWaste(item);
        if (saved?.id) {
          item.cloudId = saved.id;
          synced += 1;
        }
      }
      touchState();
      saveState();
      render();
      showToast(synced ? `Odesláno svozů: ${synced}` : 'Žádný svoz se nepovedlo odeslat');
    }

    async function addWasteFromForm(data, form) {
      const item = {
        id: uid(),
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        type: normalizeText(data.type),
        date: normalizeText(data.date),
        repeatRule: normalizeWasteRepeatRule(data.repeatRule || 'none'),
        notifyBeforeHours: data.notifyBeforeHours === '' || data.notifyBeforeHours === undefined ? 12 : Number(data.notifyBeforeHours),
        enabled: true,
        note: normalizeText(data.note)
      };
      getState().waste.push(item);
      touchState();
      saveState();
      form?.reset();
      render();
      showToast('Svoz uložen');
      cloudAddWaste(item).then((saved) => {
        if (saved?.id) { item.cloudId = saved.id; saveState(); requestRender(); }
      }).catch((error) => console.warn('Cloud sync (svoz) na pozadí selhal', error));
    }

    async function deleteWaste(id) {
      const item = getState().waste.find((entry) => entry.id === id);
      if (!item) return;
      getState().waste = getState().waste.filter((entry) => entry.id !== id);
      touchState();
      saveState();
      render();
      showToast('Svoz smazán');
      cloudDeleteWaste(item).catch((error) => console.warn('Cloud sync (smazání svozu) na pozadí selhal', error));
    }

    function renderWasteOverviewItem(item) {
      return renderOverviewItem({
        title: `${item.type} odpad`,
        badge: item.days === null ? 'bez data' : dueBadge(item.days),
        badgeClass: item.days !== null && item.days <= 1 ? 'warn' : '',
        meta: `Svoz ${formatDate(item.date)}${item.note ? ` · ${item.note}` : ''}`,
        icon: '♻️'
      });
    }

    // Panel Odpad pro renderHomecare (fast i main path měly identický obsah).
    function renderWasteAddForm(S, waste) {
      return `
        <form data-form="add-waste">
          <div class="form-grid two">
            ${field('Typ', 'type', 'text', 'plast / papír / komunál', true)}
            ${field('Datum svozu', 'date', 'date', '', true)}
            ${selectField('Opakování', 'repeatRule', [['none', 'Jednorázově'], ['weekly', 'Týdně'], ['biweekly', 'Každé 2 týdny'], ['monthly', 'Měsíčně']])}
            ${field('Upozornit předem (hod)', 'notifyBeforeHours', 'number', '12')}
            ${field('Poznámka', 'note', 'text', 'volitelné')}
          </div>
          <div class="form-actions"><button class="primary-btn" type="submit">Přidat svoz</button></div>
        </form>
      `;
    }

    function renderWastePanel() {
      const S = getState();
      const waste = getWasteRuntimeItems(S.waste).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      const activeTab = getModuleTab('waste', 'overview');
      const tabs = renderSectionTabs('waste', [
        { id: 'overview', label: 'Přehled', icon: '♻️', count: waste.length },
        { id: 'add', label: 'Přidat svoz', icon: '➕' }
      ], 'overview');
      return `
        <section class="card homecare-panel panel-waste">
          <div class="card-header">
            <div><h2>Svozový plán</h2><p>Svoz odpadu s přípravou na připomínky.</p></div>
            <span class="badge ${waste.some((item) => item.cloudId) ? 'good' : ''}">${waste.some((item) => item.cloudId) ? 'cloud' : 'lokálně'}</span>
          </div>
          ${tabs}
          <div class="module-tabbed waste-tab-${escapeHtml(activeTab)}" data-tab-area="waste">
            ${activeTab === 'add' ? renderWasteAddForm(S, waste) : (waste.length ? `<div class="list">${waste.map((item) => `
            <div class="item">
              <div class="item-top"><div class="item-title">${escapeHtml(item.type)}</div><span class="badge ${daysUntil(item.date) <= 1 ? 'warn' : ''}">${formatDate(item.date)}</span></div>
              <div class="item-meta">${escapeHtml(wasteRepeatLabel(item.repeatRule))}${item.notifyBeforeHours ? ` · připomenout ${escapeHtml(String(item.notifyBeforeHours))} h předem` : ''}${item.note ? ` · ${escapeHtml(item.note)}` : ''}${item.cloudId ? ' · cloud' : ' · lokálně'}</div>
              <div class="item-actions"><button class="danger-btn" type="button" data-action="delete-waste" data-id="${escapeHtml(item.id)}">Smazat</button></div>
            </div>`).join('')}</div>` : renderEmptyCta({ icon: '♻️', title: 'Svoz odpadu není nastavený', text: 'Přidej první svoz a aplikace ho ukáže v přehledu Dnes a brzy.', nav: 'waste', tab: 'add', label: 'Přidat svoz' }))}
          </div>
        </section>`;
    }

    return {
      // dashboard / runtime
      getWasteRuntimeItems,
      getUpcomingWasteRuntimeItems,
      normalizeWasteStorageItems,
      wasteRepeatLabel,
      // render
      renderWasteOverviewItem,
      renderWastePanel,
      // cloud
      cloudLoadWaste,
      cloudSyncWasteById,
      cloudSyncLocalWaste,
      // handlery
      addWasteFromForm,
      deleteWaste
    };
  }

  window.DomacnostWaste = { createWaste };
})();
