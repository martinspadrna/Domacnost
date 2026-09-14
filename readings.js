(function () {
  'use strict';

  function createReadings(deps) {
    const getState = deps.getState || (() => ({}));
    const ui = deps.ui || {};
    const state = new Proxy({}, {
      get: (_target, key) => getState()?.[key],
      set: (_target, key, value) => {
        const current = getState();
        if (current) current[key] = value;
        return true;
      }
    });
    const {
      READING_TYPE_OPTIONS,
      READING_UNIT_OPTIONS,
      READING_DETAIL_PERIOD_OPTIONS,
      addReadingEntryFromForm,
      cloudReady,
      escapeHtml,
      field,
      financeMonthLabel,
      formatDate,
      getModuleTab,
      isDetailsOpen,
      latestReadingForMeter,
      parseDateValue,
      readingBillingLabel,
      readingCostBalance,
      readingCostBalanceClass,
      readingCostValueLabel,
      readingCurrentMonthKey,
      readingDefaultGroup,
      readingDeltaForEntry,
      readingEntriesForRegister,
      readingEntryCost,
      readingEntryRegisterLabel,
      readingGroupOptions,
      readingLastKnownUnitPrice,
      readingLastMonthDisplay,
      readingMeterBillingLabel,
      readingMeterById,
      readingMeterGroup,
      readingMeterHasCompleteMonthEntry,
      readingMeterLatestDisplay,
      readingMeterRelationLabel,
      readingMeterStats,
      readingMeterUnitPrice,
      readingMoney,
      readingMonthlyUnit,
      readingMonthlyValue,
      readingMonthsLabel,
      readingParentMeterOptions,
      readingPricingLabel,
      readingRegisterInputKey,
      readingRegistersForMeter,
      readingsConsumptionRows,
      readingsEntries,
      readingsChartRows,
      readingsMeters,
      readingsMonthlyRows,
      readingTypeMeta,
      readingUnitPriceForEntry,
      readingValue,
      renderEmpty,
      renderReadingPriceFormBlock,
      renderReadingsCostSummary,
      renderReadingsMeterToolPage,
      renderSectionTabs,
      selectField,
      todayISO
    } = deps;

    function renderReadingMeterCard(meter, options = {}) {
      const context = options.context || 'overview';
      const showManage = context === 'meters';
      const meta = readingTypeMeta(meter.type);
      const stats = options.stats || readingMeterStats(meter, options.consumptionRows || null);
      const latest = stats.latest;
      const lastMonth = options.lastMonth || null;
      const deltaLabel = lastMonth
        ? readingLastMonthDisplay(lastMonth, meter)
        : (stats.delta === null ? 'první odečet' : `+${readingValue(Math.max(0, stats.delta), meter.unit)} od minula`);
      const isEditing = showManage && ui.readingsEditingMeterId === meter.id;
      const meterGroup = readingMeterGroup(meter);
      const relationLabel = readingMeterRelationLabel(meter);
      const billingLabel = readingMeterBillingLabel(meter);
      const balance = readingCostBalance(meter, lastMonth);
      const balanceClass = readingCostBalanceClass(balance.status);
      const depositLabel = balance.deposit !== '' ? `${readingMoney(balance.deposit)}/měs.${balance.depositSource === 'místo' ? ' · z místa' : ''}` : 'záloha nenastavená';
      return `
        <article class="reading-meter-card reading-meter-${escapeHtml(meta.className)} ${meter.archived ? 'muted-item' : ''} ${isEditing ? 'is-editing' : ''}">
          <div class="reading-meter-top">
            <span class="reading-meter-icon">${escapeHtml(meta.icon)}</span>
            <div><strong>${escapeHtml(meter.name)}</strong><em>${escapeHtml(meta.label)} · ${escapeHtml(meterGroup?.name || 'Domácnost')} · ${escapeHtml(relationLabel)} · období ${escapeHtml(billingLabel)}${meter.location ? ` · ${escapeHtml(meter.location)}` : ''}</em></div>
            <span class="badge ${latest ? 'good' : ''}">${latest ? escapeHtml(formatDate(latest.date)) : 'bez odečtu'}</span>
          </div>
          <div class="reading-meter-value"><strong>${escapeHtml(readingMeterLatestDisplay(meter))}</strong><span>${escapeHtml(deltaLabel)}</span></div>
          <div class="reading-meter-pricing"><span>${escapeHtml(readingPricingLabel(meter))}</span>${lastMonth ? `<strong>${lastMonth.hasCost ? `${readingMoney(lastMonth.cost)}/měs.` : 'bez ceny'}</strong>` : ''}</div>
          <div class="reading-meter-balance ${escapeHtml(balanceClass)}"><span>Platíš ${escapeHtml(depositLabel)}</span><strong>${escapeHtml(balance.label)}</strong></div>
          <div class="item-meta">${meter.serial ? `Číslo: ${escapeHtml(meter.serial)} · ` : ''}${stats.rows.length} odečtů${lastMonth ? ` · průměr ${readingMonthlyValue(lastMonth.value, meter.unit)}${lastMonth.hasSubmeters ? ` · čistě po odečtení ${readingMonthlyValue(lastMonth.submeterValue, meter.unit)}` : ''} · ${escapeHtml(lastMonth.periodLabel || financeMonthLabel(lastMonth.month))}` : ''}${meter.note ? ` · ${escapeHtml(meter.note)}` : ''}</div>
          ${showManage ? `<div class="item-actions"><button class="ghost-btn" type="button" data-action="toggle-reading-meter-edit" data-id="${escapeHtml(meter.id)}">${isEditing ? 'Zavřít úpravu' : 'Upravit'}</button><button class="ghost-btn" type="button" data-action="toggle-reading-meter" data-id="${escapeHtml(meter.id)}">${meter.archived ? 'Vrátit' : 'Archivovat'}</button><button class="danger-btn" type="button" data-action="delete-reading-meter" data-id="${escapeHtml(meter.id)}">Smazat</button></div>
          ${isEditing ? `<div class="action-details compact-edit-details readings-form-drawer reading-meter-edit-drawer open">
            <div class="details-like-head"><span>Upravit měřidlo</span><em>místo, vazba, ceny</em></div>
            <form data-form="update-reading-meter" data-id="${escapeHtml(meter.id)}" class="compact-form readings-form">
              <div class="form-grid two">
                ${selectField('Typ', 'type', READING_TYPE_OPTIONS, meter.type)}
                ${selectField('Místo / domácnost', 'groupId', readingGroupOptions(), meter.groupId || readingDefaultGroup().id)}
                ${selectField('Vazba na hlavní měřidlo', 'parentMeterId', readingParentMeterOptions(meter.type, meter.unit, meter.id), meter.parentMeterId || '')}
                ${field('Název', 'name', 'text', 'např. Elektroměr hlavní', true, meter.name)}
                ${selectField('Jednotka', 'unit', READING_UNIT_OPTIONS, meter.unit)}
                ${field('Měsíční záloha', 'monthlyDeposit', 'text', 'Kč/měsíc, volitelné', false, meter.monthlyDeposit ?? '', 'decimal')}
                ${field('Fakturační období od', 'billingFrom', 'date', '', false, meter.billingFrom || '')}
                ${field('Fakturační období do', 'billingTo', 'date', '', false, meter.billingTo || '')}
                ${field('Číslo měřidla', 'serial', 'text', 'volitelné', false, meter.serial)}
                ${field('Umístění', 'location', 'text', 'např. chodba / sklep', false, meter.location)}
                ${field('Poznámka', 'note', 'text', 'volitelné', false, meter.note)}
              </div>
              <div class="small-muted">Podružné měřidlo se odečítá z hlavního jen tehdy, když mají stejný typ a jednotku. Vlastní fakturační období se po prvním konci dál posouvá ročně.</div>
              ${renderReadingPriceFormBlock(meter)}
              <div class="form-actions"><button class="primary-btn" type="submit">Uložit změny</button></div>
            </form>
          </div>` : ''}` : ''}
        </article>`;
    }

    function renderReadingEntryItem(entry) {
      const meter = readingMeterById(entry.meterId);
      const meta = readingTypeMeta(meter?.type);
      const delta = readingDeltaForEntry(entry);
      const unitPrice = readingUnitPriceForEntry(entry, meter);
      const cost = delta !== null ? readingEntryCost(entry, meter, Math.max(0, delta), true) : null;
      const priceLabel = unitPrice !== '' ? ` · ${unitPrice.toLocaleString('cs-CZ', { maximumFractionDigits: 3 })} Kč/${meter?.unit || 'j.'}` : '';
      return `
        <div class="item compact-item reading-entry-item">
          <div class="item-top"><div class="item-title"><span>${escapeHtml(meta.icon)}</span> ${escapeHtml(meter?.name || 'Měřidlo')}</div><span class="badge">${readingValue(entry.value, meter?.unit || '')}</span></div>
          <div class="item-meta">${escapeHtml(formatDate(entry.date))}${readingEntryRegisterLabel(entry) ? ` · ${escapeHtml(readingEntryRegisterLabel(entry))}` : ''}${delta !== null ? ` · rozdíl ${readingValue(Math.max(0, delta), meter?.unit || '')}` : ' · první odečet'}${priceLabel}${cost !== null && cost > 0 ? ` · odhad ${readingMoney(cost)}` : ''}${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}</div>
          <div class="item-actions"><button class="danger-btn" type="button" data-action="delete-reading-entry" data-id="${escapeHtml(entry.id)}">Smazat</button></div>
        </div>`;
    }
    function readingsPeriodFilteredEntries(entries = [], period = ui.readingsDetailPeriod) {
      const value = String(period || '12');
      if (value === 'all') return entries;
      const months = Number(value || 12);
      if (!Number.isFinite(months) || months <= 0) return entries;
      const now = parseDateValue(todayISO()) || new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
      const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
      return entries.filter((entry) => String(entry.date || '') >= startKey);
    }

    function latestReadingForEntryInput(meterId, register = '') {
      const entries = register ? readingEntriesForRegister(meterId, register) : readingsEntries(meterId);
      return [...entries].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
    }

    function readingEntryValuePlaceholder(meter, register = '') {
      const latest = latestReadingForEntryInput(meter?.id, register);
      if (!latest || !Number.isFinite(Number(latest.value))) return register ? `aktuální stav ${register}` : 'aktuální stav';
      return `naposledy ${Number(latest.value).toLocaleString('cs-CZ', { maximumFractionDigits: 3 })} ${meter?.unit || ''}`.trim();
    }

    function readingEntryValueField(label, name, meter, register = '', required = false) {
      const inputId = `field-${name}-${Math.random().toString(36).slice(2, 7)}`;
      // Žádné min="" tady - nativní HTML5 validace by odeslání formuláře
      // zablokovala úplně, dřív než se stihne zeptat addReadingEntryFromForm()
      // svým vlastním potvrzovacím dialogem (window.confirm). Nižší stav je
      // typicky překlep, ale legitimně nastane i po výměně měřidla - tam musí
      // jít formulář vůbec odeslat, aby se potvrzení mohlo zobrazit.
      return `
        <div class="field">
          <label for="${inputId}">${escapeHtml(label)}</label>
          <input class="input" id="${inputId}" name="${escapeHtml(name)}" type="number" step="any" inputmode="decimal" placeholder="${escapeHtml(readingEntryValuePlaceholder(meter, register))}" value="" ${required ? 'required' : ''}>
        </div>
      `;
    }

    function renderReadingEntryForm(meters = [], selectedId = '', options = {}) {
      const showMeterSelect = options.showMeterSelect !== false;
      const meter = readingMeterById(selectedId) || meters[0] || null;
      if (!meter) return renderEmpty('Nejdřív přidej měřidlo.');
      const registers = readingRegistersForMeter(meter);
      const lastKnownPrice = readingLastKnownUnitPrice(meter.id, null, registers[0] || '') || readingMeterUnitPrice(meter, registers[0] || '');
      const unitPricePlaceholder = lastKnownPrice !== '' ? `prázdné = poslední ${lastKnownPrice.toLocaleString('cs-CZ', { maximumFractionDigits: 3 })} Kč/${meter.unit || 'j.'}` : 'volitelně, prázdné = poslední cena';
      const meterOptions = meters.map((item) => [item.id, `${readingTypeMeta(item.type).icon} ${item.name} · ${item.unit}`]);
      const stableValueFields = registers.length
        ? registers.map((register) => {
          const key = readingRegisterInputKey(register);
          return `${readingEntryValueField(`Stav ${register}`, `registerValue__${key}`, meter, register, false)}<input type="hidden" name="registerLabel__${key}" value="${escapeHtml(register)}">`;
        }).join('')
        : readingEntryValueField('Stav', 'value', meter, '', true);
      return `
        <form data-form="add-reading-entry" class="compact-form readings-form readings-entry-form">
          <div class="form-grid two">
            ${showMeterSelect ? selectField('Měřidlo', 'meterId', [['', 'Vyber měřidlo'], ...meterOptions], meter.id) : `<input type="hidden" name="meterId" value="${escapeHtml(meter.id)}">`}
            ${field('Datum', 'date', 'date', '', true, todayISO())}
            ${stableValueFields}
            ${field('Cena za jednotku pro tento odečet', 'unitPrice', 'text', unitPricePlaceholder, false, '', 'decimal')}
            <label><span>Foto odečtu</span><input type="file" name="photo" accept="image/*" capture="environment"><small>Fotka se zatím použije jen jako poznámka k odečtu. Automatické přečtení hodnoty bude potřeba doplnit přes OCR/backend.</small></label>
            ${field('Poznámka', 'note', 'text', 'např. samoodečet')}
          </div>
          <div class="form-actions"><button class="primary-btn" type="submit">Uložit odečet</button></div>
        </form>`;
    }

    function renderReadingsEntryPanel(meters = []) {
      if (!meters.length) return renderEmpty('Nejdřív přidej měřidlo v záložce Měřidla.');
      const monthKey = readingCurrentMonthKey();
      const dueMeters = meters.filter((meter) => !readingMeterHasCompleteMonthEntry(meter, monthKey));
      if (!ui.readingsEntryMeterId || !meters.some((meter) => meter.id === ui.readingsEntryMeterId)) ui.readingsEntryMeterId = dueMeters[0]?.id || meters[0].id;
      const selectedMeter = readingMeterById(ui.readingsEntryMeterId) || dueMeters[0] || meters[0];
      return `
        <div class="card-subheader readings-entry-head">
          <div><h3>Odečet za ${escapeHtml(financeMonthLabel(monthKey))}</h3><p>V základním seznamu jsou jen měřidla, která ještě nemají zadaný odečet pro aktuální měsíc.</p></div>
          <details class="action-details compact-edit-details readings-form-drawer readings-entry-manual" ${ui.readingsEntryDrawerOpen ? 'open' : ''}>
            <summary><span>Zadat odečet</span><em>vybrat libovolné měřidlo</em></summary>
            ${renderReadingEntryForm(meters, selectedMeter.id, { showMeterSelect: true })}
          </details>
        </div>
        ${dueMeters.length ? `<div class="readings-due-grid">${dueMeters.map((meter) => {
          const meta = readingTypeMeta(meter.type);
          const latest = latestReadingForMeter(meter.id);
          const selected = meter.id === selectedMeter.id && ui.readingsEntryDrawerOpen;
          return `<article class="reading-due-card ${selected ? 'active' : ''}">
            <div><strong>${escapeHtml(meta.icon)} ${escapeHtml(meter.name)}</strong><span>${latest ? `naposledy ${escapeHtml(formatDate(latest.date))} · ${escapeHtml(readingMeterLatestDisplay(meter))}` : 'zatím bez odečtu'}</span></div>
            <button class="primary-btn icon-btn" type="button" data-action="select-reading-entry-meter" data-id="${escapeHtml(meter.id)}" aria-label="Zadat odečet pro ${escapeHtml(meter.name)}">+</button>
            ${selected ? `<div class="reading-due-form">${renderReadingEntryForm(meters, meter.id, { showMeterSelect: false })}</div>` : ''}
          </article>`;
        }).join('')}</div>` : renderEmpty('Všechna aktivní měřidla už mají odečet pro aktuální měsíc. Další odečet zadáš nahoře přes „Zadat odečet“.')}
      `;
    }

    function renderReadingsChart(rows) {
      if (!rows.length) return renderEmpty('Graf se zobrazí po druhém odečtu na stejném měřidle.');
      const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
      return `<div class="readings-chart" role="list" aria-label="Graf průměrné měsíční spotřeby">
        ${rows.map((row) => {
          const meter = readingMeterById(row.meterId);
          const meta = readingTypeMeta(row.type);
          const width = Math.max(6, Math.min(100, Math.round((Number(row.value) || 0) / max * 100)));
          const interval = row.periodLabel ? `${row.periodLabel}${row.monthsSpan ? ` · ${readingMonthsLabel(row.monthsSpan)}` : ''}` : financeMonthLabel(row.month);
          const relationNote = row.hasSubmeters ? ` · celkem ${readingMonthlyValue(row.rawValue, row.unit)} minus podružné ${readingMonthlyValue(row.submeterValue, row.unit)}` : '';
          return `<div class="reading-chart-row" role="listitem">
            <div class="reading-chart-label"><strong>${escapeHtml(meta.icon)} ${escapeHtml(row.meterName || meter?.name || meta.label)}</strong><span>průměr za měsíc · ${escapeHtml(interval)}${row.registers?.length ? ` · ${escapeHtml(row.registers.join('+'))}` : ''}${escapeHtml(relationNote)}</span></div>
            <div class="reading-chart-track"><span style="width:${width}%"></span></div>
            <div class="reading-chart-values"><strong>${readingMonthlyValue(row.value, row.unit)}</strong>${row.hasCost ? `<span>${readingMoney(row.cost)}/měs.</span>` : '<span>bez ceny</span>'}</div>
          </div>`;
        }).join('')}
      </div>`;
    }


    function renderReadingsLineChart(rows = []) {
      if (!rows.length) return renderEmpty('Čárový graf se zobrazí po druhém odečtu na stejném měřidle.');
      const sorted = [...rows].sort((a, b) => String(a.month || '').localeCompare(String(b.month || '')) || String(a.meterName || '').localeCompare(String(b.meterName || ''), 'cs'));
      const months = Array.from(new Set(sorted.map((row) => row.month).filter(Boolean))).sort();
      if (!months.length) return renderEmpty('Graf zatím nemá měsíční data.');
      const seriesMap = new Map();
      sorted.forEach((row) => {
        const key = row.meterId || row.meterName || 'meter';
        const meter = readingMeterById(row.meterId);
        if (!seriesMap.has(key)) seriesMap.set(key, { key, label: row.meterName || meter?.name || readingTypeMeta(row.type).label, unit: row.unit || meter?.unit || '', values: new Map(), meta: new Map() });
        const item = seriesMap.get(key);
        item.values.set(row.month, Number(row.value) || 0);
        item.meta.set(row.month, row);
      });
      const series = Array.from(seriesMap.values()).slice(0, 6);
      const units = Array.from(new Set(series.map((item) => item.unit).filter(Boolean)));
      const unitLabel = units.length === 1 ? readingMonthlyUnit(units[0]) : (units.length ? 'různé jednotky/měs.' : 'jedn./měs.');
      const allValues = series.flatMap((item) => months.map((month) => Number(item.values.get(month)) || 0));
      const max = Math.max(...allValues, 1);
      const min = Math.min(...allValues, 0);
      const range = Math.max(1, max - min);
      const width = 640;
      const height = 220;
      const padX = 42;
      const padY = 28;
      const pointX = (index) => months.length === 1 ? width / 2 : padX + (index * (width - padX * 2) / (months.length - 1));
      const pointY = (value) => height - padY - ((Number(value) - min) / range * (height - padY * 2));
      const lines = series.map((item, index) => {
        const points = months.map((month, monthIndex) => `${pointX(monthIndex).toFixed(1)},${pointY(item.values.get(month) || 0).toFixed(1)}`).join(' ');
        const circles = months.map((month, monthIndex) => {
          const row = item.meta.get(month) || {};
          const interval = row.periodLabel ? `${row.periodLabel}${row.monthsSpan ? ` · ${readingMonthsLabel(row.monthsSpan)}` : ''}` : financeMonthLabel(month);
          return `<circle cx="${pointX(monthIndex).toFixed(1)}" cy="${pointY(item.values.get(month) || 0).toFixed(1)}" r="3.8"><title>${escapeHtml(item.label)} · ${escapeHtml(financeMonthLabel(month))}: ${escapeHtml(readingMonthlyValue(item.values.get(month) || 0, item.unit))} · ${escapeHtml(interval)}</title></circle>`;
        }).join('');
        return `<g class="readings-line-series readings-line-series-${index + 1}"><polyline points="${points}"/>${circles}</g>`;
      }).join('');
      const yLabels = `<span class="readings-line-unit">${escapeHtml(unitLabel)}</span><span>${escapeHtml(readingMonthlyValue(max, units[0] || ''))}</span><span>${escapeHtml(readingMonthlyValue(min, units[0] || ''))}</span>`;
      const xLabels = months.map((month, index) => `<span style="left:${months.length === 1 ? 50 : (index * 100 / (months.length - 1)).toFixed(2)}%">${escapeHtml(financeMonthLabel(month))}</span>`).join('');
      const legend = series.map((item, index) => `<span class="readings-line-legend-item readings-line-series-${index + 1}"><i></i>${escapeHtml(item.label)} <small>${escapeHtml(readingMonthlyUnit(item.unit))}</small></span>`).join('');
      return `<div class="readings-line-chart">
        <div class="readings-line-note">Graf ukazuje průměrnou měsíční spotřebu dopočítanou z období mezi dvěma odečty. Nejde o prostý rozdíl mezi odečty.</div>
        <div class="readings-line-ylabels">${yLabels}</div>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Čárový graf průměrné měsíční spotřeby">
          <line class="readings-line-axis" x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}"/>
          <line class="readings-line-axis" x1="${padX}" y1="${padY}" x2="${padX}" y2="${height - padY}"/>
          ${lines}
        </svg>
        <div class="readings-line-xlabels">${xLabels}</div>
        <div class="readings-line-legend">${legend}</div>
      </div>`;
    }


    function readingsPeriodFilteredRows(rows = [], period = ui.readingsDetailPeriod) {
      const value = String(period || '12');
      if (value === 'all') return rows;
      const months = Number(value || 12);
      if (!Number.isFinite(months) || months <= 0) return rows;
      const now = parseDateValue(todayISO()) || new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
      const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
      return rows.filter((row) => String(row.month || '') >= startKey);
    }

    function renderReadingDetailPanel(meters) {
      if (!meters.length) return renderEmpty('Detail se zobrazí po přidání prvního měřidla.');
      if (!ui.readingsDetailMeterId || !meters.some((meter) => meter.id === ui.readingsDetailMeterId)) ui.readingsDetailMeterId = meters[0].id;
      if (!READING_DETAIL_PERIOD_OPTIONS.some(([value]) => value === ui.readingsDetailPeriod)) ui.readingsDetailPeriod = '12';
      ui.readingsCompareMeterIds = Array.isArray(ui.readingsCompareMeterIds) ? ui.readingsCompareMeterIds.filter((id) => meters.some((meter) => meter.id === id)) : [];
      const selectedMeter = readingMeterById(ui.readingsDetailMeterId) || meters[0];
      const consumptionRows = readingsConsumptionRows();
      const selectedRows = readingsPeriodFilteredRows(consumptionRows.filter((row) => row.meterId === selectedMeter.id), ui.readingsDetailPeriod).reverse();
      const compareIds = Array.from(new Set([selectedMeter.id, ...ui.readingsCompareMeterIds]));
      const compareRows = readingsPeriodFilteredRows(consumptionRows.filter((row) => compareIds.includes(row.meterId)), ui.readingsDetailPeriod).reverse();
      const selectedEntries = readingsPeriodFilteredEntries(readingsEntries(selectedMeter.id), ui.readingsDetailPeriod).slice(0, 40);
      return `
        <div class="card-subheader readings-detail-controls">
          <div><h3>Detail měřidla</h3><p>Grafy ukazují průměrnou měsíční spotřebu z období mezi odečty, včetně jednotek a rozsahu.</p></div>
          <div class="readings-detail-filter-grid">
            <label for="readingsDetailMeterSelect"><span>Měřidlo</span><select id="readingsDetailMeterSelect" name="readingsDetailMeter" autocomplete="off" data-reading-detail-filter="meter">${meters.map((meter) => `<option value="${escapeHtml(meter.id)}" ${meter.id === selectedMeter.id ? 'selected' : ''}>${escapeHtml(readingTypeMeta(meter.type).icon)} ${escapeHtml(meter.name)}</option>`).join('')}</select></label>
            <label for="readingsDetailPeriodSelect"><span>Období</span><select id="readingsDetailPeriodSelect" name="readingsDetailPeriod" autocomplete="off" data-reading-detail-filter="period">${READING_DETAIL_PERIOD_OPTIONS.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === ui.readingsDetailPeriod ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>
          </div>
        </div>
        <div class="readings-detail-layout">
          <section class="soft-panel readings-detail-chart-panel">
            <div class="card-subheader"><div><h3>Průměrná měsíční spotřeba</h3><p>${escapeHtml(selectedMeter.name)} · ${escapeHtml(readingPricingLabel(selectedMeter))}</p></div></div>
            ${renderReadingsLineChart(selectedRows)}
          </section>
          <section class="soft-panel readings-compare-panel">
            <div class="card-subheader"><div><h3>Porovnání měřidel</h3><p>Zaškrtni další měřidla a porovnej průměrnou měsíční spotřebu v jednom grafu.</p></div></div>
            <div class="readings-compare-list">
              ${meters.map((meter) => `<label class="pill-check" for="readingsCompare__${escapeHtml(meter.id)}"><input id="readingsCompare__${escapeHtml(meter.id)}" type="checkbox" name="readingsCompareMeter" data-reading-detail-filter="compare" value="${escapeHtml(meter.id)}" ${ui.readingsCompareMeterIds.includes(meter.id) ? 'checked' : ''} ${meter.id === selectedMeter.id ? 'disabled' : ''}><span>${escapeHtml(readingTypeMeta(meter.type).icon)} ${escapeHtml(meter.name)}</span></label>`).join('')}
            </div>
            ${renderReadingsLineChart(compareRows)}
          </section>
        </div>
        <div class="list compact-list readings-history-list readings-detail-history">
          ${selectedEntries.length ? selectedEntries.map(renderReadingEntryItem).join('') : renderEmpty('Vybrané měřidlo v tomto období nemá odečty.')}
        </div>`;
    }

    function renderReadings() {
      let activeTab = getModuleTab('readings', 'overview');
      if (!['overview', 'entry', 'detail', 'meters', 'history'].includes(activeTab)) activeTab = 'overview';
      const meters = readingsMeters();
      const allMeters = activeTab === 'meters' ? readingsMeters(true) : readingsMeters(true);
      const entriesCount = Array.isArray(state.readings) ? state.readings.length : 0;
      const dueMetersCount = meters.filter((meter) => !readingMeterHasCompleteMonthEntry(meter)).length;
      const latestCount = meters.filter((meter) => latestReadingForMeter(meter.id)).length;
      const tabs = renderSectionTabs('readings', [
        { id: 'overview', label: 'Přehled', icon: '📊', count: latestCount },
        { id: 'entry', label: 'Odečet', icon: '➕', count: dueMetersCount },
        { id: 'detail', label: 'Detail', icon: '📉', count: meters.length },
        { id: 'meters', label: 'Měřidla', icon: '🧮', count: allMeters.length },
        { id: 'history', label: 'Historie', icon: '📈', count: entriesCount }
      ], 'overview');

      let content = '';
      if (activeTab === 'overview') {
        const consumptionRows = readingsConsumptionRows();
        const monthRows = readingsMonthlyRows(consumptionRows);
        const chartRows = readingsChartRows(12, consumptionRows);
        const meterStatsMap = new Map(meters.map((meter) => [meter.id, readingMeterStats(meter, consumptionRows)]));
        const lastMonthMap = new Map();
        consumptionRows.forEach((row) => { if (!lastMonthMap.has(row.meterId)) lastMonthMap.set(row.meterId, row); });
        // U větší domácnosti s víc měřidly (elektřina + plyn + voda dohromady)
        // býval tenhle přehled jedna dlouhá stránka se všemi kartami pod sebou.
        // Rozdělení podle typu měřidla + collapse na všechny kromě první skupiny
        // zkrátí výchozí pohled, ale nic neschová natrvalo (jde rozkliknout).
        const meterTypeGroups = READING_TYPE_OPTIONS
          .map(([type, label]) => ({ type, label, meta: readingTypeMeta(type), list: meters.filter((meter) => meter.type === type) }))
          .filter((group) => group.list.length);
        content = `
          <section class="card desktop-span-2 readings-panel panel-overview">
            <div class="card-header"><div><h2>Přehled měřidel</h2><p>Elektřina, plyn a voda v jednom přehledu. U dvoutarifní elektřiny se v souhrnu počítá T1 + T2 dohromady, detail tarifů zůstává vidět v textu.</p></div><span class="badge ${cloudReady() ? 'good' : ''}">${cloudReady() ? 'cloud domácnost' : 'lokálně'}</span></div>
            ${meters.length ? meterTypeGroups.map((group, index) => `
              <details class="compact-edit-details readings-type-group" data-details-key="readings-type-${group.type}" ${isDetailsOpen(`readings-type-${group.type}`, index === 0) ? 'open' : ''}>
                <summary><span>${escapeHtml(group.meta.icon)} ${escapeHtml(group.label)}</span><em>${group.list.length} měřidel</em></summary>
                <div class="readings-meter-grid">${group.list.map((meter) => renderReadingMeterCard(meter, { context: 'overview', stats: meterStatsMap.get(meter.id), lastMonth: lastMonthMap.get(meter.id), consumptionRows })).join('')}</div>
              </details>
            `).join('') : renderEmpty('Zatím žádné měřidlo. Přidání je v záložce Měřidla nahoře.')}
          </section>

          <section class="card readings-panel panel-overview">
            <details class="compact-edit-details readings-overview-collapse" data-details-key="readings-consumption-summary" ${isDetailsOpen('readings-consumption-summary', false) ? 'open' : ''}>
              <summary><span>📉 Spotřeba</span><em>průměr za měsíc mezi odečty</em></summary>
              <p class="small-muted">Průměrná měsíční spotřeba dopočítaná z období mezi odečty.</p>
              ${renderReadingsChart(chartRows)}
            </details>
          </section>

          <section class="card readings-panel panel-overview">
            <details class="compact-edit-details readings-overview-collapse" data-details-key="readings-cost-summary" ${isDetailsOpen('readings-cost-summary', false) ? 'open' : ''}>
              <summary><span>💰 Zálohy vs. odhad</span><em>záloha proti odhadu spotřeby v Kč</em></summary>
              <p class="small-muted">U každého měřidla porovnává poslední odhad měsíční spotřeby v Kč proti placené záloze.</p>
              ${renderReadingsCostSummary(consumptionRows)}
              <div class="card-subheader compact-subheader"><div><h3>Průměr a náklady po měsících</h3><p>Součet měsíčních průměrů podle typu měřidla včetně odhadu ceny.</p></div></div>
              ${monthRows.length ? `<div class="list compact-list">${monthRows.map((row) => `<div class="item compact-item"><div class="item-top"><div class="item-title">${escapeHtml(row.groupName || 'Domácnost')} · ${escapeHtml(readingTypeMeta(row.type).icon)} ${escapeHtml(readingTypeMeta(row.type).label)}</div><span class="badge">${readingMonthlyValue(row.value, row.unit)}</span></div><div class="item-meta">${escapeHtml(financeMonthLabel(row.month))}${row.periods?.length ? ` · ${escapeHtml(row.periods.slice(0, 2).join('; '))}` : ''} · odhad ${escapeHtml(readingCostValueLabel(row))} · období ${escapeHtml(readingBillingLabel(row.type, row.groupId))}</div></div>`).join('')}</div>` : renderEmpty('Jakmile budou aspoň dva odečty na jednom měřidle, zobrazí se tady průměrná měsíční spotřeba.')}
            </details>
          </section>`;
      } else if (activeTab === 'entry') {
        content = `
          <section class="card desktop-span-2 readings-panel panel-entry">
            <div class="card-header"><div><h2>Odečet</h2><p>Rychlé zadání aktuálního stavu. Hotová měřidla pro aktuální měsíc se schovají.</p></div><span class="badge">${dueMetersCount} čeká</span></div>
            ${renderReadingsEntryPanel(meters)}
          </section>`;
      } else if (activeTab === 'detail') {
        content = `
          <section class="card desktop-span-2 readings-panel panel-detail">
            <div class="card-header"><div><h2>Detail</h2><p>Graf spotřeby jednoho měřidla, období a porovnání více měřidel.</p></div></div>
            ${renderReadingDetailPanel(meters)}
          </section>`;
      } else if (activeTab === 'meters') {
        const priceFormBlock = ui.readingsMeterToolPage === 'add' ? renderReadingPriceFormBlock() : '';
        content = `
          <section class="card desktop-span-2 readings-panel panel-meters">
            <div class="card-header"><div><h2>Měřidla</h2><p>Elektroměr, plynoměr, vodoměr nebo více vodoměrů v bytě/domě.</p></div><span class="badge">${allMeters.length}</span></div>
            <div class="readings-meter-tools readings-meter-tool-tabs">
              <button class="readings-tool-card ${ui.readingsMeterToolPage === 'import' ? 'active' : ''}" type="button" data-action="set-reading-meter-tool" data-tool="import"><strong>Import</strong><span>z Domácí odečty</span></button>
              <button class="readings-tool-card ${ui.readingsMeterToolPage === 'add' ? 'active' : ''}" type="button" data-action="set-reading-meter-tool" data-tool="add"><strong>Přidat měřidlo</strong><span>elektřina, plyn, voda</span></button>
              <button class="readings-tool-card ${ui.readingsMeterToolPage === 'prices' ? 'active' : ''}" type="button" data-action="set-reading-meter-tool" data-tool="prices"><strong>Místa</strong><span>skupiny, ceny, zálohy</span></button>
            </div>
            ${renderReadingsMeterToolPage(ui.readingsMeterToolPage, priceFormBlock)}
            ${allMeters.length ? `<div class="readings-meter-grid">${allMeters.map((meter) => renderReadingMeterCard(meter, { context: 'meters' })).join('')}</div>` : renderEmpty('Zatím není přidané žádné měřidlo.')}
          </section>`;
      } else {
        const entries = readingsEntries();
        content = `
          <section class="card desktop-span-2 readings-panel panel-history">
            <div class="card-header"><div><h2>Historie odečtů</h2><p>Poslední zapsané stavy a rozdíl proti předchozímu odečtu.</p></div><span class="badge">${entries.length}</span></div>
            ${entries.length ? `<div class="list compact-list readings-history-list">${entries.slice(0, ui.readingsHistoryVisibleCount || 40).map(renderReadingEntryItem).join('')}</div>${entries.length > (ui.readingsHistoryVisibleCount || 40) ? `<div class="list-load-more"><button class="ghost-btn" type="button" data-action="show-more-history" data-history="readings">Zobrazit dalších ${Math.min(40, entries.length - (ui.readingsHistoryVisibleCount || 40))}</button><span>${ui.readingsHistoryVisibleCount || 40} z ${entries.length}</span></div>` : ''}` : renderEmpty('Historie je zatím prázdná.')}
          </section>`;
      }

      return `
        ${tabs}
        <div class="grid two module-tabbed readings-module readings-tab-${escapeHtml(activeTab)}" data-tab-area="readings">
          ${content}
        </div>`;
    }

    return { renderReadings };
  }

  window.DomacnostReadings = { createReadings };
})();
