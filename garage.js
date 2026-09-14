(function () {
  'use strict';

  function createGarage(deps) {
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
      SERVICE_PLAN_TYPE_OPTIONS,
      buildFuelConsumptionSeries,
      chartColumnLimit,
      computeServicePlanStatus,
      dateStatus,
      escapeHtml,
      field,
      filterGarageHistoryRecords,
      formatCostPerKm,
      formatCurrency,
      formatDate,
      formatFuelPricePerLiter,
      formatGarageChartValue,
      formatKm,
      formatLiters,
      formatLitreValue,
      fuelNumberField,
      fuelPricePerLiter,
      garageChartPointsFromConsumption,
      garageChartPointsFromFuelPrices,
      garageDistanceForMonth,
      garageDistanceForYear,
      garageEdgeLabels,
      garageFuelConsumptionForItem,
      garageHistoryRecords,
      garageHistoryYears,
      garageLinePoints,
      garageMonthlyDistancePoints,
      garageMonthlyFuelCostPoints,
      garagePresetBrands,
      garageRowsForVehicle,
      garageVehicleAnalytics,
      garageVehicleCostSummary,
      garageVehiclePickerMeta,
      garageVehicleTotalCostPerKm,
      getFuelioPreviewStats,
      getModuleTab,
      getServiceStatus,
      getVehicleCurrentOdometer,
      getVehicleServicePlan,
      getVehicleStats,
      isDetailsOpen,
      isVehicleOwned,
      localISODate,
      normalizeGarageRuntimeState,
      normalizeVehicleIconColor,
      normalizeVehicleIconShape,
      renderEmpty,
      renderEmptyCta,
      renderSectionTabs,
      resolveVehicleInsuranceContract,
      selectField,
      sortFuelRows,
      todayISO,
      vehicleIconColorClass,
      vehicleIconColorOptions,
      vehicleIconShapeEmoji,
      vehicleIconShapeOptions,
      vehicleInsuranceContractOptions,
      vehicleInsuranceUntilEffective,
      vehicleOwnedDistance,
      vehicleOwnershipLabel,
      vehicleOwnershipMonths,
      vehicleOwnershipStatus,
    } = deps;

    function renderGarage() {
      normalizeGarageRuntimeState();
      const vehicles = state.vehicles;
      if (!ui.garageVehicleId && vehicles.length) ui.garageVehicleId = vehicles[0].id;
      let activeVehicle = vehicles.find((vehicle) => vehicle.id === ui.garageVehicleId) || null;
      if (!activeVehicle && vehicles.length) {
        ui.garageVehicleId = vehicles[0].id;
        activeVehicle = vehicles[0];
      }
      const activeGarageTab = getModuleTab('garage', 'overview');
      const tabs = renderSectionTabs('garage', [
        { id: 'overview', label: 'Přehled', icon: '🚗', count: vehicles.length },
        { id: 'detail', label: 'Detail', icon: '🔧', count: activeVehicle ? 1 : 0 },
        { id: 'stats', label: 'Statistiky', icon: '📊' },
        { id: 'calculator', label: 'Kalkulačka', icon: '🧮' },
        { id: 'add', label: 'Přidat auto', icon: '➕' },
        { id: 'import', label: 'Fuelio', icon: '📥' }
      ], 'overview');

      let content = '';
      if (activeGarageTab === 'detail') {
        content = `
          <section class="card desktop-span-2 garage-panel panel-detail garage-fuelio-panel">
            ${activeVehicle ? renderVehicleDetail(activeVehicle) : renderEmptyCta({ icon: '🚗', title: 'Nejdřív přidej auto', text: 'Detail se naplní tankováním, servisy, termíny STK a pojištěním.', nav: 'garage', tab: 'add', label: 'Přidat auto' })}
          </section>`;
      } else if (activeGarageTab === 'stats') {
        content = `
          <section class="card desktop-span-2 garage-panel panel-stats garage-fuelio-panel">
            ${renderGarageStatsPanel(vehicles, activeVehicle)}
          </section>`;
      } else if (activeGarageTab === 'calculator') {
        content = `
          <section class="card desktop-span-2 garage-panel panel-calculator garage-fuelio-panel">
            ${renderGarageTripCalculator(vehicles, activeVehicle)}
          </section>`;
      } else if (activeGarageTab === 'add') {
        content = `
          <section class="card garage-panel panel-add">
            <div class="card-header"><div><h2>Přidat auto</h2><p>Základ vozidla, termíny STK a pojištění. Detail se pak řeší v záložce Detail.</p></div></div>
            <form data-form="add-vehicle">
              ${renderVehiclePresetTool()}
              <div class="form-grid two">
                ${field('Název auta', 'name', 'text', 'Elroq / Octavia', true)}
                ${field('SPZ', 'plate', 'text', 'volitelné')}
                ${field('Palivo', 'fuelType', 'text', 'benzín / nafta / elektro')}
                ${field('Aktuální km', 'odometer', 'number', '0')}
                ${field('Datum koupě', 'purchaseDate', 'date', '')}
                ${field('Cena při koupi', 'purchasePrice', 'number', 'volitelné')}
                ${field('Km při koupi', 'purchaseOdometer', 'number', 'volitelné')}
                ${selectField('Stav auta', 'ownershipStatus', [['owned', 'Vlastním'], ['sold', 'Nevlastním / prodané']], 'owned')}
                ${field('Datum prodeje', 'saleDate', 'date', '')}
                ${field('Cena při prodeji', 'salePrice', 'number', 'volitelné')}
                ${field('Km při prodeji', 'saleOdometer', 'number', 'volitelné')}
                ${field('STK do', 'technicalInspectionUntil', 'date', '')}
                ${field('Pojistka do', 'insuranceUntil', 'date', '')}
                ${selectField('Barva ikonky auta', 'iconColor', vehicleIconColorOptions(), 'blue')}
                ${selectField('Tvar ikonky auta', 'iconShape', vehicleIconShapeOptions(), 'car')}
              </div>
              ${renderVehicleTechnicalFields()}
              <div class="form-actions"><button class="primary-btn" type="submit">Přidat auto</button></div>
            </form>
          </section>`;
      } else if (activeGarageTab === 'import') {
        content = `
          <section class="card desktop-span-2 garage-panel panel-import">
            ${renderFuelioImport()}
          </section>`;
      } else {
        content = `
          <section class="card desktop-span-2 garage-panel panel-overview garage-fuelio-panel clean-garage-overview garage-overview-dashboard-card">
            ${renderGarageOverviewDashboard(vehicles, activeVehicle)}
          </section>`;
      }

      return `
        ${tabs}
        <div class="grid two module-tabbed garage-tab-${escapeHtml(activeGarageTab)}" data-tab-area="garage">
          ${content}
        </div>
      `;
    }
    function renderVehicleListItem(vehicle) {
      const fuelRows = state.fuel.filter((item) => item.vehicleId === vehicle.id);
      const serviceRows = state.services.filter((item) => item.vehicleId === vehicle.id);
      const stats = getVehicleStats(sortFuelRows(fuelRows), serviceRows);
      const costPerKm = stats.totalKm > 0 ? stats.fuelCost / stats.totalKm : null;
      return `
        <div class="item vehicle-list-item fuelio-vehicle-card ${vehicle.id === ui.garageVehicleId ? 'selected' : ''}">
          <button class="vehicle-main-action" type="button" data-action="select-vehicle" data-id="${vehicle.id}">
            <span class="vehicle-icon-bubble ${vehicleIconColorClass(vehicle.iconColor)}" aria-hidden="true">${vehicleIconShapeEmoji(vehicle.iconShape)}</span>
            <span class="vehicle-main-copy">
              <strong>${escapeHtml(vehicle.name)}</strong>
              <em>${escapeHtml([vehicle.brand, vehicle.model, vehicle.plate].filter(Boolean).join(' · ') || vehicle.fuelType || 'auto')}</em>
            </span>
          </button>
          <div class="fuelio-vehicle-stats">
            <span><strong>${stats.averageConsumption ? `${stats.averageConsumption.toFixed(1).replace('.', ',')}` : '—'}</strong><em>l/100</em></span>
            <span><strong>${costPerKm ? `${costPerKm.toFixed(2).replace('.', ',')}` : '—'}</strong><em>Kč/km</em></span>
            <span><strong>${fuelRows.length + serviceRows.length}</strong><em>záznamů</em></span>
          </div>
          <div class="item-actions vehicle-card-actions">
            <button class="ghost-btn icon-action-btn" type="button" data-action="select-vehicle" data-id="${vehicle.id}" data-garage-target="vehicle-settings" title="Nastavení auta" aria-label="Nastavení auta ${escapeHtml(vehicle.name)}">⚙️</button>
            ${vehicleOwnershipStatus(vehicle) === 'owned' ? `<button class="primary-btn icon-action-btn fuel-add-shortcut" type="button" data-action="select-vehicle" data-id="${vehicle.id}" data-garage-target="add-fuel" title="Přidat tankování" aria-label="Přidat tankování ${escapeHtml(vehicle.name)}">⛽+</button>` : ''}
            <button class="ghost-btn icon-action-btn" type="button" data-action="select-vehicle" data-id="${vehicle.id}" data-garage-target="add-service" title="Přidat servis" aria-label="Přidat servis ${escapeHtml(vehicle.name)}">🧾+</button>
          </div>
        </div>
      `;
    }
    function garagePresetSelectField(label, name, options, selected = '', disabled = false, extraAttrs = '') {
      const selectId = `field-${name}-${Math.random().toString(36).slice(2, 7)}`;
      return `
        <div class="field">
          <label for="${selectId}">${escapeHtml(label)}</label>
          <select class="select" id="${selectId}" name="${name}" ${disabled ? 'disabled' : ''} ${extraAttrs}>
            ${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}
          </select>
        </div>
      `;
    }
    function renderVehiclePresetTool() {
      const brandOptions = [['', 'Nejdřív vyber značku…'], ...garagePresetBrands().map((brand) => [brand, brand])];
      return `
        <details class="action-details compact-edit-details garage-preset-tool" ${ui.garagePresetToolOpen ? 'open' : ''}>
          <summary><span>Předvyplnit podle auta</span><em>značka → model → motorizace, vše abecedně</em></summary>
          <div class="form-grid three garage-preset-grid">
            ${garagePresetSelectField('Značka', 'vehiclePresetBrand', brandOptions, '', false, 'data-garage-preset-step="brand"')}
            ${garagePresetSelectField('Model', 'vehiclePresetModel', [['', 'Vyber značku…']], '', true, 'data-garage-preset-step="model"')}
            ${garagePresetSelectField('Motorizace', 'vehiclePresetId', [['', 'Vyber model…']], '', true, 'data-garage-preset-step="engine"')}
          </div>
          <div class="form-actions compact-actions"><button class="ghost-btn" type="button" data-action="garage-apply-vehicle-preset">Načíst údaje</button></div>
          <div class="inline-note compact-note">Nejde o online technický registr. Je to bezpečný lokální katalog bez scrapingu; přesné hodnoty je vždy lepší ověřit podle TP konkrétního auta.</div>
        </details>
      `;
    }
    function renderVehicleTechnicalFields(vehicle = {}) {
      return `
        <details class="action-details compact-edit-details garage-technical-fields" ${ui.garageTechnicalFieldsOpen ? 'open' : ''}>
          <summary><span>Technický list auta</span><em>údaje z TP / technického listu</em></summary>
          <div class="form-grid two">
            ${field('Značka', 'brand', 'text', 'Škoda', false, vehicle.brand || '')}
            ${field('Model', 'model', 'text', 'Octavia', false, vehicle.model || '')}
            ${field('Generace / verze', 'generation', 'text', 'III / RS / Scout', false, vehicle.generation || '')}
            ${field('Rok / výroba', 'productionYear', 'text', '2017 / 2013–2020', false, vehicle.productionYear || '')}
            ${field('Karoserie', 'bodyType', 'text', 'combi / hatchback / SUV', false, vehicle.bodyType || '')}
            ${field('VIN', 'vin', 'text', 'volitelné', false, vehicle.vin || '')}
            ${field('Motor', 'engineName', 'text', '1.6 TDI / 2.0 TSI / EV', false, vehicle.engineName || '')}
            ${field('Kód motoru', 'engineCode', 'text', 'např. CAYC', false, vehicle.engineCode || '')}
            ${field('Objem ccm', 'displacementCcm', 'number', '1598', false, vehicle.displacementCcm || '')}
            ${field('Výkon kW', 'powerKw', 'number', '77', false, vehicle.powerKw || '')}
            ${field('Výkon hp', 'powerHp', 'number', '105', false, vehicle.powerHp || '')}
            ${field('Točivý moment Nm', 'torqueNm', 'number', '250', false, vehicle.torqueNm || '')}
            ${field('Válce', 'cylinders', 'number', '4', false, vehicle.cylinders || '')}
            ${field('Převodovka', 'transmission', 'text', 'manuál / DSG / automat', false, vehicle.transmission || '')}
            ${field('Pohon', 'drive', 'text', 'přední / zadní / 4x4', false, vehicle.drive || '')}
            ${field('Emisní norma', 'emissionNorm', 'text', 'Euro 6 / EV', false, vehicle.emissionNorm || '')}
            ${field('CO₂ g/km', 'co2', 'number', 'volitelné', false, vehicle.co2 || '')}
            ${field('Pohotovostní hmotnost kg', 'curbWeightKg', 'number', 'volitelné', false, vehicle.curbWeightKg || '')}
            ${field('Celková hmotnost kg', 'grossWeightKg', 'number', 'volitelné', false, vehicle.grossWeightKg || '')}
            ${field('Počet míst', 'seats', 'number', '5', false, vehicle.seats || '')}
            ${field('Počet dveří', 'doors', 'number', '5', false, vehicle.doors || '')}
            ${field('Nádrž l', 'fuelTankLiters', 'number', '50', false, vehicle.fuelTankLiters || '')}
            ${field('Baterie kWh', 'batteryKwh', 'number', '82', false, vehicle.batteryKwh || '')}
            ${field('Oficiální spotřeba', 'officialConsumption', 'text', '4,8 l/100 km / 16 kWh/100 km', false, vehicle.officialConsumption || '')}
            ${field('Pneu', 'tireSize', 'text', '205/55 R16', false, vehicle.tireSize || '')}
            ${field('Brzděný přívěs kg', 'towingBrakedKg', 'number', 'volitelné', false, vehicle.towingBrakedKg || '')}
            ${field('Nebrzděný přívěs kg', 'towingUnbrakedKg', 'number', 'volitelné', false, vehicle.towingUnbrakedKg || '')}
            ${field('Délka mm', 'lengthMm', 'number', 'volitelné', false, vehicle.lengthMm || '')}
            ${field('Šířka mm', 'widthMm', 'number', 'volitelné', false, vehicle.widthMm || '')}
            ${field('Výška mm', 'heightMm', 'number', 'volitelné', false, vehicle.heightMm || '')}
            ${field('Rozvor mm', 'wheelbaseMm', 'number', 'volitelné', false, vehicle.wheelbaseMm || '')}
          </div>
        </details>
      `;
    }
    function renderGarageLineChart(title, subtitle, values = [], emptyText = 'Zatím není dost dat.', metrics = [], edgeLabels = null) {
      const pointRows = values.map((entry) => (typeof entry === 'object' && entry !== null ? entry : { value: entry, label: '' }))
        .map((entry) => ({ ...entry, value: Number(entry.value || 0) }))
        .filter((entry) => Number.isFinite(entry.value) && entry.value > 0);
      const validValues = pointRows.map((entry) => entry.value);
      const metricRows = Array.isArray(metrics) && metrics.length ? metrics : [];
      const header = `<div class="garage-chart-header-full"><strong>${escapeHtml(title)}</strong><em>${escapeHtml(subtitle)}</em></div>`;
      if (validValues.length < 2) {
        return `<article class="garage-chart-card">${header}<div class="garage-chart-body garage-chart-body-empty"><div class="garage-chart-values">${metricRows.map((row) => `<span><em>${escapeHtml(row.label)}</em><strong>${escapeHtml(row.value)}</strong></span>`).join('')}</div><div class="empty small-empty">${escapeHtml(emptyText)}</div></div></article>`;
      }
      const points = garageLinePoints(validValues);
      const average = validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
      const min = Math.min(...validValues);
      const max = Math.max(...validValues);
      const span = Math.max(1, max - min);
      const avgY = 90 - 12 - (((average - min) / span) * (90 - 24));
      const defaultRows = [
        { label: 'Průměr', value: formatGarageChartValue(average) },
        { label: 'Poslední', value: formatGarageChartValue(validValues[validValues.length - 1]) }
      ];
      const resolvedMetrics = metricRows.length ? metricRows : defaultRows;
      const labels = edgeLabels || garageEdgeLabels(pointRows);
      return `
        <article class="garage-chart-card">
          ${header}
          <div class="garage-chart-body">
            <div class="garage-chart-values">
              ${resolvedMetrics.map((row) => `<span><em>${escapeHtml(row.label)}</em><strong>${escapeHtml(row.value)}</strong></span>`).join('')}
            </div>
            <div class="garage-chart-plot">
              <svg class="garage-line-chart" viewBox="0 0 300 90" role="img" aria-label="${escapeHtml(title)}">
                <line class="garage-line-average" x1="12" x2="288" y1="${avgY.toFixed(1)}" y2="${avgY.toFixed(1)}"></line>
                <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
                ${points.split(' ').map((point) => `<circle cx="${point.split(',')[0]}" cy="${point.split(',')[1]}" r="3.5" fill="currentColor"></circle>`).join('')}
              </svg>
              ${labels ? `<div class="garage-chart-axis-labels"><span>${escapeHtml(labels.first)}</span><span>${escapeHtml(labels.last)}</span></div>` : ''}
            </div>
          </div>
        </article>
      `;
    }
    function garageDecimalInputValue(value) {
      const number = Number(value || 0);
      if (!Number.isFinite(number) || number <= 0) return '';
      return String(Number(number.toFixed(2))).replace('.', ',');
    }
    function garageTripDecimalField(label, name, placeholder, value, required = true) {
      return `<label class="field"><span>${escapeHtml(label)}</span><input class="input" type="text" inputmode="decimal" autocomplete="off" name="${escapeHtml(name)}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(garageDecimalInputValue(value))}" ${required ? 'required' : ''}></label>`;
    }
    function renderGarageVehiclePicker(vehicles = [], activeVehicle = null) {
      const activeRows = activeVehicle ? garageRowsForVehicle(activeVehicle.id) : { fuelRows: [], serviceRows: [] };
      const activeKm = activeVehicle ? getVehicleCurrentOdometer(activeVehicle, activeRows.fuelRows, activeRows.serviceRows) : 0;
      const activeMeta = activeVehicle ? garageVehiclePickerMeta(activeVehicle, activeRows) : '';
      const activeIsOwned = activeVehicle ? vehicleOwnershipStatus(activeVehicle) === 'owned' : true;
      return `
        <section class="garage-active-vehicle-selector garage-active-vehicle-selector-clean">
          <details class="garage-vehicle-dropdown">
            <summary>
              <span class="garage-vehicle-summary-main"><span class="vehicle-icon-bubble ${vehicleIconColorClass(activeVehicle?.iconColor)}" aria-hidden="true">${vehicleIconShapeEmoji(activeVehicle?.iconShape)}</span><strong>${escapeHtml(activeVehicle?.name || 'Vyber auto')}</strong>${activeMeta ? `<em>${escapeHtml(activeMeta)}</em>` : ''}</span>
              <span class="garage-vehicle-summary-side">${activeIsOwned ? `<span class="garage-vehicle-summary-km">${escapeHtml(formatKm(activeKm))}</span>` : ''}<span class="garage-vehicle-dropdown-arrow" aria-hidden="true">⌄</span></span>
            </summary>
            <div class="garage-vehicle-dropdown-list">
              ${vehicles.map((vehicle) => {
                const rows = garageRowsForVehicle(vehicle.id);
                const km = getVehicleCurrentOdometer(vehicle, rows.fuelRows, rows.serviceRows);
                const isOwned = vehicleOwnershipStatus(vehicle) === 'owned';
                const meta = garageVehiclePickerMeta(vehicle, rows);
                return `<div class="garage-vehicle-option-row ${vehicle.id === activeVehicle?.id ? 'active' : ''} ${!isOwned ? 'garage-vehicle-option-archived' : ''}">
                  <button class="garage-vehicle-option-main" type="button" data-action="garage-select-overview-vehicle" data-id="${escapeHtml(vehicle.id)}">
                    <span class="vehicle-icon-bubble ${vehicleIconColorClass(vehicle.iconColor)}" aria-hidden="true">${vehicleIconShapeEmoji(vehicle.iconShape)}</span>
                    <span class="garage-vehicle-option-copy"><strong>${escapeHtml(vehicle.name || 'Auto')}</strong><em>${escapeHtml(meta)}</em></span>
                    ${isOwned ? `<b>${escapeHtml(formatKm(km))}</b>` : ''}
                  </button>
                  ${isOwned ? `<button class="primary-btn icon-action-btn fuel-add-shortcut" type="button" data-action="select-vehicle" data-id="${escapeHtml(vehicle.id)}" data-garage-target="add-fuel" title="Přidat tankování" aria-label="Přidat tankování ${escapeHtml(vehicle.name || 'auta')}">⛽+</button>` : ''}
                </div>`;
              }).join('')}
            </div>
          </details>
        </section>
      `;
    }
    function renderGarageFuelPanel(vehicle) {
      const analytics = garageVehicleAnalytics(vehicle);
      const priceChartPoints = garageChartPointsFromFuelPrices(analytics.fuelRows, chartColumnLimit(14));
      const consumptionChartPoints = garageChartPointsFromConsumption(analytics.entries, chartColumnLimit(14));
      const monthlyFuelCostPoints = garageMonthlyFuelCostPoints(analytics.fuelRows).slice(-chartColumnLimit(12));
      const monthlyDistancePoints = garageMonthlyDistancePoints(analytics.entries).slice(-chartColumnLimit(12));
      const priceChartValues = priceChartPoints.map((item) => item.value);
      const consumptionChartValues = consumptionChartPoints.map((item) => item.value);
      const monthlyChartValues = monthlyFuelCostPoints.map((item) => item.value);
      const monthlyDistanceValues = monthlyDistancePoints.map((item) => item.value);
      const avgPrice = priceChartValues.length ? priceChartValues.reduce((sum, value) => sum + value, 0) / priceChartValues.length : null;
      const avgConsumption = consumptionChartValues.length ? consumptionChartValues.reduce((sum, value) => sum + value, 0) / consumptionChartValues.length : null;
      const avgMonthlyFuel = monthlyChartValues.length ? monthlyChartValues.reduce((sum, value) => sum + value, 0) / monthlyChartValues.length : null;
      const currentMonthDistance = garageDistanceForMonth(analytics.entries);
      const currentYearDistance = garageDistanceForYear(analytics.entries);
      return `
        <section class="garage-dashboard-panel garage-fuel-dashboard-panel">
          <div class="card-header compact-card-header"><div><h2>Palivo</h2><p>${escapeHtml(vehicle.name)} · přehled podle tankování a kilometrů</p></div></div>
          <div class="detail-stack compact-detail-stack garage-fuel-lines">
            <div class="stat-line"><span>Aktuální spotřeba</span><strong>${analytics.currentConsumption !== null ? formatLitreValue(analytics.currentConsumption) : 'čeká na další tankování'}</strong></div>
            <div class="stat-line"><span>Dlouhodobý průměr</span><strong>${analytics.longTermConsumption !== null ? formatLitreValue(analytics.longTermConsumption) : 'čeká na další tankování'}</strong></div>
            <div class="stat-line"><span>Poslední cena l/Kč</span><strong>${analytics.latestPricePerLiter ? escapeHtml(formatFuelPricePerLiter(analytics.latestPricePerLiter)) : '—'}</strong></div>
          </div>
          <div class="garage-chart-carousel" data-no-swipe aria-label="Grafy paliva">
            ${renderGarageLineChart('Cena tankování', 'Kč/litr podle posledních tankování', priceChartPoints, 'Přidej aspoň dvě tankování s cenou za litr.', [
              { label: 'Průměr', value: avgPrice ? formatFuelPricePerLiter(avgPrice) : '—' },
              { label: 'Poslední', value: analytics.latestPricePerLiter ? formatFuelPricePerLiter(analytics.latestPricePerLiter) : '—' },
              { label: 'Nejvyšší', value: priceChartValues.length ? formatFuelPricePerLiter(Math.max(...priceChartValues)) : '—' }
            ])}
            ${renderGarageLineChart('Spotřeba', 'l/100 km podle tankování', consumptionChartPoints, 'Přidej aspoň dvě tankování s km a litry.', [
              { label: 'Průměr', value: avgConsumption ? formatLitreValue(avgConsumption) : '—' },
              { label: 'Poslední', value: formatLitreValue(analytics.latestConsumption) },
              { label: 'Nejlepší', value: formatLitreValue(analytics.bestConsumption) }
            ])}
            ${renderGarageLineChart('Měsíční provoz', 'měsíční náklad na palivo', monthlyFuelCostPoints, 'Zatím není dost měsíců s tankováním.', [
              { label: 'Průměr', value: avgMonthlyFuel ? formatCurrency(avgMonthlyFuel) : '—' },
              { label: 'Poslední', value: monthlyChartValues.length ? formatCurrency(monthlyChartValues[monthlyChartValues.length - 1]) : '—' },
              { label: 'Celkem', value: formatCurrency(monthlyChartValues.reduce((sum, value) => sum + value, 0)) }
            ])}
            ${renderGarageLineChart('Kilometry', 'měsíčně ujeté km', monthlyDistancePoints, 'Zatím není dost kilometrů mezi tankováními.', [
              { label: 'Měsíční', value: formatKm(currentMonthDistance) },
              { label: 'Roční', value: formatKm(currentYearDistance) },
              { label: 'Průměr / měsíc', value: formatKm(analytics.averageMonthDistance) },
              { label: 'Průměr / rok', value: formatKm(analytics.averageYearDistance) }
            ])}
          </div>
        </section>
      `;
    }
    function renderGarageTripCalculator(vehicles = [], activeVehicle = null) {
      if (!vehicles.length) return renderEmptyCta({ icon: '🧮', title: 'Kalkulačka čeká na auto', text: 'Přidej první auto a kalkulačka si vezme jeho průměrnou spotřebu i poslední cenu paliva.', nav: 'garage', tab: 'add', label: 'Přidat auto' });
      if (!ui.garageCalcVehicleId || !vehicles.some((item) => item.id === ui.garageCalcVehicleId)) ui.garageCalcVehicleId = activeVehicle?.id || ui.garageVehicleId || vehicles[0].id;
      const selectedVehicle = vehicles.find((item) => item.id === ui.garageCalcVehicleId) || activeVehicle || vehicles[0];
      const analytics = garageVehicleAnalytics(selectedVehicle);
      const defaultConsumption = Number(analytics.averageConsumption || analytics.latestConsumption || 0);
      const defaultFuelPrice = Number(analytics.latestPricePerLiter || 0);
      const hasManualResult = ui.garageTripCalcResult?.vehicleId === selectedVehicle.id;
      const consumption = hasManualResult ? Number(ui.garageTripCalcResult.consumption || 0) : defaultConsumption;
      const fuelPrice = hasManualResult ? Number(ui.garageTripCalcResult.fuelPrice || 0) : defaultFuelPrice;
      const distance = hasManualResult ? Number(ui.garageTripCalcResult.distance || 0) : 0;
      const total = hasManualResult ? ui.garageTripCalcResult.total : null;
      const liters = hasManualResult ? ui.garageTripCalcResult.liters : null;
      const calcCostSummary = garageVehicleCostSummary(selectedVehicle, analytics);
      const runningPerKm = Number(calcCostSummary.runningPerKm || 0);
      const fullRunningTripTotal = hasManualResult && distance > 0 && runningPerKm > 0 ? distance * runningPerKm : null;
      return `
        <div class="card-header">
          <div><h2>Kalkulačka cesty</h2><p>Vybereš auto, spotřeba a poslední cena paliva se načtou automaticky podle auta. Oboje jde ručně přepsat.</p></div>
          <span class="badge">${escapeHtml(selectedVehicle.name || 'Auto')}</span>
        </div>
        <form data-form="garage-trip-calc" class="compact-form garage-trip-calc-form">
          <div class="form-grid two">
            <label class="field"><span>Auto</span><select class="select" name="vehicleId" data-garage-calc-vehicle>${vehicles.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedVehicle.id ? 'selected' : ''}>${escapeHtml(item.name || 'Auto')}</option>`).join('')}</select></label>
            ${garageTripDecimalField('Kolik pojedu km', 'distance', 'např. 120', distance)}
            ${garageTripDecimalField('Průměrná spotřeba l/100 km', 'consumption', 'editovatelné', consumption)}
            ${garageTripDecimalField('Cena paliva Kč/l', 'fuelPrice', 'editovatelné', fuelPrice)}
          </div>
          <div class="form-actions"><button class="primary-btn" type="submit">Spočítat cestu</button></div>
        </form>
        <div class="kpi-row compact garage-trip-result">
          <div class="kpi"><strong>${total ? formatCurrency(total) : '—'}</strong><span>jen palivo</span></div>
          <div class="kpi"><strong>${fullRunningTripTotal !== null ? formatCurrency(fullRunningTripTotal) : '—'}</strong><span>palivo + servis bez koupě</span></div>
          <div class="kpi"><strong>${liters ? formatLiters(liters) : '—'}</strong><span>spotřebuješ</span></div>
          <div class="kpi"><strong>${fuelPrice ? formatFuelPricePerLiter(fuelPrice) : '—'}</strong><span>poslední cena paliva</span></div>
          <div class="kpi"><strong>${consumption ? formatLitreValue(consumption) : '—'}</strong><span>celková průměrná spotřeba</span></div>
        </div>
        <div class="inline-note compact-note">Po změně auta se hodnoty přepíšou podle vybraného auta. Cena „palivo + servis bez koupě“ používá celkový provozní průměr auta bez pořizovací ceny.</div>
      `;
    }
    function renderGarageOverviewDashboard(vehicles = [], activeVehicle = null) {
      if (!vehicles.length || !activeVehicle) return renderEmptyCta({ icon: '🚗', title: 'Garáž je prázdná', text: 'Přidej první auto, potom půjdou řešit tankování, servis, STK a pojistka.', nav: 'garage', tab: 'add', label: 'Přidat auto' });
      return `${renderGarageVehiclePicker(vehicles, activeVehicle)}${renderGarageFuelPanel(activeVehicle)}`;
    }
    function renderGarageStatsPanel(vehicles = [], activeVehicle = null) {
      if (!vehicles.length) return renderEmptyCta({ icon: '📊', title: 'Statistiky zatím nejsou', text: 'Nejdřív přidej auto a pár tankování.', nav: 'garage', tab: 'add', label: 'Přidat auto' });
      if (!ui.garageStatsVehicleId || !vehicles.some((vehicle) => vehicle.id === ui.garageStatsVehicleId)) ui.garageStatsVehicleId = activeVehicle?.id || ui.garageVehicleId || vehicles[0].id;
      const selectedVehicle = vehicles.find((vehicle) => vehicle.id === ui.garageStatsVehicleId) || activeVehicle || vehicles[0];
      const analytics = garageVehicleAnalytics(selectedVehicle);
      const costSummary = garageVehicleCostSummary(selectedVehicle, analytics);
      return `
        <div class="card-header">
          <div><h2>Statistiky</h2><p>${escapeHtml(selectedVehicle.name)} · tankování, náklady a vzdálenost zvlášť.</p></div>
          <span class="badge">${escapeHtml(formatKm(analytics.currentKm))}</span>
        </div>
        <div class="garage-stats-filters garage-stats-single-filter">
          <label class="compact-select-field"><span>Auto</span><select class="select" data-garage-stats-filter="vehicle">${vehicles.map((vehicle) => `<option value="${escapeHtml(vehicle.id)}" ${vehicle.id === selectedVehicle.id ? 'selected' : ''}>${escapeHtml(vehicle.name)}</option>`).join('')}</select></label>
        </div>
        <section class="garage-stat-block garage-stat-fuel">
          <div class="garage-stat-block-head"><h3>Statistiky / Tankování</h3><p>Jen palivo, tankování a spotřeba podle kilometrů.</p></div>
          <div class="kpi-row compact garage-stats-kpis">
            <div class="kpi"><strong>${analytics.fuelCountTotal}</strong><span>tankování celkem</span></div>
            <div class="kpi"><strong>${analytics.fuelCountThisMonth}</strong><span>tento měsíc</span></div>
            <div class="kpi"><strong>${analytics.fuelCountPrevYear}</strong><span>minulý rok</span></div>
            <div class="kpi"><strong>${formatLiters(analytics.litersTotal)}</strong><span>palivo celkem</span></div>
            <div class="kpi"><strong>${formatLiters(analytics.litersThisMonth)}</strong><span>palivo tento měsíc</span></div>
            <div class="kpi"><strong>${formatLiters(analytics.litersPrevYear)}</strong><span>palivo minulý rok</span></div>
            <div class="kpi"><strong>${formatLitreValue(analytics.bestConsumption)}</strong><span>nejlepší spotřeba</span></div>
            <div class="kpi"><strong>${formatLitreValue(analytics.worstConsumption)}</strong><span>nejhorší spotřeba</span></div>
          </div>
        </section>
        <section class="garage-stat-block garage-stat-costs">
          <div class="garage-stat-block-head"><h3>Statistiky / Náklady</h3><p>Servisy, pojistky, STK, pneu a ostatní výdaje mimo palivo.</p></div>
          <div class="kpi-row compact garage-stats-kpis">
            <div class="kpi"><strong>${analytics.serviceCountTotal}</strong><span>nákladů celkem</span></div>
            <div class="kpi"><strong>${formatCurrency(analytics.serviceCostTotal)}</strong><span>náklady celkem</span></div>
            <div class="kpi"><strong>${formatCurrency(analytics.serviceCostThisMonth)}</strong><span>tento měsíc</span></div>
            <div class="kpi"><strong>${formatCurrency(analytics.serviceCostPrevYear)}</strong><span>minulý rok</span></div>
            <div class="kpi"><strong>${formatCostPerKm(analytics.totalDistance ? analytics.serviceCostTotal / analytics.totalDistance : null)}</strong><span>servis / km</span></div>
          </div>
        </section>
        <section class="garage-stat-block garage-stat-running-costs">
          <div class="garage-stat-block-head"><h3>Statistiky / Kč za kilometr</h3><p>Palivo zvlášť, běžný provoz bez koupě a pak vše včetně koupě a případného prodeje.</p></div>
          <div class="kpi-row compact garage-stats-kpis">
            <div class="kpi"><strong>${formatCostPerKm(costSummary.fuelPerKm)}</strong><span>jen palivo</span></div>
            <div class="kpi"><strong>${formatCostPerKm(costSummary.runningPerKm)}</strong><span>palivo + servis + STK + pojistky</span></div>
            <div class="kpi"><strong>${formatCostPerKm(costSummary.totalPerKm)}</strong><span>včetně koupě / prodeje</span></div>
            <div class="kpi"><strong>${costSummary.purchasePrice ? formatCurrency(costSummary.purchasePrice) : '—'}</strong><span>kupní cena</span></div>
            <div class="kpi"><strong>${costSummary.salePrice ? formatCurrency(costSummary.salePrice) : '—'}</strong><span>prodejní cena</span></div>
            <div class="kpi"><strong>${formatCurrency(costSummary.totalWithPurchase / Math.max(1, vehicleOwnershipMonths(selectedVehicle)))}</strong><span>náklad / měsíc vlastnictví</span></div>
          </div>
        </section>
        <section class="garage-stat-block garage-stat-distance">
          <div class="garage-stat-block-head"><h3>Statistiky / Vzdálenost</h3><p>Ujeté kilometry podle stavu km v tankování.</p></div>
          <div class="kpi-row compact garage-stats-kpis">
            <div class="kpi"><strong>${formatKm(analytics.totalDistance)}</strong><span>celkem od evidence</span></div>
            <div class="kpi"><strong>${formatKm(analytics.averageMonthDistance)}</strong><span>průměr / měsíc</span></div>
            <div class="kpi"><strong>${formatKm(analytics.averageYearDistance)}</strong><span>průměr / rok</span></div>
            <div class="kpi"><strong>${formatKm(analytics.prevYearDistance)}</strong><span>minulý rok</span></div>
            <div class="kpi"><strong>${formatKm(analytics.currentKm)}</strong><span>aktuální stav</span></div>
          </div>
        </section>
      `;
    }
    function renderFuelioImport() {
      const rows = ui.fuelioPreview?.rows || [];
      const stats = getFuelioPreviewStats(rows);
      return `
        <div class="card-header">
          <div><h2>Import z Fuelio</h2><p>Nahraj CSV export. Nejdřív se ukáže náhled, duplicity a až potom se data uloží.</p></div>
          <span class="badge">CSV</span>
        </div>
        <form data-form="fuelio-preview">
          <div class="upload-box">
            <label for="fuelioCsv">Fuelio CSV export</label>
            <input id="fuelioCsv" class="input" type="file" name="fuelioCsv" accept=".csv,text/csv" required>
            <p>Mapování je tolerantní: datum, km, litry, cena, poznámka, kategorie a vozidlo. Import nikdy nezapisuje data bez náhledu.</p>
          </div>
          <div class="form-actions"><button class="ghost-btn" type="submit">Načíst náhled</button></div>
        </form>
        ${ui.fuelioPreview ? `
          <div class="preview-box">
            <div class="item-top"><div class="item-title">${escapeHtml(ui.fuelioPreview.fileName)}</div><span class="badge good">náhled</span></div>
            <div class="kpi-row compact">
              <div class="kpi"><strong>${stats.fuelCount}</strong><span>tankování</span></div>
              <div class="kpi"><strong>${stats.serviceCount}</strong><span>servisy/náklady</span></div>
              <div class="kpi"><strong>${stats.vehicleCount || 1}</strong><span>vozidla</span></div>
              <div class="kpi"><strong>${stats.duplicateCount}</strong><span>možné duplicity</span></div>
            </div>
            <div class="inline-note">Import půjde do existujících aut podle názvu. Pokud CSV nemá název auta, použije se aktuálně vybrané auto nebo se vytvoří „Fuelio import“.</div>
            ${renderFuelioPreviewTable(rows)}
            <div class="form-actions">
              <button class="primary-btn" type="button" data-action="confirm-fuelio-import">Importovat</button>
              <button class="ghost-btn" type="button" data-action="clear-fuelio-preview">Zrušit náhled</button>
            </div>
            <div class="inline-note">Cloud import použije stejný náhled a potom odešle jen nové neuložené záznamy. Duplicity z Fuelia hlídá aplikace lokálně i databáze přes hash.</div>
          </div>
        ` : ''}
      `;
    }
    function renderFuelioPreviewTable(rows) {
      const sample = rows.slice(0, 8);
      if (!sample.length) return '';
      return `
        <div class="table-wrap" style="margin-top:12px;">
          <table class="preview-table">
            <thead><tr><th>Typ</th><th>Datum</th><th>Auto</th><th>Km</th><th>Litry</th><th>Cena</th><th>Poznámka</th></tr></thead>
            <tbody>
              ${sample.map((row) => `
                <tr>
                  <td>${row.kind === 'fuel' ? 'Tankování' : 'Náklad'}</td>
                  <td>${formatDate(row.date)}</td>
                  <td>${escapeHtml(row.vehicleName || 'aktuální auto')}</td>
                  <td>${escapeHtml(row.odometer || '—')}</td>
                  <td>${row.liters ? escapeHtml(String(row.liters).replace('.', ',')) : '—'}</td>
                  <td>${formatCurrency(row.price)}</td>
                  <td>${escapeHtml(row.note || row.title || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${rows.length > sample.length ? `<div class="inline-note" style="margin-top:8px;">Zobrazuji prvních ${sample.length} řádků z ${rows.length}. Uloží se celý import bez duplicit.</div>` : ''}
      `;
    }
    function garageCountLabel(count) {
      const value = Number(count || 0);
      if (value === 1) return 'auto v garáži';
      if (value >= 2 && value <= 4) return 'auta v garáži';
      return 'aut v garáži';
    }
    function garageHistoryTypeLabel(type) {
      if (type === 'fuel') return 'tankování';
      if (type === 'service') return 'servis / náklad';
      return 'vše';
    }
    function renderGarageHistoryFilters(records, visibleRecords) {
      const years = garageHistoryYears(records);
      const selectedYear = years.includes(String(ui.garageHistoryYearFilter)) ? String(ui.garageHistoryYearFilter) : 'all';
      const selectedType = ['all', 'fuel', 'service'].includes(ui.garageHistoryTypeFilter) ? ui.garageHistoryTypeFilter : 'all';
      const fuelCount = records.filter((record) => record.kind === 'fuel').length;
      const serviceCount = records.filter((record) => record.kind === 'service').length;
      return `
        <div class="garage-history-toolbar">
          <label class="compact-select-field">
            <span>Rok</span>
            <select class="select" data-garage-history-filter="year" aria-label="Filtrovat historii auta podle roku">
              <option value="all" ${selectedYear === 'all' ? 'selected' : ''}>Všechny roky</option>
              ${years.map((year) => `<option value="${escapeHtml(year)}" ${selectedYear === year ? 'selected' : ''}>${escapeHtml(year)}</option>`).join('')}
            </select>
          </label>
          <label class="compact-select-field">
            <span>Typ</span>
            <select class="select" data-garage-history-filter="type" aria-label="Filtrovat historii auta podle typu záznamu">
              <option value="all" ${selectedType === 'all' ? 'selected' : ''}>Vše</option>
              <option value="fuel" ${selectedType === 'fuel' ? 'selected' : ''}>Tankování (${fuelCount})</option>
              <option value="service" ${selectedType === 'service' ? 'selected' : ''}>Servis / náklady (${serviceCount})</option>
            </select>
          </label>
          <div class="garage-history-count"><strong>${visibleRecords.length}</strong><span>z ${records.length} záznamů</span></div>
        </div>
      `;
    }
    function renderGarageHistoryItem(record) {
      return record.kind === 'fuel' ? renderFuelListItem(record.item) : renderServiceListItem(record.item);
    }
    function renderGarageHistory(vehicle, fuelRows, serviceRows) {
      const records = garageHistoryRecords(fuelRows, serviceRows);
      const visibleRecords = filterGarageHistoryRecords(records);
      const visibleLimit = ui.garageHistoryVisibleCount || 40;
      const selectedYear = garageHistoryYears(records).includes(String(ui.garageHistoryYearFilter)) ? String(ui.garageHistoryYearFilter) : 'all';
      const selectedType = ['all', 'fuel', 'service'].includes(ui.garageHistoryTypeFilter) ? ui.garageHistoryTypeFilter : 'all';
      const filterText = `${selectedYear === 'all' ? 'všechny roky' : selectedYear} · ${garageHistoryTypeLabel(selectedType)}`;
      return `
        <details class="action-details compact-edit-details garage-history-panel" data-details-key="garage-history-${vehicle?.id || ''}" ${isDetailsOpen(`garage-history-${vehicle?.id || ''}`) ? 'open' : ''}>
          <summary><span>Historie auta</span><em>${records.length} záznamů celkem · ${escapeHtml(filterText)}</em></summary>
          ${renderGarageHistoryFilters(records, visibleRecords)}
          ${visibleRecords.length ? `<div class="list compact-list garage-history-list">${visibleRecords.slice(0, visibleLimit).map(renderGarageHistoryItem).join('')}</div>${visibleRecords.length > visibleLimit ? `<div class="list-load-more"><button class="ghost-btn" type="button" data-action="show-more-history" data-history="garage">Zobrazit dalších ${Math.min(40, visibleRecords.length - visibleLimit)}</button><span>${visibleLimit} z ${visibleRecords.length}</span></div>` : ''}` : renderEmpty(`Pro filtr ${filterText} tu není žádný záznam.`)}
        </details>
      `;
    }
    function renderFuelListItem(item) {
      return `
        <div class="item garage-history-row fuelio-record-row">
          <div class="item-top">
            <div class="item-title">⛽ ${formatDate(item.date)}</div>
            <span class="badge">${escapeHtml(item.odometer || '—')} km</span>
          </div>
          <div class="item-meta">${Number(item.liters || 0) > 0 ? `${escapeHtml(item.liters)} l` : 'litry nezadané'} · ${formatCurrency(item.price)}${fuelPricePerLiter(item) ? ` · ${escapeHtml(formatFuelPricePerLiter(fuelPricePerLiter(item)))}` : ''}${garageFuelConsumptionForItem(item) ? ` · spotřeba ${formatLitreValue(garageFuelConsumptionForItem(item))}` : ''}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</div>
          <div class="item-actions">
            <button class="ghost-btn" type="button" data-action="edit-garage-record" data-collection="fuel" data-id="${item.id}">Upravit</button>
            <button class="danger-btn" type="button" data-action="delete" data-collection="fuel" data-id="${item.id}">Smazat</button>
          </div>
        </div>
      `;
    }
    function renderServiceListItem(item) {
      return `
        <div class="item garage-history-row fuelio-record-row">
          <div class="item-top">
            <div class="item-title">🧾 ${escapeHtml(item.title)}</div>
            <span class="badge">${formatDate(item.date)}</span>
          </div>
          <div class="item-meta">${formatCurrency(item.price)}${item.odometer ? ` · ${escapeHtml(item.odometer)} km` : ''}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</div>
          <div class="item-actions">
            <button class="ghost-btn" type="button" data-action="edit-garage-record" data-collection="services" data-id="${item.id}">Upravit</button>
            <button class="danger-btn" type="button" data-action="delete" data-collection="services" data-id="${item.id}">Smazat</button>
          </div>
        </div>
      `;
    }
    function renderGarageDetailCharts(vehicle, fuelRows = []) {
      const detailsKey = `garage-charts-${vehicle?.id || 'vehicle'}`;
      const open = isDetailsOpen(detailsKey, false);
      if (!open) return `<details class="action-details compact-edit-details garage-detail-chart-details" data-details-key="${escapeHtml(detailsKey)}" data-lazy-render><summary><span>Graf spotřeby</span><em>načte se až po otevření</em></summary></details>`;
      const analytics = garageVehicleAnalytics(vehicle);
      const currentYear = new Date().getFullYear();
      const lastYearStart = new Date();
      lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);
      const lastYearStartIso = localISODate(lastYearStart);
      const lastYearEntries = analytics.entries.filter((item) => String(item.date || '').slice(0, 10) >= lastYearStartIso);
      const lastYearPoints = garageChartPointsFromConsumption(lastYearEntries, chartColumnLimit(24));
      const allTimePoints = garageChartPointsFromConsumption(analytics.entries, chartColumnLimit(999));
      const lastYearValues = lastYearPoints.map((item) => item.value);
      const allTimeValues = allTimePoints.map((item) => item.value);
      const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      return `
        <details class="action-details compact-edit-details garage-detail-chart-details" data-details-key="${escapeHtml(detailsKey)}" data-lazy-render open>
        <summary><span>Graf spotřeby</span><em>poslední rok a celá doba</em></summary>
        <div class="garage-detail-chart-section">
          <div class="garage-stat-block-head"><h3>Graf spotřeby</h3><p>Stejný styl jako přehled. První graf je poslední rok, druhý celá doba evidence.</p></div>
          <div class="garage-chart-carousel garage-detail-chart-carousel" data-no-swipe aria-label="Grafy spotřeby auta">
            ${renderGarageLineChart('Poslední rok', 'spotřeba l/100 km', lastYearPoints, 'Za poslední rok není dost tankování s km a litry.', [
              { label: 'Průměr', value: formatLitreValue(avg(lastYearValues)) },
              { label: 'Poslední', value: lastYearValues.length ? formatLitreValue(lastYearValues[lastYearValues.length - 1]) : '—' },
              { label: 'Rok', value: String(currentYear) }
            ])}
            ${renderGarageLineChart('Celá doba', 'spotřeba l/100 km', allTimePoints, 'Zatím není dost tankování s km a litry.', [
              { label: 'Průměr', value: formatLitreValue(avg(allTimeValues)) },
              { label: 'Nejlepší', value: formatLitreValue(analytics.bestConsumption) },
              { label: 'Nejhorší', value: formatLitreValue(analytics.worstConsumption) }
            ])}
          </div>
        </div></details>`;
    }
    function renderGarageRecordEditForm(collection, item) {
      if (collection === 'fuel') {
        return `
          <form class="inline-edit-form" data-form="update-fuel" data-id="${item.id}">
            <div class="form-grid two">
              ${field('Datum', 'date', 'date', '', true, item.date || todayISO())}
              ${field('Stav km', 'odometer', 'number', 'např. 125000', true, item.odometer || '')}
              <div class="fuel-cost-row">
                ${fuelNumberField('Litry', 'liters', 'např. 42,5', item.liters || '')}
                ${fuelNumberField('Cena za litr', 'pricePerLiter', 'např. 38,90', item.pricePerLiter || fuelPricePerLiter(item))}
              </div>
              ${fuelNumberField('Cena celkem', 'price', 'např. 1600', item.price || '')}
              ${field('Poznámka', 'note', 'text', 'volitelné', false, item.note || '')}
            </div>
            <div class="form-actions"><button class="primary-btn" type="submit">Uložit tankování</button><button class="ghost-btn" type="button" data-action="cancel-garage-edit">Zrušit</button></div>
          </form>
        `;
      }
      return `
        <form class="inline-edit-form" data-form="update-service" data-id="${item.id}">
          <div class="form-grid two">
            ${field('Datum', 'date', 'date', '', true, item.date || todayISO())}
            ${field('Stav km', 'odometer', 'number', 'volitelné', false, item.odometer || '')}
            ${field('Popis', 'title', 'text', 'olej / pneu / STK', true, item.title || '')}
            ${field('Cena', 'price', 'number', 'volitelné', false, item.price || '')}
            ${field('Poznámka', 'note', 'text', 'volitelné', false, item.note || '')}
          </div>
          <div class="form-actions"><button class="primary-btn" type="submit">Uložit servis</button><button class="ghost-btn" type="button" data-action="cancel-garage-edit">Zrušit</button></div>
        </form>
      `;
    }

    function renderVehicleServicePlanItem(item, currentKm) {
      const status = computeServicePlanStatus(item, currentKm);
      const isEditing = ui.garageServicePlanEditId === item.id;
      const intervalBits = [
        item.intervalKm ? `${formatKm(item.intervalKm)}` : '',
        item.intervalMonths ? `${item.intervalMonths} měs.` : ''
      ].filter(Boolean).join(' / ') || 'bez intervalu';
      const lastBits = [
        item.lastKm ? `${formatKm(item.lastKm)}` : '',
        item.lastDate ? formatDate(item.lastDate) : ''
      ].filter(Boolean).join(' · ') || 'nezadáno';
      return `
        <div class="item service-plan-item">
          <div class="item-top">
            <div class="item-title">${escapeHtml(item.label)}</div>
            <span class="badge ${status.tone}">${escapeHtml(status.label)}</span>
          </div>
          <div class="item-meta">${escapeHtml(status.detail)}</div>
          <div class="item-meta">Interval: ${escapeHtml(intervalBits)} · Naposledy: ${escapeHtml(lastBits)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</div>
          <div class="item-actions">
            <button class="ghost-btn" type="button" data-action="edit-service-plan-item" data-id="${escapeHtml(item.id)}">${isEditing ? 'Zavřít úpravu' : 'Upravit'}</button>
            <button class="danger-btn" type="button" data-action="delete-service-plan-item" data-vehicle-id="${escapeHtml(item.vehicleIdForEdit || '')}" data-id="${escapeHtml(item.id)}">Smazat</button>
          </div>
        </div>
      `;
    }
    function renderVehicleServicePlanForm(vehicle, editItem = null) {
      const item = editItem || { type: 'oil', label: '', intervalKm: '', intervalMonths: '', lastKm: '', lastDate: '', note: '' };
      return `
        <form data-form="service-plan-item" data-vehicle-id="${escapeHtml(vehicle.id)}" data-edit-id="${escapeHtml(editItem ? editItem.id : '')}" class="compact-form service-plan-form">
          <div class="form-grid two">
            ${selectField('Položka', 'type', SERVICE_PLAN_TYPE_OPTIONS, item.type)}
            ${field('Vlastní název (u vlastní položky)', 'label', 'text', 'např. Klimatizace', false, item.label || '')}
            ${field('Interval km', 'intervalKm', 'number', 'např. 15000', false, item.intervalKm || '')}
            ${field('Interval měsíců', 'intervalMonths', 'number', 'např. 12', false, item.intervalMonths || '')}
            ${field('Naposledy při km', 'lastKm', 'number', 'např. 82000', false, item.lastKm || '')}
            ${field('Naposledy datum', 'lastDate', 'date', '', false, item.lastDate || '')}
            ${field('Poznámka', 'note', 'text', 'volitelné', false, item.note || '')}
          </div>
          <div class="form-actions compact-actions">
            <button class="primary-btn" type="submit">${editItem ? 'Uložit změny' : 'Přidat do plánu'}</button>
            ${editItem ? '<button class="ghost-btn" type="button" data-action="cancel-service-plan-edit">Zrušit úpravu</button>' : ''}
          </div>
        </form>
      `;
    }
    function renderVehicleServicePlan(vehicle, currentKm) {
      const plan = getVehicleServicePlan(vehicle.id).map((item) => ({ ...item, vehicleIdForEdit: vehicle.id }));
      const editItem = ui.garageServicePlanEditId ? plan.find((item) => item.id === ui.garageServicePlanEditId) || null : null;
      const counts = plan.reduce((acc, item) => {
        const tone = computeServicePlanStatus(item, currentKm).tone;
        if (tone === 'bad') acc.over += 1;
        else if (tone === 'warn') acc.soon += 1;
        return acc;
      }, { over: 0, soon: 0 });
      const summaryBadge = counts.over ? `${counts.over} po termínu` : counts.soon ? `${counts.soon} brzy` : plan.length ? 'vše OK' : 'prázdné';
      const summaryTone = counts.over ? 'bad' : counts.soon ? 'warn' : plan.length ? 'good' : '';
      return `
        <details class="action-details compact-edit-details garage-service-plan-details" data-garage-detail="service-plan" ${ui.garageServicePlanOpen ? 'open' : ''}>
          <summary><span>Servisní plán</span><em>olej, filtry, brzdy, pneu, rozvody, STK…</em></summary>
          <div class="service-plan-body">
            <div class="card-subheader compact-subheader"><div><h3>Servisní plán auta</h3><p>Další termín se počítá z aktuálních ${formatKm(currentKm)} a dnešního data.</p></div><span class="badge ${summaryTone}">${escapeHtml(summaryBadge)}</span></div>
            ${plan.length ? `<div class="list compact-list service-plan-list">${plan.map((item) => renderVehicleServicePlanItem(item, currentKm)).join('')}</div>` : '<div class="inline-note">Zatím žádná položka. Přidej olej, filtry, brzdy nebo vlastní servisní úkon a hlídej interval.</div>'}
            ${renderVehicleServicePlanForm(vehicle, editItem)}
          </div>
        </details>
      `;
    }
    function renderVehicleDetail(vehicle) {
      const fuelRows = sortFuelRows(state.fuel.filter((item) => item.vehicleId === vehicle.id));
      const serviceRows = state.services.filter((item) => item.vehicleId === vehicle.id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const stats = getVehicleStats(fuelRows, serviceRows);
      const analytics = garageVehicleAnalytics(vehicle);
      const latestFuel = fuelRows[fuelRows.length - 1] || null;
      const latestService = serviceRows[0] || null;
      const serviceStatus = getServiceStatus(vehicle, latestService, latestFuel);
      const stk = dateStatus(vehicle.technicalInspectionUntil, 60);
      const linkedInsuranceContract = resolveVehicleInsuranceContract(vehicle);
      const insurance = dateStatus(vehicleInsuranceUntilEffective(vehicle), 45);
      const costPerKm = stats.totalKm > 0 ? stats.fuelCost / stats.totalKm : null;
      const totalCost = stats.fuelCost + stats.serviceCost;
      const costSummary = garageVehicleCostSummary(vehicle, analytics);
      const totalCostPerKm = garageVehicleTotalCostPerKm(analytics);
      return `
        <div class="card-header compact-detail-head vehicle-detail-head">
          <div class="vehicle-detail-title"><span class="vehicle-icon-bubble vehicle-icon-bubble-large ${vehicleIconColorClass(vehicle.iconColor)}" aria-hidden="true">${vehicleIconShapeEmoji(vehicle.iconShape)}</span><div><h2>${escapeHtml(vehicle.name)}</h2><p>${escapeHtml(vehicle.plate || 'Bez SPZ')} · ${escapeHtml(vehicle.fuelType || 'palivo neuvedeno')} · ${escapeHtml(vehicleOwnershipLabel(vehicle))}</p></div></div>
          <div class="vehicle-detail-head-actions">
            <button class="ghost-btn icon-action-btn" type="button" data-action="open-garage-detail" data-garage-target="vehicle-settings" title="Nastavení auta" aria-label="Nastavení auta">⚙️</button>
            ${vehicleOwnershipStatus(vehicle) === 'owned' ? '<button class="primary-btn icon-action-btn fuel-add-shortcut" type="button" data-action="open-garage-detail" data-garage-target="add-fuel" title="Přidat tankování" aria-label="Přidat tankování">⛽+</button>' : ''}
            <button class="ghost-btn icon-action-btn" type="button" data-action="open-garage-detail" data-garage-target="add-service" title="Přidat servis / náklad" aria-label="Přidat servis nebo náklad">🧾+</button>
            <span class="badge ${vehicle.cloudId ? 'good' : ''}">${vehicle.cloudId ? 'cloud' : 'lokálně'} · ${escapeHtml(vehicle.odometer || latestFuel?.odometer || 0)} km</span>
          </div>
        </div>
        <div class="kpi-row compact">
          <div class="kpi"><strong>${stats.averageConsumption ? `${stats.averageConsumption.toFixed(2).replace('.', ',')}` : '—'}</strong><span>l/100 km</span></div>
          <div class="kpi"><strong>${formatCurrency(stats.thisYearCost)}</strong><span>náklady letos</span></div>
          <div class="kpi"><strong>${formatCurrency(totalCost)}</strong><span>provoz bez koupě</span></div>
          <div class="kpi"><strong>${costPerKm ? `${costPerKm.toFixed(2).replace('.', ',')} Kč` : '—'}</strong><span>palivo / km</span></div>
          <div class="kpi"><strong>${formatCostPerKm(costSummary.runningPerKm)}</strong><span>Kč/km bez pořizovací ceny</span></div>
          <div class="kpi"><strong>${formatCostPerKm(costSummary.totalPerKm)}</strong><span>Kč/km včetně koupě</span></div>
        </div>
        <div class="garage-status-grid compact-status-grid">
          ${renderDueCard('STK', stk, 'Datum STK zatím není nastavené.')}
          ${renderDueCard(linkedInsuranceContract ? 'Pojistka · smlouva' : 'Pojistka', insurance, 'Datum konce pojistky zatím není nastavené.')}
          ${renderDueCard('Servis', serviceStatus, 'Servisní interval zatím není nastavený.')}
        </div>
        <div class="grid two detail-summary-grid">
          <div class="detail-stack compact-detail-stack">
            <div class="stat-line"><span>Poslední tankování</span><strong>${latestFuel ? `${formatDate(latestFuel.date)} · ${escapeHtml(latestFuel.odometer || '—')} km` : '—'}</strong></div>
            <div class="stat-line"><span>Poslední servis</span><strong>${latestService ? `${formatDate(latestService.date)} · ${escapeHtml(latestService.title || 'servis')}` : '—'}</strong></div>
            <div class="stat-line"><span>Koupeno</span><strong>${vehicle.purchaseDate ? `${formatDate(vehicle.purchaseDate)}${vehicle.purchasePrice ? ` · ${formatCurrency(vehicle.purchasePrice)}` : ''}${vehicle.purchaseOdometer ? ` · ${escapeHtml(vehicle.purchaseOdometer)} km` : ''}` : 'nenastaveno'}</strong></div>
            <div class="stat-line"><span>Prodáno</span><strong>${vehicle.saleDate ? `${formatDate(vehicle.saleDate)}${vehicle.salePrice ? ` · ${formatCurrency(vehicle.salePrice)}` : ''}${vehicle.saleOdometer ? ` · ${escapeHtml(vehicle.saleOdometer)} km` : ''}` : 'zatím ne'}</strong></div>
            <div class="stat-line"><span>Záznamy</span><strong>${fuelRows.length} tankování · ${serviceRows.length} servisů</strong></div>
            ${vehicle.note ? `<div class="inline-note compact-note">${escapeHtml(vehicle.note)}</div>` : ''}
          </div>
          <div class="detail-stack compact-detail-stack">
            <div class="stat-line"><span>Kč/km jen palivo</span><strong>${formatCostPerKm(costSummary.fuelPerKm)}</strong></div>
            <div class="stat-line"><span>Kč/km bez pořizovací ceny</span><strong>${formatCostPerKm(costSummary.runningPerKm)}</strong></div>
            <div class="stat-line"><span>Kč/km včetně koupě</span><strong>${formatCostPerKm(costSummary.totalPerKm)}</strong></div>
            <div class="stat-line"><span>Pořízení / prodej</span><strong>${costSummary.purchasePrice ? `${formatCurrency(costSummary.purchasePrice)}${vehicle.purchaseOdometer ? ` · ${escapeHtml(vehicle.purchaseOdometer)} km` : ''}${costSummary.salePrice ? ` · prodej ${formatCurrency(costSummary.salePrice)}` : ''}${vehicle.saleOdometer ? ` · ${escapeHtml(vehicle.saleOdometer)} km` : ''}` : 'nenastaveno'}</strong></div>
            ${!isVehicleOwned(vehicle) ? `<div class="stat-line"><span>Náklad / měsíc vlastnictví</span><strong>${formatCurrency(costSummary.totalWithPurchase / Math.max(1, vehicleOwnershipMonths(vehicle)))}</strong></div><div class="stat-line"><span>Km / měsíc vlastnictví</span><strong>${formatKm(vehicleOwnedDistance(vehicle, analytics) / Math.max(1, vehicleOwnershipMonths(vehicle)))}</strong></div>` : ''}
          </div>
        </div>
        ${renderGarageDetailCharts(vehicle, fuelRows)}
        ${renderVehicleServicePlan(vehicle, analytics.currentKm)}
        ${renderGarageHistory(vehicle, fuelRows, serviceRows)}
        <details class="action-details compact-edit-details" data-garage-detail="vehicle-settings" data-details-key="garage-vehicle-settings-${vehicle.id}" ${isDetailsOpen(`garage-vehicle-settings-${vehicle.id}`) ? 'open' : ''}>
          <summary><span>Upravit údaje auta</span><em>termíny, km, servisní intervaly</em></summary>
          <form data-form="update-vehicle" data-vehicle-id="${vehicle.id}" class="compact-form">
            <div class="form-grid two">
              ${field('Název auta', 'name', 'text', 'Elroq / Octavia', true, vehicle.name)}
              ${field('SPZ', 'plate', 'text', 'volitelné', false, vehicle.plate || '')}
              ${field('Palivo', 'fuelType', 'text', 'benzín / nafta / elektro', false, vehicle.fuelType || '')}
              ${field('Aktuální km', 'odometer', 'number', '0', false, vehicle.odometer || latestFuel?.odometer || '')}
              ${field('Datum koupě', 'purchaseDate', 'date', '', false, vehicle.purchaseDate || '')}
              ${field('Cena při koupi', 'purchasePrice', 'number', 'volitelné', false, vehicle.purchasePrice || '')}
              ${field('Km při koupi', 'purchaseOdometer', 'number', 'volitelné', false, vehicle.purchaseOdometer || '')}
              ${selectField('Stav auta', 'ownershipStatus', [['owned', 'Vlastním'], ['sold', 'Nevlastním / prodané']], vehicleOwnershipStatus(vehicle))}
              ${field('Datum prodeje', 'saleDate', 'date', '', false, vehicle.saleDate || '')}
              ${field('Cena při prodeji', 'salePrice', 'number', 'volitelné', false, vehicle.salePrice || '')}
              ${field('Km při prodeji', 'saleOdometer', 'number', 'volitelné', false, vehicle.saleOdometer || '')}
              ${field('STK do', 'technicalInspectionUntil', 'date', '', false, vehicle.technicalInspectionUntil || '')}
              ${field('Pojistka do', 'insuranceUntil', 'date', '', false, vehicle.insuranceUntil || '')}
              ${selectField('Smlouva pojištění (povinné ručení)', 'insuranceContractId', vehicleInsuranceContractOptions(), linkedInsuranceContract?.id || '')}
              ${field('Další servis při km', 'nextServiceKm', 'number', 'např. 150000', false, vehicle.nextServiceKm || '')}
              ${field('Další servis do data', 'nextServiceDate', 'date', '', false, vehicle.nextServiceDate || '')}
              ${selectField('Barva ikonky auta', 'iconColor', vehicleIconColorOptions(), normalizeVehicleIconColor(vehicle.iconColor))}
              ${selectField('Tvar ikonky auta', 'iconShape', vehicleIconShapeOptions(), normalizeVehicleIconShape(vehicle.iconShape))}
              ${field('Poznámka', 'note', 'text', 'pneu, rozměr, VIN...', false, vehicle.note || '')}
            </div>
            ${linkedInsuranceContract ? `<div class="inline-note compact-note">Datum konce pojistky se bere ze smlouvy „${escapeHtml(linkedInsuranceContract.name)}“ (${escapeHtml(formatDate(linkedInsuranceContract.validTo))}) - pole „Pojistka do“ výše se pak ignoruje.</div>` : ''}
            ${renderVehicleTechnicalFields(vehicle)}
            <div class="form-actions"><button class="primary-btn" type="submit">Uložit údaje auta</button></div>
          </form>
        </details>
        <details class="action-details compact-edit-details danger-zone-details" data-details-key="garage-danger-zone-${vehicle.id}" ${isDetailsOpen(`garage-danger-zone-${vehicle.id}`) ? 'open' : ''}>
          <summary><span>Smazat auto</span><em>a všechny jeho záznamy</em></summary>
          <div class="inline-note warn-note">Smaže se auto, tankování i servisní náklady. Akce bude ještě vyžadovat potvrzení.</div>
          <div class="form-actions"><button class="danger-btn" type="button" data-action="delete-vehicle" data-id="${vehicle.id}">Smazat auto</button></div>
        </details>
      `;
    }
    function renderDueCard(label, status, emptyText) {
      const value = status.left === null ? emptyText : status.text;
      return `
        <div class="due-card ${status.className}">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `;
    }
    function renderMiniChart(fuelRows) {
      const series = buildFuelConsumptionSeries(fuelRows, chartColumnLimit(12));
      const values = series.map((item) => item.value).filter((value) => Number.isFinite(value));
      if (values.length < 2) return '<div class="inline-note" style="margin-top:12px;">Graf spotřeby za poslední rok se zobrazí po více tankováních s km a litry.</div>';
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const yMin = Math.max(0, Math.floor((min - 0.4) * 2) / 2);
      const yMax = Math.ceil((max + 0.4) * 2) / 2;
      const chartWidth = 390;
      const chartHeight = 206;
      const padLeft = 38;
      const padRight = 10;
      const padTop = 18;
      const padBottom = 42;
      const innerWidth = chartWidth - padLeft - padRight;
      const innerHeight = chartHeight - padTop - padBottom;
      const tickCount = 4;
      const step = Math.max((yMax - yMin) / (tickCount - 1), 0.5);
      const ticks = Array.from({ length: tickCount }, (_, index) => Number((yMax - index * step).toFixed(1)));
      const barGap = 6;
      const barWidth = Math.max(10, Math.floor((innerWidth - (series.length - 1) * barGap) / series.length));
      const valueY = (value) => padTop + ((yMax - value) / Math.max(yMax - yMin, 0.5)) * innerHeight;
      const bars = series.map((item, index) => {
        const x = padLeft + index * (barWidth + barGap);
        const baseY = padTop + innerHeight;
        if (!Number.isFinite(item.value)) {
          return `<g class="consumption-bar empty"><text x="${x + barWidth / 2}" y="${baseY - 6}" text-anchor="middle">—</text><text x="${x + barWidth / 2}" y="${chartHeight - 18}" text-anchor="middle">${escapeHtml(item.label)}</text></g>`;
        }
        const y = valueY(item.value);
        const height = Math.max(6, baseY - y);
        return `<g class="consumption-bar"><rect x="${x}" y="${y.toFixed(1)}" width="${barWidth}" height="${height.toFixed(1)}" rx="8"></rect><text x="${x + barWidth / 2}" y="${Math.max(padTop + 10, y - 6).toFixed(1)}" text-anchor="middle">${String(item.value.toFixed(1)).replace('.', ',')}</text><text x="${x + barWidth / 2}" y="${chartHeight - 18}" text-anchor="middle">${escapeHtml(item.label)}</text></g>`;
      }).join('');
      const grid = ticks.map((tick) => {
        const y = valueY(tick);
        return `<g class="consumption-grid"><line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${chartWidth - padRight}" y2="${y.toFixed(1)}"></line><text x="${padLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${String(tick.toFixed(1)).replace('.', ',')}</text></g>`;
      }).join('');
      return `
        <div class="consumption-chart-wrap">
          <div class="consumption-chart-head"><strong>Spotřeba paliva</strong><span>posledních ${series.length} měsíců</span></div>
          <svg class="consumption-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="Graf spotřeby paliva za posledních ${series.length} měsíců">
            ${grid}
            ${bars}
          </svg>
          <div class="consumption-chart-stats">
            <span><strong>${String(avg.toFixed(2)).replace('.', ',')}</strong><em>průměr l/100</em></span>
            <span><strong>${String(min.toFixed(2)).replace('.', ',')}</strong><em>minimum</em></span>
            <span><strong>${String(max.toFixed(2)).replace('.', ',')}</strong><em>maximum</em></span>
          </div>
        </div>
      `;
    }

    return { renderGarage, renderGarageRecordEditForm };
  }

  window.DomacnostGarage = { createGarage };
})();
