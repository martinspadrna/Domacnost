(function () {
  'use strict';

  // Záruky: CRUD, přílohy (IndexedDB lokálně / Supabase storage v cloudu), komprese obrázků.
  // Extrahováno z app.js (fáze B). Stav přes deps.getState() (živá reference), takže se
  // ukládá 1:1 jako dřív: mutace state.warranties / state.warrantyFiles → saveState() → render().
  // IndexedDB i komprese jdou přes deps, aby se neměnilo, kdy a jak se ukládají přílohy.
  function createWarranty(deps) {
    const getState = deps.getState || (() => ({}));
    const getDetailsOpen = deps.getDetailsOpen || (() => false);
    const getModuleTab = deps.getModuleTab || ((area, fallback) => fallback);
    const renderSectionTabs = deps.renderSectionTabs || (() => '');
    const sessionStorage = deps.sessionStorage || window.sessionStorage;

    const normalizeKey = deps.normalizeKey || ((v) => String(v || '').toLowerCase());
    const normalizeText = deps.normalizeText || ((v) => String(v || '').trim());
    const uid = deps.uid || (() => Math.random().toString(36).slice(2));
    const todayISO = deps.todayISO || (() => new Date().toISOString().slice(0, 10));
    const addYearsIso = deps.addYearsIso || ((iso) => iso);
    const daysUntil = deps.daysUntil || (() => null);
    const formatDate = deps.formatDate || ((v) => String(v || ''));
    const formatCurrency = deps.formatCurrency || ((v) => String(v || ''));
    const formatBytes = deps.formatBytes || ((v) => `${v} B`);
    const escapeHtml = deps.escapeHtml || ((v) => String(v ?? ''));
    const field = deps.field || (() => '');
    const selectField = deps.selectField || (() => '');
    const renderOverviewSummary = deps.renderOverviewSummary || (() => '');
    const renderEmptyCta = deps.renderEmptyCta || (() => '');
    const getFormData = deps.getFormData || (() => ({}));
    const cloudReady = deps.cloudReady || (() => false);
    const cloudSaveHouseholdUiSettings = deps.cloudSaveHouseholdUiSettings || (() => Promise.resolve(false));
    const getSupabaseClient = deps.getSupabaseClient || (() => null);
    const refreshCloudSession = deps.refreshCloudSession || (async () => null);
    const showToast = deps.showToast || (() => {});
    const showUndoToast = deps.showUndoToast || null;
    const sanitizeStorageFileName = deps.sanitizeStorageFileName || ((name) => String(name || 'priloha'));
    const currentHouseholdId = deps.currentHouseholdId || (() => '');
    const currentProfileId = deps.currentProfileId || (() => '');
    const touchState = deps.touchState || (() => {});
    const saveState = deps.saveState || (() => {});
    const render = deps.render || (() => {});
    const renderOverlays = deps.renderOverlays || render;
    const requestRender = deps.requestRender || render;
    const putStoredWarrantyFile = deps.putStoredWarrantyFile || (async () => {});
    const getStoredWarrantyFile = deps.getStoredWarrantyFile || (async () => null);
    const deleteStoredWarrantyFile = deps.deleteStoredWarrantyFile || (async () => {});
    const showFilePreviewModal = deps.showFilePreviewModal || (() => {});
    const cloudAddExtraItem = deps.cloudAddExtraItem || (async () => null);
    const cloudUpdateExtraItem = deps.cloudUpdateExtraItem || (async () => false);
    const cloudDeleteExtraItem = deps.cloudDeleteExtraItem || (async () => false);

    const WARRANTY_STATUS_OPTIONS = deps.WARRANTY_STATUS_OPTIONS || [];
    const WARRANTY_YEARS_OPTIONS = deps.WARRANTY_YEARS_OPTIONS || [];
    const WARRANTY_FILE_ALLOWED_MIME = deps.WARRANTY_FILE_ALLOWED_MIME || new Set();
    const WARRANTY_FILE_MAX_BYTES = deps.WARRANTY_FILE_MAX_BYTES || (15 * 1024 * 1024);
    const WARRANTY_IMAGE_MAX_DIMENSION = deps.WARRANTY_IMAGE_MAX_DIMENSION || 1600;
    const WARRANTY_IMAGE_JPEG_QUALITY = deps.WARRANTY_IMAGE_JPEG_QUALITY || 0.82;
    let activeWarrantyDetailId = '';

    function offerUndo(message, restore, onExpire = null) {
      if (typeof showUndoToast === 'function') showUndoToast(message, restore, { onExpire });
      else {
        showToast(message);
        if (typeof onExpire === 'function') Promise.resolve().then(onExpire).catch(() => {});
      }
    }

    function restoreAt(items, item, index, matches = (entry) => entry.id === item.id) {
      const next = Array.isArray(items) ? [...items] : [];
      if (next.some(matches)) return next;
      next.splice(Math.max(0, Math.min(Number(index) || 0, next.length)), 0, item);
      return next;
    }

    // Draft formuláře záruky – dříve modulová proměnná v app.js, používaná jen zárukami.
    let warrantyFormDraft = (() => {
      try { return JSON.parse(sessionStorage.getItem('domacnostPlus.warrantyDraft')) || null; }
      catch (error) { return null; }
    })();
    const warrantyPendingFiles = new Map();

    function warrantyFileQueueKey(formOrId = '') {
      if (typeof formOrId === 'string') return formOrId || 'new';
      const form = formOrId;
      if (!form) return 'new';
      if (form.dataset?.form === 'add-warranty-files') return `files:${form.dataset.warrantyId || ''}`;
      return 'new';
    }

    function pendingWarrantyFilesFor(key) {
      return warrantyPendingFiles.get(warrantyFileQueueKey(key)) || [];
    }

    function stageWarrantyFilesFromForm(form) {
      if (!form) return [];
      const input = form.querySelector?.('input[type="file"]');
      const files = Array.from(input?.files || []).filter(Boolean);
      const key = warrantyFileQueueKey(form);
      if (files.length) warrantyPendingFiles.set(key, files);
      return pendingWarrantyFilesFor(key);
    }

    function clearWarrantyPendingFiles(key) {
      warrantyPendingFiles.delete(warrantyFileQueueKey(key));
    }

    function renderPendingWarrantyFiles(key) {
      const files = pendingWarrantyFilesFor(key);
      if (!files.length) return '';
      return `
        <div class="inline-note compact-note warranty-pending-files">
          Vybráno: ${files.map((file) => escapeHtml(file.name || 'příloha')).join(', ')}
        </div>`;
    }

    function normalizeWarrantyStatus(value) {
      const key = normalizeKey(value || 'active');
      return WARRANTY_STATUS_OPTIONS.some(([id]) => id === key) ? key : 'active';
    }

    function warrantyStatusLabel(value) {
      return WARRANTY_STATUS_OPTIONS.find(([id]) => id === normalizeWarrantyStatus(value))?.[1] || 'Aktivní';
    }

    function normalizeWarrantyYears(value, purchaseDate = '') {
      const parsed = Number.parseInt(String(value || '').replace(/\D/g, ''), 10);
      if (Number.isFinite(parsed)) return Math.min(10, Math.max(2, parsed));
      return warrantyYearsFromDates(purchaseDate, '') || 2;
    }

    function warrantyYearsFromDates(purchaseDate = '', warrantyUntil = '') {
      if (!purchaseDate || !warrantyUntil) return 0;
      const start = new Date(`${purchaseDate}T00:00:00`);
      const end = new Date(`${warrantyUntil}T00:00:00`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
      const approx = Math.round((end.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      return Math.min(10, Math.max(2, approx || 2));
    }

    function warrantyFileCount(warrantyId) {
      return (getState().warrantyFiles || []).filter((file) => file.warrantyId === warrantyId).length;
    }

    function warrantyFilesFor(warrantyId) {
      return (getState().warrantyFiles || []).filter((file) => file.warrantyId === warrantyId).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }

    function primaryWarrantyFile(warrantyId) {
      return warrantyFilesFor(warrantyId)[0] || null;
    }

    function normalizeWarrantyItem(item = {}) {
      const purchaseDate = normalizeText(item.purchaseDate || item.purchase_date || item.date || todayISO());
      const rawUntil = normalizeText(item.warrantyUntil || item.warranty_until || item.until || '');
      const warrantyYears = normalizeWarrantyYears(item.warrantyYears || item.warranty_years || warrantyYearsFromDates(purchaseDate, rawUntil) || 2, purchaseDate);
      const warrantyUntil = rawUntil || addYearsIso(purchaseDate, warrantyYears);
      return {
        id: item.id || `warranty-${uid()}`,
        householdId: item.householdId || '',
        profileId: item.profileId || '',
        cloudId: item.cloudId || item.cloud_id || '',
        createdAt: item.createdAt || item.created_at || new Date().toISOString(),
        updatedAt: item.updatedAt || item.updated_at || '',
        name: normalizeText(item.name || item.title) || 'Věc v záruce',
        store: normalizeText(item.store || item.seller || ''),
        category: '',
        price: normalizeText(item.price || ''),
        purchaseDate,
        warrantyYears,
        warrantyUntil,
        status: normalizeWarrantyStatus(item.status),
        note: normalizeText(item.note || item.notes || '')
      };
    }

    function normalizeWarranties(items = []) {
      return Array.isArray(items) ? items.map(normalizeWarrantyItem).filter((item) => item.name) : [];
    }

    function warrantyDraftValue(name, fallback = '') {
      if (!warrantyFormDraft || typeof warrantyFormDraft !== 'object') return fallback;
      return Object.prototype.hasOwnProperty.call(warrantyFormDraft, name) ? (warrantyFormDraft[name] || '') : fallback;
    }

    function warrantyDraftHasUserInput() {
      if (!warrantyFormDraft || typeof warrantyFormDraft !== 'object') return false;
      return ['name', 'store', 'price', 'purchaseDate', 'warrantyYears', 'warrantyUntil', 'status', 'note'].some((key) => {
        const value = normalizeText(warrantyFormDraft[key]);
        if (!value) return false;
        if (key === 'purchaseDate' && value === todayISO()) return false;
        if (key === 'warrantyYears' && value === '2') return false;
        if (key === 'warrantyUntil' && value === addYearsIso(todayISO(), 2)) return false;
        if (key === 'status' && value === 'active') return false;
        return true;
      });
    }

    function saveWarrantyDraftFromForm(form) {
      if (!form || !form.matches?.('form[data-form="add-warranty"]')) return;
      const data = getFormData(form);
      warrantyFormDraft = {
        name: normalizeText(data.name),
        store: normalizeText(data.store),
        price: normalizeText(data.price),
        purchaseDate: normalizeText(data.purchaseDate),
        warrantyYears: normalizeText(data.warrantyYears),
        warrantyUntil: normalizeText(data.warrantyUntil),
        status: normalizeText(data.status),
        note: normalizeText(data.note)
      };
      sessionStorage.setItem('domacnostPlus.warrantyDraft', JSON.stringify(warrantyFormDraft));
    }

    function clearWarrantyDraft() {
      warrantyFormDraft = null;
      sessionStorage.removeItem('domacnostPlus.warrantyDraft');
    }

    function isWarrantyFormActive() {
      const form = document.querySelector?.('form[data-form="add-warranty"]');
      if (!form) return false;
      return form.contains(document.activeElement) || warrantyDraftHasUserInput();
    }

    function warrantyTone(item) {
      if (item.status === 'archived' || item.status === 'done') return 'good';
      if (item.status === 'claim') return 'warn';
      const days = daysUntil(item.warrantyUntil);
      if (days === null) return '';
      if (days < 0) return 'bad';
      if (days <= 30) return 'warn';
      return 'good';
    }

    function warrantyBadge(item) {
      if (item.status === 'claim') return 'reklamace';
      if (item.status === 'done') return 'vyřešeno';
      if (item.status === 'archived') return 'archiv';
      const days = daysUntil(item.warrantyUntil);
      if (days === null) return 'bez data';
      if (days < 0) return 'po záruce';
      if (days === 0) return 'končí dnes';
      if (days <= 30) return `končí za ${days} d`;
      return `zbývá ${days} d`;
    }

    function sortedWarranties() {
      return normalizeWarranties(getState().warranties)
        .sort((a, b) => {
          const aArchived = ['archived', 'done'].includes(a.status) ? 1 : 0;
          const bArchived = ['archived', 'done'].includes(b.status) ? 1 : 0;
          if (aArchived !== bArchived) return aArchived - bArchived;
          return String(a.warrantyUntil || '9999').localeCompare(String(b.warrantyUntil || '9999'));
        });
    }

    function renderWarrantyFileItem(file, options = {}) {
      const deletable = options.deletable !== false;
      return `
        <div class="warranty-file-row">
          <button class="ghost-btn file-open-btn" type="button" data-action="open-warranty-file" data-id="${escapeHtml(file.id)}">${escapeHtml(file.fileName || 'Příloha')}</button>
          <span class="item-meta">${escapeHtml(file.fileType || 'soubor')} · ${formatBytes(file.size)}${file.cloudId ? ' · cloud' : ' · lokálně'}</span>
          ${deletable ? `<button class="danger-btn mini-danger-btn" type="button" data-action="delete-warranty-file" data-id="${escapeHtml(file.id)}" aria-label="Smazat přílohu">×</button>` : ''}
        </div>
      `;
    }

    function renderWarrantyItem(item) {
      const fileCount = warrantyFileCount(item.id);
      const firstFile = primaryWarrantyFile(item.id);
      const meta = [
        item.store,
        item.price ? formatCurrency(item.price) : '',
        `koupeno ${formatDate(item.purchaseDate)}`,
        `${item.warrantyYears || 2} roky`,
        `do ${formatDate(item.warrantyUntil)}`,
        fileCount ? `${fileCount} příloh` : 'bez příloh',
        warrantyStatusLabel(item.status)
      ].filter(Boolean).join(' · ');
      return `
        <div class="item warranty-item">
          <div class="item-top">
            <div class="item-title">🧾 ${escapeHtml(item.name)}</div>
            <span class="badge ${warrantyTone(item)}">${escapeHtml(warrantyBadge(item))}</span>
          </div>
          <div class="item-meta">${escapeHtml(meta)}</div>
          ${item.note ? `<div class="inline-note compact-note">${escapeHtml(item.note)}</div>` : ''}
          <div class="item-actions compact-actions warranty-item-actions">
            ${firstFile ? `<button class="ghost-btn" type="button" data-action="open-warranty-file" data-id="${escapeHtml(firstFile.id)}">Otevřít soubor</button>` : ''}
            <button class="ghost-btn" type="button" data-action="open-warranty-detail" data-id="${escapeHtml(item.id)}">Detail</button>
          </div>
        </div>
      `;
    }

    function renderWarrantyDetailModal() {
      if (!activeWarrantyDetailId) return '';
      const item = normalizeWarranties(getState().warranties).find((entry) => entry.id === activeWarrantyDetailId);
      if (!item) return '';
      const files = warrantyFilesFor(item.id);
      const purchaseDate = item.purchaseDate || todayISO();
      const warrantyYears = normalizeWarrantyYears(item.warrantyYears || warrantyYearsFromDates(purchaseDate, item.warrantyUntil) || 2, purchaseDate);
      const warrantyUntil = item.warrantyUntil || addYearsIso(purchaseDate, warrantyYears);
      return `
        <div class="app-modal-backdrop warranty-detail-backdrop" data-modal-backdrop role="presentation">
          <section class="app-modal warranty-detail-modal" role="dialog" aria-modal="true" aria-labelledby="warranty-detail-title">
            <div class="app-modal-head warranty-detail-head">
              <div>
                <span class="badge ${warrantyTone(item)}">${escapeHtml(warrantyBadge(item))}</span>
                <h2 id="warranty-detail-title">${escapeHtml(item.name)}</h2>
                <p>${escapeHtml([item.store, item.price ? formatCurrency(item.price) : '', `do ${formatDate(item.warrantyUntil)}`].filter(Boolean).join(' · '))}</p>
              </div>
              <button class="icon-btn" type="button" data-action="close-modal" aria-label="Zavřít detail záruky">×</button>
            </div>

            <div class="modal-detail-grid warranty-detail-summary">
              <div class="modal-detail-card"><span>Koupeno</span><strong>${escapeHtml(formatDate(item.purchaseDate))}</strong></div>
              <div class="modal-detail-card"><span>Záruka do</span><strong>${escapeHtml(formatDate(item.warrantyUntil))}</strong></div>
              <div class="modal-detail-card"><span>Délka</span><strong>${escapeHtml(String(item.warrantyYears || 2))} roky</strong></div>
              <div class="modal-detail-card"><span>Přílohy</span><strong>${files.length}</strong></div>
            </div>

            <details class="compact-edit-details warranty-detail-edit" data-details-key="warranty-detail-edit-${escapeHtml(item.id)}" ${getDetailsOpen(`warranty-detail-edit-${item.id}`, true) ? 'open' : ''}>
              <summary><span>Upravit údaje</span><em>všechny hodnoty záruky</em></summary>
              <form data-form="edit-warranty" data-id="${escapeHtml(item.id)}" class="compact-form warranty-form">
                <div class="form-grid two">
                  ${field('Věc', 'name', 'text', 'televize / pračka / telefon', true, item.name)}
                  ${field('Obchod', 'store', 'text', 'Alza / Datart / Kaufland', false, item.store)}
                  ${field('Cena', 'price', 'text', 'volitelné', false, item.price, 'decimal')}
                  ${field('Datum koupě', 'purchaseDate', 'date', '', true, purchaseDate)}
                  ${selectField('Délka záruky', 'warrantyYears', WARRANTY_YEARS_OPTIONS, String(warrantyYears))}
                  ${field('Záruka do', 'warrantyUntil', 'date', 'automaticky podle délky', false, warrantyUntil)}
                  ${selectField('Stav', 'status', WARRANTY_STATUS_OPTIONS, item.status)}
                  ${field('Poznámka / reklamace', 'note', 'text', 'reklamace, domluva', false, item.note)}
                </div>
                <div class="form-actions modal-actions"><button class="primary-btn" type="submit">Uložit změny</button></div>
              </form>
            </details>

            <details class="compact-edit-details warranty-detail-files" data-details-key="warranty-detail-files-${escapeHtml(item.id)}" ${getDetailsOpen(`warranty-detail-files-${item.id}`, true) ? 'open' : ''}>
              <summary><span>Přílohy</span><em>${files.length ? `${files.length} souborů` : 'fotka / PDF'}</em></summary>
              ${files.length ? `<div class="warranty-file-list">${files.map((file) => renderWarrantyFileItem(file)).join('')}</div>` : '<div class="item-meta">Bez přílohy</div>'}
              <form data-form="add-warranty-files" data-warranty-id="${escapeHtml(item.id)}" class="compact-form warranty-file-form">
                <label class="field"><span>Přidat fotku / PDF</span><input class="input" type="file" name="files" multiple accept="application/pdf,image/*,.pdf"></label>
                ${renderPendingWarrantyFiles(`files:${item.id}`)}
                <div class="form-actions compact-actions"><button class="ghost-btn" type="submit">Přidat přílohu</button></div>
              </form>
            </details>

            <details class="compact-edit-details danger-zone warranty-detail-danger" data-details-key="warranty-detail-danger-${escapeHtml(item.id)}" ${getDetailsOpen(`warranty-detail-danger-${item.id}`) ? 'open' : ''}>
              <summary><span>Smazat záruku</span><em>nevratná akce</em></summary>
              <div class="hint-box danger-hint">Smaže se záruka i její vazby na přílohy.</div>
              <div class="form-actions modal-actions"><button class="danger-btn" type="button" data-action="delete-warranty" data-id="${escapeHtml(item.id)}">Smazat záruku</button></div>
            </details>
          </section>
        </div>
      `;
    }

    function openWarrantyDetail(id) {
      const item = normalizeWarranties(getState().warranties).find((entry) => entry.id === id);
      if (!item) return false;
      activeWarrantyDetailId = item.id;
      renderOverlays();
      return true;
    }

    function isWarrantyDetailOpen() {
      return Boolean(activeWarrantyDetailId && normalizeWarranties(getState().warranties).some((entry) => entry.id === activeWarrantyDetailId));
    }

    function closeWarrantyDetail(options = {}) {
      if (!activeWarrantyDetailId) return false;
      activeWarrantyDetailId = '';
      if (options.render !== false) renderOverlays();
      return true;
    }

    function renderWarrantyAddForm() {
      const draftPurchaseDate = warrantyDraftValue('purchaseDate', todayISO()) || todayISO();
      const draftWarrantyYears = normalizeWarrantyYears(warrantyDraftValue('warrantyYears', '2'), draftPurchaseDate);
      const draftWarrantyUntil = warrantyDraftValue('warrantyUntil', addYearsIso(draftPurchaseDate, draftWarrantyYears)) || addYearsIso(draftPurchaseDate, draftWarrantyYears);
      const draftStatus = warrantyDraftValue('status', 'active') || 'active';
      return `
        <form data-form="add-warranty" class="compact-form warranty-form">
          <div class="form-grid two">
            ${field('Věc', 'name', 'text', 'televize / pračka / telefon', true, warrantyDraftValue('name', ''))}
            ${field('Obchod', 'store', 'text', 'Alza / Datart / Kaufland', false, warrantyDraftValue('store', ''))}
            ${field('Cena', 'price', 'text', 'volitelné', false, warrantyDraftValue('price', ''), 'decimal')}
            ${field('Datum koupě', 'purchaseDate', 'date', '', true, draftPurchaseDate)}
            ${selectField('Délka záruky', 'warrantyYears', WARRANTY_YEARS_OPTIONS, String(draftWarrantyYears))}
            ${field('Záruka do', 'warrantyUntil', 'date', 'automaticky podle délky', false, draftWarrantyUntil)}
            ${selectField('Stav', 'status', WARRANTY_STATUS_OPTIONS, draftStatus)}
            ${field('Poznámka / reklamace', 'note', 'text', 'např. reklamováno, číslo reklamace, domluva', false, warrantyDraftValue('note', ''))}
          </div>
          <label class="field warranty-file-add-field"><span>Fotka / PDF účtenky</span><input class="input" type="file" name="files" multiple accept="application/pdf,image/*,.pdf"></label>
          ${renderPendingWarrantyFiles('new')}
          <div class="inline-note compact-note">Základ je 2 roky. Fotky se před uložením automaticky zmenší tak, aby zůstal čitelný text. PDF se nechává beze změny.</div>
          <div class="form-actions"><button class="primary-btn" type="submit">Přidat záruku</button></div>
        </form>
      `;
    }

    function renderWarrantiesPanel(warranties) {
      const activeItems = warranties.filter((item) => !['archived', 'done'].includes(item.status));
      const claimCount = warranties.filter((item) => item.status === 'claim').length;
      const endingSoon = warranties.filter((item) => {
        const days = daysUntil(item.warrantyUntil);
        return item.status === 'active' && days !== null && days >= 0 && days <= 30;
      }).length;
      const expired = warranties.filter((item) => {
        const days = daysUntil(item.warrantyUntil);
        return item.status === 'active' && days !== null && days < 0;
      }).length;
      const activeTab = getModuleTab('warranties', 'overview');
      const tabs = renderSectionTabs('warranties', [
        { id: 'overview', label: 'Přehled', icon: '🧾', count: warranties.length },
        { id: 'add', label: 'Přidat záruku', icon: '➕' }
      ], 'overview');
      return `
        <section class="card homecare-panel panel-warranties">
          <div class="card-header">
            <div><h2>Přehled záruk</h2><p>Koupené věci, konec záruky a poznámky třeba k reklamaci.</p></div>
            <span class="badge ${getState().cloud?.householdId ? 'good' : ''}">${getState().cloud?.householdId ? 'sdílené v domácnosti' : 'lokálně'}</span>
          </div>
          ${tabs}
          <div class="module-tabbed warranties-tab-${escapeHtml(activeTab)}" data-tab-area="warranties">
            ${activeTab === 'add' ? renderWarrantyAddForm() : `
              ${renderOverviewSummary([
                { label: 'Aktivní', value: activeItems.length },
                { label: 'Do 30 dnů', value: endingSoon, tone: endingSoon ? 'warn' : '' },
                { label: 'Reklamace', value: claimCount, tone: claimCount ? 'warn' : '' },
                { label: 'Po záruce', value: expired, tone: expired ? 'bad' : '' }
              ])}
              <div style="height:14px"></div>
              ${warranties.length ? `<div class="list warranty-list">${warranties.map(renderWarrantyItem).join('')}</div>` : renderEmptyCta({ icon: '🧾', title: 'Záruky jsou prázdné', text: 'Přidej první koupenou věc. Konec záruky se předvyplní na 2 roky od nákupu.', nav: 'warranties', tab: 'add', label: 'Přidat záruku' })}
            `}
          </div>
        </section>
      `;
    }

    async function ensureCloudWarrantySnapshot() {
      if (!cloudReady()) return false;
      return cloudSaveHouseholdUiSettings(false);
    }

    function isAllowedWarrantyFile(file) {
      if (!file) return false;
      const name = String(file.name || '').toLowerCase();
      const type = String(file.type || '').toLowerCase();
      if (WARRANTY_FILE_ALLOWED_MIME.has(type)) return true;
      return ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].some((ext) => name.endsWith(ext));
    }

    function warrantyFileValidationMessage(file) {
      if (!file) return 'Soubor není dostupný';
      if (file.size > WARRANTY_FILE_MAX_BYTES) return `${file.name || 'Soubor'} je větší než 15 MB`;
      if (!isAllowedWarrantyFile(file)) return `${file.name || 'Soubor'} není podporovaný typ. Použij PDF nebo fotku.`;
      return '';
    }

    function shouldCompressWarrantyImage(file) {
      if (!file) return false;
      const type = String(file.type || '').toLowerCase();
      const name = String(file.name || '').toLowerCase();
      if (!type.startsWith('image/')) return false;
      if (type.includes('heic') || type.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif')) return false;
      return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(type) || /\.(jpe?g|png|webp)$/i.test(name);
    }

    function warrantyCompressedFileName(name = 'uctenka') {
      const clean = String(name || 'uctenka').replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'uctenka';
      return `${clean}-zmenseno.jpg`;
    }

    function loadWarrantyImage(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Obrázek se nepovedlo načíst'));
        };
        image.src = url;
      });
    }

    async function compressWarrantyImageFile(file) {
      if (!shouldCompressWarrantyImage(file)) return file;
      try {
        const image = await loadWarrantyImage(file);
        const width = image.naturalWidth || image.width || 0;
        const height = image.naturalHeight || image.height || 0;
        if (!width || !height) return file;
        const scale = Math.min(1, WARRANTY_IMAGE_MAX_DIMENSION / Math.max(width, height));
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        if (scale >= 1 && file.size <= 900 * 1024) return file;
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return file;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, targetWidth, targetHeight);
        context.drawImage(image, 0, 0, targetWidth, targetHeight);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', WARRANTY_IMAGE_JPEG_QUALITY));
        if (!blob || !blob.size || blob.size >= file.size) return file;
        return new File([blob], warrantyCompressedFileName(file.name), { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
      } catch (error) {
        console.warn('Warranty image compression failed', error);
        return file;
      }
    }

    async function prepareWarrantyFileForSave(file) {
      return compressWarrantyImageFile(file);
    }

    async function cloudUploadWarrantyFile(warranty, file) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId || !warranty?.id) return null;
      const user = await refreshCloudSession(false);
      if (!user) return null;
      await ensureCloudWarrantySnapshot();
      const storagePath = `${getState().cloud.householdId}/${warranty.id}/${Date.now()}-${uid()}-${sanitizeStorageFileName(file.name)}`;
      const { error: uploadError } = await client.storage
        .from('warranty-files')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'application/octet-stream'
        });
      if (uploadError) {
        showToast(uploadError.message || 'Přílohu záruky se nepovedlo nahrát');
        return null;
      }
      const { data, error } = await client
        .from('household_warranty_files')
        .insert({
          household_id: getState().cloud.householdId,
          warranty_key: warranty.id,
          bucket_id: 'warranty-files',
          storage_path: storagePath,
          file_name: file.name || 'příloha',
          mime_type: file.type || null,
          file_size: file.size || 0,
          source: file.type && file.type.startsWith('image/') ? 'camera' : 'upload',
          created_by: user.id
        })
        .select('id,household_id,warranty_key,storage_path,file_name,mime_type,file_size,source,created_at')
        .single();
      if (error) {
        await client.storage.from('warranty-files').remove([storagePath]).catch?.(() => {});
        showToast(error.message || 'Metadata přílohy záruky se nepovedlo uložit');
        return null;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return mapCloudWarrantyFile(data);
    }

    function mapCloudWarrantyFile(item) {
      const warranty = getState().warranties.find((entry) => entry.id === item.warranty_key);
      if (!warranty) return null;
      const existing = getState().warrantyFiles.find((file) => file.cloudId === item.id);
      return {
        id: existing?.id || `warranty-file-cloud-${item.id}`,
        cloudId: item.id,
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        warrantyId: warranty.id,
        storagePath: item.storage_path,
        bucketId: 'warranty-files',
        fileName: item.file_name || 'příloha',
        fileType: item.mime_type || 'soubor',
        size: item.file_size || 0,
        source: item.source || 'upload',
        createdAt: item.created_at || new Date().toISOString()
      };
    }

    async function cloudLoadWarrantyFiles(showMessage = false) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return false;
      const user = await refreshCloudSession(false);
      if (!user) return false;
      const { data, error } = await client
        .from('household_warranty_files')
        .select('id,household_id,warranty_key,storage_path,file_name,mime_type,file_size,source,created_at')
        .eq('household_id', getState().cloud.householdId)
        .order('created_at', { ascending: false });
      if (error) {
        if (showMessage) showToast(error.message || 'Přílohy záruk se nepovedlo načíst');
        return false;
      }
      const cloudFiles = (data || []).map((item) => mapCloudWarrantyFile(item)).filter(Boolean);
      const localOnly = (getState().warrantyFiles || []).filter((file) => !file.cloudId);
      getState().warrantyFiles = [...localOnly, ...cloudFiles];
      getState().cloud.lastSyncAt = new Date().toISOString();
      touchState();
      saveState();
      if (showMessage) {
        render();
        showToast('Cloud přílohy záruk načtené');
      }
      return true;
    }

    async function addWarrantyFilesToWarranty(warranty, files = []) {
      if (!warranty || !files.length) return { added: 0, failed: 0 };
      const useCloudStorage = cloudReady();
      let added = 0;
      let failed = 0;
      for (const originalFile of files) {
        const file = await prepareWarrantyFileForSave(originalFile);
        const validationMessage = warrantyFileValidationMessage(file);
        if (validationMessage) {
          failed += 1;
          showToast(validationMessage);
          continue;
        }
        if (useCloudStorage) {
          const cloudFile = await cloudUploadWarrantyFile(warranty, file);
          if (cloudFile) {
            getState().warrantyFiles = getState().warrantyFiles.filter((entry) => entry.cloudId !== cloudFile.cloudId);
            getState().warrantyFiles.push(cloudFile);
            added += 1;
          } else failed += 1;
          continue;
        }
        if (!('indexedDB' in window)) {
          failed += 1;
          showToast('Prohlížeč nepodporuje IndexedDB');
          continue;
        }
        const id = `warranty-file-${uid()}`;
        const createdAt = new Date().toISOString();
        const meta = {
          id,
          householdId: currentHouseholdId(),
          profileId: currentProfileId(),
          warrantyId: warranty.id,
          fileName: file.name || 'příloha',
          fileType: file.type || 'soubor',
          size: file.size || 0,
          createdAt
        };
        await putStoredWarrantyFile({ ...meta, blob: file });
        getState().warrantyFiles.push(meta);
        added += 1;
      }
      return { added, failed };
    }

    async function addWarrantyFiles(form) {
      const warrantyId = form.dataset.warrantyId;
      const warranty = getState().warranties.find((item) => item.id === warrantyId);
      const input = form.querySelector('input[type="file"]');
      const queueKey = warrantyFileQueueKey(form);
      const files = pendingWarrantyFilesFor(queueKey).length ? pendingWarrantyFilesFor(queueKey) : [...(input?.files || [])];
      if (!warranty || !files.length) return showToast('Vyber soubor');
      const { added, failed } = await addWarrantyFilesToWarranty(warranty, files);
      touchState();
      saveState();
      if (input) input.value = '';
      if (added && !failed) clearWarrantyPendingFiles(queueKey);
      render();
      if (added && cloudReady()) showToast(failed ? `Do cloudu nahráno ${added}, neprošlo ${failed}` : 'Příloha záruky nahraná do cloudu');
      else if (added) showToast(added === 1 ? 'Příloha záruky uložená lokálně' : `Lokálně přidáno příloh: ${added}`);
      else showToast('Přílohu se nepovedlo přidat');
    }

    async function cloudSyncLocalWarrantyFiles(showMessage = true) {
      if (!cloudReady()) {
        if (showMessage) showToast('Nejdřív napoj domácnost na cloud');
        return 0;
      }
      const localFiles = (getState().warrantyFiles || []).filter((file) => !file.cloudId);
      if (!localFiles.length) return 0;
      let uploaded = 0;
      let missing = 0;
      let failed = 0;
      for (const meta of localFiles) {
        const warranty = getState().warranties.find((item) => item.id === meta.warrantyId);
        if (!warranty) { failed += 1; continue; }
        let stored = null;
        try { stored = await getStoredWarrantyFile(meta.id); } catch { stored = null; }
        const blob = stored?.blob;
        if (!blob) { missing += 1; continue; }
        const fileName = meta.fileName || stored.fileName || 'priloha';
        const fileType = meta.fileType || stored.fileType || blob.type || 'application/octet-stream';
        const uploadFile = (typeof File !== 'undefined' && blob instanceof File) ? blob : new File([blob], fileName, { type: fileType });
        const cloudFile = await cloudUploadWarrantyFile(warranty, uploadFile);
        if (!cloudFile?.cloudId) { failed += 1; continue; }
        getState().warrantyFiles = getState().warrantyFiles.filter((file) => file.id !== meta.id && file.cloudId !== cloudFile.cloudId);
        getState().warrantyFiles.push({ ...cloudFile, id: meta.id, createdAt: meta.createdAt || cloudFile.createdAt });
        deleteStoredWarrantyFile(meta.id).catch(() => {});
        uploaded += 1;
      }
      if (uploaded) getState().cloud.lastSyncAt = new Date().toISOString();
      touchState();
      saveState();
      if (showMessage) {
        render();
        const details = [uploaded ? `${uploaded} nahráno` : '', missing ? `${missing} nemá soubor v tomto prohlížeči` : '', failed ? `${failed} chyba` : ''].filter(Boolean).join(' · ');
        showToast(details || 'Přílohy záruk se nepodařilo dohnat');
      }
      return uploaded;
    }

    async function openCloudWarrantyFile(meta, download = false) {
      const client = getSupabaseClient();
      if (!client || !meta?.storagePath) return showToast('Cloud příloha není dostupná');
      const { data, error } = await client.storage
        .from('warranty-files')
        .createSignedUrl(meta.storagePath, 300, download ? { download: meta.fileName || 'priloha' } : undefined);
      if (error || !data?.signedUrl) return showToast(error?.message || 'Dočasný odkaz nejde vytvořit');
      if (download) {
        const link = document.createElement('a');
        link.href = data.signedUrl;
        link.download = meta.fileName || 'priloha';
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }
      showFilePreviewModal({ url: data.signedUrl, name: meta.fileName || 'Příloha záruky', type: meta.fileType || meta.mimeType || '', source: 'Záruky' });
    }

    async function openWarrantyFile(id) {
      const meta = getState().warrantyFiles.find((file) => file.id === id);
      if (meta?.cloudId) return openCloudWarrantyFile(meta, false);
      try {
        const record = await getStoredWarrantyFile(id);
        if (!record?.blob) return showToast('Soubor není v tomto prohlížeči dostupný');
        const url = URL.createObjectURL(record.blob);
        showFilePreviewModal({ url, objectUrl: url, name: meta?.fileName || record.fileName || 'Příloha záruky', type: meta?.fileType || record.fileType || record.blob.type || '', source: 'Záruky' });
      } catch {
        showToast('Soubor nejde otevřít');
      }
    }

    async function permanentlyDeleteWarrantyFile(meta) {
      if (!meta) return;
      if (meta.cloudId) {
        const client = getSupabaseClient();
        if (!client || !getState().cloud?.householdId) return;
        const { error: dbError } = await client.from('household_warranty_files').delete().eq('id', meta.cloudId).eq('household_id', getState().cloud.householdId);
        if (dbError) { console.warn('Cloud sync (smazání přílohy záruky) na pozadí selhal', dbError.message); return; }
        if (meta.storagePath) await client.storage.from('warranty-files').remove([meta.storagePath]).catch?.(() => {});
        getState().cloud.lastSyncAt = new Date().toISOString();
        saveState();
      } else {
        await deleteStoredWarrantyFile(meta.id).catch(() => {});
      }
    }

    async function deleteWarrantyFile(id) {
      const meta = getState().warrantyFiles.find((file) => file.id === id);
      if (!meta) return;
      const ok = window.confirm(meta.cloudId ? 'Smazat přílohu záruky z cloudu?' : 'Smazat přílohu záruky z tohoto zařízení?');
      if (!ok) return;
      const fileIndex = getState().warrantyFiles.findIndex((file) => file.id === id);
      getState().warrantyFiles = getState().warrantyFiles.filter((file) => file.id !== id);
      touchState();
      saveState();
      render();
      offerUndo('Příloha záruky smazána', async () => {
        getState().warrantyFiles = restoreAt(getState().warrantyFiles, meta, fileIndex);
        touchState();
        saveState();
        render();
        showToast('Příloha vrácena');
      }, () => permanentlyDeleteWarrantyFile(meta));
    }

    async function addWarrantyFromForm(data, form) {
      if (form?.dataset?.saving === 'true') {
        showToast('Záruka se právě ukládá…');
        return;
      }
      if (form) form.dataset.saving = 'true';
      const purchaseDate = normalizeText(data.purchaseDate) || todayISO();
      const warrantyYears = normalizeWarrantyYears(data.warrantyYears || 2, purchaseDate);
      const item = normalizeWarrantyItem({
        id: uid(),
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        name: data.name,
        store: data.store,
        price: data.price,
        purchaseDate,
        warrantyYears,
        warrantyUntil: normalizeText(data.warrantyUntil) || addYearsIso(purchaseDate, warrantyYears),
        status: data.status || 'active',
        note: data.note
      });
      getState().warranties = normalizeWarranties([...(getState().warranties || []), item]);
      const savedItem = getState().warranties.find((entry) => entry.id === item.id) || item;
      touchState();
      saveState();
      const input = form?.querySelector?.('input[type="file"]');
      const files = pendingWarrantyFilesFor('new').length ? pendingWarrantyFilesFor('new') : [...(input?.files || [])];
      clearWarrantyDraft();
      clearWarrantyPendingFiles('new');
      form?.reset();
      const purchase = form?.querySelector?.('[name="purchaseDate"]');
      const years = form?.querySelector?.('[name="warrantyYears"]');
      const until = form?.querySelector?.('[name="warrantyUntil"]');
      if (purchase) purchase.value = todayISO();
      if (years) years.value = '2';
      if (until) until.value = addYearsIso(todayISO(), 2);
      if (form) delete form.dataset.saving;
      render();
      showToast(files.length ? 'Záruka uložena, příloha se nahrává na pozadí' : 'Záruka uložena');
      (async () => {
        if (cloudReady()) {
          try {
            const saved = await cloudAddExtraItem('warranties', savedItem);
            if (saved?.id) {
              savedItem.cloudId = saved.id;
              getState().warranties = normalizeWarranties(getState().warranties).map((entry) => entry.id === savedItem.id ? { ...entry, cloudId: saved.id } : entry);
              touchState();
              saveState();
              requestRender();
            }
          } catch (error) {
            console.warn('Warranty cloud add failed', error);
          }
        }
        let fileResult = { added: 0, failed: 0 };
        if (files.length) {
          try {
            fileResult = await addWarrantyFilesToWarranty(savedItem, files);
          } catch (error) {
            console.warn('Warranty file add failed', error);
            fileResult.failed += files.length;
          }
          touchState();
          saveState();
          requestRender();
          if (fileResult.added) showToast(fileResult.failed ? 'Příloha záruky nahraná (část se nepovedla)' : 'Příloha záruky nahraná');
          else showToast('Příloha záruky se nepovedla přidat');
        }
        if (cloudReady()) {
          try {
            await cloudSyncLocalWarrantyFiles(false);
          } catch (error) {
            console.warn('Warranty file follow-up sync failed', error);
          }
        }
      })().catch((error) => console.warn('Cloud sync (záruka) na pozadí selhal', error));
    }

    async function updateWarrantyFromForm(data, form) {
      const id = form?.dataset?.id || '';
      const existing = (getState().warranties || []).find((item) => item.id === id);
      if (!existing) return showToast('Záruka nenalezena');
      const purchaseDate = normalizeText(data.purchaseDate) || existing.purchaseDate || todayISO();
      const warrantyYears = normalizeWarrantyYears(data.warrantyYears || existing.warrantyYears || 2, purchaseDate);
      const updated = normalizeWarrantyItem({
        ...existing,
        name: normalizeText(data.name) || existing.name,
        store: normalizeText(data.store),
        price: normalizeText(data.price),
        purchaseDate,
        warrantyYears,
        warrantyUntil: normalizeText(data.warrantyUntil) || addYearsIso(purchaseDate, warrantyYears),
        status: normalizeWarrantyStatus(data.status),
        note: normalizeText(data.note),
        updatedAt: new Date().toISOString()
      });
      getState().warranties = normalizeWarranties(getState().warranties).map((item) => item.id === id ? updated : item);
      touchState();
      saveState();
      render();
      showToast('Záruka upravena');
      if (cloudReady()) {
        (async () => {
          const current = getState().warranties.find((item) => item.id === id) || updated;
          if (current.cloudId) {
            await cloudUpdateExtraItem('warranties', current);
          } else {
            const saved = await cloudAddExtraItem('warranties', current);
            if (saved?.id) {
              getState().warranties = normalizeWarranties(getState().warranties).map((item) => item.id === id ? { ...item, cloudId: saved.id } : item);
              touchState();
              saveState();
              requestRender();
            }
          }
        })().catch((error) => console.warn('Cloud sync (úprava záruky) na pozadí selhal', error));
      }
    }

    async function deleteWarranty(id) {
      const before = (getState().warranties || []).length;
      const warranty = getState().warranties.find((item) => item.id === id);
      const warrantyIndex = getState().warranties.findIndex((item) => item.id === id);
      const fileSnapshots = (getState().warrantyFiles || []).map((file, index) => ({ file, index })).filter(({ file }) => file.warrantyId === id);
      getState().warranties = normalizeWarranties(getState().warranties).filter((item) => item.id !== id);
      if (getState().warranties.length === before) return;
      if (activeWarrantyDetailId === id) activeWarrantyDetailId = '';
      getState().warrantyFiles = (getState().warrantyFiles || []).filter((file) => file.warrantyId !== id);
      touchState();
      saveState();
      render();
      offerUndo('Záruka smazána', async () => {
        getState().warranties = normalizeWarranties(restoreAt(getState().warranties, warranty, warrantyIndex));
        fileSnapshots.forEach(({ file, index }) => { getState().warrantyFiles = restoreAt(getState().warrantyFiles, file, index); });
        touchState();
        saveState();
        render();
        showToast('Záruka vrácena');
      }, async () => {
        for (const { file } of fileSnapshots) await permanentlyDeleteWarrantyFile(file);
        if (warranty?.cloudId) await cloudDeleteExtraItem('warranties', warranty);
        if (cloudReady()) await cloudSaveHouseholdUiSettings(false);
      });
    }

    return {
      // normalizace / čtení
      normalizeWarrantyStatus,
      normalizeWarrantyYears,
      normalizeWarrantyItem,
      normalizeWarranties,
      sortedWarranties,
      warrantyFilesFor,
      // draft
      saveWarrantyDraftFromForm,
      clearWarrantyDraft,
      stageWarrantyFilesFromForm,
      isWarrantyFormActive,
      // render
      renderWarrantyItem,
      renderWarrantyDetailModal,
      renderWarrantiesPanel,
      openWarrantyDetail,
      closeWarrantyDetail,
      // přílohy + cloud
      cloudLoadWarrantyFiles,
      cloudSyncLocalWarrantyFiles,
      addWarrantyFiles,
      openWarrantyFile,
      deleteWarrantyFile,
      // handlery
      addWarrantyFromForm,
      updateWarrantyFromForm,
      deleteWarranty,
      ui: {
        overlay: {
          isOpen: isWarrantyDetailOpen,
          render: renderWarrantyDetailModal,
          close: closeWarrantyDetail
        }
      }
    };
  }

  window.DomacnostWarranty = { createWarranty };
})();
