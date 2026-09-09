(function () {
  'use strict';

  // Bazén: lokální výpočet objemu a orientační dávkování pH přípravků.
  // Data žijí v households.dashboard_layout.pools (pole pojmenovaných bazénů),
  // takže není potřeba nová DB tabulka. Každý bazén má vlastní rozměry/cílové
  // pH i vlastní historii měření - jde o samostatnou "entitu", podobně jako
  // vozidla v Garáži.
  function createPool(deps) {
    const getState = deps.getState || (() => ({}));
    const getModuleTab = deps.getModuleTab || ((area, fallback) => fallback);
    const setModuleTab = deps.setModuleTab || (() => {});
    const renderSectionTabs = deps.renderSectionTabs || (() => '');
    const uid = deps.uid || (() => `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const todayISO = deps.todayISO || (() => new Date().toISOString().slice(0, 10));
    const normalizeText = deps.normalizeText || ((v) => String(v || '').trim());
    const escapeHtml = deps.escapeHtml || ((v) => String(v ?? ''));
    const decimalValue = deps.decimalValue || ((v) => Number(String(v || '').replace(',', '.')) || 0);
    const field = deps.field || (() => '');
    const selectField = deps.selectField || (() => '');
    const renderEmptyCta = deps.renderEmptyCta || (() => '');
    const formatDate = deps.formatDate || ((v) => String(v || ''));
    const formatDateTime = deps.formatDateTime || ((v) => String(v || ''));
    const touchState = deps.touchState || (() => {});
    const saveState = deps.saveState || (() => {});
    const render = deps.render || (() => {});
    const showToast = deps.showToast || (() => {});
    const cloudReady = deps.cloudReady || (() => false);
    const cloudSaveHouseholdUiSettings = deps.cloudSaveHouseholdUiSettings || (() => Promise.resolve(false));
    const confirm = deps.confirm || ((message) => window.confirm(message));

    let activePoolId = '';
    let activePoolMeasurementEditId = '';
    let phInfoOpen = false;

    const SHAPE_OPTIONS = [
      ['rect', 'Obdélník'],
      ['round', 'Kruh'],
      ['oval', 'Ovál'],
      ['custom', 'Zadaný objem']
    ];

    function numberOrEmpty(value) {
      if (value === '' || value === null || value === undefined) return '';
      const number = decimalValue(value);
      return number > 0 ? number : '';
    }

    function nullableNumber(value) {
      if (value === '' || value === null || value === undefined) return '';
      const number = decimalValue(value);
      return Number.isFinite(number) && number > 0 ? number : '';
    }

    // Teplota vody smí legitimně být 0 °C (zazimovaný/promrzlý bazén) nebo i
    // záporná - na rozdíl od nullableNumber (pH, dávkování...), kde 0/záporné
    // číslo reálně znamená "nezadáno", tady by to hodnotu tiše zahodilo.
    function nullableTemperature(value) {
      if (value === '' || value === null || value === undefined) return '';
      const number = decimalValue(value);
      return Number.isFinite(number) ? number : '';
    }

    function normalizePoolTime(value) {
      const raw = normalizeText(value);
      const match = raw.match(/^(\d{1,2}):(\d{2})/);
      if (!match) return '';
      const hours = Math.max(0, Math.min(23, Number(match[1])));
      const minutes = Math.max(0, Math.min(59, Number(match[2])));
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    function currentPoolTime() {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }

    function normalizePoolMeasurement(value = {}) {
      const date = normalizeText(value.date || value.measuredAt || value.createdAt || todayISO()).slice(0, 10) || todayISO();
      return {
        id: normalizeText(value.id) || `pool-measure-${uid()}`,
        date,
        time: normalizePoolTime(value.time || value.measuredTime || String(value.measuredAt || value.createdAt || '').slice(11, 16)),
        ph: nullableNumber(value.ph),
        waterTempC: nullableTemperature(value.waterTempC ?? value.waterTemp ?? value.temperature),
        note: normalizeText(value.note),
        createdAt: normalizeText(value.createdAt) || new Date().toISOString()
      };
    }

    function normalizePoolMeasurements(value) {
      const rows = Array.isArray(value) ? value : [];
      return rows
        .map(normalizePoolMeasurement)
        .filter((item) => item.ph !== '' || item.waterTempC !== '')
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.time || '').localeCompare(String(b.time || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
        .slice(-120);
    }

    function normalizePool(value = {}, index = 0) {
      const shape = ['rect', 'round', 'oval', 'custom'].includes(value.shape) ? value.shape : 'rect';
      return {
        id: normalizeText(value.id) || `pool-${uid()}`,
        name: normalizeText(value.name) || `Bazén${index ? ` ${index + 1}` : ''}`,
        shape,
        length: numberOrEmpty(value.length),
        width: numberOrEmpty(value.width),
        diameter: numberOrEmpty(value.diameter),
        depth: numberOrEmpty(value.depth),
        volumeM3: numberOrEmpty(value.volumeM3),
        ph: value.ph === '' || value.ph === null || value.ph === undefined ? '' : decimalValue(value.ph),
        waterTempC: nullableTemperature(value.waterTempC ?? value.waterTemp ?? value.temperature),
        targetPh: value.targetPh === '' || value.targetPh === null || value.targetPh === undefined ? 7.2 : decimalValue(value.targetPh) || 7.2,
        dosePer10m3Per01: numberOrEmpty(value.dosePer10m3Per01) || 100,
        measurements: normalizePoolMeasurements(value.measurements),
        note: normalizeText(value.note),
        createdAt: normalizeText(value.createdAt) || new Date().toISOString(),
        updatedAt: normalizeText(value.updatedAt)
      };
    }

    // Zpětná kompatibilita: staré households.dashboard_layout.pool (jeden objekt,
    // bez name/id) migruje app.js na pole s jednou položkou - normalizePool tady
    // dostane i objekt bez id/name a doplní je.
    function normalizePools(value) {
      const rows = Array.isArray(value) ? value : [];
      const seen = new Set();
      return rows.map((row, index) => normalizePool(row, index)).map((pool) => {
        let id = pool.id;
        while (seen.has(id)) id = `pool-${uid()}`;
        seen.add(id);
        return { ...pool, id };
      });
    }

    // Cloud-merge logika bazénů (tombstone smazání proti cloud snapshotu) -
    // patří sem, ne do app.js, aby vlastník tvaru poolCloud.deletedIds a
    // pravidel "kdy vyhrává lokální smazání" byl jeden modul, ne dva.
    function normalizePoolCloudState(value = {}) {
      const deletedIds = {};
      const source = value && typeof value === 'object' ? value.deletedIds || {} : {};
      Object.entries(source).forEach(([id, deletedAt]) => {
        const cleanId = normalizeText(id);
        const cleanDeletedAt = normalizeText(deletedAt);
        if (cleanId && Number.isFinite(Date.parse(cleanDeletedAt))) deletedIds[cleanId] = cleanDeletedAt;
      });
      return {
        loadedAt: normalizeText(value?.loadedAt),
        pendingAt: normalizeText(value?.pendingAt),
        deletedIds
      };
    }

    function poolDeleteWinsOverCloud(pool, deletedIds = {}) {
      const deletedAt = Date.parse(deletedIds?.[pool?.id] || '');
      if (!Number.isFinite(deletedAt)) return false;
      const cloudUpdatedAt = Date.parse(pool?.updatedAt || pool?.createdAt || '');
      return !Number.isFinite(cloudUpdatedAt) || cloudUpdatedAt <= deletedAt;
    }

    function getPools() {
      return normalizePools(getState().pools);
    }

    function getActivePool(pools = getPools()) {
      if (!pools.length) return null;
      return pools.find((pool) => pool.id === activePoolId) || pools[0];
    }

    function poolVolumeM3(pool) {
      if (!pool) return 0;
      const item = normalizePool(pool);
      if (item.shape === 'custom') return decimalValue(item.volumeM3);
      const depth = decimalValue(item.depth);
      if (depth <= 0) return 0;
      if (item.shape === 'round') {
        const diameter = decimalValue(item.diameter);
        return diameter > 0 ? Math.PI * Math.pow(diameter / 2, 2) * depth : 0;
      }
      if (item.shape === 'oval') {
        const length = decimalValue(item.length);
        const width = decimalValue(item.width);
        return length > 0 && width > 0 ? Math.PI * (length / 2) * (width / 2) * depth : 0;
      }
      const length = decimalValue(item.length);
      const width = decimalValue(item.width);
      return length > 0 && width > 0 ? length * width * depth : 0;
    }

    function formatVolume(value) {
      const number = Number(value || 0);
      if (!Number.isFinite(number) || number <= 0) return '0 m³';
      return `${number.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} m³`;
    }

    function formatGrams(value) {
      const number = Math.max(0, Math.round(Number(value || 0)));
      if (number >= 1000) return `${(number / 1000).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} kg`;
      return `${number.toLocaleString('cs-CZ')} g`;
    }

    function poolPhDose(pool) {
      if (!pool) return { status: 'missing', label: 'Doplň rozměry a pH', grams: 0, delta: 0 };
      const item = normalizePool(pool);
      const current = decimalValue(item.ph);
      const target = decimalValue(item.targetPh) || 7.2;
      const volume = poolVolumeM3(item);
      const dosePer10 = decimalValue(item.dosePer10m3Per01) || 100;
      if (volume <= 0 || current <= 0 || target <= 0) return { status: 'missing', label: 'Doplň rozměry a pH', grams: 0, delta: 0 };
      const delta = current - target;
      if (Math.abs(delta) < 0.05) return { status: 'ok', label: 'pH je v cíli', grams: 0, delta };
      const direction = delta > 0 ? 'minus' : 'plus';
      const grams = (volume / 10) * (Math.abs(delta) / 0.1) * dosePer10;
      return {
        status: direction,
        label: direction === 'minus' ? 'Přidat pH-' : 'Přidat pH+',
        grams,
        delta
      };
    }

    function latestPoolMeasurement(pool) {
      const measurements = normalizePoolMeasurements(pool.measurements);
      return measurements.length ? measurements[measurements.length - 1] : null;
    }

    function formatPoolNumber(value, decimals = 1) {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) return '—';
      return number.toLocaleString('cs-CZ', { maximumFractionDigits: decimals });
    }

    function phInfoContent(pool) {
      const target = decimalValue(pool?.targetPh) || 7.2;
      const ph = decimalValue(pool?.ph);
      if (!ph) {
        return {
          tone: '',
          label: 'pH zatím nezměřeno',
          text: 'pH ukazuje, jak kyselá nebo zásaditá je voda v bazénu. Ideální rozmezí pro koupání i účinnou dezinfekci chlórem je zhruba 7,0–7,6. Změř pH testrem nebo proužky a zapiš ho jako nové měření.'
        };
      }
      const diff = ph - target;
      if (Math.abs(diff) < 0.2) {
        return {
          tone: 'good',
          label: `pH ${formatPoolNumber(ph, 2)} je v pořádku`,
          text: `Hodnota je blízko cíle ${formatPoolNumber(target, 2)}. Voda by měla být příjemná na kůži a oči a dezinfekce (chlór) funguje nejúčinněji právě v tomhle rozmezí.`
        };
      }
      if (diff < 0) {
        return {
          tone: diff < -0.4 ? 'bad' : 'warn',
          label: `pH ${formatPoolNumber(ph, 2)} je nízké (kyselá voda)`,
          text: 'Nejčastější příčiny: hodně deště nebo čerstvě doplněná voda, moc chlornanu/dezinfekce, nebo nově napuštěný bazén. Nízké pH dráždí oči a pokožku a časem koroduje kovové části (žebřík, trysky, topení). Přidej pH+ podle dávkování níž a za pár hodin pH znovu změř.'
        };
      }
      return {
        tone: diff > 0.4 ? 'bad' : 'warn',
        label: `pH ${formatPoolNumber(ph, 2)} je vysoké (zásaditá voda)`,
        text: 'Nejčastější příčiny: tvrdá napouštěná voda, moc přidaného pH+ přípravku, nebo víc organického znečištění (listí, pyl, opalovací krémy). Vysoké pH snižuje účinnost chlóru a může způsobit zákal vody a vodní kámen. Přidej pH- podle dávkování níž a za pár hodin pH znovu změř.'
      };
    }

    function renderPhInfoModal(pool) {
      if (!phInfoOpen || !pool) return '';
      const info = phInfoContent(pool);
      return `
        <div class="app-modal-backdrop pool-ph-info-backdrop" data-modal-backdrop role="presentation">
          <section class="app-modal pool-ph-info-modal" role="dialog" aria-modal="true" aria-labelledby="pool-ph-info-title">
            <div class="app-modal-head">
              <div>
                <span class="badge ${escapeHtml(info.tone)}">${escapeHtml(info.label)}</span>
                <h2 id="pool-ph-info-title">Co znamená pH bazénu</h2>
              </div>
              <button class="icon-btn" type="button" data-action="close-modal" aria-label="Zavřít vysvětlivku">×</button>
            </div>
            <p>${escapeHtml(info.text)}</p>
          </section>
        </div>
      `;
    }

    function openPhInfoModal() {
      phInfoOpen = true;
      render();
    }

    function isPhInfoModalOpen() {
      return phInfoOpen;
    }

    function closePhInfoModal(options = {}) {
      if (!phInfoOpen) return false;
      phInfoOpen = false;
      if (options.render !== false) render();
      return true;
    }

    function renderPoolMeasurements(pool) {
      const measurements = normalizePoolMeasurements(pool.measurements);
      const latest = latestPoolMeasurement(pool);
      const chartRows = measurements.slice(-14);
      const tableRows = measurements.slice(-6).reverse();
      const chart = renderPoolMeasurementChart(chartRows);
      const renderMeasurementRow = (item) => {
        const isEditing = activePoolMeasurementEditId === item.id;
        return `
            <div class="file-row compact-file-row pool-measurement-row ${isEditing ? 'is-editing' : ''}">
              <div>
                <strong>${escapeHtml(formatDate(item.date))}${item.time ? ` · ${escapeHtml(item.time)}` : ''}</strong>
                <em>pH ${escapeHtml(formatPoolNumber(item.ph, 2))} · voda ${escapeHtml(item.waterTempC !== '' ? `${formatPoolNumber(item.waterTempC, 1)} °C` : '—')}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</em>
              </div>
              <div class="item-actions">
                <button class="ghost-btn" type="button" data-action="pool-measurement-edit" data-id="${escapeHtml(item.id)}">${isEditing ? 'Zavřít úpravu' : 'Upravit'}</button>
                <button class="danger-btn" type="button" data-action="pool-measurement-delete" data-id="${escapeHtml(item.id)}">Smazat</button>
              </div>
              ${isEditing ? `
                <form data-form="pool-measurement" data-id="${escapeHtml(item.id)}" class="compact-form inline-edit-form pool-measurement-edit-form">
                  <div class="form-grid three">
                    ${field('Datum měření', 'date', 'date', '', true, item.date || todayISO())}
                    ${field('Čas měření', 'time', 'time', '', false, item.time || '')}
                    ${field('pH', 'ph', 'number', 'např. 7,4', false, item.ph)}
                    ${field('Teplota vody °C', 'waterTempC', 'number', 'např. 24,5', false, item.waterTempC)}
                  </div>
                  ${field('Poznámka', 'note', 'text', 'volitelné', false, item.note || '')}
                  <div class="form-actions"><button class="primary-btn" type="submit">Uložit měření</button><button class="ghost-btn" type="button" data-action="pool-measurement-cancel">Zrušit</button></div>
                </form>
              ` : ''}
            </div>
        `;
      };
      return `
        <section class="card desktop-span-2 pool-measurements-panel">
          <div class="card-header"><div><h2>Měření vody</h2><p>Historie pH a teploty vody pro sledování trendu.</p></div><span class="badge">${measurements.length} měření</span></div>
          <div class="kpi-grid compact-kpi-grid">
            <button type="button" class="kpi kpi-clickable" data-action="pool-ph-info"><strong>${latest?.ph !== '' && latest?.ph !== undefined ? formatPoolNumber(latest.ph, 2) : '—'}</strong><span>poslední pH</span></button>
            <div class="kpi"><strong>${latest?.waterTempC !== '' && latest?.waterTempC !== undefined ? `${formatPoolNumber(latest.waterTempC, 1)} °C` : '—'}</strong><span>teplota vody</span></div>
            <div class="kpi"><strong>${latest?.date ? formatDate(latest.date) : '—'}</strong><span>poslední měření</span></div>
          </div>
          ${chart}
          ${tableRows.length ? `<div class="file-list compact-file-list pool-measurement-list">${tableRows.map(renderMeasurementRow).join('')}</div>` : '<div class="inline-note compact-note">Zatím žádné uložené měření. Vyplň pH nebo teplotu vody a ulož bazén.</div>'}
        </section>
      `;
    }

    function renderPoolMeasurementChart(rows) {
      if (!rows.length) return '<div class="inline-note compact-note">Graf se zobrazí po prvním měření.</div>';
      const width = 520;
      const height = 220;
      const padLeft = 52;
      const padRight = 18;
      const padTop = 20;
      const padBottom = 42;
      const innerWidth = width - padLeft - padRight;
      const innerHeight = height - padTop - padBottom;
      const phValues = rows.map((item) => Number(item.ph)).filter(Number.isFinite);
      const tempValues = rows.map((item) => Number(item.waterTempC)).filter(Number.isFinite);
      const phMin = Math.min(6.8, ...phValues);
      const phMax = Math.max(8.0, ...phValues);
      const tempMin = Math.max(0, Math.floor(Math.min(18, ...tempValues) - 1));
      const tempMax = Math.ceil(Math.max(30, ...tempValues) + 1);
      const xFor = (index) => padLeft + (rows.length === 1 ? innerWidth / 2 : (index / (rows.length - 1)) * innerWidth);
      const yScale = (value, min, max) => padTop + ((max - value) / Math.max(max - min, 0.1)) * innerHeight;
      const pathFor = (key, min, max) => {
        let started = false;
        return rows.map((item, index) => {
          const value = Number(item[key]);
          if (!Number.isFinite(value)) return '';
          const command = started ? 'L' : 'M';
          started = true;
          return `${command} ${xFor(index).toFixed(1)} ${yScale(value, min, max).toFixed(1)}`;
        })
        .filter(Boolean)
        .join(' ');
      };
      const phPath = pathFor('ph', phMin, phMax);
      const tempPath = pathFor('waterTempC', tempMin, tempMax);
      const labels = rows.map((item, index) => {
        const x = xFor(index);
        const label = String(item.date || '').slice(5).replace('-', '.');
        return `<text x="${x.toFixed(1)}" y="${height - 18}" text-anchor="middle">${escapeHtml(label)}</text>`;
      }).join('');
      const phDots = rows.map((item, index) => {
        const value = Number(item.ph);
        if (!Number.isFinite(value)) return '';
        return `<circle class="pool-chart-dot ph" cx="${xFor(index).toFixed(1)}" cy="${yScale(value, phMin, phMax).toFixed(1)}" r="4"></circle>`;
      }).join('');
      const tempDots = rows.map((item, index) => {
        const value = Number(item.waterTempC);
        if (!Number.isFinite(value)) return '';
        return `<circle class="pool-chart-dot temp" cx="${xFor(index).toFixed(1)}" cy="${yScale(value, tempMin, tempMax).toFixed(1)}" r="4"></circle>`;
      }).join('');
      return `
        <div class="pool-chart-wrap">
          <div class="consumption-chart-head"><strong>Trend vody</strong><span>posledních ${rows.length} měření</span></div>
          <svg class="consumption-chart pool-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Graf pH a teploty vody">
            <g class="consumption-grid">
              <line x1="${padLeft}" y1="${padTop}" x2="${width - padRight}" y2="${padTop}"></line>
              <line x1="${padLeft}" y1="${padTop + innerHeight / 2}" x2="${width - padRight}" y2="${padTop + innerHeight / 2}"></line>
              <line x1="${padLeft}" y1="${padTop + innerHeight}" x2="${width - padRight}" y2="${padTop + innerHeight}"></line>
              <text x="${padLeft - 8}" y="${padTop + 4}" text-anchor="end">pH ${phMax.toFixed(1)}</text>
              <text x="${padLeft - 8}" y="${padTop + innerHeight + 4}" text-anchor="end">pH ${phMin.toFixed(1)}</text>
            </g>
            ${phPath ? `<path class="pool-chart-line ph" d="${phPath}"></path>` : ''}
            ${tempPath ? `<path class="pool-chart-line temp" d="${tempPath}"></path>` : ''}
            ${phDots}${tempDots}
            <g class="consumption-bar">${labels}</g>
          </svg>
          <div class="consumption-chart-stats pool-chart-legend">
            <span><strong>pH</strong><em>modrá linka</em></span>
            <span><strong>°C</strong><em>zelená linka, vlastní měřítko</em></span>
          </div>
        </div>
      `;
    }

    function renderDimensionFields(pool) {
      if (pool.shape === 'custom') {
        return field('Objem vody m³', 'volumeM3', 'number', 'např. 24', true, pool.volumeM3 || '');
      }
      if (pool.shape === 'round') {
        return `
          ${field('Průměr m', 'diameter', 'number', 'např. 4,5', true, pool.diameter || '')}
          ${field('Průměrná hloubka m', 'depth', 'number', 'např. 1,2', true, pool.depth || '')}
        `;
      }
      return `
        ${field('Délka m', 'length', 'number', 'např. 6', true, pool.length || '')}
        ${field('Šířka m', 'width', 'number', 'např. 3', true, pool.width || '')}
        ${field('Průměrná hloubka m', 'depth', 'number', 'např. 1,2', true, pool.depth || '')}
      `;
    }

    function renderPoolSwitcher(pools, activePool) {
      if (!pools.length) return '';
      return `
        <div class="pool-switcher" data-no-swipe>
          ${pools.map((pool) => `
            <button class="pool-switcher-chip ${activePool && pool.id === activePool.id ? 'active' : ''}" type="button" data-action="pool-select" data-id="${escapeHtml(pool.id)}">${escapeHtml(pool.name)}</button>
          `).join('')}
          <button class="pool-switcher-chip pool-switcher-add" type="button" data-action="pool-add">+ Nový bazén</button>
        </div>
      `;
    }

    function renderPoolSettingsForm(pool, exists = true) {
      return `
        <form data-form="pool-settings" class="compact-form pool-form">
          <div class="form-grid two">
            ${field('Název bazénu', 'name', 'text', 'např. Zahradní bazén', true, pool.name || '')}
            ${selectField('Tvar bazénu', 'shape', SHAPE_OPTIONS, pool.shape)}
            ${renderDimensionFields(pool)}
            ${field('Cílové pH', 'targetPh', 'number', 'např. 7,2', false, pool.targetPh || 7.2)}
            ${field('Dávka g / 10 m³ / 0,1 pH', 'dosePer10m3Per01', 'number', 'např. 100', false, pool.dosePer10m3Per01 || 100)}
            ${field('Poznámka', 'note', 'text', 'např. po dešti / chlorování', false, pool.note || '')}
          </div>
          <div class="inline-note compact-note">Dávkování je orientační. Vždy ho porovnej s etiketou konkrétního pH+ / pH- přípravku. Aktuální pH a teplotu vody zapisuješ v záložce „Nové měření“.</div>
          <div class="form-actions">
            <button class="primary-btn" type="submit">${exists ? 'Uložit nastavení' : 'Založit bazén'}</button>
            ${exists ? `<button class="danger-btn" type="button" data-action="pool-delete" data-id="${escapeHtml(pool.id)}">Smazat tento bazén</button>` : ''}
          </div>
        </form>
      `;
    }

    // "Nové měření" má záměrně jen 2 pole - pH a teplotu vody. Datum/čas se
    // berou automaticky (teď), zbytek bazénu (rozměry, cílové pH, dávkování)
    // patří do Nastavení, ne sem - uživatel chce při zápisu měření zadávat
    // jen tyhle dvě hodnoty, nic víc.
    function renderPoolMeasurementForm(pool) {
      return `
        <form data-form="pool-add-measurement" class="compact-form pool-form">
          <div class="form-grid two">
            ${field('Aktuální pH', 'ph', 'number', 'např. 7,6', false, '')}
            ${field('Teplota vody °C', 'waterTempC', 'number', 'např. 24,5', false, '')}
          </div>
          <div class="form-actions">
            <button class="primary-btn" type="submit">Uložit měření</button>
          </div>
        </form>
      `;
    }

    function renderPool() {
      const pools = getPools();
      const pool = getActivePool(pools);
      if (!pool) {
        if (['add', 'settings'].includes(getModuleTab('pool', 'overview'))) {
          return `
            <section class="card desktop-span-2 pool-panel">
              <div class="card-header"><div><h2>Nový bazén</h2><p>Zadej rozměry a cílové pH, uložením se bazén založí.</p></div></div>
              ${renderPoolSettingsForm(normalizePool({}), false)}
            </section>
          `;
        }
        return renderEmptyCta({ icon: '🏊', title: 'Zatím žádný bazén', text: 'Založ bazén, nastav rozměry a cílové pH, ať se dá počítat objem vody a dávkování.', nav: 'pool', tab: 'settings', label: 'Založit bazén' });
      }
      const volume = poolVolumeM3(pool);
      const dose = poolPhDose(pool);
      const tone = dose.status === 'ok' ? 'good' : dose.status === 'missing' ? 'warn' : 'bad';
      const latest = latestPoolMeasurement(pool);
      const activeTab = getModuleTab('pool', 'overview');
      const tabs = renderSectionTabs('pool', [
        { id: 'overview', label: 'Přehled', icon: '🏊', count: normalizePoolMeasurements(pool.measurements).length },
        { id: 'add', label: 'Nové měření', icon: '➕' },
        { id: 'settings', label: 'Nastavení', icon: '⚙️' }
      ], 'overview');
      return `
        <section class="card desktop-span-2 pool-panel">
          <div class="card-header"><div><h2>${escapeHtml(pool.name)}</h2><p>Objem vody, poslední pH a orientační dávka pH přípravku.</p></div><span class="badge">${formatVolume(volume)}</span></div>
          ${renderPoolSwitcher(pools, pool)}
          ${tabs}
          <div class="module-tabbed pool-tab-${escapeHtml(activeTab)}" data-tab-area="pool">
            ${activeTab === 'add' ? renderPoolMeasurementForm(pool) : activeTab === 'settings' ? renderPoolSettingsForm(pool, true) : `
              <div class="kpi-grid compact-kpi-grid">
                <div class="kpi"><strong>${formatVolume(volume)}</strong><span>objem vody</span></div>
                <button type="button" class="kpi kpi-clickable" data-action="pool-ph-info"><strong>${pool.ph || '—'}</strong><span>aktuální pH</span></button>
                <div class="kpi"><strong>${pool.waterTempC ? `${formatPoolNumber(pool.waterTempC, 1)} °C` : '—'}</strong><span>teplota vody</span></div>
                <div class="kpi ${tone}"><strong>${dose.status === 'ok' ? 'OK' : dose.status === 'missing' ? 'doplň' : formatGrams(dose.grams)}</strong><span>${escapeHtml(dose.label)}</span></div>
              </div>
              ${pool.updatedAt ? `<div class="inline-note compact-note">Naposledy upraveno ${escapeHtml(formatDateTime(pool.updatedAt))}${latest?.date ? ` · měření ${escapeHtml(formatDate(latest.date))}${latest.time ? ` ${escapeHtml(latest.time)}` : ''}` : ''}${pool.note ? ` · ${escapeHtml(pool.note)}` : ''}</div>` : ''}
            `}
          </div>
        </section>
        ${activeTab === 'overview' ? renderPoolMeasurements(pool) : ''}
        ${volume > 0 ? '' : renderEmptyCta({ icon: '🏊', title: 'Zadej rozměry bazénu', text: 'Pak se dopočítá objem vody a dávkování podle naměřeného pH.', nav: 'pool', tab: 'settings', label: 'Nastavit bazén' })}
        ${renderPhInfoModal(pool)}
      `;
    }

    function markPoolCloudPending(options = {}) {
      const state = getState();
      const now = new Date().toISOString();
      const deletedIds = { ...(state.poolCloud?.deletedIds || {}) };
      const deletedId = normalizeText(options.deletedId);
      if (deletedId) deletedIds[deletedId] = now;
      state.poolCloud = {
        ...(state.poolCloud || {}),
        pendingAt: now,
        deletedIds
      };
    }

    function markPoolCloudSaved() {
      const state = getState();
      state.poolCloud = {
        ...(state.poolCloud || {}),
        pendingAt: '',
        loadedAt: new Date().toISOString(),
        deletedIds: { ...(state.poolCloud?.deletedIds || {}) }
      };
      saveState({ immediate: true });
    }

    function persistPools(pools, options = {}) {
      getState().pools = normalizePools(pools);
      markPoolCloudPending(options);
      touchState();
      saveState({ immediate: options.immediate === true });
      if (cloudReady()) {
        cloudSaveHouseholdUiSettings(false)
          .then((ok) => { if (ok) markPoolCloudSaved(); })
          .catch((error) => console.warn('Cloud sync (bazén) na pozadí selhal', error));
      }
    }

    function addPool() {
      const pools = getPools();
      const pool = normalizePool({ name: `Bazén ${pools.length + 1}` }, pools.length);
      persistPools([...pools, pool]);
      activePoolId = pool.id;
      setModuleTab('pool', 'settings');
      render();
      showToast('Nový bazén přidán, doplň rozměry');
    }

    function previewShape(shape) {
      const pools = getPools();
      const active = getActivePool(pools);
      if (!active) return;
      const updated = normalizePool({ ...active, shape });
      getState().pools = pools.map((pool) => (pool.id === active.id ? updated : pool));
      render();
    }

    function selectPool(id) {
      const pools = getPools();
      if (!pools.some((pool) => pool.id === id)) return;
      activePoolId = id;
      render();
    }

    function deletePool(id) {
      const pools = getPools();
      const target = pools.find((pool) => pool.id === id);
      if (!target) return;
      if (!confirm(`Smazat bazén „${target.name}“${target.measurements.length ? ` včetně ${target.measurements.length} měření` : ''}?`)) return;
      const next = pools.filter((pool) => pool.id !== id);
      if (activePoolId === id) activePoolId = next[0]?.id || '';
      persistPools(next, { deletedId: id, immediate: true });
      setModuleTab('pool', 'overview');
      render();
      showToast('Bazén smazán');
    }

    function poolWithLatestMeasurementState(pool) {
      const measurements = normalizePoolMeasurements(pool.measurements || []);
      const latest = measurements.length ? measurements[measurements.length - 1] : null;
      return normalizePool({
        ...pool,
        measurements,
        ph: latest ? latest.ph : '',
        waterTempC: latest ? latest.waterTempC : '',
        updatedAt: new Date().toISOString()
      });
    }

    function setPoolMeasurementEdit(id) {
      activePoolMeasurementEditId = activePoolMeasurementEditId === id ? '' : normalizeText(id);
      render();
    }

    function cancelPoolMeasurementEdit() {
      if (!activePoolMeasurementEditId) return;
      activePoolMeasurementEditId = '';
      render();
    }

    function updatePoolMeasurementFromForm(id, data) {
      const cleanId = normalizeText(id);
      if (!cleanId) return;
      const pools = getPools();
      const current = getActivePool(pools);
      if (!current) return;
      const existing = normalizePoolMeasurements(current.measurements || []).find((item) => item.id === cleanId);
      if (!existing) return;
      const updatedMeasurement = normalizePoolMeasurement({
        ...existing,
        date: normalizeText(data.date) || existing.date || todayISO(),
        time: normalizePoolTime(data.time) || existing.time || '',
        ph: data.ph,
        waterTempC: data.waterTempC,
        note: data.note,
        createdAt: existing.createdAt
      });
      if (updatedMeasurement.ph === '' && updatedMeasurement.waterTempC === '') {
        showToast('Zadej pH nebo teplotu vody');
        return;
      }
      const nextMeasurements = normalizePoolMeasurements((current.measurements || []).map((item) => (
        item.id === cleanId ? updatedMeasurement : item
      )));
      const nextPool = poolWithLatestMeasurementState({ ...current, measurements: nextMeasurements });
      const nextPools = pools.map((pool) => (pool.id === current.id ? nextPool : pool));
      activePoolMeasurementEditId = '';
      persistPools(nextPools, { immediate: true });
      render();
      showToast('Měření upraveno');
    }

    function deletePoolMeasurement(id) {
      const cleanId = normalizeText(id);
      if (!cleanId) return;
      const pools = getPools();
      const current = getActivePool(pools);
      if (!current) return;
      const measurements = normalizePoolMeasurements(current.measurements || []);
      const target = measurements.find((item) => item.id === cleanId);
      if (!target) return;
      if (!confirm(`Smazat měření z ${formatDate(target.date)}${target.time ? ` ${target.time}` : ''}?`)) return;
      const nextMeasurements = measurements.filter((item) => item.id !== cleanId);
      const nextPool = poolWithLatestMeasurementState({ ...current, measurements: nextMeasurements });
      const nextPools = pools.map((pool) => (pool.id === current.id ? nextPool : pool));
      if (activePoolMeasurementEditId === cleanId) activePoolMeasurementEditId = '';
      persistPools(nextPools, { immediate: true });
      render();
      showToast('Měření smazáno');
    }

    // Nastavení bazénu (název/tvar/rozměry/cílové pH/dávkování/poznámka) -
    // NIKDY se tu nezapisuje měření ani se nemění aktuální pH/teplota vody,
    // to žije jen v addPoolMeasurementFromForm/měřeních. Založení nového
    // bazénu jde přes stejný formulář (exists=false).
    function savePoolFromForm(data) {
      const pools = getPools();
      const current = getActivePool(pools) || normalizePool({}, pools.length);
      const next = normalizePool({
        ...current,
        ...data,
        name: normalizeText(data.name) || current.name,
        updatedAt: new Date().toISOString()
      });
      const exists = pools.some((pool) => pool.id === current.id);
      const nextPools = exists ? pools.map((pool) => (pool.id === current.id ? next : pool)) : [...pools, next];
      activePoolId = next.id;
      persistPools(nextPools);
      render();
      showToast(exists ? 'Nastavení bazénu uloženo' : 'Bazén založen');
    }

    // "Nové měření" - jen pH a teplota vody, datum/čas se berou automaticky.
    // Vždy zapíše nový záznam do historie (na rozdíl od dřívějšího chování,
    // kdy uložení nastavení mimochodem přidalo měření jen když se pH/teplota
    // lišily od posledního záznamu - teď je to oddělená, výslovná akce).
    function addPoolMeasurementFromForm(data) {
      const pools = getPools();
      const current = getActivePool(pools);
      if (!current) return showToast('Nejdřív založ bazén');
      const typedPh = normalizeText(data.ph);
      const typedWaterTempC = normalizeText(data.waterTempC);
      if (typedPh === '' && typedWaterTempC === '') {
        showToast('Zadej pH nebo teplotu vody');
        return;
      }
      const measurement = normalizePoolMeasurement({
        date: todayISO(),
        time: currentPoolTime(),
        ph: typedPh === '' ? '' : data.ph,
        waterTempC: typedWaterTempC === '' ? '' : data.waterTempC
      });
      const nextMeasurements = normalizePoolMeasurements([...(current.measurements || []), measurement]);
      const nextPool = poolWithLatestMeasurementState({ ...current, measurements: nextMeasurements });
      const nextPools = pools.map((pool) => (pool.id === current.id ? nextPool : pool));
      persistPools(nextPools, { immediate: true });
      render();
      showToast('Měření uloženo');
    }

    return {
      normalizePool,
      normalizePools,
      normalizePoolCloudState,
      poolDeleteWinsOverCloud,
      getPools,
      getActivePool,
      poolVolumeM3,
      formatPoolVolume: formatVolume,
      poolPhDose,
      latestPoolMeasurement,
      renderPool,
      savePoolFromForm,
      addPoolMeasurementFromForm,
      addPool,
      selectPool,
      deletePool,
      setPoolMeasurementEdit,
      cancelPoolMeasurementEdit,
      updatePoolMeasurementFromForm,
      deletePoolMeasurement,
      previewShape,
      openPhInfoModal,
      closePhInfoModal,
      ui: {
        overlay: {
          isOpen: isPhInfoModalOpen,
          close: closePhInfoModal
        }
      }
    };
  }

  window.DomacnostPool = { createPool };
})();
