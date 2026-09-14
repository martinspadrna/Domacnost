(function () {
  'use strict';

  // Finance: účty, pohyby, šablony, souhrny/KPI, cloud sync. Extrahováno z app.js (fáze B).
  // 4 paralelní pole (state.finance, state.financeAccounts, state.financeTemplates,
  // state.financeCloud) se čtou i zapisují přes deps.getState() (živá reference) – ukládání
  // i výpočty (financeMonthSummary, financeAccountBalances) zůstávají 1:1 jako dřív.
  // UI proměnné editace (financeEditId atd.) zůstávají v app.js (resetují je i app.js handlery),
  // modul k nim přistupuje přes get/set accessory. Dashboard KPI (financeMonthSummary) je
  // volatelné z app.js přes wrapper.
  function createFinance(deps) {
    const getState = deps.getState || (() => ({}));
    const getFinanceEditId = deps.getFinanceEditId || (() => '');
    const setFinanceEditId = deps.setFinanceEditId || (() => {});
    const getFinanceAccountEditId = deps.getFinanceAccountEditId || (() => '');
    const setFinanceAccountEditId = deps.setFinanceAccountEditId || (() => {});
    const getFinanceTemplateEditId = deps.getFinanceTemplateEditId || (() => '');
    const setFinanceTemplateEditId = deps.setFinanceTemplateEditId || (() => {});
    const getFinanceCopyId = deps.getFinanceCopyId || (() => '');
    const setFinanceCopyId = deps.setFinanceCopyId || (() => {});
    const getDetailsOpen = deps.getDetailsOpen || (() => false);
    const writeFinanceModuleTab = deps.writeFinanceModuleTab || (() => {});
    const getModuleTab = deps.getModuleTab || ((area, fallback) => fallback);
    const escapeHtml = deps.escapeHtml || ((v) => String(v ?? ''));
    const normalizeText = deps.normalizeText || ((v) => String(v || '').trim());
    const normalizeKey = deps.normalizeKey || ((v) => String(v || '').toLowerCase());
    const uid = deps.uid || (() => Math.random().toString(36).slice(2));
    const todayISO = deps.todayISO || (() => new Date().toISOString().slice(0, 10));
    const formatCurrency = deps.formatCurrency || ((v) => String(v || ''));
    const formatDate = deps.formatDate || ((v) => String(v || ''));
    const field = deps.field || (() => '');
    const selectField = deps.selectField || (() => '');
    const renderEmpty = deps.renderEmpty || (() => '');
    const renderEmptyCta = deps.renderEmptyCta || (() => '');
    const renderSectionTabs = deps.renderSectionTabs || (() => '');
    const renderOverviewItem = deps.renderOverviewItem || (() => '');
    const decimalValue = deps.decimalValue || ((v) => Number(v) || 0);
    const parseDateValue = deps.parseDateValue || (() => null);
    const keepActiveSectionTabsCentered = deps.keepActiveSectionTabsCentered || (() => {});
    const persistStateSnapshot = deps.persistStateSnapshot || (() => {});
    const requestRender = deps.requestRender || (() => {});
    const yieldToMainThread = deps.yieldToMainThread || (() => Promise.resolve());
    const render = deps.render || (() => {});
    const saveState = deps.saveState || (() => {});
    const touchState = deps.touchState || (() => {});
    const showToast = deps.showToast || (() => {});
    const showUndoToast = deps.showUndoToast || ((text) => showToast(text));
    const currentHouseholdId = deps.currentHouseholdId || (() => '');
    const currentProfileId = deps.currentProfileId || (() => '');
    const cloudReady = deps.cloudReady || (() => false);
    const cloudSaveHouseholdUiSettings = deps.cloudSaveHouseholdUiSettings || (() => Promise.resolve(false));
    const getSupabaseClient = deps.getSupabaseClient || (() => null);
    const refreshCloudSession = deps.refreshCloudSession || (async () => null);
    const getFormData = deps.getFormData || (() => ({}));

    const FINANCE_CATEGORY_OPTIONS = deps.FINANCE_CATEGORY_OPTIONS || [];
    const DEFAULT_FINANCE_TEMPLATES = deps.DEFAULT_FINANCE_TEMPLATES || [];
    let financeLoanEditId = '';

    function renderFinanceOverviewItem(item) {
      const isIncome = item.type === 'income';
      const isTransfer = item.type === 'transfer';
      const account = financeAccountById(item.accountId);
      const target = financeAccountById(item.transferAccountId);
      return renderOverviewItem({
        title: item.title,
        badge: formatCurrency(item.amount),
        badgeClass: isIncome || isTransfer ? 'good' : 'warn',
        meta: [formatDate(item.date), isTransfer ? 'Přesun' : financeCategoryLabel(item.category), account?.name, target ? `→ ${target.name}` : '', financePaymentLabel(item.paymentMethod), item.note, item.cloudId ? 'cloud' : 'lokálně'].filter(Boolean).join(' · '),
        icon: isTransfer ? '↔️' : isIncome ? '➕' : '➖'
      });
    }

    function normalizeFinanceTemplate(template = {}) {
      const id = normalizeText(template.id) || `finance-template-${uid()}`;
      const type = template.type === 'income' ? 'income' : template.type === 'transfer' ? 'transfer' : 'expense';
      const category = normalizeText(template.category) || (type === 'income' ? 'other_income' : 'other_expense');
      return {
        id,
        householdId: template.householdId || currentHouseholdId(),
        profileId: template.profileId || currentProfileId(),
        createdAt: template.createdAt || new Date().toISOString(),
        updatedAt: template.updatedAt || template.createdAt || new Date().toISOString(),
        icon: normalizeText(template.icon) || '💳',
        name: normalizeText(template.name || template.title) || 'Šablona platby',
        type,
        title: normalizeText(template.title) || financeCategoryLabel(category),
        amount: template.amount === '' || template.amount === null || template.amount === undefined ? '' : decimalValue(template.amount),
        category,
        paymentMethod: normalizeText(template.paymentMethod) || 'bank_transfer',
        accountId: normalizeText(template.accountId),
        transferAccountId: type === 'transfer' ? normalizeText(template.transferAccountId) : '',
        note: normalizeText(template.note),
        system: Boolean(template.system),
        deleted: Boolean(template.deleted)
      };
    }

    function normalizeFinanceTemplates(templates = []) {
      const byId = new Map();
      const byContent = new Set();
      (Array.isArray(templates) ? templates : [])
        .map((template) => normalizeFinanceTemplate(template))
        .forEach((template) => {
          const contentKey = normalizeKey(`${template.name}|${template.title}|${template.type}|${template.amount}|${template.category}|${template.accountId}|${template.transferAccountId}|${template.note}`);
          if (!template.id && byContent.has(contentKey)) return;
          byContent.add(contentKey);
          byId.set(String(template.id || contentKey), template);
        });
      return [...byId.values()];
    }

    function normalizeFinanceLoan(loan = {}) {
      const id = normalizeText(loan.id) || `finance-loan-${uid()}`;
      const principal = Math.max(0, decimalValue(loan.principal ?? loan.originalAmount));
      const currentBalance = Math.max(0, decimalValue(loan.currentBalance ?? loan.balance ?? principal));
      const interestRate = Math.max(0, decimalValue(loan.interestRate ?? loan.apr));
      const monthlyPayment = Math.max(0, decimalValue(loan.monthlyPayment ?? loan.payment));
      const remainingMonths = Math.max(0, Math.round(Number(loan.remainingMonths ?? loan.monthsLeft ?? 0)) || 0);
      return {
        id,
        householdId: loan.householdId || currentHouseholdId(),
        profileId: loan.profileId || currentProfileId(),
        createdAt: loan.createdAt || new Date().toISOString(),
        updatedAt: loan.updatedAt || loan.createdAt || new Date().toISOString(),
        name: normalizeText(loan.name || loan.title) || 'Půjčka',
        lender: normalizeText(loan.lender),
        loanType: normalizeText(loan.loanType || loan.type) || 'consumer',
        principal,
        currentBalance,
        interestRate,
        monthlyPayment,
        remainingMonths,
        startDate: normalizeText(loan.startDate),
        nextPaymentDate: normalizeText(loan.nextPaymentDate),
        earlyRepaymentFee: Math.max(0, decimalValue(loan.earlyRepaymentFee ?? loan.payoffFee)),
        note: normalizeText(loan.note)
      };
    }

    function normalizeFinanceLoans(loans = []) {
      return (Array.isArray(loans) ? loans : [])
        .map(normalizeFinanceLoan)
        .filter((loan) => loan.name && (loan.currentBalance > 0 || loan.monthlyPayment > 0 || loan.principal > 0));
    }

    function mergeFinanceLoans(localLoans = [], cloudLoans = [], options = {}) {
      const preferLocal = options.preferLocal === true;
      const byId = new Map();
      const put = (loan, source) => {
        const normalized = normalizeFinanceLoan(loan);
        const key = String(normalized.id);
        const existing = byId.get(key);
        if (!existing) {
          byId.set(key, { ...normalized, _source: source });
          return;
        }
        const existingTime = Date.parse(existing.updatedAt || existing.createdAt || '') || 0;
        const nextTime = Date.parse(normalized.updatedAt || normalized.createdAt || '') || 0;
        if (preferLocal && source === 'local') byId.set(key, { ...normalized, _source: source });
        else if (nextTime >= existingTime) byId.set(key, { ...normalized, _source: source });
      };
      normalizeFinanceLoans(cloudLoans).forEach((loan) => put(loan, 'cloud'));
      normalizeFinanceLoans(localLoans).forEach((loan) => put(loan, 'local'));
      return [...byId.values()].map(({ _source, ...loan }) => loan);
    }

    function getFinanceLoans() {
      getState().financeLoans = normalizeFinanceLoans(getState().financeLoans || []);
      return [...getState().financeLoans].sort((a, b) => Number(b.currentBalance || 0) - Number(a.currentBalance || 0) || a.name.localeCompare(b.name, 'cs'));
    }

    function financeLoanMonthlyPayment(balance, annualRate, months) {
      const principal = Math.max(0, Number(balance || 0));
      const count = Math.max(0, Math.round(Number(months || 0)) || 0);
      if (!principal || !count) return 0;
      const monthlyRate = Math.max(0, Number(annualRate || 0)) / 100 / 12;
      if (!monthlyRate) return principal / count;
      const factor = Math.pow(1 + monthlyRate, count);
      return principal * monthlyRate * factor / (factor - 1);
    }

    function financeLoanProjection(loan) {
      const normalized = normalizeFinanceLoan(loan);
      const payment = normalized.monthlyPayment || financeLoanMonthlyPayment(normalized.currentBalance, normalized.interestRate, normalized.remainingMonths);
      const months = normalized.remainingMonths || (payment > 0 ? Math.ceil(normalized.currentBalance / payment) : 0);
      const remainingPayments = payment * months;
      const payoffCost = normalized.currentBalance + normalized.earlyRepaymentFee;
      const interestLeft = Math.max(0, remainingPayments - normalized.currentBalance);
      return { loan: normalized, payment, months, remainingPayments, payoffCost, interestLeft };
    }

    function mergeFinanceTemplates(localTemplates = [], cloudTemplates = [], options = {}) {
      const preferLocal = options.preferLocal === true;
      const byId = new Map();
      const put = (template, source) => {
        const normalized = normalizeFinanceTemplate(template);
        const key = String(normalized.id || normalizeKey(normalized.name));
        const existing = byId.get(key);
        if (!existing) {
          byId.set(key, { ...normalized, _source: source });
          return;
        }
        const existingTime = Date.parse(existing.updatedAt || existing.createdAt || '') || 0;
        const nextTime = Date.parse(normalized.updatedAt || normalized.createdAt || '') || 0;
        const nextIsNewer = nextTime >= existingTime;
        const shouldReplace = preferLocal
          ? source === 'local' || (existing._source !== 'local' && nextIsNewer)
          : nextIsNewer;
        if (shouldReplace) byId.set(key, { ...normalized, _source: source });
      };
      normalizeFinanceTemplates(cloudTemplates).forEach((template) => put(template, 'cloud'));
      normalizeFinanceTemplates(localTemplates).forEach((template) => put(template, 'local'));
      return [...byId.values()].map(({ _source, ...template }) => template);
    }

    function financeTemplateDefinitions() {
      const map = new Map();
      DEFAULT_FINANCE_TEMPLATES.map((template) => normalizeFinanceTemplate(template)).forEach((template) => map.set(String(template.id), template));
      normalizeFinanceTemplates(getState().financeTemplates || []).forEach((template) => {
        const key = String(template.id);
        if (template.deleted) {
          map.delete(key);
          return;
        }
        map.set(key, { ...template, system: false, deleted: false });
      });
      return [...map.values()].filter((template) => !template.deleted);
    }

    function financeTemplateById(id) {
      const key = String(id || '');
      return financeTemplateDefinitions().find((template) => String(template.id) === key) || null;
    }

    function financeTemplateAccountFallback(template, accounts = financeAccountsSorted()) {
      if (template.accountId && accounts.some((account) => account.id === template.accountId)) return template.accountId;
      return accounts[0]?.id || '';
    }

    function financeTemplateTransferFallback(template, accounts = financeAccountsSorted(), accountId = '') {
      if (template.transferAccountId && accounts.some((account) => account.id === template.transferAccountId)) return template.transferAccountId;
      if (template.id === 'savings' || template.type === 'transfer') {
        return accounts.find((account) => account.id !== accountId && ['savings', 'envelope', 'person'].includes(account.accountType))?.id || accounts.find((account) => account.id !== accountId)?.id || '';
      }
      return '';
    }

    function renderFinanceTemplatePanel(accounts = financeAccountsSorted()) {
      const templates = financeTemplateDefinitions();
      const customTemplates = normalizeFinanceTemplates(getState().financeTemplates || []).filter((template) => !template.deleted);
      const editTemplate = getFinanceTemplateEditId() ? financeTemplateById(getFinanceTemplateEditId()) : null;
      const formTemplate = editTemplate || normalizeFinanceTemplate({
        id: '',
        name: '',
        icon: '💳',
        type: 'expense',
        title: '',
        amount: '',
        category: 'housing',
        paymentMethod: 'bank_transfer',
        accountId: accounts[0]?.id || '',
        transferAccountId: '',
        note: ''
      });
      const isTemplateEdit = Boolean(editTemplate);
      return `
        <div class="quick-add-panel finance-template-panel">
          <div class="quick-add-head"><strong>Šablony plateb</strong><span>Klikneš, formulář se vyplní a jen upravíš částku/datum. Šablony se dají i upravit, aby nevznikaly duplicity.</span></div>
          <div class="quick-chip-row">
            ${templates.map((template) => `
              <span class="finance-template-chip-wrap ${template.system ? 'is-system' : 'is-custom'}">
                <button class="quick-chip" type="button" data-action="finance-template" data-template="${escapeHtml(template.id)}"><span class="finance-template-chip-icon">${escapeHtml(template.icon || '💳')}</span><span>${escapeHtml(template.name)}</span></button>
                <span class="finance-template-actions">
                  <button class="tiny-ghost-btn" type="button" data-action="edit-finance-template" data-id="${escapeHtml(template.id)}" aria-label="Upravit šablonu ${escapeHtml(template.name)}">✎</button>
                  <button class="tiny-danger-btn" type="button" data-action="delete-finance-template" data-id="${escapeHtml(template.id)}" aria-label="Smazat šablonu ${escapeHtml(template.name)}">×</button>
                </span>
              </span>
            `).join('')}
          </div>
          <details class="action-details compact-edit-details finance-template-details" data-details-key="finance-template-form" ${isTemplateEdit || getDetailsOpen('finance-template-form') ? 'open' : ''}>
            <summary><span>${isTemplateEdit ? 'Upravit šablonu' : 'Vytvořit vlastní šablonu'}</span><em>${isTemplateEdit ? escapeHtml(formTemplate.name) : 'nájem, elektřina, plyn, pojistky...'}</em></summary>
            <form data-form="${isTemplateEdit ? 'update-finance-template' : 'add-finance-template'}" ${isTemplateEdit ? `data-id="${escapeHtml(formTemplate.id)}"` : ''} class="compact-form">
              <div class="form-grid two">
                ${field('Název šablony', 'name', 'text', 'např. Nájem / Elektřina / Plyn', true, formTemplate.name || '')}
                ${field('Ikona', 'icon', 'text', '🏠', false, formTemplate.icon || '💳')}
                ${selectField('Typ', 'type', [['expense', 'Výdaj'], ['income', 'Příjem'], ['transfer', 'Přesun mezi účty']], formTemplate.type || 'expense')}
                ${selectField('Účet', 'accountId', financeAccountOptions(true), financeTemplateAccountFallback(formTemplate, accounts))}
                ${selectField('Cílový účet u přesunu', 'transferAccountId', financeAccountOptions(false), financeTemplateTransferFallback(formTemplate, accounts, financeTemplateAccountFallback(formTemplate, accounts)))}
                ${field('Název pohybu', 'title', 'text', 'např. Nájem', true, formTemplate.title || '')}
                ${field('Částka', 'amount', 'number', 'volitelné', false, formTemplate.amount ?? '')}
                ${selectField('Kategorie', 'category', financeCategoryOptions(), formTemplate.category || 'housing')}
                ${selectField('Platba', 'paymentMethod', [['card', 'Kartou'], ['cash', 'Hotově'], ['bank_transfer', 'Převod'], ['direct_debit', 'Inkaso'], ['other', 'Jiné']], formTemplate.paymentMethod || 'bank_transfer')}
                ${field('Poznámka', 'note', 'text', 'volitelné', false, formTemplate.note || '')}
              </div>
              <div class="form-actions">
                <button class="primary-btn" type="submit">${isTemplateEdit ? 'Uložit úpravu šablony' : 'Uložit šablonu'}</button>
                ${isTemplateEdit ? '<button class="ghost-btn" type="button" data-action="finance-template-edit-cancel">Zrušit úpravu</button>' : ''}
              </div>
            </form>
          </details>
          ${customTemplates.length ? `<div class="inline-note">Vlastních/upravených šablon: ${customTemplates.length}. Šablony jsou uložené v domácnosti a zálohují se přes cloud nastavení.</div>` : ''}
        </div>
      `;
    }

    function renderFinanceTransactionForm(item = null) {
      const isEdit = Boolean(item);
      const accounts = financeAccountsSorted();
      const type = item?.type === 'income' ? 'income' : item?.type === 'transfer' ? 'transfer' : 'expense';
      const category = item?.category || (type === 'income' ? 'other_income' : 'groceries');
      return `
        <form data-form="${isEdit ? 'update-finance' : 'add-finance'}" ${isEdit ? `data-id="${escapeHtml(item.id)}"` : ''} ${item?.templateId ? `data-template-id="${escapeHtml(item.templateId)}"` : ''} class="compact-form spaced-form">
          <div class="form-grid two">
            ${selectField('Typ', 'type', [['expense', 'Výdaj'], ['income', 'Příjem'], ['transfer', 'Přesun mezi účty']], type)}
            ${selectField('Účet', 'accountId', financeAccountOptions(true), item?.accountId || accounts[0]?.id || '')}
            ${selectField('Cílový účet u přesunu', 'transferAccountId', financeAccountOptions(false), item?.transferAccountId || '')}
            ${field('Název', 'title', 'text', 'např. výplata / energie / výběr', true, item?.title || '')}
            ${field('Částka', 'amount', 'number', 'např. 1250', true, item?.amount ?? '')}
            ${field('Datum', 'date', 'date', '', false, item?.date || todayISO())}
            ${selectField('Kategorie', 'category', financeCategoryOptions(), category)}
            ${selectField('Platba', 'paymentMethod', [['card', 'Kartou'], ['cash', 'Hotově'], ['bank_transfer', 'Převod'], ['direct_debit', 'Inkaso'], ['other', 'Jiné']], item?.paymentMethod || 'bank_transfer')}
            ${field('Poznámka', 'note', 'text', 'volitelné', false, item?.note || '')}
          </div>
          <div class="form-actions">
            <button class="primary-btn" type="submit">${isEdit ? 'Uložit úpravu' : 'Přidat pohyb'}</button>
            <button class="ghost-btn" type="button" data-action="finance-save-form-template">Uložit jako šablonu</button>
            ${isEdit ? '<button class="ghost-btn" type="button" data-action="finance-edit-cancel">Zrušit úpravu</button>' : ''}
          </div>
        </form>
      `;
    }

    function renderFinanceAccountForm(account = null) {
      const isEdit = Boolean(account);
      return `
        <form data-form="${isEdit ? 'update-finance-account' : 'add-finance-account'}" ${isEdit ? `data-id="${escapeHtml(account.id)}"` : ''} class="compact-form">
          <div class="form-grid two">
            ${field('Název účtu', 'name', 'text', 'např. Tchyně – u mě', true, account?.name || '')}
            ${selectField('Typ účtu', 'accountType', financeAccountTypeOptions(), account?.accountType || 'person')}
            ${field('Počáteční zůstatek', 'openingBalance', 'number', 'např. 0', false, account?.openingBalance ?? '')}
            ${field('Vlastník / poznámka', 'ownerLabel', 'text', 'např. tchyně', false, account?.ownerLabel || '')}
            ${selectField('Započítat do celku', 'includeInTotal', [['yes', 'Ano'], ['no', 'Ne']], account?.includeInTotal === false ? 'no' : 'yes')}
            ${field('Poznámka', 'note', 'text', 'volitelné', false, account?.note || '')}
          </div>
          <div class="form-actions">
            <button class="primary-btn" type="submit">${isEdit ? 'Uložit účet' : 'Přidat účet'}</button>
            ${isEdit ? '<button class="ghost-btn" type="button" data-action="finance-account-edit-cancel">Zrušit úpravu</button>' : ''}
          </div>
        </form>
      `;
    }

    function renderFinanceCopyPanel() {
      const source = getFinanceCopyId() ? (getState().finance || []).find((item) => item.id === getFinanceCopyId()) : null;
      if (!source) return '';
      const sourceDate = parseDateValue(source.date) || new Date();
      const nextDate = new Date(sourceDate.getFullYear(), sourceDate.getMonth() + 1, sourceDate.getDate());
      const firstMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
      return `
        <section class="card finance-panel panel-add finance-copy-panel">
          <div class="card-header"><div><h2>Kopírovat pohyb do dalších měsíců</h2><p>${escapeHtml(source.title)} · ${formatCurrency(source.amount)} · ${formatDate(source.date)}</p></div><span class="badge">kopie</span></div>
          <form data-form="copy-finance" data-id="${escapeHtml(source.id)}" class="compact-form">
            <div class="form-grid two">
              ${field('První měsíc', 'firstMonth', 'month', '', true, firstMonth)}
              ${field('Počet měsíců', 'count', 'number', 'např. 6', true, '1')}
              ${field('Den v měsíci', 'day', 'number', '1–31', false, String(sourceDate.getDate()))}
              ${field('Poznámka ke kopiím', 'noteSuffix', 'text', 'volitelné')}
            </div>
            <div class="form-actions">
              <button class="primary-btn" type="submit">Vytvořit kopie</button>
              <button class="ghost-btn" type="button" data-action="finance-copy-cancel">Zrušit</button>
            </div>
          </form>
        </section>
      `;
    }

    function renderFinanceMonthToolbar(selectedMonth, typeFilter) {
      const filters = [
        ['all', 'Vše'],
        ['income', 'Příjmy'],
        ['expense', 'Výdaje'],
        ['transfer', 'Přesuny']
      ];
      return `
        <div class="finance-toolbar">
          <form data-form="finance-month-filter" class="compact-filter-form finance-month-form">
            <div class="form-grid two">
              ${field('Měsíc přehledu', 'month', 'month', '', false, selectedMonth)}
              <div class="field"><label>Rychlý posun</label><div class="item-actions"><button class="ghost-btn" type="button" data-action="finance-month-prev">Předchozí</button><button class="ghost-btn" type="button" data-action="finance-month-current">Aktuální</button><button class="ghost-btn" type="button" data-action="finance-month-next">Další</button></div></div>
            </div>
          </form>
          <div class="finance-filter-chips" role="group" aria-label="Filtr pohybů">
            ${filters.map(([id, label]) => `<button class="quick-chip ${typeFilter === id ? 'active' : ''}" type="button" data-action="finance-filter" data-filter="${id}">${escapeHtml(label)}</button>`).join('')}
          </div>
        </div>
      `;
    }

    function renderFinanceSplitOverview(incomeItems, expenseItems) {
      const renderMiniRows = (rows, emptyText) => rows.length
        ? rows.slice(0, 8).map((item) => {
            const icon = financeMovementIcon(item);
            return `<div class="finance-mini-row"><span class="finance-mini-title"><span class="finance-mini-icon" aria-hidden="true">${escapeHtml(icon)}</span><span>${escapeHtml(item.title)}</span></span><strong>${formatCurrency(item.amount)}</strong></div>`;
          }).join('')
        : `<div class="inline-note compact-note">${escapeHtml(emptyText)}</div>`;
      return `
        <div class="finance-split-overview">
          <section class="finance-split-card income"><div class="finance-split-head"><strong>Příjmy</strong><span>${incomeItems.length}×</span></div>${renderMiniRows(incomeItems, 'Žádné příjmy v měsíci.')}</section>
          <section class="finance-split-card expense"><div class="finance-split-head"><strong>Výdaje</strong><span>${expenseItems.length}×</span></div>${renderMiniRows(expenseItems, 'Žádné výdaje v měsíci.')}</section>
        </div>
      `;
    }

    function renderFinanceAccountBalanceCards(accounts = financeAccountsSorted(), balances = financeAccountBalances()) {
      const visibleAccounts = accounts.filter(Boolean);
      if (!visibleAccounts.length) {
        return renderEmptyCta({ icon: '🏦', title: 'Zatím tu není žádný účet', text: 'Přidej banku, hotovost, spoření nebo obálku. Přehled pak ukáže každý účet zvlášť.', nav: 'finance', tab: 'accounts', label: 'Přidat účet' });
      }
      return `
        <div class="finance-account-balance-grid" aria-label="Zůstatky podle účtů">
          ${visibleAccounts.map((account) => {
            const balance = Number(balances[account.id] || 0);
            const tone = balance < 0 ? 'bad' : account.includeInTotal === false ? 'muted' : 'good';
            return `<article class="finance-account-balance-card ${tone}">
              <div class="finance-account-balance-top"><span>${financeAccountIcon(account.accountType)}</span><em>${escapeHtml(financeAccountTypeLabel(account.accountType))}</em></div>
              <strong>${escapeHtml(account.name)}</strong>
              <b>${formatCurrency(balance)}</b>
              <small>${account.ownerLabel ? escapeHtml(account.ownerLabel) : account.includeInTotal === false ? 'mimo celkový součet' : 'započítaný účet'}</small>
            </article>`;
          }).join('')}
        </div>
      `;
    }

    function renderFinanceLoanForm(loan = null) {
      const item = loan ? normalizeFinanceLoan(loan) : {
        loanType: 'consumer',
        name: '',
        lender: '',
        principal: '',
        currentBalance: '',
        interestRate: '',
        monthlyPayment: '',
        remainingMonths: '',
        earlyRepaymentFee: '',
        nextPaymentDate: '',
        note: ''
      };
      const isEdit = Boolean(loan);
      return `
        <form data-form="${isEdit ? 'update-finance-loan' : 'add-finance-loan'}" ${isEdit ? `data-id="${escapeHtml(item.id)}"` : ''} class="compact-form finance-loan-form">
          <div class="form-grid two">
            ${field('Název půjčky', 'name', 'text', 'např. Auto / spotřebák / hypotéka', true, item.name || '')}
            ${field('Banka / věřitel', 'lender', 'text', 'např. Air Bank', false, item.lender || '')}
            ${selectField('Typ', 'loanType', [['consumer', 'Spotřebitelská'], ['mortgage', 'Hypotéka'], ['car', 'Auto'], ['credit', 'Kreditka / kontokorent'], ['other', 'Jiná']], item.loanType || 'consumer')}
            ${field('Původní jistina', 'principal', 'number', 'např. 250000', false, item.principal || '')}
            ${field('Aktuální zůstatek', 'currentBalance', 'number', 'např. 184000', true, item.currentBalance || '')}
            ${field('Úrok % p.a.', 'interestRate', 'number', 'např. 7,9', false, item.interestRate || '')}
            ${field('Měsíční splátka', 'monthlyPayment', 'number', 'např. 4200', true, item.monthlyPayment || '')}
            ${field('Zbývá měsíců', 'remainingMonths', 'number', 'např. 48', true, item.remainingMonths || '')}
            ${field('Poplatek za splacení', 'earlyRepaymentFee', 'number', 'volitelné', false, item.earlyRepaymentFee || '')}
            ${field('Další splátka', 'nextPaymentDate', 'date', '', false, item.nextPaymentDate || '')}
            ${field('Poznámka', 'note', 'text', 'volitelné', false, item.note || '')}
          </div>
          <div class="form-actions">
            <button class="primary-btn" type="submit">${isEdit ? 'Uložit půjčku' : 'Přidat půjčku'}</button>
            ${isEdit ? '<button class="ghost-btn" type="button" data-action="finance-loan-edit-cancel">Zrušit úpravu</button>' : ''}
          </div>
        </form>
      `;
    }

    function financeLoanPayoffDate(months) {
      const count = Math.round(Number(months || 0));
      if (!count) return '';
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() + count);
      return date.toISOString().slice(0, 10);
    }

    function renderFinanceLoanItem(loan) {
      const projection = financeLoanProjection(loan);
      const typeLabel = { consumer: 'spotřebitelská', mortgage: 'hypotéka', car: 'auto', credit: 'kredit', other: 'jiná' }[loan.loanType] || 'půjčka';
      const payoffDate = financeLoanPayoffDate(projection.months);
      return `
        <div class="item compact-item finance-loan-item">
          <div class="item-top">
            <div class="item-title">💳 ${escapeHtml(loan.name)}</div>
            <span class="badge ${projection.payoffCost ? 'warn' : ''}">${formatCurrency(loan.currentBalance)}</span>
          </div>
          <div class="item-meta">${escapeHtml(loan.lender || typeLabel)} · splátka ${formatCurrency(projection.payment)} · zbývá ${projection.months} měs.${payoffDate ? ` · doplacena ${escapeHtml(formatDate(payoffDate))}` : ''} · doplatit ${formatCurrency(projection.payoffCost)}${loan.interestRate ? ` · ${loan.interestRate}% p.a.` : ''}${loan.note ? ` · ${escapeHtml(loan.note)}` : ''}</div>
          <div class="item-actions">
            <button class="ghost-btn" type="button" data-action="finance-loan-edit" data-id="${escapeHtml(loan.id)}">Upravit</button>
            <button class="danger-btn" type="button" data-action="delete-finance-loan" data-id="${escapeHtml(loan.id)}">Smazat</button>
          </div>
        </div>
      `;
    }

    function renderFinanceRefinanceResult(result) {
      if (!result) return '';
      const tone = result.savings > 0 ? 'good' : result.savings < 0 ? 'bad' : '';
      return `
        <div class="kpi-grid compact-kpi-grid refinance-result-grid">
          <div class="kpi"><strong>${formatCurrency(result.currentMonthlyPayment)}</strong><span>současné splátky</span></div>
          <div class="kpi"><strong>${formatCurrency(result.newMonthlyPayment)}</strong><span>nová splátka</span></div>
          <div class="kpi ${tone}"><strong>${formatCurrency(result.savings)}</strong><span>${result.savings >= 0 ? 'odhad úspory' : 'o tolik dražší'}</span></div>
          <div class="kpi"><strong>${result.breakEvenMonths ? `${result.breakEvenMonths} měs.` : '—'}</strong><span>návratnost poplatků</span></div>
        </div>
        <div class="inline-note compact-note">Refinancovaná jistina ${formatCurrency(result.newPrincipal)} · starý doplatek ${formatCurrency(result.currentTotalCost)} · nový doplatek ${formatCurrency(result.newTotalCost)}. Výpočet je orientační, bez pojištění a přesného amortizačního kalendáře banky.</div>
      `;
    }

    function renderFinanceRefinancePanel(loans = getFinanceLoans()) {
      const result = getState().financeRefinanceResult || null;
      if (!loans.length) return renderEmpty('Přidej aspoň jednu půjčku a kalkulačka refinancování se zobrazí.');
      return `
        <section class="card finance-panel panel-loans">
          <div class="card-header"><div><h2>Refinancování</h2><p>Vyber půjčky, zadej novou sazbu a délku. Appka porovná současné zbývající splátky s novou půjčkou.</p></div><span class="badge">orientačně</span></div>
          <form data-form="finance-refinance" class="compact-form">
            <div class="quick-chip-row">
              ${loans.map((loan) => `<label class="pill-check"><input type="checkbox" name="loanIds" value="${escapeHtml(loan.id)}" checked><span>${escapeHtml(loan.name)} · ${formatCurrency(loan.currentBalance)}</span></label>`).join('')}
            </div>
            <div class="form-grid two">
              ${field('Nový úrok % p.a.', 'interestRate', 'number', 'např. 5,9', true)}
              ${field('Nová délka v měsících', 'months', 'number', 'např. 48', true)}
              ${field('Nový poplatek / náklady', 'setupFee', 'number', 'např. 2000', false)}
              ${field('Poznámka', 'note', 'text', 'volitelné')}
            </div>
            <div class="form-actions"><button class="primary-btn" type="submit">Spočítat refinancování</button></div>
          </form>
          ${renderFinanceRefinanceResult(result)}
        </section>
      `;
    }

    function renderFinanceLoansPanel() {
      const loans = getFinanceLoans();
      const editingLoan = financeLoanEditId ? loans.find((loan) => loan.id === financeLoanEditId) || null : null;
      const projections = loans.map(financeLoanProjection);
      const totalBalance = projections.reduce((sum, row) => sum + row.loan.currentBalance, 0);
      const totalPayment = projections.reduce((sum, row) => sum + row.payment, 0);
      const totalPayoff = projections.reduce((sum, row) => sum + row.payoffCost, 0);
      return `
        <section class="card desktop-span-2 finance-panel panel-loans">
          <div class="card-header"><div><h2>Půjčky</h2><p>Aktuální zůstatky, splátky a podklady pro refinancování.</p></div><span class="badge">${loans.length}</span></div>
          <div class="kpi-grid compact-kpi-grid">
            <div class="kpi"><strong>${formatCurrency(totalBalance)}</strong><span>aktuální zůstatek</span></div>
            <div class="kpi"><strong>${formatCurrency(totalPayment)}</strong><span>měsíční splátky</span></div>
            <div class="kpi"><strong>${formatCurrency(totalPayoff)}</strong><span>doplatek včetně poplatků</span></div>
          </div>
          ${loans.length ? `<div class="list compact-list">${loans.map(renderFinanceLoanItem).join('')}</div>` : renderEmptyCta({ icon: '💳', title: 'Zatím žádná půjčka', text: 'Zadej zůstatek, splátku a zbývající měsíce. Pak půjde spočítat refinancování.', nav: 'finance', tab: 'loans', label: 'Přidat půjčku' })}
          ${editingLoan ? `<div class="inline-edit-card"><h3>Upravit půjčku</h3>${renderFinanceLoanForm(editingLoan)}</div>` : ''}
          <details class="action-details compact-edit-details finance-form-drawer" data-details-key="finance-add-loan" ${!editingLoan && getDetailsOpen('finance-add-loan', true) ? 'open' : ''}>
            <summary><span>Přidat půjčku</span><em>zůstatek, úrok, splátka, zbývající měsíce</em></summary>
            ${renderFinanceLoanForm(null)}
          </details>
        </section>
        ${renderFinanceRefinancePanel(loans)}
      `;
    }

    function renderFinance() {
      const accounts = financeAccountsSorted();
      const selectedMonth = financeSelectedMonth();
      const editingFinanceItem = (getState().finance || []).find((item) => item.id === getFinanceEditId()) || null;
      const editingFinanceAccount = (getState().financeAccounts || []).find((account) => account.id === getFinanceAccountEditId()) || null;
      const activeFinanceTab = getModuleTab('finance', editingFinanceItem || getFinanceCopyId() ? 'add' : 'summary');
      const monthItems = (getState().finance || []).filter((item) => String(item.date || '').slice(0, 7) === selectedMonth);
      const localAccounts = accounts.filter((account) => !account.cloudId || account.syncStatus).length;
      const tabs = renderSectionTabs('finance', [
        { id: 'summary', label: 'Přehled', icon: '💰', count: monthItems.length },
        { id: 'accounts', label: 'Účty', icon: '🏦', count: accounts.length },
        { id: 'loans', label: 'Půjčky', icon: '💳', count: getFinanceLoans().length },
        { id: 'add', label: 'Přidat', icon: '➕' },
        { id: 'analysis', label: 'Souhrny', icon: '📊' }
      ], 'summary');

      let content = '';
      if (activeFinanceTab === 'accounts') {
        const balances = financeAccountBalances();
        const managedRows = financeManagedGroups(balances);
        content = `
          <section class="card finance-panel panel-accounts">
            <div class="card-header"><div><h2>Účty / peněženky</h2><p>Každý účet má vlastní zůstatek. Může to být banka, hotovost, spoření, obálka nebo osoba.</p></div><span class="badge">${accounts.length}</span></div>
            ${accounts.length ? `<div class="list compact-list">${accounts.map((account) => renderFinanceAccount(account, balances)).join('')}</div>` : renderEmptyCta({ icon: '🏦', title: 'Nejdřív přidej účet', text: 'Účet může být banka, hotovost, spoření, obálka nebo spravované peníze pro někoho dalšího.', nav: 'finance', tab: 'accounts', label: 'Přidat účet' })}
            ${editingFinanceAccount ? `<div class="inline-edit-card"><h3>Upravit účet</h3>${renderFinanceAccountForm(editingFinanceAccount)}</div>` : ''}
            <details class="action-details compact-edit-details finance-form-drawer" data-details-key="finance-add-account" ${getDetailsOpen('finance-add-account') ? 'open' : ''}>
              <summary><span>Přidat účet / peněženku</span><em>banka, hotovost, obálka nebo osoba</em></summary>
              ${renderFinanceAccountForm(null)}
            </details>
          </section>

          <section class="card finance-panel panel-accounts">
            <div class="card-header"><div><h2>Spravované zůstatky</h2><p>Součet účtů seskupený podle osoby/obálky.</p></div></div>
            ${managedRows.length ? `<div class="list compact-list">${managedRows.map((row) => `<div class="item compact-item"><div class="item-top"><div class="item-title">${escapeHtml(row.label)}</div><span class="badge good">${formatCurrency(row.total)}</span></div><div class="item-meta">${row.accounts.map((account) => `${financeAccountIcon(account.accountType)} ${escapeHtml(account.name)}: ${formatCurrency(balances[account.id] || 0)}`).join(' · ')}</div></div>`).join('')}</div>` : renderEmptyCta({ icon: '👥', title: 'Spravované peníze zatím nejsou', text: 'Přidej účet s vlastníkem, třeba babička / tchyně, nebo použij rychlé založení dvojice účtů.', nav: 'finance', tab: 'accounts', label: 'Přidat spravované peníze' })}
            <details class="action-details compact-edit-details finance-form-drawer" data-details-key="finance-add-managed-set" ${getDetailsOpen('finance-add-managed-set') ? 'open' : ''}>
              <summary><span>Založit spravované peníze</span><em>dvojice hlavní účet + spoření</em></summary>
              <form data-form="add-managed-finance-set" class="compact-form">
                <div class="form-grid two">
                  ${field('Název osoby / obálky', 'ownerName', 'text', 'např. Tchyně / Dovolená / Kapesné', true)}
                  ${field('Hlavní účet', 'mainAccountName', 'text', 'např. Tchyně – u mě')}
                  ${field('Účet bokem / spoření', 'reserveAccountName', 'text', 'např. Tchyně – spoření')}
                  ${field('Počáteční zůstatek hlavní', 'mainOpeningBalance', 'number', '0')}
                  ${field('Počáteční zůstatek bokem', 'reserveOpeningBalance', 'number', '0')}
                  ${selectField('Započítat do celku', 'includeInTotal', [['yes', 'Ano'], ['no', 'Ne']], 'yes')}
                </div>
                <div class="form-actions"><button class="primary-btn" type="submit">Založit dvojici účtů</button></div>
              </form>
            </details>
          </section>`;
      } else if (activeFinanceTab === 'loans') {
        content = renderFinanceLoansPanel();
      } else if (activeFinanceTab === 'add') {
        content = `
          ${renderFinanceCopyPanel()}
          <section class="card finance-panel panel-add">
            <div class="card-header"><div><h2>${editingFinanceItem ? 'Upravit pohyb' : 'Přidat pohyb'}</h2><p>Příjem, výdaj nebo přesun mezi účty. Šablony jsou rychlé pro opakované platby.</p></div>${editingFinanceItem ? '<span class="badge warn">úprava</span>' : ''}</div>
            ${renderFinanceTemplatePanel(accounts)}
            ${renderFinanceTransactionForm(editingFinanceItem)}
            <div class="inline-note">Finance jsou cloud-first: při přihlášené domácnosti se účty a pohyby ukládají do Supabase. Když cloud zrovna nejde, záznam zůstane lokálně označený jako čekající a dá se později odeslat.</div>
          </section>`;
      } else if (activeFinanceTab === 'analysis') {
        const categoryRows = financeCategoryBreakdown(selectedMonth);
        const accountRows = financeAccountMonthSummary(selectedMonth);
        content = `
          <section class="card finance-panel panel-analysis">
            <div class="card-header"><div><h2>Souhrn podle kategorií</h2><p>${escapeHtml(financeMonthLabel(selectedMonth))}</p></div></div>
            ${categoryRows.length ? `<div class="list compact-list">${categoryRows.map((row) => `<div class="item compact-item"><div class="item-top"><div class="item-title">${escapeHtml(row.label)}</div><span class="badge ${row.type === 'income' ? 'good' : ''}">${formatCurrency(row.amount)}</span></div><div class="item-meta">${row.type === 'income' ? 'příjmy' : 'výdaje'} · ${row.count}×</div></div>`).join('')}</div>` : renderEmpty('V tomhle měsíci zatím nejsou žádné kategorie.')}
          </section>

          <section class="card finance-panel panel-analysis">
            <div class="card-header"><div><h2>Souhrn podle účtů</h2><p>${escapeHtml(financeMonthLabel(selectedMonth))}</p></div></div>
            ${accountRows.length ? `<div class="list compact-list">${accountRows.map((row) => `<div class="item compact-item"><div class="item-top"><div class="item-title">${escapeHtml(row.label)}</div><span class="badge">${formatCurrency(row.net)}</span></div><div class="item-meta">Příjmy ${formatCurrency(row.income)} · výdaje ${formatCurrency(row.expense)} · přesuny ${formatCurrency(row.transferIn - row.transferOut)}</div></div>`).join('')}</div>` : renderEmpty('V tomhle měsíci zatím nejsou žádné pohyby na účtech.')}
          </section>`;
      } else {
        const typeFilter = financeTypeFilter();
        const items = [...(getState().finance || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const visibleMonthItems = items.filter((item) => String(item.date || '').slice(0, 7) === selectedMonth);
        const visibleItems = filterFinanceItemsByType(visibleMonthItems, typeFilter);
        const incomeItems = visibleMonthItems.filter((item) => item.type === 'income').sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
        const expenseItems = visibleMonthItems.filter((item) => item.type === 'expense').sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
        const summary = financeMonthSummary(selectedMonth);
        const balances = financeAccountBalances();
        const localOnly = items.filter((item) => !item.cloudId || item.syncStatus).length;
        const cloudNote = getState().cloud?.householdId ? (localOnly || localAccounts ? `čeká na cloud: ${localOnly + localAccounts}` : 'online záloha OK') : 'lokální režim';
        content = `
          <section class="card desktop-span-2 finance-panel panel-summary finance-dashboard-card">
            <div class="card-header finance-overview-head"><div><h2>Účty zvlášť</h2><p>${escapeHtml(financeMonthLabel(selectedMonth))} · ${escapeHtml(cloudNote)}</p></div><span class="badge ${getState().cloud?.householdId && !localOnly && !localAccounts ? 'good' : localOnly || localAccounts ? 'warn' : ''}">${getState().cloud?.householdId ? 'cloud-first' : 'lokálně'}</span></div>
            ${renderFinanceAccountBalanceCards(accounts, balances)}
            <div class="finance-kpi-row">
              <div class="finance-kpi income"><span>Příjmy</span><strong>${formatCurrency(summary.income)}</strong></div>
              <div class="finance-kpi expense"><span>Výdaje</span><strong>${formatCurrency(summary.expense)}</strong></div>
              <div class="finance-kpi balance ${summary.balance >= 0 ? 'income' : 'expense'}"><span>Rozdíl</span><strong>${formatCurrency(summary.balance)}</strong></div>
            </div>
            ${renderFinanceMonthToolbar(selectedMonth, typeFilter)}
            ${renderFinanceSplitOverview(incomeItems, expenseItems)}
            <div class="card-header finance-list-head"><div><h2>Pohyby na účtu</h2><p>${escapeHtml(typeFilter === 'all' ? 'Všechny pohyby' : typeFilter === 'income' ? 'Jen příjmy' : typeFilter === 'expense' ? 'Jen výdaje' : 'Jen přesuny')} za ${escapeHtml(financeMonthLabel(selectedMonth))}</p></div><span class="badge">${visibleItems.length}</span></div>
            ${visibleItems.length ? `<div class="list compact-list finance-movement-list">${visibleItems.slice(0, 80).map(renderFinanceItem).join('')}</div>` : renderEmptyCta({ icon: '💰', title: 'Měsíc je bez pohybů', text: 'Přidej příjem, výdaj nebo přesun mezi účty. Přehled se začne počítat automaticky.', nav: 'finance', tab: 'add', label: 'Přidat pohyb' })}
          </section>`;
      }

      return `
        ${tabs}
        <div class="grid two module-tabbed finance-tab-${escapeHtml(activeFinanceTab)}" data-tab-area="finance">
          ${content}
        </div>
      `;
    }

    function renderFinanceAccount(account, balances = financeAccountBalances()) {
      return `
        <div class="item">
          <div class="item-top">
            <div class="item-title">${financeAccountIcon(account.accountType)} ${escapeHtml(account.name)}</div>
            <span class="badge good">${formatCurrency(balances[account.id] || 0)}</span>
          </div>
          <div class="item-meta">${escapeHtml(financeAccountTypeLabel(account.accountType))}${account.ownerLabel ? ` · ${escapeHtml(account.ownerLabel)}` : ''}${account.includeInTotal === false ? ' · mimo celkový součet' : ''}${account.note ? ` · ${escapeHtml(account.note)}` : ''}${account.cloudId ? ' · cloud' : ' · lokálně'}</div>
          <div class="item-actions">
            <button class="ghost-btn" type="button" data-action="finance-account-edit" data-id="${escapeHtml(account.id)}">Upravit</button>
            <button class="danger-btn" type="button" data-action="delete-finance-account" data-id="${account.id}">Smazat</button>
          </div>
        </div>
      `;
    }

    function renderFinanceItem(item) {
      const isIncome = item.type === 'income';
      const isTransfer = item.type === 'transfer';
      const account = financeAccountById(item.accountId);
      const target = financeAccountById(item.transferAccountId);
      const movementIcon = financeMovementIcon(item);
      const paymentIcon = financePaymentIcon(item.paymentMethod);
      const syncLabel = item.syncStatus ? ' · čeká na cloud' : item.cloudId ? ' · cloud' : ' · lokálně';
      return `
        <div class="item finance-item ${isIncome ? 'is-income' : isTransfer ? 'is-transfer' : 'is-expense'}">
          <div class="item-top finance-item-top">
            <div class="finance-item-title-wrap">
              <span class="finance-movement-icon finance-template-like-icon" aria-hidden="true">${escapeHtml(movementIcon)}</span>
              <div class="finance-item-title-text">
                <div class="item-title">${escapeHtml(item.title)}</div>
                <div class="finance-item-subicons"><span>${escapeHtml(paymentIcon)}</span>${account ? `<span>${financeAccountIcon(account.accountType)}</span>` : ''}${target ? `<span>→ ${financeAccountIcon(target.accountType)}</span>` : ''}</div>
              </div>
            </div>
            <span class="badge ${isIncome || isTransfer ? 'good' : 'warn'}">${formatCurrency(item.amount)}</span>
          </div>
          <div class="item-meta">${formatDate(item.date)} · ${isTransfer ? 'Přesun' : escapeHtml(financeCategoryLabel(item.category))}${account ? ` · ${escapeHtml(account.name)}` : ''}${target ? ` → ${escapeHtml(target.name)}` : ''} · ${escapeHtml(financePaymentLabel(item.paymentMethod))}${item.note ? ` · ${escapeHtml(item.note)}` : ''}${syncLabel}</div>
          <div class="item-actions finance-item-actions">
            <button class="ghost-btn" type="button" data-action="finance-edit" data-id="${escapeHtml(item.id)}">Upravit</button>
            <button class="ghost-btn" type="button" data-action="finance-copy" data-id="${escapeHtml(item.id)}">Kopírovat</button>
            <button class="danger-btn" type="button" data-action="delete-finance" data-id="${escapeHtml(item.id)}">Smazat</button>
          </div>
        </div>
      `;
    }

    function financeCategoryOptions() {
      return FINANCE_CATEGORY_OPTIONS.map(([key, label]) => [key, label]);
    }

    function financeCategoryLabel(value) {
      return FINANCE_CATEGORY_OPTIONS.find(([key]) => key === value)?.[1] || value || 'Ostatní';
    }

    function financeAccountTypeOptions() {
      return [['cash', 'Hotovost'], ['bank', 'Běžný účet'], ['savings', 'Spoření'], ['envelope', 'Obálka / rezerva'], ['person', 'Osoba / spravované peníze'], ['debt', 'Dluh / vyrovnání'], ['other', 'Jiné']];
    }

    function financeAccountTypeLabel(value) {
      return financeAccountTypeOptions().find(([key]) => key === value)?.[1] || 'Jiné';
    }

    function financeAccountIcon(value) {
      return { cash: '💵', bank: '🏦', savings: '🐷', envelope: '✉️', person: '👤', debt: '🧾', other: '💰' }[value] || '💰';
    }

    function financeAccountsSorted() {
      return [...(getState().financeAccounts || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'cs'));
    }

    function financeAccountById(id) {
      return (getState().financeAccounts || []).find((account) => account.id === id || account.cloudId === id) || null;
    }

    function financeAccountOptions(includeEmpty = true) {
      const options = financeAccountsSorted().map((account) => [account.id, `${financeAccountIcon(account.accountType)} ${account.name}`]);
      return includeEmpty ? [['', 'Bez účtu / jen záznam'], ...options] : [['', 'Nevybráno'], ...options];
    }

    function financeManagedGroups(balances = financeAccountBalances()) {
      const map = new Map();
      (getState().financeAccounts || []).forEach((account) => {
        const explicitOwner = normalizeText(account.ownerLabel);
        const isManagedType = ['person', 'savings', 'envelope', 'debt'].includes(account.accountType);
        if (!explicitOwner && !isManagedType) return;
        const label = explicitOwner || financeAccountTypeLabel(account.accountType);
        if (!map.has(label)) map.set(label, { label, accounts: [], total: 0 });
        const row = map.get(label);
        row.accounts.push(account);
        row.total += Number(balances[account.id] || 0);
      });
      return [...map.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.label.localeCompare(b.label, 'cs'));
    }

    function financeCategoryType(value) {
      return FINANCE_CATEGORY_OPTIONS.find(([key]) => key === value)?.[2] || 'expense';
    }

    function financeCategoryIcon(value) {
      const map = {
        salary: '💼',
        bonus: '🎁',
        sale: '💸',
        other_income: '➕',
        groceries: '🛒',
        drugstore: '🧴',
        housing: '🏠',
        energy: '⚡',
        car: '🚗',
        kids: '🧸',
        health: '💊',
        fun: '🎮',
        restaurant: '🍽️',
        subscription: '🎟️',
        contracts: '📄',
        other_expense: '💳'
      };
      return map[value] || '💳';
    }

    function financeMovementIcon(item = {}) {
      if (item.type === 'transfer') return '↔️';
      const templates = financeTemplateDefinitions();
      const templateId = normalizeText(item.templateId);
      if (templateId) {
        const direct = templates.find((template) => String(template.id) === templateId);
        if (direct?.icon) return direct.icon;
      }
      const titleKey = normalizeKey(item.title || '');
      if (titleKey) {
        const exact = templates.find((template) => normalizeKey(template.title) === titleKey || normalizeKey(template.name) === titleKey);
        if (exact?.icon) return exact.icon;
        const loose = templates.find((template) => {
          const tTitle = normalizeKey(template.title || '');
          const tName = normalizeKey(template.name || '');
          return (tTitle && (titleKey.includes(tTitle) || tTitle.includes(titleKey))) || (tName && (titleKey.includes(tName) || tName.includes(titleKey)));
        });
        if (loose?.icon) return loose.icon;
      }
      const category = normalizeText(item.category);
      const typed = templates.find((template) => template.type === item.type && template.category === category && template.paymentMethod === item.paymentMethod);
      if (typed?.icon) return typed.icon;
      return financeCategoryIcon(category);
    }

    function financePaymentIcon(value) {
      return { cash: '💵', card: '💳', bank_transfer: '🏦', direct_debit: '🔁', other: '💰' }[value] || '💰';
    }

    function financePaymentLabel(value) {
      const map = { cash: 'hotově', card: 'kartou', bank_transfer: 'převod', direct_debit: 'inkaso', other: 'jiné' };
      return map[value] || 'jiné';
    }

    function financeTypeFilter() {
      const value = normalizeText(getState().financeCloud?.typeFilter || 'all');
      return ['all', 'income', 'expense', 'transfer'].includes(value) ? value : 'all';
    }

    function filterFinanceItemsByType(items = [], filter = financeTypeFilter()) {
      const safe = ['income', 'expense', 'transfer'].includes(filter) ? filter : 'all';
      return safe === 'all' ? items : items.filter((item) => item.type === safe);
    }

    function setFinanceTypeFilter(filter = 'all') {
      const safe = ['all', 'income', 'expense', 'transfer'].includes(filter) ? filter : 'all';
      getState().financeCloud = { ...(getState().financeCloud || {}), typeFilter: safe };
      touchState();
      saveState();
      render();
    }

    function addMonthsToFinanceDate(dateValue, monthOffset = 1, preferredDay = 0) {
      const base = parseDateValue(dateValue) || new Date();
      const day = Math.min(31, Math.max(1, Number(preferredDay || base.getDate() || 1)));
      const target = new Date(base.getFullYear(), base.getMonth() + Number(monthOffset || 0), 1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(day, lastDay));
      return target.toISOString().slice(0, 10);
    }

    function dateInFinanceMonth(monthKey, day = 1) {
      const safeMonth = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? String(monthKey) : todayISO().slice(0, 7);
      const [year, month] = safeMonth.split('-').map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      return `${safeMonth}-${String(Math.min(Math.max(1, Number(day || 1)), lastDay)).padStart(2, '0')}`;
    }

    function financeCloudPendingCount() {
      return (getState().finance || []).filter((item) => !item.cloudId || item.syncStatus).length + (getState().financeAccounts || []).filter((item) => !item.cloudId || item.syncStatus).length;
    }

    function markFinanceCloudPending(reason = 'finance') {
      getState().financeCloud = { ...(getState().financeCloud || {}), pendingAt: new Date().toISOString(), pendingReason: reason };
    }

    function clearFinanceCloudPendingIfClean() {
      if (!financeCloudPendingCount()) getState().financeCloud = { ...(getState().financeCloud || {}), pendingAt: '', pendingReason: '' };
    }

    function financeSelectedMonth() {
      const stored = getState().financeCloud?.monthFilter;
      return /^\d{4}-\d{2}$/.test(String(stored || '')) ? stored : todayISO().slice(0, 7);
    }

    function financeMonthLabel(month) {
      const safeMonth = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : todayISO().slice(0, 7);
      const [year, monthIndex] = safeMonth.split('-').map(Number);
      return new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(new Date(year, monthIndex - 1, 1));
    }

    function setFinanceMonth(month) {
      if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return showToast('Vyber platný měsíc');
      getState().financeCloud = { ...(getState().financeCloud || {}), monthFilter: month };
      touchState();
      saveState();
      render();
    }

    function shiftFinanceMonth(delta) {
      const month = financeSelectedMonth();
      const [year, monthIndex] = month.split('-').map(Number);
      const date = new Date(year, monthIndex - 1 + delta, 1);
      const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      setFinanceMonth(next);
    }

    function financeMonthSummary(month = financeSelectedMonth()) {
      return (getState().finance || []).reduce((acc, item) => {
        if (String(item.date || '').slice(0, 7) !== month) return acc;
        const amount = Number(item.amount || 0);
        if (item.type === 'income') acc.income += amount;
        else if (item.type === 'expense') acc.expense += amount;
        acc.balance = acc.income - acc.expense;
        return acc;
      }, { income: 0, expense: 0, balance: 0 });
    }

    function financeCategoryBreakdown(month = financeSelectedMonth()) {
      const map = new Map();
      (getState().finance || []).forEach((item) => {
        if (String(item.date || '').slice(0, 7) !== month || item.type === 'transfer') return;
        const key = `${item.type}:${item.category || 'other'}`;
        const current = map.get(key) || { key, type: item.type, category: item.category || 'other', label: financeCategoryLabel(item.category), amount: 0, count: 0 };
        current.amount += Number(item.amount || 0);
        current.count += 1;
        map.set(key, current);
      });
      return [...map.values()].sort((a, b) => b.amount - a.amount);
    }

    function financeAccountMonthSummary(month = financeSelectedMonth()) {
      const map = new Map();
      const ensure = (account) => {
        if (!account) return null;
        const key = account.id;
        if (!map.has(key)) map.set(key, { key, label: `${financeAccountIcon(account.accountType)} ${account.name}`, income: 0, expense: 0, transferIn: 0, transferOut: 0, net: 0 });
        return map.get(key);
      };
      (getState().finance || []).forEach((item) => {
        if (String(item.date || '').slice(0, 7) !== month) return;
        const amount = Number(item.amount || 0);
        const account = financeAccountById(item.accountId);
        const target = financeAccountById(item.transferAccountId);
        if (item.type === 'income') { const row = ensure(account); if (row) { row.income += amount; row.net += amount; } }
        if (item.type === 'expense') { const row = ensure(account); if (row) { row.expense += amount; row.net -= amount; } }
        if (item.type === 'transfer') {
          const from = ensure(account);
          const to = ensure(target);
          if (from) { from.transferOut += amount; from.net -= amount; }
          if (to) { to.transferIn += amount; to.net += amount; }
        }
      });
      return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    }

    function financeAccountBalances() {
      const balances = {};
      (getState().financeAccounts || []).forEach((account) => {
        balances[account.id] = Number(account.openingBalance || 0);
        if (account.cloudId) balances[account.cloudId] = balances[account.id];
      });
      (getState().finance || []).forEach((item) => {
        const amount = Number(item.amount || 0);
        if (!amount) return;
        const account = financeAccountById(item.accountId);
        const target = financeAccountById(item.transferAccountId);
        if (item.type === 'income' && account) balances[account.id] = (balances[account.id] || 0) + amount;
        if (item.type === 'expense' && account) balances[account.id] = (balances[account.id] || 0) - amount;
        if (item.type === 'transfer') {
          if (account) balances[account.id] = (balances[account.id] || 0) - amount;
          if (target) balances[target.id] = (balances[target.id] || 0) + amount;
        }
      });
      return balances;
    }

    function cloudFinanceAccountPayload(account, userId) {
      return {
        household_id: getState().cloud.householdId,
        profile_id: null,
        name: account.name,
        account_type: ['cash', 'bank', 'savings', 'envelope', 'person', 'debt', 'other'].includes(account.accountType) ? account.accountType : 'other',
        owner_label: account.ownerLabel || null,
        currency: 'CZK',
        opening_balance: Number(account.openingBalance || 0),
        current_balance: Number(financeAccountBalances()[account.id] || account.openingBalance || 0),
        include_in_total: account.includeInTotal !== false,
        is_archived: false,
        note: account.note || null,
        created_by: userId,
        updated_by: userId
      };
    }

    async function cloudAddFinanceAccount(account) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return null;
      const user = await refreshCloudSession(false);
      if (!user) return null;
      const { data, error } = await client.from('finance_accounts').insert(cloudFinanceAccountPayload(account, user.id)).select('id').single();
      if (error) {
        showToast(error.message || 'Účet se nepovedlo uložit do cloudu');
        return null;
      }
      account.cloudId = data.id;
      account.syncStatus = '';
      getState().cloud.lastSyncAt = new Date().toISOString();
      return data;
    }

    async function cloudUpdateFinanceAccount(account) {
      const client = getSupabaseClient();
      if (!client || !account?.cloudId || !getState().cloud?.householdId) return true;
      const user = await refreshCloudSession(false);
      if (!user) return false;
      const payload = cloudFinanceAccountPayload(account, user.id);
      delete payload.created_by;
      const { error } = await client.from('finance_accounts').update(payload).eq('id', account.cloudId).eq('household_id', getState().cloud.householdId);
      if (error) {
        showToast(error.message || 'Účet se nepovedlo upravit v cloudu');
        return false;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return true;
    }

    function cloudFinancePayload(item, userId) {
      const account = financeAccountById(item.accountId);
      const target = financeAccountById(item.transferAccountId);
      return {
        household_id: getState().cloud.householdId,
        profile_id: null,
        category_id: null,
        account_id: account?.cloudId || null,
        transfer_account_id: target?.cloudId || null,
        type: item.type === 'transfer' ? 'transfer' : item.type === 'income' ? 'income' : 'expense',
        title: item.title || financeCategoryLabel(item.category),
        amount: Number(item.amount || 0),
        currency: 'CZK',
        transaction_date: item.date || todayISO(),
        payment_method: ['cash', 'card', 'bank_transfer', 'direct_debit', 'other'].includes(item.paymentMethod) ? item.paymentMethod : 'other',
        is_recurring: false,
        recurring_rule: 'none',
        note: item.note || null,
        source: 'manual',
        created_by: userId,
        updated_by: userId
      };
    }

    async function cloudAddFinance(item) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return null;
      const user = await refreshCloudSession(false);
      if (!user) return null;
      if (item.accountId) {
        const account = financeAccountById(item.accountId);
        if (account && !account.cloudId) await cloudAddFinanceAccount(account);
      }
      if (item.transferAccountId) {
        const target = financeAccountById(item.transferAccountId);
        if (target && !target.cloudId) await cloudAddFinanceAccount(target);
      }
      const { data, error } = await client.from('finance_transactions').insert(cloudFinancePayload(item, user.id)).select('id').single();
      if (error) {
        showToast(error.message || 'Finance se nepovedlo uložit do cloudu');
        return null;
      }
      item.cloudId = data.id;
      item.syncStatus = '';
      getState().cloud.lastSyncAt = new Date().toISOString();
      return data;
    }

    async function cloudUpdateFinance(item) {
      const client = getSupabaseClient();
      if (!client || !item?.cloudId || !getState().cloud?.householdId) return true;
      const user = await refreshCloudSession(false);
      if (!user) return false;
      if (item.accountId) {
        const account = financeAccountById(item.accountId);
        if (account && !account.cloudId) await cloudAddFinanceAccount(account);
      }
      if (item.transferAccountId) {
        const target = financeAccountById(item.transferAccountId);
        if (target && !target.cloudId) await cloudAddFinanceAccount(target);
      }
      const payload = cloudFinancePayload(item, user.id);
      delete payload.created_by;
      const { error } = await client.from('finance_transactions').update(payload).eq('id', item.cloudId).eq('household_id', getState().cloud.householdId);
      if (error) {
        showToast(error.message || 'Finance se nepovedlo upravit v cloudu');
        return false;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return true;
    }

    async function cloudLoadFinance(showMessage = true) {
      const client = getSupabaseClient();
      if (!client || !getState().cloud?.householdId) return false;
      const { data: accountData, error: accountError } = await client
        .from('finance_accounts')
        .select('id,name,account_type,owner_label,opening_balance,include_in_total,note,created_at')
        .eq('household_id', getState().cloud.householdId)
        .eq('is_archived', false)
        .order('name', { ascending: true });
      if (accountError) {
        showToast(accountError.message || 'Finanční účty se nepovedlo načíst z cloudu');
        return false;
      }
      const localAccounts = (getState().financeAccounts || []).filter((item) => !item.cloudId || item.syncStatus);
      const pendingAccountCloudIds = new Set(localAccounts.map((item) => item.cloudId).filter(Boolean));
      const cloudAccounts = (accountData || []).filter((item) => !pendingAccountCloudIds.has(item.id)).map((item) => ({
        id: getState().financeAccounts.find((entry) => entry.cloudId === item.id)?.id || `finance-account-cloud-${item.id}`,
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        cloudId: item.id,
        name: item.name || 'Účet',
        accountType: item.account_type || 'other',
        ownerLabel: item.owner_label || '',
        openingBalance: Number(item.opening_balance || 0),
        includeInTotal: item.include_in_total !== false,
        note: item.note || '',
        createdAt: item.created_at || new Date().toISOString()
      }));
      getState().financeAccounts = [...cloudAccounts, ...localAccounts];
      const cloudAccountById = Object.fromEntries(getState().financeAccounts.filter((account) => account.cloudId).map((account) => [account.cloudId, account]));

      const { data, error } = await client
        .from('finance_transactions')
        .select('id,type,title,amount,transaction_date,payment_method,note,created_at,account_id,transfer_account_id')
        .eq('household_id', getState().cloud.householdId)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) {
        showToast(error.message || 'Finance se nepovedlo načíst z cloudu');
        return false;
      }
      const localOnly = (getState().finance || []).filter((item) => !item.cloudId || item.syncStatus);
      const pendingFinanceCloudIds = new Set(localOnly.map((item) => item.cloudId).filter(Boolean));
      const cloudItems = (data || []).filter((item) => !pendingFinanceCloudIds.has(item.id)).map((item) => ({
        id: getState().finance.find((entry) => entry.cloudId === item.id)?.id || `finance-cloud-${item.id}`,
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        cloudId: item.id,
        type: item.type === 'transfer' || item.transfer_account_id ? 'transfer' : item.type || 'expense',
        title: item.title || 'Záznam',
        amount: item.amount === null || item.amount === undefined ? 0 : Number(item.amount),
        date: item.transaction_date || todayISO(),
        paymentMethod: item.payment_method || 'other',
        accountId: cloudAccountById[item.account_id]?.id || '',
        transferAccountId: cloudAccountById[item.transfer_account_id]?.id || '',
        category: item.type === 'income' ? 'other_income' : 'other_expense',
        note: item.note || '',
        createdAt: item.created_at || new Date().toISOString()
      }));
      getState().finance = [...cloudItems, ...localOnly];
      getState().financeCloud = { ...(getState().financeCloud || {}), accountsLoadedAt: new Date().toISOString(), loadedAt: new Date().toISOString() };
      clearFinanceCloudPendingIfClean();
      touchState();
      saveState();
      render();
      if (showMessage) showToast('Cloud finance načtené');
      return true;
    }

    async function cloudDeleteFinance(item) {
      const client = getSupabaseClient();
      if (!client || !item?.cloudId || !getState().cloud?.householdId) return true;
      const { error } = await client.from('finance_transactions').delete().eq('id', item.cloudId).eq('household_id', getState().cloud.householdId);
      if (error) {
        showToast(error.message || 'Záznam se nepovedlo smazat v cloudu');
        return false;
      }
      getState().cloud.lastSyncAt = new Date().toISOString();
      return true;
    }

    async function cloudDeleteFinanceAccount(account) {
      const client = getSupabaseClient();
      if (!client || !account?.cloudId || !getState().cloud?.householdId) return true;
      const { error } = await client.from('finance_accounts').update({ is_archived: true }).eq('id', account.cloudId).eq('household_id', getState().cloud.householdId);
      if (error) {
        showToast(error.message || 'Účet se nepovedlo archivovat v cloudu');
        return false;
      }
      return true;
    }

    async function addFinanceAccountFromForm(data, form) {
      const account = {
        id: uid(),
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        name: normalizeText(data.name),
        accountType: normalizeText(data.accountType) || 'other',
        ownerLabel: normalizeText(data.ownerLabel),
        openingBalance: decimalValue(data.openingBalance) || 0,
        includeInTotal: data.includeInTotal !== 'no',
        note: normalizeText(data.note)
      };
      if (!account.name) return showToast('Doplň název účtu');
      getState().financeAccounts.push(account);
      touchState();
      saveState();
      form.reset();
      render();
      showToast('Účet uložen');
      cloudAddFinanceAccount(account).then((saved) => {
        if (saved?.id) { account.cloudId = saved.id; saveState(); requestRender(); }
      }).catch((error) => console.warn('Cloud sync (účet) na pozadí selhal', error));
    }

    async function addManagedFinanceSetFromForm(data, form) {
      const ownerName = normalizeText(data.ownerName);
      if (!ownerName) return showToast('Doplň název osoby nebo obálky');
      const includeInTotal = data.includeInTotal !== 'no';
      const existingNames = new Set((getState().financeAccounts || []).map((account) => normalizeText(account.name).toLowerCase()));
      const mainName = normalizeText(data.mainAccountName) || `${ownerName} – u mě`;
      const reserveName = normalizeText(data.reserveAccountName) || `${ownerName} – bokem`;
      const drafts = [
        { name: mainName, accountType: 'person', openingBalance: decimalValue(data.mainOpeningBalance) || 0, note: 'Hlavní spravovaný zůstatek' },
        { name: reserveName, accountType: 'savings', openingBalance: decimalValue(data.reserveOpeningBalance) || 0, note: 'Peníze bokem / spoření' }
      ].filter((draft) => draft.name && !existingNames.has(draft.name.toLowerCase()));
      if (!drafts.length) return showToast('Tyhle účty už existují');
      const accounts = drafts.map((draft) => ({
        id: uid(),
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        name: draft.name,
        accountType: draft.accountType,
        ownerLabel: ownerName,
        openingBalance: draft.openingBalance,
        includeInTotal,
        note: draft.note
      }));
      accounts.forEach((account) => getState().financeAccounts.push(account));
      touchState();
      saveState();
      form.reset();
      render();
      showToast(`Založeno účtů: ${drafts.length}`);
      Promise.all(accounts.map((account) => cloudAddFinanceAccount(account).then((saved) => {
        if (saved?.id) account.cloudId = saved.id;
        return Boolean(saved?.id);
      }))).then((results) => {
        if (results.some(Boolean)) { saveState(); requestRender(); }
      }).catch((error) => console.warn('Cloud sync (spravované účty) na pozadí selhal', error));
    }

    function fillFinanceTemplate(templateId) {
      setFinanceEditId('');
      setFinanceCopyId('');
      writeFinanceModuleTab('add');
      render();
      const form = document.querySelector('[data-form="add-finance"]');
      if (!form) return;
      const accounts = financeAccountsSorted();
      const template = financeTemplateById(templateId);
      if (!template) return;
      const accountId = financeTemplateAccountFallback(template, accounts);
      const transferAccountId = financeTemplateTransferFallback(template, accounts, accountId);
      const values = {
        type: template.type,
        title: template.title,
        amount: template.amount || '',
        category: template.category,
        paymentMethod: template.paymentMethod,
        accountId,
        transferAccountId,
        note: template.note || ''
      };
      Object.entries(values).forEach(([name, value]) => {
        const input = form.elements[name];
        if (input) input.value = value || '';
      });
      form.dataset.templateId = template.id || '';
      if (form.elements.date) form.elements.date.value = todayISO();
      if (form.elements.amount) form.elements.amount.focus();
      showToast('Šablona vyplněná, můžeš upravit a uložit');
    }

    function financeTemplateFromFormData(data = {}, nameOverride = '', idOverride = '') {
      const type = data.type === 'income' ? 'income' : data.type === 'transfer' ? 'transfer' : 'expense';
      const category = normalizeText(data.category) || (type === 'income' ? 'other_income' : 'other_expense');
      const existingId = normalizeText(idOverride || data.id);
      const existingByName = !existingId ? financeTemplateDefinitions().find((template) => normalizeKey(template.name) === normalizeKey(nameOverride || data.name || data.title)) : null;
      return normalizeFinanceTemplate({
        id: existingId || existingByName?.id || `finance-template-${uid()}`,
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        icon: normalizeText(data.icon) || (type === 'income' ? '➕' : type === 'transfer' ? '↔️' : '💳'),
        name: normalizeText(nameOverride || data.name || data.title) || 'Šablona platby',
        type,
        title: normalizeText(data.title) || financeCategoryLabel(category),
        amount: data.amount === '' ? '' : decimalValue(data.amount),
        category,
        paymentMethod: normalizeText(data.paymentMethod) || 'bank_transfer',
        accountId: normalizeText(data.accountId),
        transferAccountId: type === 'transfer' ? normalizeText(data.transferAccountId) : '',
        note: normalizeText(data.note),
        system: false
      });
    }

    function persistFinanceTemplatesState() {
      touchState();
      if (cloudReady()) {
        getState().financeCloud = { ...(getState().financeCloud || {}), templatesPendingAt: new Date().toISOString() };
      }
      saveState();
      if (!cloudReady()) return Promise.resolve(true);
      return cloudSaveHouseholdUiSettings(false)
          .then((ok) => {
            if (ok) {
              getState().financeCloud = { ...(getState().financeCloud || {}), templatesPendingAt: '', templatesLoadedAt: new Date().toISOString() };
              persistStateSnapshot();
            }
            return ok;
          })
          .catch((error) => {
            persistStateSnapshot();
            console.warn('Finance template autosync failed', error);
            return false;
          });
    }

    function upsertFinanceTemplate(template) {
      const normalized = normalizeFinanceTemplate({ ...template, system: false, updatedAt: new Date().toISOString() });
      const current = normalizeFinanceTemplates(getState().financeTemplates || []);
      const indexById = current.findIndex((item) => String(item.id) === String(normalized.id));
      if (indexById >= 0) current[indexById] = { ...current[indexById], ...normalized, system: false };
      else {
        const indexByName = current.findIndex((item) => normalizeKey(item.name) === normalizeKey(normalized.name));
        if (indexByName >= 0) current[indexByName] = { ...current[indexByName], ...normalized, id: current[indexByName].id, system: false };
        else current.push(normalized);
      }
      getState().financeTemplates = normalizeFinanceTemplates(current);
      return normalized;
    }

    function addFinanceTemplateFromForm(data, form) {
      const template = financeTemplateFromFormData(data);
      if (!template.name || !template.title) return showToast('Doplň název šablony a pohybu');
      upsertFinanceTemplate(template);
      setFinanceTemplateEditId('');
      persistFinanceTemplatesState();
      form?.reset?.();
      render();
      showToast(`Šablona ${template.name} uložená`);
    }

    function updateFinanceTemplateFromForm(id, data, form) {
      const existing = financeTemplateById(id);
      if (!existing) return showToast('Šablona nenalezená');
      const template = financeTemplateFromFormData(data, data.name || existing.name, existing.id);
      if (!template.name || !template.title) return showToast('Doplň název šablony a pohybu');
      upsertFinanceTemplate({ ...existing, ...template, id: existing.id, createdAt: existing.createdAt || new Date().toISOString(), system: false });
      setFinanceTemplateEditId('');
      persistFinanceTemplatesState();
      form?.reset?.();
      render();
      showToast(`Šablona ${template.name} upravená`);
    }

    function editFinanceTemplate(id) {
      const template = financeTemplateById(id);
      if (!template) return showToast('Šablona nenalezená');
      setFinanceTemplateEditId(template.id);
      writeFinanceModuleTab('add');
      render();
    }

    function saveFinanceTemplateFromVisibleForm(form) {
      if (!form) return showToast('Formulář se nepovedlo najít');
      const data = getFormData(form);
      const defaultName = normalizeText(data.title) || 'Nová šablona';
      const name = normalizeText(window.prompt('Název šablony', defaultName));
      if (!name) return;
      const existing = financeTemplateDefinitions().find((template) => normalizeKey(template.name) === normalizeKey(name));
      const template = financeTemplateFromFormData(data, name, existing?.id || '');
      upsertFinanceTemplate(template);
      setFinanceTemplateEditId('');
      persistFinanceTemplatesState();
      render();
      showToast(existing ? `Šablona ${template.name} upravená` : `Šablona ${template.name} uložená`);
    }

    function deleteFinanceTemplate(id) {
      const template = financeTemplateById(id);
      if (!template) return showToast('Šablona nenalezená');
      if (!window.confirm(`Smazat šablonu ${template.name}?`)) return;
      const current = normalizeFinanceTemplates(getState().financeTemplates || []).filter((item) => String(item.id) !== String(id));
      const isDefaultTemplate = DEFAULT_FINANCE_TEMPLATES.some((item) => String(item.id) === String(id));
      if (template.system || isDefaultTemplate) {
        current.push(normalizeFinanceTemplate({ ...template, id: template.id, deleted: true, system: false, updatedAt: new Date().toISOString() }));
      }
      getState().financeTemplates = normalizeFinanceTemplates(current);
      if (getFinanceTemplateEditId() === id) setFinanceTemplateEditId('');
      const deleteSync = persistFinanceTemplatesState();
      render();
      showUndoToast('Šablona smazaná', async () => {
        const restored = normalizeFinanceTemplates(getState().financeTemplates || []).filter((item) => String(item.id) !== String(template.id));
        if (!template.system && !isDefaultTemplate) restored.push(normalizeFinanceTemplate({ ...template, deleted: false }));
        getState().financeTemplates = normalizeFinanceTemplates(restored);
        touchState();
        saveState();
        render();
        await Promise.resolve(deleteSync).catch(() => false);
        await persistFinanceTemplatesState();
        showToast('Šablona obnovená');
      });
    }

    function setFinanceCopy(id) {
      const item = (getState().finance || []).find((entry) => entry.id === id);
      if (!item) return showToast('Pohyb se nepovedlo najít');
      setFinanceCopyId(id);
      setFinanceEditId('');
      writeFinanceModuleTab('add');
      render();
      keepActiveSectionTabsCentered('smooth');
      const schedule = window.requestAnimationFrame || ((fn) => window.setTimeout(fn, 0));
      schedule(() => document.querySelector('[data-form="copy-finance"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
    }

    async function copyFinanceToMonths(id, data, form) {
      const source = (getState().finance || []).find((entry) => entry.id === id);
      if (!source) return showToast('Původní pohyb se nepovedlo najít');
      const firstMonth = /^\d{4}-\d{2}$/.test(String(data.firstMonth || '')) ? String(data.firstMonth) : todayISO().slice(0, 7);
      const count = Math.min(36, Math.max(1, Math.floor(Number(data.count || 1))));
      const sourceDate = parseDateValue(source.date) || new Date();
      const day = Math.min(31, Math.max(1, Math.floor(Number(data.day || sourceDate.getDate() || 1))));
      const noteSuffix = normalizeText(data.noteSuffix);
      const [firstYear, firstMonthIndex] = firstMonth.split('-').map(Number);
      const copies = [];
      for (let index = 0; index < count; index += 1) {
        const monthDate = new Date(firstYear, firstMonthIndex - 1 + index, 1);
        const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
        const copy = {
          ...source,
          id: uid(),
          cloudId: '',
          syncStatus: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          date: dateInFinanceMonth(monthKey, day),
          note: [source.note, noteSuffix].filter(Boolean).join(' · ')
        };
        copies.push(copy);
      }
      getState().finance.push(...copies);
      getState().financeCloud = { ...(getState().financeCloud || {}), monthFilter: firstMonth };
      setFinanceCopyId('');
      if (cloudReady()) markFinanceCloudPending('copy-finance');
      touchState();
      saveState();
      form?.reset?.();
      render();
      let cloudCount = 0;
      if (cloudReady()) {
        for (const item of copies) {
          const saved = await cloudAddFinance(item);
          if (saved?.id) {
            item.cloudId = saved.id;
            item.syncStatus = '';
            cloudCount += 1;
          } else {
            item.syncStatus = 'pending_add';
          }
          await yieldToMainThread();
        }
        clearFinanceCloudPendingIfClean();
        touchState();
        saveState();
        requestRender();
      }
      showToast(cloudReady() ? `Vytvořeno kopií: ${copies.length}, cloud: ${cloudCount}` : `Vytvořeno kopií: ${copies.length}`);
    }

    function setFinanceEdit(id) {
      const item = (getState().finance || []).find((entry) => entry.id === id);
      if (!item) return;
      setFinanceEditId(id);
      setFinanceCopyId('');
      writeFinanceModuleTab('add');
      render();
      keepActiveSectionTabsCentered('smooth');
      const schedule = window.requestAnimationFrame || ((fn) => window.setTimeout(fn, 0));
      schedule(() => document.querySelector('[data-form="update-finance"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
    }

    function setFinanceAccountEdit(id) {
      const account = (getState().financeAccounts || []).find((entry) => entry.id === id);
      if (!account) return;
      setFinanceAccountEditId(id);
      writeFinanceModuleTab('accounts');
      render();
      keepActiveSectionTabsCentered('smooth');
      const schedule = window.requestAnimationFrame || ((fn) => window.setTimeout(fn, 0));
      schedule(() => document.querySelector('[data-form="update-finance-account"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
    }

    function queueFinanceCloudAdd(item) {
      if (!cloudReady() || !item) return;
      window.setTimeout(async () => {
        try {
          const saved = await cloudAddFinance(item);
          if (saved?.id) {
            item.cloudId = saved.id;
            item.syncStatus = '';
            clearFinanceCloudPendingIfClean();
            touchState();
            saveState();
            requestRender();
            showToast('Finance uloženy do cloudu');
            return;
          }
          item.syncStatus = 'pending_add';
          markFinanceCloudPending('add-finance-failed');
          persistStateSnapshot();
          requestRender();
          showToast('Finance zůstaly lokálně a čekají na cloud');
        } catch (error) {
          console.warn('Finance background cloud add failed', error);
          item.syncStatus = 'pending_add';
          markFinanceCloudPending('add-finance-failed');
          persistStateSnapshot();
          requestRender();
          showToast('Finance zůstaly lokálně a čekají na cloud');
        }
      }, 80);
    }

    async function addFinanceFromForm(data, form) {
      let type = data.type === 'income' ? 'income' : data.type === 'transfer' ? 'transfer' : 'expense';
      const accountId = normalizeText(data.accountId);
      const transferAccountId = normalizeText(data.transferAccountId);
      if (type === 'transfer' && (!accountId || !transferAccountId || accountId === transferAccountId)) {
        return showToast('U přesunu vyber dva různé účty');
      }
      const category = normalizeText(data.category) || (type === 'income' ? 'other_income' : 'other_expense');
      const item = {
        id: uid(),
        householdId: currentHouseholdId(),
        profileId: currentProfileId(),
        createdAt: new Date().toISOString(),
        type,
        title: normalizeText(data.title) || (type === 'transfer' ? 'Přesun' : financeCategoryLabel(category)),
        amount: decimalValue(data.amount),
        date: normalizeText(data.date) || todayISO(),
        category,
        accountId,
        transferAccountId: type === 'transfer' ? transferAccountId : '',
        templateId: normalizeText(form?.dataset?.templateId),
        paymentMethod: normalizeText(data.paymentMethod) || 'other',
        note: normalizeText(data.note)
      };
      if (!item.title || !Number(item.amount)) return showToast('Doplň název a částku');
      getState().finance.push(item);
      getState().financeCloud = { ...(getState().financeCloud || {}), monthFilter: String(item.date || todayISO()).slice(0, 7) };
      if (cloudReady()) markFinanceCloudPending('add-finance');
      touchState();
      saveState();
      form.reset();
      if (form?.dataset) delete form.dataset.templateId;
      render();
      if (cloudReady()) {
        item.syncStatus = 'pending_add';
        persistStateSnapshot();
        queueFinanceCloudAdd(item);
        showToast('Pohyb přidaný, cloud se doposílá na pozadí');
        return;
      }
      showToast('Finance uloženy lokálně');
    }

    function financeItemFromFormData(data, base = {}) {
      const type = data.type === 'income' ? 'income' : data.type === 'transfer' ? 'transfer' : 'expense';
      const accountId = normalizeText(data.accountId);
      const transferAccountId = normalizeText(data.transferAccountId);
      const category = normalizeText(data.category) || (type === 'income' ? 'other_income' : 'other_expense');
      return {
        ...base,
        householdId: base.householdId || currentHouseholdId(),
        profileId: base.profileId || currentProfileId(),
        updatedAt: new Date().toISOString(),
        type,
        title: normalizeText(data.title) || (type === 'transfer' ? 'Přesun' : financeCategoryLabel(category)),
        amount: decimalValue(data.amount),
        date: normalizeText(data.date) || todayISO(),
        category,
        accountId,
        transferAccountId: type === 'transfer' ? transferAccountId : '',
        templateId: normalizeText(base.templateId || data.templateId || ''),
        paymentMethod: normalizeText(data.paymentMethod) || 'other',
        note: normalizeText(data.note)
      };
    }

    async function updateFinanceFromForm(id, data, form) {
      const index = (getState().finance || []).findIndex((entry) => entry.id === id);
      if (index < 0) return showToast('Záznam se nepovedlo najít');
      const current = getState().finance[index];
      const next = financeItemFromFormData(data, current);
      if (next.type === 'transfer' && (!next.accountId || !next.transferAccountId || next.accountId === next.transferAccountId)) {
        return showToast('U přesunu vyber dva různé účty');
      }
      if (!next.title || !Number(next.amount)) return showToast('Doplň název a částku');
      getState().finance[index] = next;
      getState().financeCloud = { ...(getState().financeCloud || {}), monthFilter: String(next.date || todayISO()).slice(0, 7) };
      setFinanceEditId('');
      if (cloudReady() && next.cloudId) {
        next.syncStatus = 'pending_update';
        markFinanceCloudPending('update-finance');
      }
      touchState();
      saveState();
      form?.reset?.();
      render();
      if (cloudReady() && next.cloudId) {
        const ok = await cloudUpdateFinance(next);
        if (ok) {
          next.syncStatus = '';
          clearFinanceCloudPendingIfClean();
          touchState();
          saveState();
          requestRender();
          showToast('Pohyb upraven v cloudu');
        } else {
          next.syncStatus = 'pending_update';
          markFinanceCloudPending('update-finance-failed');
          persistStateSnapshot();
          requestRender();
          showToast('Pohyb upraven lokálně, čeká na cloud');
        }
        return;
      }
      if (cloudReady() && !next.cloudId) {
        const saved = await cloudAddFinance(next);
        if (saved?.id) {
          next.cloudId = saved.id;
          next.syncStatus = '';
          clearFinanceCloudPendingIfClean();
          touchState();
          saveState();
          requestRender();
          showToast('Pohyb uložen do cloudu');
          return;
        }
        next.syncStatus = 'pending_add';
        markFinanceCloudPending('update-finance-local');
        persistStateSnapshot();
        requestRender();
      }
      showToast(next.cloudId ? 'Pohyb upraven' : 'Pohyb upraven lokálně');
    }

    async function updateFinanceAccountFromForm(id, data, form) {
      const index = (getState().financeAccounts || []).findIndex((entry) => entry.id === id);
      if (index < 0) return showToast('Účet se nepovedlo najít');
      const current = getState().financeAccounts[index];
      const next = {
        ...current,
        updatedAt: new Date().toISOString(),
        name: normalizeText(data.name),
        accountType: normalizeText(data.accountType) || 'other',
        ownerLabel: normalizeText(data.ownerLabel),
        openingBalance: decimalValue(data.openingBalance) || 0,
        includeInTotal: data.includeInTotal !== 'no',
        note: normalizeText(data.note)
      };
      if (!next.name) return showToast('Doplň název účtu');
      getState().financeAccounts[index] = next;
      setFinanceAccountEditId('');
      touchState();
      saveState();
      form?.reset?.();
      render();
      showToast('Účet upraven');
      cloudUpdateFinanceAccount(next).catch((error) => console.warn('Cloud sync (úprava účtu) na pozadí selhal', error));
    }

    function persistFinanceLoans(toast = '') {
      touchState();
      saveState({ immediate: true });
      render();
      if (toast) showToast(toast);
      if (!cloudReady()) return Promise.resolve(true);
      return cloudSaveHouseholdUiSettings(false)
          .then((ok) => Boolean(ok))
          .catch((error) => {
            console.warn('Finance loans autosync failed', error);
            persistStateSnapshot();
            showToast('Půjčky jsou uložené lokálně, cloud se zkusí později');
            return false;
          });
    }

    function addFinanceLoanFromForm(data, form) {
      const loan = normalizeFinanceLoan(data);
      if (!loan.name || !(loan.currentBalance > 0) || !(loan.monthlyPayment > 0) || !(loan.remainingMonths > 0)) {
        return showToast('Doplň název, zůstatek, splátku a zbývající měsíce');
      }
      getState().financeLoans = normalizeFinanceLoans([...(getState().financeLoans || []), loan]);
      form?.reset?.();
      persistFinanceLoans('Půjčka přidaná');
    }

    function updateFinanceLoanFromForm(id, data, form) {
      const list = getFinanceLoans();
      const index = list.findIndex((loan) => loan.id === id);
      if (index < 0) return showToast('Půjčku se nepovedlo najít');
      const current = list[index];
      const next = normalizeFinanceLoan({
        ...current,
        ...data,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString()
      });
      if (!next.name || !(next.currentBalance > 0) || !(next.monthlyPayment > 0) || !(next.remainingMonths > 0)) {
        return showToast('Doplň název, zůstatek, splátku a zbývající měsíce');
      }
      list[index] = next;
      getState().financeLoans = normalizeFinanceLoans(list);
      financeLoanEditId = '';
      form?.reset?.();
      persistFinanceLoans('Půjčka upravená');
    }

    function setFinanceLoanEdit(id) {
      financeLoanEditId = financeLoanEditId === id ? '' : String(id || '');
      writeFinanceModuleTab('loans');
      render();
      keepActiveSectionTabsCentered('smooth');
      const schedule = window.requestAnimationFrame || ((fn) => window.setTimeout(fn, 0));
      schedule(() => document.querySelector('[data-form="update-finance-loan"], [data-form="add-finance-loan"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
    }

    function deleteFinanceLoan(id) {
      const loan = getFinanceLoans().find((item) => item.id === id);
      if (!loan) return;
      if (typeof window !== 'undefined' && !window.confirm(`Smazat půjčku „${loan.name}“?`)) return;
      getState().financeLoans = getFinanceLoans().filter((item) => item.id !== id);
      if (financeLoanEditId === id) financeLoanEditId = '';
      getState().financeRefinanceResult = null;
      const deleteSync = persistFinanceLoans();
      showUndoToast('Půjčka smazaná', async () => {
        if (!(getState().financeLoans || []).some((item) => item.id === loan.id)) {
          getState().financeLoans = normalizeFinanceLoans([...(getState().financeLoans || []), loan]);
        }
        touchState();
        saveState({ immediate: true });
        render();
        await Promise.resolve(deleteSync).catch(() => false);
        await persistFinanceLoans();
        showToast('Půjčka obnovená');
      });
    }

    function calculateFinanceRefinance(data, form) {
      const selectedIds = Array.isArray(data.loanIds) ? data.loanIds : data.loanIds ? [data.loanIds] : [];
      const selected = getFinanceLoans().filter((loan) => selectedIds.includes(loan.id));
      if (!selected.length) return showToast('Vyber aspoň jednu půjčku');
      const interestRate = decimalValue(data.interestRate);
      const months = Math.max(0, Math.round(Number(data.months || 0)) || 0);
      const setupFee = Math.max(0, decimalValue(data.setupFee));
      if (!(months > 0)) return showToast('Zadej novou délku v měsících');
      const projections = selected.map(financeLoanProjection);
      const currentMonthlyPayment = projections.reduce((sum, row) => sum + row.payment, 0);
      const currentTotalCost = projections.reduce((sum, row) => sum + row.remainingPayments, 0);
      const payoffFees = projections.reduce((sum, row) => sum + row.loan.earlyRepaymentFee, 0);
      const balance = projections.reduce((sum, row) => sum + row.loan.currentBalance, 0);
      const newPrincipal = balance + payoffFees + setupFee;
      const newMonthlyPayment = financeLoanMonthlyPayment(newPrincipal, interestRate, months);
      const newTotalCost = newMonthlyPayment * months;
      const savings = currentTotalCost - newTotalCost;
      const monthlySaving = currentMonthlyPayment - newMonthlyPayment;
      const breakEvenMonths = monthlySaving > 0 && (payoffFees + setupFee) > 0 ? Math.ceil((payoffFees + setupFee) / monthlySaving) : 0;
      getState().financeRefinanceResult = {
        createdAt: new Date().toISOString(),
        loanIds: selectedIds,
        interestRate,
        months,
        setupFee,
        payoffFees,
        balance,
        newPrincipal,
        currentMonthlyPayment,
        currentTotalCost,
        newMonthlyPayment,
        newTotalCost,
        savings,
        breakEvenMonths,
        note: normalizeText(data.note)
      };
      touchState();
      saveState();
      render();
      showToast(savings > 0 ? `Refinancování vychází o ${formatCurrency(savings)} lépe` : 'Refinancování podle zadaných parametrů nevychází lépe');
    }

    async function cloudSyncFinanceAccountById(id) {
      const account = getState().financeAccounts.find((entry) => entry.id === id);
      if (!account) return;
      const saved = await cloudAddFinanceAccount(account);
      if (!saved?.id) return;
      touchState();
      saveState();
      render();
      showToast('Účet odeslán do cloudu');
    }

    async function cloudSyncLocalFinanceAccounts() {
      const local = (getState().financeAccounts || []).filter((item) => !item.cloudId || item.syncStatus);
      if (!local.length) return showToast('Žádné lokální účty k odeslání');
      let count = 0;
      for (const account of local) {
        const ok = account.cloudId ? await cloudUpdateFinanceAccount(account) : await cloudAddFinanceAccount(account);
        if (ok?.id || ok === true) { account.syncStatus = ''; count += 1; }
      }
      touchState();
      saveState();
      render();
      showToast(`Odesláno finančních účtů: ${count}`);
    }

    async function cloudSyncFinanceById(id) {
      const item = getState().finance.find((entry) => entry.id === id);
      if (!item) return;
      const ok = item.cloudId ? await cloudUpdateFinance(item) : await cloudAddFinance(item);
      if (!ok?.id && ok !== true) return;
      item.syncStatus = '';
      clearFinanceCloudPendingIfClean();
      touchState();
      saveState();
      render();
      showToast('Záznam odeslán do cloudu');
    }

    async function cloudSyncLocalFinance() {
      const local = (getState().finance || []).filter((item) => !item.cloudId || item.syncStatus);
      if (!local.length) return showToast('Žádné lokální finance k odeslání');
      let count = 0;
      for (const item of local) {
        const ok = item.cloudId ? await cloudUpdateFinance(item) : await cloudAddFinance(item);
        if (ok?.id || ok === true) {
          item.syncStatus = '';
          count += 1;
        }
        await yieldToMainThread();
      }
      clearFinanceCloudPendingIfClean();
      touchState();
      saveState();
      render();
      showToast(`Odesláno finančních záznamů: ${count}`);
    }

    async function cloudSyncAllFinance() {
      await cloudSyncLocalFinanceAccounts();
      await cloudSyncLocalFinance();
    }

    async function deleteFinanceTransaction(id) {
      const item = getState().finance.find((entry) => entry.id === id);
      if (!item) return;
      getState().finance = getState().finance.filter((entry) => entry.id !== id);
      touchState();
      saveState();
      render();
      const deleteSync = cloudDeleteFinance(item).catch((error) => {
        console.warn('Cloud sync (smazání pohybu) na pozadí selhal', error);
        return false;
      });
      showUndoToast('Záznam smazán', async () => {
        if ((getState().finance || []).some((entry) => entry.id === item.id)) return;
        const restored = { ...item };
        getState().finance = [...(getState().finance || []), restored];
        touchState();
        saveState();
        render();
        const deletedInCloud = await deleteSync;
        if (deletedInCloud && item.cloudId) {
          restored.cloudId = '';
          restored.syncStatus = 'pending';
          markFinanceCloudPending('undo-delete');
          const saved = await cloudAddFinance(restored);
          if (!saved?.id) restored.syncStatus = 'pending';
        }
        clearFinanceCloudPendingIfClean();
        touchState();
        saveState();
        render();
        showToast('Záznam obnoven');
      });
    }

    async function deleteFinanceAccount(id) {
      const account = getState().financeAccounts.find((entry) => entry.id === id);
      if (!account) return;
      if ((getState().finance || []).some((item) => item.accountId === id || item.transferAccountId === id)) {
        showToast('Účet má pohyby. Nejdřív smaž nebo přesuň záznamy.');
        return;
      }
      getState().financeAccounts = getState().financeAccounts.filter((entry) => entry.id !== id);
      touchState();
      saveState();
      render();
      const deleteSync = cloudDeleteFinanceAccount(account).catch((error) => {
        console.warn('Cloud sync (smazání účtu) na pozadí selhal', error);
        return false;
      });
      showUndoToast('Účet smazán', async () => {
        if (!(getState().financeAccounts || []).some((entry) => entry.id === account.id)) {
          getState().financeAccounts = [...(getState().financeAccounts || []), account];
        }
        touchState();
        saveState();
        render();
        const archivedInCloud = await deleteSync;
        if (archivedInCloud && account.cloudId) {
          account.syncStatus = 'pending';
          const restored = await cloudUpdateFinanceAccount(account);
          if (restored === true) account.syncStatus = '';
        }
        touchState();
        saveState();
        render();
        showToast('Účet obnoven');
      });
    }

    return {
      // dashboard KPI / čtení
      financeMonthSummary,
      financeAccountBalances,
      financeCategoryBreakdown,
      financeAccountMonthSummary,
      financeSelectedMonth,
      financeMonthLabel,
      financeTypeFilter,
      financeCloudPendingCount,
      mergeFinanceTemplates,
      normalizeFinanceTemplates,
      mergeFinanceLoans,
      normalizeFinanceLoans,
      financeTemplateDefinitions,
      // render
      renderFinance,
      renderFinanceOverviewItem,
      // month / filter ovládání
      setFinanceMonth,
      shiftFinanceMonth,
      setFinanceTypeFilter,
      // šablony
      fillFinanceTemplate,
      editFinanceTemplate,
      deleteFinanceTemplate,
      addFinanceTemplateFromForm,
      updateFinanceTemplateFromForm,
      saveFinanceTemplateFromVisibleForm,
      // edit / copy
      setFinanceEdit,
      setFinanceAccountEdit,
      setFinanceCopy,
      copyFinanceToMonths,
      // formuláře
      addFinanceFromForm,
      updateFinanceFromForm,
      addFinanceAccountFromForm,
      updateFinanceAccountFromForm,
      addManagedFinanceSetFromForm,
      addFinanceLoanFromForm,
      updateFinanceLoanFromForm,
      setFinanceLoanEdit,
      deleteFinanceLoan,
      calculateFinanceRefinance,
      // cloud
      cloudLoadFinance,
      cloudSyncFinanceById,
      cloudSyncLocalFinance,
      cloudSyncFinanceAccountById,
      cloudSyncLocalFinanceAccounts,
      cloudSyncAllFinance,
      // mazání
      deleteFinanceTransaction,
      deleteFinanceAccount
    };
  }

  window.DomacnostFinance = { createFinance };
})();
