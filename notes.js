(function () {
  'use strict';

  // Zápisník (poznámky/stránky) + úkoly. Extrahováno z app.js (fáze B).
  // Stav se čte i zapisuje přes deps.getState() (živá reference – app.js state reassignuje),
  // takže ukládání zůstává 1:1 jako v app.js: mutace pole → saveState() → render().
  function createNotes(deps) {
    const getState = deps.getState || (() => ({}));
    const getDetailsOpen = deps.getDetailsOpen || (() => false);
    const uid = deps.uid || (() => Math.random().toString(36).slice(2));
    const normalizeText = deps.normalizeText || ((value) => String(value || '').trim());
    const escapeHtml = deps.escapeHtml || ((value) => String(value ?? ''));
    const field = deps.field || (() => '');
    const selectField = deps.selectField || (() => '');
    const formatDate = deps.formatDate || ((value) => String(value || ''));
    const daysUntil = deps.daysUntil || (() => null);
    const showToast = deps.showToast || (() => {});
    const saveState = deps.saveState || (() => {});
    const render = deps.render || (() => {});
    const requestRender = deps.requestRender || render;
    const touchState = deps.touchState || (() => {});
    const currentHouseholdId = deps.currentHouseholdId || (() => '');
    const currentProfileId = deps.currentProfileId || (() => '');
    const getModuleTab = deps.getModuleTab || ((area, fallback) => fallback);
    const setModuleTab = deps.setModuleTab || (() => {});
    const addItem = deps.addItem || (async () => {});
    const cloudUpdateExtraItem = deps.cloudUpdateExtraItem || (async () => false);
    const getSupabaseClient = deps.getSupabaseClient || (() => null);
    const refreshCloudSession = deps.refreshCloudSession || (async () => null);
    const renderOverviewItem = deps.renderOverviewItem || (() => '');
    const renderSectionTabs = deps.renderSectionTabs || (() => '');

    const TASK_CATEGORY_OPTIONS = deps.TASK_CATEGORY_OPTIONS || [];
    const TASK_PRIORITY_OPTIONS = deps.TASK_PRIORITY_OPTIONS || [];
    const NOTEBOOK_NOTE_PREFIX = deps.NOTEBOOK_NOTE_PREFIX || 'DPLUS_NOTEBOOK_V1:';

    function normalizeNotebookPageKind(value) {
      // Zůstává jen kvůli zpětné kompatibilitě se stránkami vytvořenými ve v236.
      return value === 'trip' ? 'trip' : 'note';
    }

    function normalizeTripMeta(value = {}) {
      const sources = Array.isArray(value.sources)
        ? value.sources.map((source) => ({
            title: normalizeText(source.title || source.name || source.url || ''),
            url: normalizeText(source.url || source.link || '')
          })).filter((source) => source.title || source.url).slice(0, 8)
        : [];
      return {
        place: normalizeText(value.place || value.destination || value.location || ''),
        date: normalizeText(value.date || ''),
        startLocation: normalizeText(value.startLocation || value.start || ''),
        openingHours: normalizeText(value.openingHours || value.opening_hours || ''),
        ticketPrices: normalizeText(value.ticketPrices || value.ticket_prices || value.prices || ''),
        route: normalizeText(value.route || value.travel || ''),
        weather: normalizeText(value.weather || ''),
        website: normalizeText(value.website || value.web || value.officialWebsite || ''),
        parking: normalizeText(value.parking || ''),
        tips: normalizeText(value.tips || value.notes || value.note || ''),
        warning: normalizeText(value.warning || ''),
        verifiedAt: normalizeText(value.verifiedAt || value.verified_at || value.checkedAt || ''),
        sources
      };
    }

    function parseNotebookNote(note = {}) {
      const text = String(note.text || '');
      if (!text.startsWith(NOTEBOOK_NOTE_PREFIX)) return null;
      try {
        const raw = JSON.parse(text.slice(NOTEBOOK_NOTE_PREFIX.length));
        const items = Array.isArray(raw.items) ? raw.items.map((item) => ({
          id: normalizeText(item.id) || uid(),
          text: normalizeText(item.text),
          done: Boolean(item.done),
          createdAt: item.createdAt || note.createdAt || new Date().toISOString()
        })).filter((item) => item.text) : [];
        return {
          note,
          id: note.id,
          cloudId: note.cloudId || '',
          section: normalizeText(raw.section) || 'Nezařazené',
          kind: normalizeNotebookPageKind(raw.kind || raw.type),
          title: normalizeText(raw.title) || 'Stránka',
          body: normalizeText(raw.body),
          items,
          trip: normalizeTripMeta(raw.trip || {}),
          tripAiStatus: normalizeText(raw.tripAiStatus || ''),
          createdAt: raw.createdAt || note.createdAt || new Date().toISOString(),
          updatedAt: raw.updatedAt || note.updatedAt || ''
        };
      } catch (error) {
        return null;
      }
    }

    function serializeNotebookPage(page = {}) {
      return NOTEBOOK_NOTE_PREFIX + JSON.stringify({
        section: normalizeText(page.section) || 'Nezařazené',
        kind: normalizeNotebookPageKind(page.kind || page.type),
        title: normalizeText(page.title) || 'Stránka',
        body: normalizeText(page.body),
        items: Array.isArray(page.items) ? page.items.map((item) => ({
          id: normalizeText(item.id) || uid(),
          text: normalizeText(item.text),
          done: Boolean(item.done),
          createdAt: item.createdAt || new Date().toISOString()
        })).filter((item) => item.text) : [],
        trip: normalizeTripMeta(page.trip || {}),
        tripAiStatus: normalizeText(page.tripAiStatus || ''),
        createdAt: page.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    // Cache pro notebookPages() a legacyQuickNotes() sdílí jednu signature
    // z state.notes. Fingerprint textu je FNV-1a hash CELÉHO note.text —
    // dřívější `text.slice(0, 96)` mohl nechat starou cache při editaci
    // za 96. znakem se zachovanou délkou/timestampem. FNV-1a je O(n) přes
    // celý text (řádově srovnatelné s Array.filter/map dole), deterministic
    // a nepotřebuje žádnou závislost. Cache invaliduje, když se cokoli
    // z těchto polí změní — po saveState i po reassignu state.
    let cachedNotesSignature = '';
    let cachedNotebookPages = null;
    let cachedLegacyQuickNotes = null;

    // FNV-1a 32-bit — jednoduchý deterministic string hash. Math.imul emuluje
    // 32-bit multiply v JavaScriptu; výstup je vrácen v base36 pro krátkost.
    function fnv1aHashNoteText(text) {
      let h = 0x811c9dc5;
      for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return (h >>> 0).toString(36);
    }

    function computeNotesSignature() {
      const notes = getState().notes || [];
      const parts = new Array(notes.length);
      for (let i = 0; i < notes.length; i += 1) {
        const n = notes[i] || {};
        const text = String(n.text || '');
        parts[i] = `${n.id || ''}|${n.cloudId || ''}|${n.updatedAt || ''}|${n.createdAt || ''}|${text.length}|${fnv1aHashNoteText(text)}`;
      }
      return `${notes.length}#${parts.join('||')}`;
    }

    function ensureNotesFresh() {
      const sig = computeNotesSignature();
      if (sig !== cachedNotesSignature) {
        cachedNotesSignature = sig;
        cachedNotebookPages = null;
        cachedLegacyQuickNotes = null;
      }
    }

    function notebookPages() {
      ensureNotesFresh();
      if (cachedNotebookPages) return cachedNotebookPages;
      cachedNotebookPages = (getState().notes || [])
        .map(parseNotebookNote)
        .filter(Boolean)
        .sort((a, b) => `${a.section} ${a.title}`.localeCompare(`${b.section} ${b.title}`, 'cs'));
      return cachedNotebookPages;
    }

    function legacyQuickNotes() {
      ensureNotesFresh();
      if (cachedLegacyQuickNotes) return cachedLegacyQuickNotes;
      cachedLegacyQuickNotes = (getState().notes || [])
        .filter((note) => !parseNotebookNote(note))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return cachedLegacyQuickNotes;
    }

    function notebookSections(pages = notebookPages()) {
      const map = new Map();
      pages.forEach((page) => {
        const key = page.section || 'Domácnost';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(page);
      });
      return [...map.entries()].map(([section, items]) => ({ section, items }));
    }

    function notebookSectionNames() {
      return notebookSections()
        .map((group) => normalizeText(group.section))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'cs'));
    }

    function notebookSectionField() {
      const sections = notebookSectionNames();
      if (!sections.length) {
        return field('Sekce', 'section', 'text', 'např. Výlety', true);
      }
      const selectId = `field-notebook-section-preset-${Math.random().toString(36).slice(2, 7)}`;
      const inputId = `field-notebook-section-new-${Math.random().toString(36).slice(2, 7)}`;
      return `
        <div class="notebook-section-picker">
          <div class="field notebook-section-field">
            <label for="${selectId}">Sekce</label>
            <select class="select" id="${selectId}" name="sectionPreset">
              <option value="">Nová sekce…</option>
              ${sections.map((section) => `<option value="${escapeHtml(section)}">${escapeHtml(section)}</option>`).join('')}
            </select>
            <small class="field-hint">Vyber existující sekci, třeba Výlety, nebo níž napiš novou.</small>
          </div>
          <div class="field notebook-new-section-field">
            <label for="${inputId}">Nová sekce</label>
            <input class="input" id="${inputId}" name="section" type="text" placeholder="Vyplň jen pro novou sekci" autocomplete="off">
          </div>
        </div>
      `;
    }

    function notebookDueField() {
      const inputId = `field-task-due-${Math.random().toString(36).slice(2, 7)}`;
      return `
        <div class="field notebook-due-field">
          <label for="${inputId}">Termín</label>
          <input class="input notebook-date-input" id="${inputId}" name="due" type="date" autocomplete="off">
        </div>
      `;
    }

    function notebookChecklistFromText(value) {
      return String(value || '')
        .split(/\r?\n/)
        .map((line) => normalizeText(line.replace(/^[-*☐✓✔\s]+/, '')))
        .filter(Boolean)
        .map((text) => ({ id: uid(), text, done: false, createdAt: new Date().toISOString() }));
    }

    async function saveNotebookPage(page, showMessage = false) {
      const note = (getState().notes || []).find((entry) => entry.id === page.id);
      if (!note) return false;
      note.text = serializeNotebookPage(page);
      note.updatedAt = new Date().toISOString();
      touchState();
      saveState();
      render();
      if (showMessage) showToast('Stránka uložená');
      cloudUpdateExtraItem('notes', note).catch((error) => console.warn('Cloud sync (zápisník) na pozadí selhal', error));
      return true;
    }

    async function addNotebookPageFromForm(data, form) {
      const section = normalizeText(data.sectionPreset) || normalizeText(data.section);
      const title = normalizeText(data.title);
      if (!section) return showToast('Doplň sekci');
      if (!title) return showToast('Doplň název stránky');
      const page = {
        section,
        kind: 'note',
        title,
        body: normalizeText(data.body),
        items: notebookChecklistFromText(data.items),
        trip: normalizeTripMeta({}),
        createdAt: new Date().toISOString()
      };
      setModuleTab('notebookCreate', '');
      await addItem('notes', { text: serializeNotebookPage(page), status: 'active' });
      form?.reset();
    }

    async function addNotebookItemFromForm(data, form) {
      const page = notebookPages().find((entry) => entry.id === form?.dataset?.pageId);
      const text = normalizeText(data.itemText);
      if (!page || !text) return showToast('Doplň bod seznamu');
      page.items.push({ id: uid(), text, done: false, createdAt: new Date().toISOString() });
      await saveNotebookPage(page, true);
    }

    async function toggleNotebookItem(pageId, itemId) {
      const page = notebookPages().find((entry) => entry.id === pageId);
      const item = page?.items.find((entry) => entry.id === itemId);
      if (!page || !item) return;
      item.done = !item.done;
      await saveNotebookPage(page);
    }

    async function deleteNotebookItem(pageId, itemId) {
      const page = notebookPages().find((entry) => entry.id === pageId);
      if (!page) return;
      page.items = page.items.filter((entry) => entry.id !== itemId);
      await saveNotebookPage(page, true);
    }

    async function notebookItemToTask(pageId, itemId) {
      const page = notebookPages().find((entry) => entry.id === pageId);
      const item = page?.items.find((entry) => entry.id === itemId);
      if (!page || !item) return;
      const task = {
        id: uid(),
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        title: item.text,
        due: '',
        note: `${page.section} / ${page.title}`,
        category: 'domacnost',
        priority: 'normal',
        done: false
      };
      getState().homeTasks.push(task);
      setModuleTab('notebookCreate', '');
      touchState();
      saveState();
      render();
      showToast('Bod převedený na úkol');
      cloudAddTask(task).then((saved) => {
        if (saved?.id) { task.cloudId = saved.id; saveState(); requestRender(); }
      }).catch((error) => console.warn('Cloud sync (úkol) na pozadí selhal', error));
    }

    function notebookPageSummary(page) {
      const open = page.items.filter((item) => !item.done).length;
      const done = page.items.filter((item) => item.done).length;
      return `${page.items.length} bodů${open ? ` · ${open} otevřené` : ''}${done ? ` · ${done} hotovo` : ''}`;
    }

    function renderNotebookPage(page) {
      const badge = page.items?.length ? `${page.items.filter((item) => !item.done).length} otevřené` : 'bez checklistu';
      return `
        <article class="notebook-page notebook-note-card item" id="notebook-page-${escapeHtml(page.id)}">
          <div class="item-top notebook-note-top">
            <div>
              <div class="notebook-section-pill">${escapeHtml(page.section)} · stránka</div>
              <div class="item-title">${escapeHtml(page.title)}</div>
            </div>
            <span class="badge ${page.cloudId ? 'good' : ''}">${page.cloudId ? 'cloud' : 'lokálně'}</span>
          </div>
          ${page.body ? `<div class="notebook-body">${escapeHtml(page.body)}</div>` : '<div class="notebook-body muted">Bez delšího textu.</div>'}
          <div class="notebook-note-stats"><span>${escapeHtml(notebookPageSummary(page))}</span><span>${escapeHtml(badge)}</span></div>
          ${page.items.length ? `<div class="notebook-checklist">${page.items.map((item) => `
            <div class="notebook-check ${item.done ? 'done' : ''}">
              <button class="notebook-check-toggle" type="button" data-action="notebook-item-toggle" data-page-id="${escapeHtml(page.id)}" data-item-id="${escapeHtml(item.id)}">${item.done ? '✓' : ''}</button>
              <span>${escapeHtml(item.text)}</span>
              <button class="ghost-btn tiny-btn" type="button" data-action="notebook-item-task" data-page-id="${escapeHtml(page.id)}" data-item-id="${escapeHtml(item.id)}">Úkol</button>
              <button class="ghost-btn tiny-btn" type="button" data-action="notebook-item-delete" data-page-id="${escapeHtml(page.id)}" data-item-id="${escapeHtml(item.id)}">×</button>
            </div>
          `).join('')}</div>` : '<div class="inline-note compact-note">Stránka zatím nemá žádný checklist.</div>'}
          <form data-form="add-notebook-item" data-page-id="${escapeHtml(page.id)}" class="notebook-add-line">
            <input class="input" name="itemText" type="text" placeholder="Přidat bod na stránku">
            <button class="ghost-btn" type="submit">Přidat</button>
          </form>
          <div class="item-actions">
            <button class="danger-btn" type="button" data-action="delete" data-collection="notes" data-id="${escapeHtml(page.id)}">Smazat stránku</button>
          </div>
        </article>
      `;
    }

    function taskDueBadgeText(task) {
      if (!task?.due) return 'bez termínu';
      const diff = daysUntil(task.due);
      if (diff === null) return formatDate(task.due);
      if (diff < 0) return `po termínu · ${formatDate(task.due)}`;
      if (diff === 0) return 'dnes';
      if (diff === 1) return 'zítra';
      return formatDate(task.due);
    }

    function taskDueTone(task) {
      if (task?.done) return 'good';
      const diff = daysUntil(task?.due);
      if (diff === null) return '';
      return diff <= 1 ? 'warn' : '';
    }

    function taskSortValue(task) {
      if (!task?.due) return '9999-12-31';
      return String(task.due);
    }

    function notebookTaskGroups(tasks = []) {
      const sorted = [...tasks].sort((a, b) => {
        if (Boolean(a.done) !== Boolean(b.done)) return Number(a.done) - Number(b.done);
        const dueCompare = taskSortValue(a).localeCompare(taskSortValue(b));
        if (dueCompare) return dueCompare;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
      const groups = {
        today: [],
        soon: [],
        later: [],
        noDue: [],
        done: []
      };
      sorted.forEach((task) => {
        if (task.done) {
          groups.done.push(task);
          return;
        }
        const diff = daysUntil(task.due);
        if (!task.due || diff === null) groups.noDue.push(task);
        else if (diff <= 0) groups.today.push(task);
        else if (diff <= 14) groups.soon.push(task);
        else groups.later.push(task);
      });
      return groups;
    }

    function renderNotebookTaskItem(task) {
      return `
        <article class="notebook-task-card ${task.done ? 'done' : ''}">
          <div class="notebook-task-main">
            <button class="notebook-task-check" type="button" data-action="task-toggle" data-id="${escapeHtml(task.id)}" aria-label="${task.done ? 'Vrátit úkol' : 'Označit jako hotové'}">${task.done ? '✓' : ''}</button>
            <div class="notebook-task-text">
              <div class="item-title">${escapeHtml(task.title)}</div>
              <div class="item-meta">${escapeHtml(taskCategoryLabel(task.category))} · ${escapeHtml(taskPriorityLabel(task.priority))}${task.note ? ` · ${escapeHtml(task.note)}` : ''}${task.cloudId ? ' · cloud' : ' · lokálně'}</div>
            </div>
          </div>
          <div class="notebook-task-side">
            <span class="badge ${escapeHtml(taskDueTone(task))}">${escapeHtml(taskDueBadgeText(task))}</span>
            <div class="item-actions notebook-task-actions"><button class="danger-btn tiny-btn" type="button" data-action="task-delete" data-id="${escapeHtml(task.id)}">Smazat</button></div>
          </div>
        </article>
      `;
    }

    function renderNotebookTaskGroup(title, items, note = '') {
      if (!items.length) return '';
      return `
        <section class="notebook-task-group">
          <div class="notebook-task-group-head"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(String(items.length))}</span></div>
          ${note ? `<p>${escapeHtml(note)}</p>` : ''}
          <div class="notebook-task-list">${items.map(renderNotebookTaskItem).join('')}</div>
        </section>
      `;
    }

    function renderNotebookTaskGroups(tasks = []) {
      const groups = notebookTaskGroups(tasks);
      return [
        renderNotebookTaskGroup('Dnes', groups.today, 'Co je dnes nebo už po termínu.'),
        renderNotebookTaskGroup('Brzy', groups.soon, 'Úkoly s termínem v nejbližších 14 dnech.'),
        renderNotebookTaskGroup('Později', groups.later, 'Úkoly s termínem dál v kalendáři.'),
        renderNotebookTaskGroup('Bez termínu', groups.noDue, 'Věci, které nejsou navázané na konkrétní den.'),
        renderNotebookTaskGroup('Hotovo', groups.done.slice(0, 30))
      ].join('');
    }

    function normalizeTaskCategory(value) {
      const valid = new Set(TASK_CATEGORY_OPTIONS.map(([key]) => key));
      return valid.has(value) ? value : 'domacnost';
    }

    function normalizeTaskPriority(value) {
      const valid = new Set(TASK_PRIORITY_OPTIONS.map(([key]) => key));
      return valid.has(value) ? value : 'normal';
    }

    function taskCategoryLabel(value) {
      return TASK_CATEGORY_OPTIONS.find(([key]) => key === value)?.[1] || 'Domácnost';
    }

    function taskPriorityLabel(value) {
      return TASK_PRIORITY_OPTIONS.find(([key]) => key === value)?.[1] || 'Normální';
    }

    function cloudTaskPayload(task, userId) {
      return {
        household_id: getState().cloud.householdId,
        profile_id: null,
        assigned_profile_id: null,
        title: task.title || 'Úkol',
        description: task.note || null,
        category: normalizeTaskCategory(task.category),
        priority: normalizeTaskPriority(task.priority),
        status: task.done ? 'done' : 'open',
        due_date: task.due || null,
        due_at: null,
        repeat_rule: 'none',
        repeat_interval: 1,
        notify_before_minutes: 60,
        completed_at: task.done ? (task.completedAt || new Date().toISOString()) : null,
        completed_by_profile_id: null,
        created_by: userId,
        updated_by: userId
      };
    }

    async function cloudAddTask(task) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return null;
      const user = await refreshCloudSession(false);
      if (!user) return null;
      const { data, error } = await client.from('household_tasks').insert(cloudTaskPayload(task, user.id)).select('id').single();
      if (error) {
        showToast(error.message || 'Úkol se nepovedlo uložit do cloudu');
        return null;
      }
      task.cloudId = data.id;
      getState().cloud.lastSyncAt = new Date().toISOString();
      return data;
    }

    async function cloudUpdateTask(task) {
      const client = getSupabaseClient();
      if (!client || !task?.cloudId || !getState().cloud?.householdId) return true;
      const user = await refreshCloudSession(false);
      if (!user) return false;
      const { error } = await client
        .from('household_tasks')
        .update(cloudTaskPayload(task, user.id))
        .eq('id', task.cloudId)
        .eq('household_id', getState().cloud.householdId);
      if (error) {
        showToast(error.message || 'Úkol se nepovedlo upravit v cloudu');
        return false;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return true;
    }

    async function cloudDeleteTask(task) {
      const client = getSupabaseClient();
      if (!client || !task?.cloudId || !getState().cloud?.householdId) return true;
      const { error } = await client.from('household_tasks').delete().eq('id', task.cloudId).eq('household_id', getState().cloud.householdId);
      if (error) {
        showToast(error.message || 'Úkol se nepovedlo smazat v cloudu');
        return false;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return true;
    }

    async function cloudLoadTasks(showMessage = true) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return false;
      const { data, error } = await client
        .from('household_tasks')
        .select('*')
        .eq('household_id', getState().cloud.householdId)
        .order('status', { ascending: false })
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) {
        showToast(error.message || 'Úkoly se nepovedlo načíst z cloudu');
        return false;
      }
      const localOnly = getState().homeTasks.filter((task) => !task.cloudId);
      const cloudItems = (data || []).map((item) => ({
        id: getState().homeTasks.find((task) => task.cloudId === item.id)?.id || `task-cloud-${item.id}`,
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        cloudId: item.id,
        title: item.title,
        due: item.due_date || '',
        note: item.description || '',
        category: normalizeTaskCategory(item.category),
        priority: normalizeTaskPriority(item.priority),
        done: item.status === 'done',
        completedAt: item.completed_at || '',
        createdAt: item.created_at || new Date().toISOString()
      }));
      getState().homeTasks = [...cloudItems, ...localOnly];
      getState().tasksCloud = { ...(getState().tasksCloud || {}), loadedAt: new Date().toISOString() };
      touchState();
      saveState();
      render();
      if (showMessage) showToast('Cloud úkoly načteny');
      return true;
    }

    async function cloudSyncTaskById(id) {
      const task = getState().homeTasks.find((entry) => entry.id === id);
      if (!task) return;
      const saved = task.cloudId ? await cloudUpdateTask(task) : await cloudAddTask(task);
      if (!saved && !task.cloudId) return;
      touchState();
      saveState();
      render();
      showToast('Úkol odeslán do cloudu');
    }

    async function cloudSyncLocalTasks() {
      const local = getState().homeTasks.filter((task) => !task.cloudId);
      if (!local.length) return showToast('Žádné lokální úkoly k odeslání');
      let count = 0;
      for (const task of local) {
        const saved = await cloudAddTask(task);
        if (saved?.id) count += 1;
      }
      touchState();
      saveState();
      render();
      showToast(`Odesláno úkolů: ${count}`);
    }

    async function addTaskFromForm(data, form) {
      const task = {
        id: uid(),
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        title: normalizeText(data.title),
        due: normalizeText(data.due),
        note: normalizeText(data.note),
        category: normalizeTaskCategory(data.category),
        priority: normalizeTaskPriority(data.priority),
        done: false
      };
      if (!task.title) return showToast('Doplň název úkolu');
      getState().homeTasks.push(task);
      setModuleTab('notebookCreate', '');
      touchState();
      saveState();
      form.reset();
      render();
      showToast('Úkol uložen');
      cloudAddTask(task).then((saved) => {
        if (saved?.id) { task.cloudId = saved.id; saveState(); requestRender(); }
      }).catch((error) => console.warn('Cloud sync (úkol) na pozadí selhal', error));
    }

    async function toggleTaskDone(id) {
      const task = getState().homeTasks.find((entry) => entry.id === id);
      if (!task) return;
      task.done = !task.done;
      task.completedAt = task.done ? new Date().toISOString() : '';
      touchState();
      saveState();
      render();
      cloudUpdateTask(task).catch((error) => console.warn('Cloud sync (úkol) na pozadí selhal', error));
    }

    async function deleteTask(id) {
      const task = getState().homeTasks.find((entry) => entry.id === id);
      if (!task) return;
      getState().homeTasks = getState().homeTasks.filter((entry) => entry.id !== id);
      touchState();
      saveState();
      render();
      showToast('Úkol smazán');
      cloudDeleteTask(task).catch((error) => console.warn('Cloud sync (úkol) na pozadí selhal', error));
    }

    function renderTaskOverviewItem(task) {
      const days = daysUntil(task.due);
      return renderOverviewItem({
        title: task.title,
        badge: task.due ? formatDate(task.due) : 'bez termínu',
        badgeClass: task.due && days <= 2 ? 'warn' : '',
        meta: task.note || taskCategoryLabel(task.category),
        icon: '✅'
      });
    }

    // Celý panel "Zápisník" (poznámky + úkoly). Vyříznuto z renderHomecare,
    // počítá si lokální proměnné stejně jako původní inline blok.
    function renderNotebookPanel() {
      const S = getState();
      const tasks = [...S.homeTasks].sort((a, b) => Number(a.done) - Number(b.done));
      const notes = [...S.notes].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const notebookTabs = ['notes', 'tasks'];
      const storedNotebookTab = getModuleTab('notebook', 'notes');
      const activeNotebookTab = notebookTabs.includes(storedNotebookTab) ? storedNotebookTab : 'notes';
      const notebookCreateType = ['note', 'task'].includes(getModuleTab('notebookCreate', '')) ? getModuleTab('notebookCreate', '') : '';
      const notebookPageCount = notebookPages().length;
      const openTaskCount = tasks.filter((task) => !task.done).length;
      return `
        <section class="card homecare-panel panel-tasks notebook-panel notebook-tabs-panel">
          <div class="card-header notebook-card-header">
            <div><h2>Poznámky a úkoly</h2><p>Jedno místo, ale dvě jasné části: Poznámky pro stránky a Úkoly pro věci k udělání.</p></div>
            <div class="notebook-header-actions">
              <span class="badge ${(tasks.some((task) => task.cloudId) || notebookPages().some((page) => page.cloudId)) ? 'good' : ''}">${S.cloud?.householdId ? 'sdílená domácnost' : 'lokálně'}</span>
            </div>
          </div>
          ${notebookCreateType ? `
            <div class="notebook-create-page notebook-create-${notebookCreateType}">
              <div class="card-subheader notebook-create-head"><div><h3>${notebookCreateType === 'task' ? 'Přidat úkol' : 'Přidat poznámku'}</h3><p>${notebookCreateType === 'task' ? 'Jen úkol. Poznámky zůstanou bokem.' : 'Jen poznámka/stránka. Úkoly zůstanou bokem.'}</p></div><button class="ghost-btn" type="button" data-action="set-section-tab" data-area="notebookCreate" data-tab="">Zpět</button></div>
              ${notebookCreateType === 'note' ? `
                <section class="glass-subcard notebook-create-card">
                  <div class="card-subheader"><h3>Nová poznámka</h3><p>Sekce, stránka, text a volitelný checklist.</p></div>
                  <form data-form="add-notebook-page" class="compact-form">
                    <div class="form-grid two notebook-note-form-grid">
                      ${notebookSectionField()}
                      ${field('Název stránky', 'title', 'text', 'např. Zoo Dvůr Králové', true)}
                    </div>
                    <div class="field"><label>Text stránky</label><textarea class="textarea" name="body" placeholder="Poznámka, odkazy, parkování, co vzít s sebou..."></textarea></div>
                    <div class="field"><label>Checklist / nápady</label><textarea class="textarea" name="items" placeholder="Zjistit parkování&#10;Koupit vstupenky&#10;Vzít pití a svačinu"></textarea></div>
                    <div class="form-actions"><button class="primary-btn" type="submit">Uložit poznámku</button></div>
                  </form>
                </section>
              ` : `
                <section class="glass-subcard notebook-create-card">
                  <div class="card-subheader"><h3>Nový úkol</h3><p>Věc k udělání s termínem, kategorií a prioritou.</p></div>
                  <form data-form="add-task" class="compact-form notebook-task-form">
                    <div class="form-grid two notebook-task-form-grid">
                      ${field('Úkol', 'title', 'text', 'vyměnit filtr / koupit baterky', true)}
                      ${notebookDueField()}
                      ${selectField('Kategorie', 'category', TASK_CATEGORY_OPTIONS, 'domacnost')}
                      ${selectField('Priorita', 'priority', TASK_PRIORITY_OPTIONS, 'normal')}
                      ${field('Poznámka', 'note', 'text', 'volitelné')}
                    </div>
                    <div class="form-actions"><button class="primary-btn" type="submit">Uložit úkol</button></div>
                  </form>
                </section>
              `}
            </div>
          ` : `
          ${renderSectionTabs('notebook', [
            { id: 'notes', label: 'Poznámky', icon: '📝', count: notebookPageCount },
            { id: 'tasks', label: 'Úkoly', icon: '✅', count: openTaskCount }
          ], 'notes')}
          ${activeNotebookTab === 'notes' ? `
            <div class="notebook-tab-content notebook-notes-tab">
              <div class="card-subheader notebook-list-head"><div><h3>Poznámky</h3><p>Vlastní sekce a stránky bez předvyplněného bordelu.</p></div>${notebookPageCount ? '<button class="ghost-btn" type="button" data-action="set-section-tab" data-area="notebookCreate" data-tab="note">+ přidat poznámku</button>' : ''}</div>
              ${notebookSections().length ? `<div class="notebook-section-list">${notebookSections().map((group) => `
                <section class="notebook-section-card">
                  <div class="notebook-section-head">
                    <strong>${escapeHtml(group.section)}</strong>
                    <span>${escapeHtml(String(group.items.length))} stránek</span>
                  </div>
                  <div class="notebook-pages">${group.items.map((page) => renderNotebookPage(page)).join('')}</div>
                </section>
              `).join('')}</div>` : '<div class="notebook-empty-actions"><div><strong>Poznámky jsou prázdné</strong><p>Vytvoř první vlastní sekci a stránku. Žádné výchozí sekce se nepřidávají.</p></div><button class="primary-btn" type="button" data-action="set-section-tab" data-area="notebookCreate" data-tab="note">+ přidat poznámku</button></div>'}
              ${legacyQuickNotes().length ? `<details class="compact-edit-details legacy-notes" data-details-key="notes-legacy-quick" ${getDetailsOpen('notes-legacy-quick') ? 'open' : ''}><summary><span>Starší rychlé poznámky</span><em>${legacyQuickNotes().length}</em></summary><div class="list">${legacyQuickNotes().map((note) => `<div class="item"><div class="item-top"><div class="item-title">${escapeHtml(note.text)}</div><span class="badge ${note.cloudId ? 'good' : ''}">${note.cloudId ? 'cloud' : 'lokálně'}</span></div><div class="item-actions"><button class="danger-btn" type="button" data-action="delete" data-collection="notes" data-id="${escapeHtml(note.id)}">Smazat</button></div></div>`).join('')}</div></details>` : ''}
            </div>
          ` : `
            <div class="notebook-tab-content notebook-tasks-tab">
              <div class="card-subheader notebook-list-head"><div><h3>Úkoly</h3><p>Rozdělené na dnes, brzy, později, bez termínu a hotovo.</p></div>${tasks.length ? '<button class="ghost-btn" type="button" data-action="set-section-tab" data-area="notebookCreate" data-tab="task">+ přidat úkol</button>' : ''}</div>
              ${tasks.length ? renderNotebookTaskGroups(tasks) : '<div class="notebook-empty-actions"><div><strong>Žádné úkoly</strong><p>Checklisty v poznámkách můžeš kdykoliv převést na úkol.</p></div><button class="primary-btn" type="button" data-action="set-section-tab" data-area="notebookCreate" data-tab="task">+ přidat úkol</button></div>'}
            </div>
          `}
          `}
        </section>
      `;
    }

    return {
      // čtení / pomocné
      notebookPages,
      legacyQuickNotes,
      notebookSections,
      notebookSectionNames,
      parseNotebookNote,
      serializeNotebookPage,
      // render
      renderNotebookPage,
      renderNotebookTaskItem,
      renderNotebookTaskGroups,
      renderTaskOverviewItem,
      renderNotebookPanel,
      notebookPageSummary,
      // task helpers
      normalizeTaskCategory,
      normalizeTaskPriority,
      taskCategoryLabel,
      taskPriorityLabel,
      // handlery – zápisník
      saveNotebookPage,
      addNotebookPageFromForm,
      addNotebookItemFromForm,
      toggleNotebookItem,
      deleteNotebookItem,
      notebookItemToTask,
      // handlery / cloud – úkoly
      cloudAddTask,
      cloudUpdateTask,
      cloudDeleteTask,
      cloudLoadTasks,
      cloudSyncTaskById,
      cloudSyncLocalTasks,
      addTaskFromForm,
      toggleTaskDone,
      deleteTask
    };
  }

  window.DomacnostNotes = { createNotes };
})();
