(function () {
  'use strict';

  function createController(deps) {
    const getState = deps.getState || (() => ({}));
    const normalizeText = deps.normalizeText || ((value) => String(value || '').trim());
    const normalizeKey = deps.normalizeKey || ((value) => normalizeText(value).toLowerCase());
    const decimalValue = deps.decimalValue || ((value) => Number(value || 0));
    const uid = deps.uid || (() => Math.random().toString(36).slice(2));
    const confirmDialog = deps.confirm || ((message) => window.confirm(message));
    const promptDialog = deps.prompt || ((message, value) => window.prompt(message, value));

    function state() {
      return getState();
    }

    function showToast(message) {
      if (typeof deps.showToast === 'function') deps.showToast(message);
    }

    function persist(renderMode = 'full') {
      deps.touchState?.();
      if (renderMode === 'request') {
        deps.requestRender?.();
        const defer = (typeof window !== 'undefined' && window.setTimeout) ? window.setTimeout.bind(window) : setTimeout;
        defer(() => deps.saveState?.(), 0);
        return;
      }
      deps.saveState?.();
      deps.render?.();
    }

    function activeList() {
      return deps.getActiveShoppingList?.() || null;
    }

    function isWholePieceUnit(unit) {
      const key = normalizeKey(unit || 'ks');
      return key === 'ks' || key === 'kus' || key === 'kusy' || key === 'kusu' || key === 'bal' || key === 'baleni';
    }

    function sanitizeShoppingQuantity(value, unit) {
      const parsed = decimalValue(value) || 1;
      if (isWholePieceUnit(unit)) return Math.max(1, Math.round(parsed));
      return Math.max(0.25, Number(parsed.toFixed(2)));
    }

    async function addShoppingFromForm(data, form) {
      deps.ensureShoppingListsReady?.();
      const store = state();
      const name = normalizeText(data.name);
      if (!name) return showToast('Zadej položku');
      const catalogItem = deps.findShoppingCatalogItem?.(name) || null;
      const kind = normalizeText(data.kind || data.category) || catalogItem?.kind || catalogItem?.category || 'Ostatní';
      const category = kind;
      const unit = normalizeText(data.unit) || catalogItem?.defaultUnit || 'ks';
      const quantity = sanitizeShoppingQuantity(data.quantity, unit);
      const note = normalizeText(data.note);
      const isKnown = Boolean(catalogItem);
      const listId = deps.getActiveShoppingListId?.() || '';
      if (!listId) return showToast('Nejdřív vytvoř nákupní seznam přes plus');
      const list = activeList();
      const cloudReady = Boolean(deps.cloudReady?.());

      if (!isKnown) {
        store.shoppingCatalogCustom = store.shoppingCatalogCustom || [];
        if (!store.shoppingCatalogCustom.some((item) => normalizeKey(item.name) === normalizeKey(name))) {
          store.shoppingCatalogCustom.push({
            id: uid(),
            householdId: deps.currentHouseholdId?.() || '',
            profileId: deps.currentProfileId?.() || '',
            createdAt: new Date().toISOString(),
            name,
            defaultUnit: unit,
            category,
            kind
          });
          deps.markShoppingCatalogDirty?.();
        }
      }

      const existingItem = (store.shopping || []).find((item) => item.listId === listId && !item.done && normalizeKey(item.name) === normalizeKey(name) && normalizeKey(item.unit) === normalizeKey(unit) && normalizeKey(item.note) === normalizeKey(note));
      if (existingItem) {
        const previousQuantity = existingItem.quantity;
        existingItem.quantity = sanitizeShoppingQuantity((Number(existingItem.quantity || 1) || 1) + quantity, unit);
        existingItem.kind = kind;
        existingItem.category = category;
        if (catalogItem?.id && !existingItem.catalogItemId) existingItem.catalogItemId = catalogItem.id;
        deps.trackShoppingUsage?.(name, unit, category);
        persist('request');
        form?.reset?.();
        showToast('Položka už byla v seznamu, navýšil jsem množství');
        if (cloudReady && deps.cloudUpdateShoppingItem) {
          void Promise.resolve().then(async () => {
            const ok = await deps.cloudUpdateShoppingItem(existingItem);
            if (ok === false) {
              existingItem.quantity = previousQuantity;
              persist('request');
            } else {
              persist('request');
            }
          });
        }
        return;
      }

      const localItem = {
        id: uid(),
        householdId: deps.currentHouseholdId?.() || '',
        profileId: deps.currentProfileId?.() || '',
        createdAt: new Date().toISOString(),
        listId,
        name,
        category,
        kind,
        quantity,
        unit,
        note,
        done: false,
        catalogItemId: catalogItem?.id || ''
      };

      deps.trackShoppingUsage?.(name, unit, category);
      store.shopping = Array.isArray(store.shopping) ? store.shopping : [];
      store.shopping.push(localItem);
      persist('request');
      form?.reset?.();
      showToast(isKnown ? 'Přidáno do seznamu' : 'Přidáno i do katalogu domácnosti');

      if (cloudReady && deps.cloudAddShoppingItem) {
        void Promise.resolve().then(async () => {
          const cloudItem = await deps.cloudAddShoppingItem({ name, category, quantity, unit, note, catalogItem, list });
          if (cloudItem) {
            localItem.cloudId = cloudItem.id;
            localItem.cloudListId = cloudItem.list_id;
            localItem.catalogItemId = cloudItem.catalog_item_id || localItem.catalogItemId;
            if (localItem.done || localItem.quantity !== quantity || localItem.note !== note || localItem.unit !== unit) {
              await deps.cloudUpdateShoppingItem?.(localItem);
            }
            persist('request');
          }
        });
      }
    }

    async function quickAddShoppingByName(name) {
      const catalogItem = deps.findShoppingCatalogItem?.(name);
      if (!catalogItem) return showToast('Položku se nepovedlo najít v katalogu');
      return addShoppingFromForm({
        name: catalogItem.name,
        kind: catalogItem.kind || catalogItem.category || 'Ostatní',
        category: catalogItem.kind || catalogItem.category || 'Ostatní',
        quantity: '1',
        unit: catalogItem.defaultUnit || 'ks',
        note: ''
      }, null);
    }

    async function addShoppingListFromForm(data, form) {
      deps.ensureShoppingListsReady?.();
      const store = state();
      const name = normalizeText(data.name);
      if (!name) return showToast('Zadej název seznamu');
      store.shoppingLists = Array.isArray(store.shoppingLists) ? store.shoppingLists : [];
      const existingList = store.shoppingLists.find((list) => normalizeKey(list.name) === normalizeKey(name));
      if (existingList) {
        store.activeShoppingListId = existingList.id;
        deps.clearShoppingOverlayArtifacts?.();
        deps.closeShoppingTransientUi?.();
        persist('request');
        form?.reset?.();
        return showToast(`Seznam ${name} už existuje, otevřel jsem ho`);
      }
      const id = `shopping-list-${uid()}`;
      const timestamp = new Date().toISOString();
      const record = {
        id,
        householdId: deps.currentHouseholdId?.() || '',
        profileId: deps.currentProfileId?.() || '',
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
        sortOrder: store.shoppingLists.length,
        source: 'custom'
      };
      deps.markShoppingRuntimeDirty?.();
      store.shoppingLists.push(record);
      store.activeShoppingListId = id;
      persist('full');
      form?.reset?.();
      showToast(`Seznam ${name} vytvořen`);
      if (deps.cloudReady?.() && deps.cloudAddShoppingList) {
        deps.cloudAddShoppingList(name).then((cloudList) => {
          if (cloudList?.id) {
            record.cloudId = cloudList.id;
            record.cloudListId = cloudList.id;
            record.source = 'cloud';
            store.shoppingCloud = { ...(store.shoppingCloud || {}), activeListId: cloudList.id };
            deps.saveState?.();
            deps.requestRender?.();
          }
        }).catch((error) => console.warn('Cloud sync (nákupní seznam) na pozadí selhal', error));
      }
    }

    function setActiveShoppingList(id) {
      deps.ensureShoppingListsReady?.();
      const store = state();
      if (!store.shoppingLists?.some((list) => list.id === id)) return;
      const sameList = store.activeShoppingListId === id;
      deps.clearShoppingOverlayArtifacts?.();
      store.activeShoppingListId = id;
      deps.closeShoppingTransientUi?.();
      if (sameList) {
        deps.requestRender?.();
        return;
      }
      persist('request');
    }

    async function deleteShoppingList(id) {
      deps.ensureShoppingListsReady?.();
      const store = state();
      const lists = deps.getShoppingLists?.() || [];
      if (lists.length <= 1) return showToast('Poslední seznam nejde smazat');
      const list = lists.find((entry) => entry.id === id);
      if (!list) return;
      if (!confirmDialog(`Smazat seznam ${list.name} včetně položek?`)) return;
      deps.markShoppingRuntimeDirty?.();
      store.shoppingLists = (store.shoppingLists || []).filter((entry) => entry.id !== id);
      store.shopping = (store.shopping || []).filter((item) => item.listId !== id);
      if (store.activeShoppingListId === id) store.activeShoppingListId = store.shoppingLists[0]?.id || '';
      deps.closeShoppingTransientUi?.();
      persist('full');
      showToast('Seznam smazán');
      if (deps.cloudArchiveShoppingList) {
        deps.cloudArchiveShoppingList(list).catch((error) => console.warn('Cloud sync (smazání seznamu) na pozadí selhal', error));
      }
    }

    function promptAddShoppingList() {
      const name = normalizeText(promptDialog('Název nového seznamu', ''));
      if (!name) return;
      addShoppingListFromForm({ name }, null);
    }

    // Přejmenování seznamu. Zachovává activeShoppingListId a položky — mění
    // jen name + updatedAt. Lokálně vždy; v cloudu přes cloudUpdateShoppingList
    // (pokud seznam ještě nemá cloudId, nejdřív cloudEnsureShoppingList).
    async function renameShoppingList(id, rawName) {
      deps.ensureShoppingListsReady?.();
      const store = state();
      const lists = deps.getShoppingLists?.() || store.shoppingLists || [];
      const list = (store.shoppingLists || []).find((entry) => entry.id === id);
      if (!list) return;
      const name = normalizeText(rawName);
      if (!name) return showToast('Název seznamu nesmí být prázdný');
      const duplicate = lists.some((entry) => entry.id !== id && normalizeKey(entry.name) === normalizeKey(name));
      if (duplicate) return showToast('Seznam s tímto názvem už existuje');
      if (name === list.name) {
        deps.closeShoppingTransientUi?.();
        deps.requestRender?.();
        return;
      }
      list.name = name;
      list.updatedAt = new Date().toISOString();
      deps.markShoppingRuntimeDirty?.();
      // activeShoppingListId se nemění — přejmenování aktivní seznam neopouští.
      persist('full');
      showToast(`Seznam přejmenován na ${name}`);
      if (deps.cloudReady?.() && deps.cloudUpdateShoppingList) {
        (async () => {
          let target = list;
          if (!(list.cloudId || list.cloudListId) && deps.cloudEnsureShoppingList) {
            await deps.cloudEnsureShoppingList(list);
            target = (store.shoppingLists || []).find((entry) => entry.id === id) || list;
          }
          await deps.cloudUpdateShoppingList(target);
        })().catch((error) => console.warn('Cloud sync (přejmenování seznamu) na pozadí selhal', error));
      }
    }

    function promptRenameShoppingList(id) {
      deps.ensureShoppingListsReady?.();
      const store = state();
      const list = (store.shoppingLists || []).find((entry) => entry.id === id);
      if (!list) return;
      const name = normalizeText(promptDialog('Nový název seznamu', list.name || ''));
      if (!name || name === list.name) return;
      renameShoppingList(id, name);
    }

    function toggleQuantityEditor(id) {
      const next = deps.getQuantityEditId?.() === id ? '' : id;
      deps.setQuantityEditId?.(next);
      deps.requestRender?.();
    }

    function setDoneModalOpen(open) {
      deps.setDoneModalOpen?.(Boolean(open));
      deps.renderOverlays?.();
    }

    async function updateShoppingQuantity(id, delta) {
      const store = state();
      const item = store.shopping?.find((entry) => entry.id === id);
      if (!item) return;
      const previousQuantity = item.quantity || item.amount || 1;
      const unit = item.unit || 'ks';
      const current = sanitizeShoppingQuantity(previousQuantity, unit);
      const step = isWholePieceUnit(unit) ? 1 : 0.25;
      const direction = delta < 0 ? -1 : 1;
      const next = current + (direction * step);
      item.quantity = sanitizeShoppingQuantity(next, unit);
      deps.setQuantityEditId?.(id);
      persist('request');
      if (deps.cloudUpdateShoppingItem) {
        const ok = await deps.cloudUpdateShoppingItem(item);
        if (ok === false) {
          item.quantity = sanitizeShoppingQuantity(previousQuantity, unit);
          persist('request');
        }
      }
    }

    async function deleteDoneShoppingBySwipe(id) {
      const store = state();
      const item = store.shopping?.find((entry) => entry.id === id);
      if (!item || !item.done) return;
      if (!confirmDialog(`Smazat koupenou položku ${item.name}?`)) return;
      store.shopping = store.shopping.filter((entry) => entry.id !== id);
      persist('full');
      showToast('Položka smazána');
      if (deps.cloudDeleteShoppingItem) {
        deps.cloudDeleteShoppingItem(item).catch((error) => console.warn('Cloud sync (smazání položky) na pozadí selhal', error));
      }
    }

    async function cloudSyncLocalShoppingItems() {
      deps.ensureShoppingListsReady?.();
      const store = state();
      const localLists = (store.shoppingLists || []).filter((list) => !(list.cloudId || list.cloudListId));
      const localItems = (store.shopping || []).filter((item) => !item.cloudId);
      if (!localLists.length && !localItems.length) return showToast('Žádné lokální nákupy k odeslání');
      let syncedLists = 0;
      let syncedItems = 0;

      for (const list of localLists) {
        const cloudList = await deps.cloudEnsureShoppingList?.(list);
        if (cloudList?.id) syncedLists += 1;
      }

      for (const item of localItems) {
        const catalogItem = deps.findShoppingCatalogItem?.(item.name) || null;
        const list = (store.shoppingLists || []).find((entry) => entry.id === item.listId) || activeList();
        if (list && !(list.cloudId || list.cloudListId)) await deps.cloudEnsureShoppingList?.(list);
        const cloudItem = await deps.cloudAddShoppingItem?.({
          name: item.name,
          category: item.category || item.kind || 'Ostatní',
          quantity: item.quantity || 1,
          unit: item.unit || 'ks',
          note: item.note || '',
          catalogItem,
          list
        });
        if (cloudItem?.id) {
          item.cloudId = cloudItem.id;
          item.cloudListId = cloudItem.list_id;
          item.catalogItemId = cloudItem.catalog_item_id || item.catalogItemId || '';
          syncedItems += 1;
        }
      }
      deps.dedupeShoppingData?.(store);
      persist('full');
      showToast((syncedLists || syncedItems) ? `Cloud nákupy: ${syncedLists} seznamů, ${syncedItems} položek` : 'Nic se nepovedlo odeslat');
    }

    async function toggleShoppingDone(id) {
      const store = state();
      const item = store.shopping?.find((entry) => entry.id === id);
      if (!item) return;
      const previousDone = Boolean(item.done);
      const previousDoneAt = item.doneAt || '';
      item.done = !item.done;
      item.doneAt = item.done ? new Date().toISOString() : '';
      persist('request');
      const ok = await deps.cloudUpdateShoppingItem?.(item);
      if (ok === false) {
        item.done = previousDone;
        item.doneAt = previousDoneAt;
        persist('request');
        showToast('Cloud úprava se nepovedla, změnu jsem vrátil');
      }
    }

    async function deleteShoppingItem(id) {
      const store = state();
      const item = store.shopping?.find((entry) => entry.id === id);
      if (!item) return;
      store.shopping = store.shopping.filter((entry) => entry.id !== id);
      persist('full');
      showToast('Smazáno');
      deps.cloudDeleteShoppingItem?.(item).catch((error) => console.warn('Cloud sync (smazání položky) na pozadí selhal', error));
    }

    async function deleteShoppingCatalogItem(id, name) {
      const store = state();
      const catalog = deps.getShoppingCatalog?.() || [];
      const item = catalog.find((entry) => String(entry.id || '') === String(id || '')) || deps.findShoppingCatalogItem?.(name);
      if (!item?.name) return showToast('Položku katalogu se nepovedlo najít');
      if (!confirmDialog(`Odebrat z katalogu položku ${item.name}? Položky v nákupních seznamech zůstanou.`)) return;
      if (item.source === 'local') {
        store.shoppingCatalogCustom = (store.shoppingCatalogCustom || []).filter((entry) => normalizeKey(entry.name) !== normalizeKey(item.name) && String(entry.id || '') !== String(item.id || ''));
      } else if (item.householdId && deps.cloudDeleteShoppingCatalogItem) {
        store.shoppingCloud = {
          ...(store.shoppingCloud || {}),
          catalog: (store.shoppingCloud?.catalog || []).filter((entry) => String(entry.id || '') !== String(item.id || '') && normalizeKey(entry.name) !== normalizeKey(item.name))
        };
        deps.cloudDeleteShoppingCatalogItem(item).catch((error) => console.warn('Cloud sync (smazání katalogu) na pozadí selhal', error));
      } else {
        store.shoppingCatalogHidden = Array.isArray(store.shoppingCatalogHidden) ? store.shoppingCatalogHidden : [];
        const key = normalizeKey(item.name);
        if (!store.shoppingCatalogHidden.some((value) => normalizeKey(value) === key)) store.shoppingCatalogHidden.push(key);
      }
      deps.markShoppingCatalogDirty?.();
      persist('full');
      showToast('Odebráno z katalogu');
    }

    return {
      addShoppingFromForm,
      quickAddShoppingByName,
      addShoppingListFromForm,
      setActiveShoppingList,
      deleteShoppingList,
      renameShoppingList,
      promptRenameShoppingList,
      promptAddShoppingList,
      toggleQuantityEditor,
      setDoneModalOpen,
      updateShoppingQuantity,
      deleteDoneShoppingBySwipe,
      cloudSyncLocalShoppingItems,
      toggleShoppingDone,
      deleteShoppingItem,
      deleteShoppingCatalogItem
    };
  }

  window.DomacnostShoppingActions = { createController };
})();
