(function () {
  'use strict';

  function createRenderer(deps) {
    const getState = deps.getState || (() => ({}));
    const escapeHtml = deps.escapeHtml || ((value) => String(value ?? ''));
    const defaultCatalogCount = Number(deps.defaultCatalogCount || 0);

    function splitShoppingItems(items) {
      const openItems = [];
      const doneItems = [];
      (items || []).forEach((item) => {
        if (item?.done) doneItems.push(item);
        else openItems.push(item);
      });
      return { openItems, doneItems };
    }

    function relativeShoppingTime(value) {
      if (!value) return 'zatím nenačteno';
      const time = new Date(value).getTime();
      if (!Number.isFinite(time)) return 'čas neznámý';
      const diff = Math.max(0, Date.now() - time);
      const seconds = Math.round(diff / 1000);
      if (seconds < 20) return 'právě teď';
      if (seconds < 60) return `před ${seconds} s`;
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return `před ${minutes} min`;
      const hours = Math.round(minutes / 60);
      if (hours < 24) return `před ${hours} h`;
      const days = Math.round(hours / 24);
      return `před ${days} dny`;
    }

    function renderShopping() {
      deps.ensureShoppingListsReady();
      const state = getState();
      const activeShoppingTab = deps.getModuleTab('shopping', 'list');
      const isShoppingListTab = activeShoppingTab === 'list';
      const isShoppingCatalogTab = activeShoppingTab === 'catalog';
      const isShoppingCouponsTab = activeShoppingTab === 'coupons';
      const isShoppingLoyaltyTab = activeShoppingTab === 'loyalty';
      const lists = deps.getShoppingLists();
      const activeListId = deps.getActiveShoppingListId();
      const activeList = lists.find((list) => list.id === activeListId) || lists[0] || null;
      const listStats = deps.buildShoppingListStats(lists);
      const activeStats = listStats.get(activeListId) || { total: 0, open: 0, done: 0 };
      const activeItems = isShoppingListTab ? deps.shoppingItemsForList(activeListId) : [];
      const { openItems, doneItems } = splitShoppingItems(activeItems);
      const groupedOpen = isShoppingListTab ? deps.groupShoppingItemsByKind(openItems) : [];
      const cloudReady = Boolean(state.cloud?.userId && state.cloud?.householdId);
      const units = (isShoppingListTab || isShoppingCatalogTab) ? deps.getShoppingUnits() : [];
      const categories = (isShoppingListTab || isShoppingCatalogTab) ? deps.getShoppingCategories() : [];
      const needsCatalog = isShoppingListTab || isShoppingCatalogTab;
      const catalog = needsCatalog ? deps.getShoppingCatalog() : [];
      const catalogSuggestions = isShoppingListTab ? deps.getShoppingDatalistItems(catalog, 90) : [];
      const customCatalogCount = (state.shoppingCatalogCustom || []).length;
      const catalogCount = catalog.length || ((state.shoppingCloud?.catalog?.length || defaultCatalogCount) + customCatalogCount);
      const ownCatalogCount = isShoppingCatalogTab ? catalog.filter((item) => item.householdId || item.source === 'local').length : customCatalogCount;
      const couponsCount = Array.isArray(state.coupons) ? state.coupons.length : 0;
      const coupons = isShoppingCouponsTab ? [...state.coupons].sort((a, b) => String(a.expiry || '9999').localeCompare(String(b.expiry || '9999'))) : [];
      const loyaltySearch = deps.getLoyaltySearchTerm ? String(deps.getLoyaltySearchTerm() || '') : '';
      const loyaltyScan = deps.getLoyaltyScanState ? deps.getLoyaltyScanState() : { detectedCode: '', detectedFormat: '' };
      const loyaltyDraft = deps.getLoyaltyAddDraft ? deps.getLoyaltyAddDraft() : {};
      const loyaltyAddOpen = deps.getLoyaltyAddDetailsOpen ? Boolean(deps.getLoyaltyAddDetailsOpen()) : false;
      const loyaltyCardsAll = deps.getLoyaltyCards ? deps.getLoyaltyCards() : (Array.isArray(state.loyaltyCards) ? state.loyaltyCards : []);
      const loyaltyCloudBadge = deps.loyaltyCloudBadge ? deps.loyaltyCloudBadge() : { label: state.cloud?.householdId ? 'sdílená domácnost' : 'jen v tomto zařízení', className: state.cloud?.householdId ? 'good' : '' };
      const loyaltyCards = isShoppingLoyaltyTab ? loyaltyCardsAll.filter((card) => {
        const query = loyaltySearch.trim().toLowerCase();
        if (!query) return true;
        return [card.store, card.cardNumber, card.note].filter(Boolean).join(' ').toLowerCase().includes(query);
      }) : [];
      const loyaltyCount = loyaltyCardsAll.length;
      const localOnlyShoppingCount = isShoppingListTab ? activeItems.filter((item) => !item.cloudId).length : 0;
      const localOnlyListsCount = (state.shoppingLists || []).filter((list) => !(list.cloudId || list.cloudListId)).length;
      const localOnlyTotalCount = localOnlyShoppingCount + localOnlyListsCount;
      const loadedAt = state.shoppingCloud?.loadedAt || state.shoppingCloud?.refreshedAt || '';
      const refreshStatus = state.shoppingCloud?.refreshStatus || '';
      const refreshError = state.shoppingCloud?.refreshError || '';
      const householdName = state.household?.name || 'aktivní domácnost';
      const progress = activeStats.total ? Math.round((activeStats.done / activeStats.total) * 100) : 0;
      const addButtonDisabled = !activeListId ? 'disabled title="Nejdřív vytvoř nákupní seznam přes plus"' : '';

      const listPanel = isShoppingListTab ? `
        <section class="card desktop-span-2 shopping-panel panel-list listonic-panel">
          <div class="card-header">
            <div><h2>${escapeHtml(activeList?.name || 'Nákupní seznam')}</h2><p>Více seznamů podle obchodů nebo situace. Položky se řadí podle druhu, ať se v krámě nelítá sem a tam.</p></div>
            <span class="badge ${cloudReady ? 'good' : ''}">${cloudReady ? 'sdílená domácnost' : 'lokálně'}</span>
          </div>

          <div class="shopping-cloud-strip ${cloudReady ? 'is-cloud' : 'is-local'} ${refreshStatus === 'loading' ? 'is-loading' : ''} ${refreshStatus === 'error' ? 'is-error' : ''}">
            <div class="shopping-cloud-copy">
              <strong>${cloudReady ? `Sdíleno: ${escapeHtml(householdName)}` : 'Nákupy jsou teď jen v tomto zařízení'}</strong>
              <span>${cloudReady ? (refreshStatus === 'loading' ? 'Obnovuji cloud nákupy…' : refreshStatus === 'error' ? escapeHtml(refreshError || 'Poslední obnovení se nepovedlo') : `Naposledy načteno ${relativeShoppingTime(loadedAt)}`) : 'Přihlas oba účty do stejné domácnosti, aby seznam viděla i manželka.'}</span>
            </div>
          </div>

          ${cloudReady && localOnlyTotalCount ? `<div class="inline-note compact-note shopping-pending-note"><strong>Čeká na automatickou synchronizaci:</strong> ${localOnlyTotalCount} položek/seznamů z tohoto zařízení.</div>` : ''}

          <div class="shopping-list-switcher">
            ${lists.map((list) => {
              const stat = listStats.get(list.id) || { total: 0, open: 0 };
              return `<button class="shopping-list-chip ${list.id === activeListId ? 'active' : ''}" type="button" data-action="set-shopping-list" data-id="${escapeHtml(list.id)}"><strong>${escapeHtml(list.name)}</strong><span>${stat.open ? `${stat.open} koupit` : 'hotovo'} · ${stat.total}</span></button>`;
            }).join('')}
            <button class="shopping-list-chip shopping-list-add-chip" type="button" data-action="prompt-add-shopping-list" aria-label="Přidat nákupní seznam"><strong>＋</strong><span>nový seznam</span></button>
          </div>
          ${activeListId ? `<div class="shopping-list-tools"><button class="ghost-btn" type="button" data-action="prompt-rename-shopping-list" data-id="${escapeHtml(activeListId)}">Přejmenovat</button><button class="ghost-btn danger-outline-btn" type="button" data-action="delete-shopping-list" data-id="${escapeHtml(activeListId)}" ${lists.length <= 1 ? 'disabled title="Poslední seznam nejde smazat"' : ''}>Smazat seznam</button></div>` : ''}

          <div class="shopping-progress-card"><div><strong>${activeStats.open ? `${activeStats.open} koupit` : 'Nákup hotový'}</strong><span>${activeStats.done} hotovo · ${activeStats.total} celkem · ${escapeHtml(activeList?.name || 'seznam')}</span></div><div class="shopping-progress"><span style="width:${progress}%"></span></div></div>

          <form data-form="add-shopping" class="listonic-add-form">
            <datalist id="shoppingCatalogList">
              ${catalogSuggestions.map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join('')}
            </datalist>
            <div class="form-grid four">
              <div class="field"><label>Položka</label><input class="input" name="name" list="shoppingCatalogList" placeholder="rohlíky / aviváž / kapsle" required ${!activeListId ? 'disabled' : ''}></div>
              ${deps.selectField('Druh výrobku', 'kind', categories.map(([name]) => [name, `${deps.shoppingKindIcon(name)} ${name}`]), 'Ostatní')}
              ${deps.field('Množství', 'quantity', 'number', '1')}
              ${deps.selectField('Jednotka', 'unit', units, 'ks')}
              ${deps.field('Poznámka', 'note', 'text', 'volitelné')}
            </div>
            <div class="form-actions">
              <button class="primary-btn" type="submit" ${addButtonDisabled}>Přidat do ${escapeHtml(activeList?.name || 'seznamu')}</button>
            </div>
          </form>

          <div class="hint-box">Klikni na množství u položky a zobrazí se + / − pro rychlou úpravu počtu.</div>
          <div style="height:14px"></div>
          ${openItems.length ? `<div class="shopping-grouped-list">${groupedOpen.map(renderShoppingGroup).join('')}</div>` : deps.renderEmptyCta({ icon: '🛒', title: activeListId ? 'Nákup je prázdný' : 'Zatím není žádný seznam', text: activeListId ? 'Přidej položku z katalogu nebo vlastní položku domácnosti.' : 'Vytvoř první nákupní seznam přes plus nahoře.', nav: 'shopping', tab: 'list', label: activeListId ? 'Přidat položku' : 'Přidat seznam' })}
          ${doneItems.length ? `<button class="shopping-done-open-card" type="button" data-action="open-shopping-done-modal"><span>✓ Hotovo</span><strong>${doneItems.length} položek</strong><em>Otevřít přehled koupených</em></button>` : ''}
        </section>` : '';

      const catalogPanel = isShoppingCatalogTab ? `
        <section class="card shopping-panel panel-catalog">
          <div class="card-header"><div><h2>Katalog domácnosti</h2><p>Produkty můžeš přidat rovnou tady. Pak se budou nabízet v nákupním seznamu.</p></div><span class="badge">${ownCatalogCount ? `${ownCatalogCount} vlastních` : 'základ'}</span></div>
          <details class="action-details compact-edit-details shopping-catalog-add-details" data-details-key="shopping-catalog-add" ${deps.getDetailsOpen?.('shopping-catalog-add') ? 'open' : ''}>
            <summary><span>Přidat produkt do katalogu</span><em>název, druh a výchozí jednotka</em></summary>
            <form data-form="add-shopping-catalog-item" class="compact-form shopping-catalog-add-form">
              <div class="form-grid three">
                ${deps.field('Produkt', 'name', 'text', 'např. kapsle do myčky', true)}
                ${deps.selectField('Druh výrobku', 'kind', categories.map(([name]) => [name, `${deps.shoppingKindIcon(name)} ${name}`]), 'Ostatní')}
                ${deps.selectField('Výchozí jednotka', 'unit', units, 'ks')}
              </div>
              <div class="form-actions"><button class="primary-btn" type="submit">Uložit do katalogu</button></div>
            </form>
          </details>
          <div style="height:14px"></div>
          <div class="list compact-list shopping-catalog-list">
            ${catalog.map((item) => deps.renderShoppingCatalogItem(item, activeList)).join('')}
          </div>
        </section>` : '';

      const couponsPanel = isShoppingCouponsTab ? `
        <section class="card shopping-panel panel-coupons">
          <div class="card-header"><div><h2>Slevové kódy</h2><p>Kupóny a kódy, které nechceš zapomenout. V online domácnosti jsou sdílené pro všechny členy.</p></div><span class="badge ${coupons.some((item) => item.cloudId) ? 'good' : ''}">${coupons.some((item) => item.cloudId) ? 'cloud' : 'lokálně'}</span></div>
          <details class="action-details compact-edit-details coupon-add-details" data-details-key="shopping-coupon-add" ${deps.getDetailsOpen?.('shopping-coupon-add') ? 'open' : ''}>
            <summary><span>Přidat nový kód</span><em>obchod, kód, platnost</em></summary>
            <form data-form="add-coupon" class="compact-form">
              <div class="form-grid two">
                ${deps.field('Obchod / služba', 'store', 'text', 'Alza / Temu / Allegro', true)}
                ${deps.field('Kód', 'code', 'text', 'SLEVA10', true)}
                ${deps.field('Sleva', 'discount', 'text', '10 % / 200 Kč')}
                ${deps.field('Platnost do', 'expiry', 'date', '')}
                ${deps.field('Poznámka', 'note', 'text', 'volitelné')}
              </div>
              <div class="form-actions"><button class="primary-btn" type="submit">Uložit kód</button></div>
            </form>
          </details>
          <div style="height:14px"></div>
          ${coupons.length ? `<div class="list">${coupons.map(deps.renderCouponItem).join('')}</div>` : deps.renderEmpty('Zatím nemáš uložený žádný slevový kód.')}
        </section>` : '';


      const loyaltyAddVisible = loyaltyAddOpen || loyaltyScan?.loading || loyaltyScan?.dataUrl || loyaltyScan?.detectedCode || loyaltyScan?.error;
      const loyaltyPanel = isShoppingLoyaltyTab ? `
        <section class="card desktop-span-2 shopping-panel panel-loyalty loyalty-wallet-panel">
          <div class="card-header loyalty-wallet-head">
            <div><h2>Věrnostní karty</h2><p>Karty do obchodů, rychle po ruce u pokladny.</p></div>
            <div class="loyalty-head-actions"><span class="badge ${escapeHtml(loyaltyCloudBadge.className || '')}">${escapeHtml(loyaltyCloudBadge.label || '')}</span><button class="icon-btn loyalty-add-plus" type="button" data-action="toggle-loyalty-add" aria-label="Nová věrnostní karta">+</button></div>
          </div>
          <div class="loyalty-toolbar">
            <div class="field loyalty-search-field"><label>Najít kartu</label><input class="input" type="search" placeholder="Kaufland, Lidl, DM…" value="${escapeHtml(loyaltySearch)}" data-loyalty-search autocomplete="off"></div>
          </div>
          ${loyaltyAddVisible ? `
            <div class="loyalty-add-panel">
              <form data-form="add-loyalty-card" class="compact-form loyalty-card-form">
                ${deps.renderLoyaltyScanPanel ? deps.renderLoyaltyScanPanel(loyaltyScan) : ''}
                <div class="form-grid two">
                  ${deps.field('Obchod', 'store', 'text', 'Kaufland / Lidl / DM', true, loyaltyDraft.store || '')}
                  ${deps.field('Číslo / kód karty', 'cardNumber', 'text', 'číslo z fotky nebo kód', true, loyaltyDraft.cardNumber || loyaltyScan?.detectedCode || '')}
                  ${deps.selectField('Typ kódu', 'codeType', [['barcode', 'Čárový kód'], ['qr', 'QR'], ['text', 'Text']], loyaltyDraft.codeType || loyaltyScan?.detectedFormat || 'barcode')}
                  ${deps.selectField('Barva karty', 'color', [['rose', 'Rose'], ['blue', 'Blue'], ['mint', 'Mint'], ['amber', 'Amber'], ['violet', 'Violet'], ['slate', 'Slate']], loyaltyDraft.color || 'rose')}
                  ${deps.field('Poznámka', 'note', 'text', 'např. Lucčina karta', false, loyaltyDraft.note || '')}
                </div>
                <div class="form-actions"><button class="primary-btn" type="submit">Uložit kartu</button><button class="ghost-btn" type="button" data-action="toggle-loyalty-add">Zrušit</button></div>
              </form>
            </div>
          ` : ''}
          <div class="loyalty-wallet-grid">
            ${loyaltyCards.length ? loyaltyCards.map((card) => deps.renderLoyaltyCardItem(card)).join('') : `<div class="empty loyalty-empty"><div class="empty-icon">💳</div><strong>${loyaltySearch ? 'Nic nenalezeno' : 'Zatím žádná karta'}</strong><span>${loyaltySearch ? 'Zkus jiný obchod nebo číslo karty.' : 'Novou kartu přidáš přes + vpravo nahoře.'}</span></div>`}
          </div>
        </section>` : '';

      return `
      ${deps.renderSectionTabs('shopping', [
        { id: 'list', label: 'Seznamy', icon: '🛒', count: activeStats.open },
        { id: 'catalog', label: 'Katalog', icon: '📚', count: catalogCount },
        { id: 'coupons', label: 'Kódy', icon: '🏷️', count: couponsCount },
        { id: 'loyalty', label: 'Karty', icon: '💳', count: loyaltyCount }
      ], 'list')}
      <div class="grid two module-tabbed shopping-tab-${activeShoppingTab}">
        ${listPanel}
        ${catalogPanel}
        ${couponsPanel}
        ${loyaltyPanel}
      </div>
    `;
    }

    function renderShoppingDoneOverlay() {
      const viewState = deps.getShoppingViewState ? deps.getShoppingViewState() : {};
      if (!viewState.doneModalOpen) return '';
      deps.ensureShoppingListsReady();
      const lists = deps.getShoppingLists();
      const activeListId = deps.getActiveShoppingListId();
      const activeList = lists.find((list) => list.id === activeListId) || lists[0] || null;
      const doneItems = activeList
        ? deps.shoppingItemsForList(activeList.id).filter((item) => item?.done)
        : [];
      const groupedDone = deps.groupShoppingItemsByKind(doneItems);
      return renderShoppingDoneModal(groupedDone, doneItems, activeList);
    }

    function renderShoppingDoneModal(groupedDone, doneItems, activeList) {
      return `
      <div class="app-modal-backdrop shopping-done-modal-backdrop" data-modal-backdrop role="presentation">
        <section class="app-modal shopping-done-modal" role="dialog" aria-modal="true" aria-labelledby="shopping-done-title">
          <div class="app-modal-head shopping-done-head">
            <div><span class="badge good">hotovo</span><h2 id="shopping-done-title">Hotovo</h2><p>${escapeHtml(activeList?.name || 'Nákupní seznam')} · ${doneItems.length} položek</p></div>
            <button class="icon-btn" type="button" data-action="close-shopping-done-modal" aria-label="Zavřít přehled koupených">×</button>
          </div>
          <div class="hint-box">Položku můžeš vrátit zpátky tlačítkem fajfky. Na mobilu ji posuň doleva a nabídne se smazání.</div>
          <div class="shopping-grouped-list shopping-listonic-done">${groupedDone.map(renderShoppingGroup).join('')}</div>
          <div class="form-actions modal-actions shopping-done-actions"><button class="ghost-btn" type="button" data-action="close-shopping-done-modal">Zavřít</button></div>
        </section>
      </div>
    `;
    }

    function renderShoppingGroup(group) {
      return `
      <section class="shopping-kind-group">
        <div class="shopping-kind-heading"><span>${escapeHtml(group.icon)}</span><strong>${escapeHtml(group.kind)}</strong><em>${group.items.length}</em></div>
        <div class="list shopping-listonic-list">${group.items.map(renderShoppingItem).join('')}</div>
      </section>
    `;
    }

    function isWholePieceUnit(unit) {
      const key = String(unit || 'ks').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      return key === 'ks' || key === 'kus' || key === 'kusy' || key === 'kusu' || key === 'bal' || key === 'baleni';
    }

    function formatShoppingAmount(item) {
      const unit = item.unit || 'ks';
      const raw = Number(item.quantity || item.amount || 1) || 1;
      const value = isWholePieceUnit(unit) ? Math.max(1, Math.round(raw)) : Math.max(0.25, Number(raw.toFixed(2)));
      return [String(value).replace('.', ','), unit].filter(Boolean).join(' ');
    }

    function renderShoppingItem(item) {
      const viewState = deps.getShoppingViewState ? deps.getShoppingViewState() : {};
      const amount = formatShoppingAmount(item);
      const kind = deps.shoppingKindLabel(item);
      const isQuantityEditing = viewState.quantityEditId === item.id && !item.done;
      return `
      <div class="item shopping-listonic-item ${item.done ? 'done' : ''}" data-shopping-row-id="${escapeHtml(item.id)}">
        <button class="shopping-check-btn ${item.done ? 'checked' : ''}" type="button" data-action="toggle-done" data-collection="shopping" data-id="${escapeHtml(item.id)}" aria-label="${item.done ? 'Vrátit položku' : 'Označit jako koupené'}">
          ${item.done ? '✓' : ''}
        </button>
        <div class="shopping-listonic-copy">
          <div class="item-title">${escapeHtml(item.name)}</div>
          <div class="item-meta">${escapeHtml(kind)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}${item.cloudId ? ' · cloud' : ''}${item.done ? ' · posuň doleva pro smazání' : ''}</div>
        </div>
        <div class="shopping-quantity-wrap ${isQuantityEditing ? 'editing' : ''}">
          ${isQuantityEditing ? `<button class="ghost-btn shopping-qty-btn" type="button" data-action="shopping-qty-dec" data-id="${escapeHtml(item.id)}">−</button>` : ''}
          <button class="badge shopping-amount-pill" type="button" data-action="shopping-qty-toggle" data-id="${escapeHtml(item.id)}">${escapeHtml(amount)}</button>
          ${isQuantityEditing ? `<button class="ghost-btn shopping-qty-btn" type="button" data-action="shopping-qty-inc" data-id="${escapeHtml(item.id)}">+</button>` : ''}
        </div>
        <span class="shopping-row-kind-icon" title="${escapeHtml(kind)}" aria-hidden="true">${escapeHtml(deps.shoppingKindIcon(kind))}</span>
        <button class="danger-btn mini-danger-btn" type="button" data-action="delete" data-collection="shopping" data-id="${escapeHtml(item.id)}" aria-label="Smazat ${escapeHtml(item.name)}">×</button>
      </div>
    `;
    }

    return { renderShopping, renderShoppingDoneOverlay };
  }

  window.DomacnostShoppingRender = { createRenderer };
})();
