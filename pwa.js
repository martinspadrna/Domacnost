(function () {
  'use strict';

  // Domácnost+ PWA modul — extrakce z app.js (v.0.1_323).
  // Drží stav instalačního promptu, service worker registrace a update flow;
  // renderuje kartu "Aktualizace a cache" v Nastavení → Data a bohatší kartu
  // "Instalace aplikace" v Cloud/PWA sekci; poskytuje akce pro instalaci,
  // diagnostiku, kontrolu / použití update a bezpečné vyčištění naší cache.
  //
  // Modul spravuje pět runtime příznaků v closure (deferredInstallPrompt,
  // serviceWorkerRegistration, pendingServiceWorker, pwaUpdateAvailable,
  // pwaControllerReloadTriggered). Perzistentní pole žijí ve state.pwa
  // (installed, lastUpdateCheck, lastInstallPrompt, lastCacheClearAt,
  // diagnostics). Stav se čte pokaždé přes getState(), aby modul přežil
  // reassign hlavního state (workspace switch / hydrate).
  function createPwa(deps) {
    const getState = deps.getState || (() => ({}));
    const saveState = deps.saveState || (() => {});
    const render = deps.render || (() => {});
    const showToast = deps.showToast || (() => {});
    const escapeHtml = deps.escapeHtml || ((v) => String(v ?? ''));
    const formatDateTime = deps.formatDateTime || ((v) => String(v || ''));
    const APP_VERSION = deps.APP_VERSION || 'Domácnost+';
    const APP_BUILD = deps.APP_BUILD || 0;

    // Sladěno s boot fallbackem v index.html (key.indexOf('domacnost-plus-')
    // === 0) a s activate handlerem v sw.js (startsWith CACHE_PREFIX). Cizí
    // cache jiných PWA na stejném originu se nesmí mazat.
    const PWA_CACHE_PREFIX = 'domacnost-plus-';
    const PWA_EXPECTED_CACHE = `${PWA_CACHE_PREFIX}v0-1-${APP_BUILD}`;

    let deferredInstallPrompt = null;
    let serviceWorkerRegistration = null;
    let pendingServiceWorker = null;
    let pwaUpdateAvailable = false;
    let pwaControllerReloadTriggered = false;
    let userRequestedUpdate = false;
    let lastAutoUpdateCheckAt = 0;
    // Zachyceno co nejdřív po startu: vrácející se uživatel má aktivní SW z
    // minula, takže "controller" je nastavený hned (žádná změna, appka
    // je pořád ta samá běžící verze). Naproti tomu první instalace SW (po
    // reinstalaci appky, vyčištění dat, nebo prvním otevření) jde z null na
    // worker přes clients.claim() - stránka už ale běží se správnou (jedinou
    // dostupnou) verzí, není co reloadovat. Bez tohohle rozlišení
    // controllerchange reloadoval appku hned po každém prvním claimu, což
    // vypadalo jako "pár vteřin po startu nejde nic kliknout".
    let hadServiceWorkerControllerAtBoot = ('serviceWorker' in navigator) && Boolean(navigator.serviceWorker.controller);

    function getPwaStatus() {
      const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
      const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
      const swSupported = 'serviceWorker' in navigator && location.protocol !== 'file:';
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
      const android = /android/i.test(navigator.userAgent || '');
      const manifestLink = document.querySelector('link[rel="manifest"]');
      const appleLinks = Array.from(document.querySelectorAll('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]'));
      const iconLinks = Array.from(document.querySelectorAll('link[rel~="icon"]'));
      return {
        standalone,
        secure,
        swSupported,
        ios,
        android,
        canPrompt: Boolean(deferredInstallPrompt),
        updateAvailable: Boolean(pwaUpdateAvailable),
        fileMode: location.protocol === 'file:',
        manifestHref: manifestLink ? new URL(manifestLink.getAttribute('href'), location.href).href : '',
        appleIconCount: appleLinks.length,
        iconCount: iconLinks.length,
        swControlled: Boolean(navigator.serviceWorker?.controller),
        swReady: Boolean(serviceWorkerRegistration),
        protocol: location.protocol.replace(':', ''),
        host: location.host || 'lokální soubor'
      };
    }

    function renderPwaDiagnostics() {
      const diagnostics = getState().pwa?.diagnostics;
      if (!diagnostics?.checks?.length) {
        return `<div class="hint-box">Diagnostiku spusť po otevření aplikace z Vercelu/HTTPS. Zkontroluje manifest, dostupnost ikon, Apple touch ikony, service worker a režim instalace.</div>`;
      }
      const okCount = diagnostics.checks.filter((item) => item.status === 'ok').length;
      const warnCount = diagnostics.checks.filter((item) => item.status === 'warn').length;
      const badCount = diagnostics.checks.filter((item) => item.status === 'bad').length;
      return `
        <div class="pwa-diagnostic-summary">
          <span class="badge good">OK ${okCount}</span>
          <span class="badge warn">Pozor ${warnCount}</span>
          <span class="badge bad">Chyba ${badCount}</span>
          <span class="badge">${escapeHtml(formatDateTime(diagnostics.checkedAt))}</span>
        </div>
        <div class="diagnostic-list">
          ${diagnostics.checks.map((item) => `
            <div class="diagnostic-row ${escapeHtml(item.status)}">
              <span class="diagnostic-dot" aria-hidden="true"></span>
              <div>
                <strong>${escapeHtml(item.label)}</strong>
                <em>${escapeHtml(item.message)}</em>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Kompaktní karta pro Nastavení → Data. Zobrazuje release/cache stav
    // a nabízí přesně tři akce, které user může chtít po update problémech:
    // Zkontrolovat aktualizaci, Použít novou verzi (jen když čeká waiting SW)
    // a Vyčistit cache aplikace (jen naše cache klíče). Bohatší diagnostika
    // ikon/manifestu zůstává v renderPwaInstallCard v Cloud/PWA sekci.
    function renderPwaUpdateStatusCard() {
      const swSupported = 'serviceWorker' in navigator;
      const swReady = Boolean(serviceWorkerRegistration);
      const swControlling = Boolean(navigator.serviceWorker?.controller);
      const pwaState = getState().pwa || {};
      const lastCheck = pwaState.lastUpdateCheck ? formatDateTime(pwaState.lastUpdateCheck) : 'zatím neprobíhla';
      const lastClear = pwaState.lastCacheClearAt ? formatDateTime(pwaState.lastCacheClearAt) : '';
      let statusTone = 'good';
      let statusLabel = 'aktuální';
      let statusNote = 'Verze v prohlížeči odpovídá poslednímu deployi.';
      if (!swSupported) {
        statusTone = 'warn';
        statusLabel = 'SW nedostupný';
        statusNote = 'Prohlížeč nepodporuje Service Worker nebo běžíš z lokálního souboru. Automatické aktualizace nefungují.';
      } else if (!swReady) {
        statusTone = '';
        statusLabel = 'SW se registruje';
        statusNote = 'Service worker se ještě neregistroval — dej mu pár sekund po prvním otevření.';
      } else if (pwaUpdateAvailable) {
        statusTone = 'warn';
        statusLabel = 'nová verze čeká';
        statusNote = 'Stáhla se novější verze aplikace. Použij „Použít novou verzi" a stránka se obnoví.';
      } else if (!swControlling) {
        statusTone = '';
        statusLabel = 'první instalace SW';
        statusNote = 'Service worker je registrovaný, ale ještě nekontroluje stránku. Update se aktivuje po dalším reloadu.';
      }
      return `
        <section class="card compact-settings-card">
          <div class="card-header">
            <div><h2>Aktualizace a cache</h2><p>Kontrola nové verze a bezpečné vyčištění PWA cache. Data domácnosti se nemažou.</p></div>
            <span class="badge ${statusTone}">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="cloud-status-grid compact-cloud-stats">
            <div class="mini-stat"><span>Verze</span><strong>${escapeHtml(APP_VERSION)}</strong></div>
            <div class="mini-stat"><span>Build</span><strong>${APP_BUILD}</strong></div>
            <div class="mini-stat"><span>Cache klíč</span><strong>${escapeHtml(PWA_EXPECTED_CACHE)}</strong></div>
            <div class="mini-stat"><span>Poslední kontrola</span><strong>${escapeHtml(lastCheck)}</strong></div>
          </div>
          <div class="inline-note">${escapeHtml(statusNote)}${lastClear ? ` Cache naposled vyčištěná ${escapeHtml(lastClear)}.` : ''}</div>
          <div class="form-actions compact-actions">
            <button class="ghost-btn" type="button" data-action="pwa-check-update">Zkontrolovat aktualizaci</button>
            ${pwaUpdateAvailable ? '<button class="primary-btn" type="button" data-action="pwa-apply-update">Použít novou verzi</button>' : ''}
            <button class="ghost-btn" type="button" data-action="pwa-clear-cache">Vyčistit cache aplikace</button>
          </div>
        </section>
      `;
    }

    function renderPwaInstallCard() {
      const pwa = getPwaStatus();
      const statusLabel = pwa.standalone ? 'nainstalováno' : pwa.fileMode ? 'lokální soubor' : pwa.canPrompt ? 'lze instalovat' : 'připraveno';
      return `
        <section class="card desktop-span-2 pwa-card">
          <div class="card-header">
            <div><h2>Instalace aplikace</h2><p>Domácnost+ je instalovatelná PWA. Tahle část teď umí i diagnostiku ikon, manifestu a service workeru.</p></div>
            <span class="badge ${pwa.standalone ? 'good' : pwa.updateAvailable ? 'warn' : ''}">${statusLabel}</span>
          </div>
          <div class="cloud-status-grid">
            <div class="mini-stat"><span>Režim</span><strong>${pwa.standalone ? 'samostatná app' : 'prohlížeč'}</strong></div>
            <div class="mini-stat"><span>Adresa</span><strong>${escapeHtml(pwa.host)}</strong></div>
            <div class="mini-stat"><span>Service worker</span><strong>${pwa.swControlled ? 'aktivní' : pwa.swSupported ? 'podporovaný' : 'není dostupný'}</strong></div>
            <div class="mini-stat"><span>Apple ikony</span><strong>${pwa.appleIconCount} odkazů</strong></div>
            <div class="mini-stat"><span>Manifest</span><strong>${pwa.manifestHref ? 'nalezen' : 'chybí'}</strong></div>
            <div class="mini-stat"><span>Verze</span><strong>${escapeHtml(APP_VERSION)}</strong></div>
          </div>
          ${pwa.fileMode ? `<div class="hint-box warn-box">Teď je appka otevřená jako lokální soubor ze ZIPu. Instalace, ikona a automatické aktualizace fungují správně až přes HTTPS, typicky přes Vercel.</div>` : ''}
          <div class="hint-box">Když se na iPhonu pořád ukazuje stará nebo prázdná ikona, smaž starou ikonu z plochy, otevři web znovu v Safari a přidej ji znovu. iOS si ikonu ukládá mimo běžnou web cache.</div>
          <div class="install-steps">
            <div class="install-step"><strong>iPhone / iPad</strong><span>Safari → Sdílet → Přidat na plochu. iOS bere hlavně apple-touch-icon, proto je kontrolujeme zvlášť.</span></div>
            <div class="install-step"><strong>Android / Chrome</strong><span>Menu prohlížeče → Instalovat aplikaci. Tlačítko se objeví jen když Chrome pošle instalační prompt.</span></div>
            <div class="install-step"><strong>Update</strong><span>Nová verze se po nasazení přes Vercel zkontroluje automaticky pomocí service workeru.</span></div>
          </div>
          <div class="form-actions">
            ${pwa.canPrompt ? `<button class="primary-btn" type="button" data-action="pwa-install">Instalovat aplikaci</button>` : ''}
            <button class="ghost-btn" type="button" data-action="pwa-run-diagnostics">Spustit diagnostiku</button>
            <button class="ghost-btn" type="button" data-action="pwa-check-update">Zkontrolovat update</button>
            <button class="ghost-btn" type="button" data-action="pwa-clear-cache">Vyčistit PWA cache</button>
            ${pwa.updateAvailable ? `<button class="primary-btn" type="button" data-action="pwa-apply-update">Aktualizovat na novou verzi</button>` : ''}
          </div>
          ${renderPwaDiagnostics()}
        </section>
      `;
    }

    function addDiagnostic(checks, label, status, message) {
      checks.push({ label, status, message });
    }

    function loadImageInfo(src) {
      return new Promise((resolve) => {
        if (!src) {
          resolve({ ok: false, width: 0, height: 0, message: 'Chybí cesta' });
          return;
        }
        const image = new Image();
        const timer = window.setTimeout(() => {
          image.onload = null;
          image.onerror = null;
          resolve({ ok: false, width: 0, height: 0, message: 'Timeout načtení' });
        }, 6000);
        image.onload = () => {
          window.clearTimeout(timer);
          resolve({ ok: true, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, message: 'OK' });
        };
        image.onerror = () => {
          window.clearTimeout(timer);
          resolve({ ok: false, width: 0, height: 0, message: 'Obrázek se nenačetl' });
        };
        image.src = src;
      });
    }

    async function verifyIcon(checks, label, src, expectedWidth = 0) {
      const info = await loadImageInfo(src);
      if (!info.ok) {
        addDiagnostic(checks, label, 'bad', `${info.message}: ${src}`);
        return;
      }
      const sizeText = `${info.width}×${info.height}`;
      if (expectedWidth && (info.width < expectedWidth || info.height < expectedWidth)) {
        addDiagnostic(checks, label, 'warn', `Načteno, ale malé: ${sizeText}`);
        return;
      }
      addDiagnostic(checks, label, 'ok', `Načteno ${sizeText}`);
    }

    async function runPwaDiagnostics() {
      showToast('Spouštím PWA diagnostiku');
      const checks = [];
      const pwa = getPwaStatus();

      addDiagnostic(checks, 'HTTPS / Vercel', pwa.secure && !pwa.fileMode ? 'ok' : 'warn', pwa.fileMode ? 'Otevřeno jako lokální ZIP; instalace nebude spolehlivá.' : `Protokol: ${pwa.protocol}`);
      addDiagnostic(checks, 'Standalone režim', pwa.standalone ? 'ok' : 'warn', pwa.standalone ? 'Aplikace běží jako nainstalovaná.' : 'Aplikace zatím běží v prohlížeči.');
      addDiagnostic(checks, 'Service worker podpora', pwa.swSupported ? 'ok' : 'bad', pwa.swSupported ? 'Prohlížeč service worker podporuje.' : 'Service worker není dostupný.');
      addDiagnostic(checks, 'Service worker řízení stránky', pwa.swControlled ? 'ok' : 'warn', pwa.swControlled ? 'Aktivní service worker řídí stránku.' : 'Po prvním načtení může být potřeba stránku obnovit.');
      addDiagnostic(checks, 'Instalační prompt', pwa.canPrompt ? 'ok' : (pwa.ios ? 'warn' : 'warn'), pwa.canPrompt ? 'Chrome nabízí instalaci tlačítkem.' : (pwa.ios ? 'Na iPhonu se používá Sdílet → Přidat na plochu.' : 'Prohlížeč zatím neposlal instalační prompt.'));

      const manifestLink = document.querySelector('link[rel="manifest"]');
      if (!manifestLink) {
        addDiagnostic(checks, 'Manifest odkaz', 'bad', 'V HTML chybí link rel="manifest".');
      } else {
        const manifestUrl = new URL(manifestLink.getAttribute('href'), location.href).href;
        addDiagnostic(checks, 'Manifest odkaz', 'ok', manifestUrl);
        try {
          const response = await fetch(manifestUrl, { cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const manifest = await response.json();
          addDiagnostic(checks, 'Manifest načtení', 'ok', `${manifest.name || 'bez názvu'} / ${manifest.display || 'bez display'}`);
          addDiagnostic(checks, 'Manifest display', manifest.display === 'standalone' ? 'ok' : 'warn', `display: ${manifest.display || 'neuvedeno'}`);
          const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
          const has192 = icons.some((icon) => String(icon.sizes || '').includes('192x192'));
          const has512 = icons.some((icon) => String(icon.sizes || '').includes('512x512'));
          const hasMaskable = icons.some((icon) => String(icon.purpose || '').includes('maskable'));
          addDiagnostic(checks, 'Manifest ikony', has192 && has512 ? 'ok' : 'bad', `${icons.length} ikon, 192: ${has192 ? 'ano' : 'ne'}, 512: ${has512 ? 'ano' : 'ne'}, maskable: ${hasMaskable ? 'ano' : 'ne'}`);
          const icon512 = icons.find((icon) => String(icon.sizes || '').includes('512x512') && !String(icon.purpose || '').includes('maskable')) || icons.find((icon) => String(icon.sizes || '').includes('512x512'));
          const icon192 = icons.find((icon) => String(icon.sizes || '').includes('192x192') && !String(icon.purpose || '').includes('maskable')) || icons.find((icon) => String(icon.sizes || '').includes('192x192'));
          if (icon192?.src) await verifyIcon(checks, 'Manifest 192 ikona', new URL(icon192.src, manifestUrl).href, 192);
          if (icon512?.src) await verifyIcon(checks, 'Manifest 512 ikona', new URL(icon512.src, manifestUrl).href, 512);
        } catch (error) {
          addDiagnostic(checks, 'Manifest načtení', 'bad', error?.message || 'Manifest se nepodařilo načíst.');
        }
      }

      const appleLinks = Array.from(document.querySelectorAll('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]'));
      addDiagnostic(checks, 'Apple touch odkazy', appleLinks.length >= 2 ? 'ok' : 'warn', `${appleLinks.length} odkazů v HTML`);
      const apple180 = appleLinks.find((link) => link.getAttribute('sizes') === '180x180') || appleLinks[0];
      if (apple180) await verifyIcon(checks, 'Apple touch ikona', new URL(apple180.getAttribute('href'), location.href).href, 120);
      await verifyIcon(checks, 'Apple touch ikona v icons', new URL('./icons/apple-touch-icon.png', location.href).href, 120);
      await verifyIcon(checks, 'Favicon v icons', new URL('./icons/favicon.ico', location.href).href, 16);

      const state = getState();
      state.pwa = {
        ...(state.pwa || {}),
        diagnostics: {
          checkedAt: new Date().toISOString(),
          appVersion: APP_VERSION,
          pageUrl: location.href,
          checks
        }
      };
      saveState();
      render();
      const bad = checks.filter((item) => item.status === 'bad').length;
      const warn = checks.filter((item) => item.status === 'warn').length;
      showToast(bad ? `Diagnostika našla ${bad} chyb` : warn ? `Diagnostika hotová, ${warn} upozornění` : 'Diagnostika OK');
    }

    async function listAppCacheKeys() {
      if (!('caches' in window)) return [];
      try {
        const keys = await caches.keys();
        return keys.filter((key) => key.startsWith(PWA_CACHE_PREFIX));
      } catch {
        return [];
      }
    }

    async function clearPwaCacheAndReload() {
      try {
        const appKeys = await listAppCacheKeys();
        if (appKeys.length) {
          await Promise.all(appKeys.map((key) => caches.delete(key)));
        }
        const state = getState();
        state.pwa = { ...(state.pwa || {}), lastCacheClearAt: new Date().toISOString() };
        saveState();
        if (serviceWorkerRegistration) await serviceWorkerRegistration.update();
        showToast('Cache vyčištěná, načítám znovu');
        window.setTimeout(() => window.location.reload(), 500);
      } catch {
        showToast('Cache se nepovedlo vyčistit');
      }
    }

    async function promptInstallApp() {
      if (!deferredInstallPrompt) {
        showToast('Instalace se teď nabízí přes menu prohlížeče');
        return;
      }
      deferredInstallPrompt.prompt();
      try {
        const choice = await deferredInstallPrompt.userChoice;
        if (choice?.outcome === 'accepted') {
          const state = getState();
          state.pwa = { ...(state.pwa || {}), installed: true, lastInstallPrompt: new Date().toISOString() };
          saveState();
          showToast('Instalace potvrzena');
        }
      } catch {
        showToast('Instalaci se nepovedlo spustit');
      }
      deferredInstallPrompt = null;
      render();
    }

    async function checkForAppUpdate(showMessage = false) {
      if (!serviceWorkerRegistration) {
        if (showMessage) showToast('Service worker zatím není připravený');
        return;
      }
      try {
        await serviceWorkerRegistration.update();
        const state = getState();
        state.pwa = { ...(state.pwa || {}), lastUpdateCheck: new Date().toISOString() };
        saveState();
        if (showMessage) showToast(pwaUpdateAvailable ? 'Je dostupná nová verze' : 'Update zkontrolován');
        render();
      } catch {
        if (showMessage) showToast('Update se nepovedlo zkontrolovat');
      }
    }

    function markUpdateAvailable(worker) {
      pendingServiceWorker = worker || pendingServiceWorker;
      pwaUpdateAvailable = true;
      render();
      showToast('Je dostupná nová verze aplikace');
    }

    function applyAppUpdate() {
      // Explicitní tap uživatele na "Aktualizovat" - na rozdíl od tichého
      // controllerchange na pozadí je bezpečné (a chtěné) rovnou obnovit
      // stránku, i na iOS. Timeout je pojistka pro standalone iOS PWA, kde
      // controllerchange po skipWaiting někdy vůbec nedorazí.
      userRequestedUpdate = true;
      if (pendingServiceWorker) {
        pendingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
        showToast('Aktualizuji aplikaci…');
        window.setTimeout(() => {
          if (pwaControllerReloadTriggered) return;
          pwaControllerReloadTriggered = true;
          window.location.reload();
        }, 2500);
        return;
      }
      window.location.reload();
    }

    // Volané při návratu appky do popředí (tab/PWA zpátky viditelná, focus).
    // Bez tohohle appka čekala jen na to, až si prohlížeč sám (throttlovaně,
    // klidně jednou za den) všimne nového sw.js - a uživatel tak reálně
    // dostával novou verzi, jen když appku po dlouhé době znovu nainstaloval.
    function maybeCheckForAppUpdateOnResume() {
      if (!serviceWorkerRegistration || pwaUpdateAvailable) return;
      const now = Date.now();
      if (now - lastAutoUpdateCheckAt < 60000) return;
      lastAutoUpdateCheckAt = now;
      checkForAppUpdate(false);
    }

    function setupInstallAndUpdateFlow() {
      window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        const state = getState();
        state.pwa = { ...(state.pwa || {}), lastInstallPrompt: new Date().toISOString() };
        saveState();
        render();
      });

      window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        const state = getState();
        state.pwa = { ...(state.pwa || {}), installed: true };
        saveState();
        showToast('Domácnost+ je nainstalovaná');
        render();
      });

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) maybeCheckForAppUpdateOnResume();
      });
      window.addEventListener('focus', maybeCheckForAppUpdateOnResume);
    }

    function registerServiceWorker() {
      if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then((registration) => {
          serviceWorkerRegistration = registration;
          if (registration.waiting && navigator.serviceWorker.controller) markUpdateAvailable(registration.waiting);
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) markUpdateAvailable(worker);
            });
          });
        }).catch(() => {});
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Guard proti reload smyčce: kdyby controllerchange přišel víckrát
        // těsně za sebou (nebo mezitím, co běží reload), pustíme reload
        // jen jednou.
        if (pwaControllerReloadTriggered) return;
        // První claim (viz hadServiceWorkerControllerAtBoot výše) neznamená
        // update běžící appky - stránka už doběhla se stejnou verzí, kterou
        // si SW právě nárokoval. Reload by jen zbytečně appku hned po startu
        // na chvíli zaseknul/restartoval, aniž by se cokoliv reálně změnilo.
        if (!hadServiceWorkerControllerAtBoot) {
          hadServiceWorkerControllerAtBoot = true;
          return;
        }
        // iOS: tichý reload na pozadí (bez tapu uživatele) je riskantní ve
        // standalone PWA, proto tam jen ukážeme trvalý pruh k dotažení.
        // Když si to ale uživatel právě odklikl přes "Aktualizovat"
        // (userRequestedUpdate), je to jeho gesto - obnovit rovnou.
        if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !userRequestedUpdate) {
          pwaUpdateAvailable = true;
          render();
          showToast('Nová verze k dispozici – klepni na Aktualizovat');
          return;
        }
        pwaControllerReloadTriggered = true;
        window.location.reload();
      });
    }

    return {
      // render
      renderPwaUpdateStatusCard,
      renderPwaInstallCard,
      // akce
      promptInstallApp,
      runPwaDiagnostics,
      clearPwaCacheAndReload,
      checkForAppUpdate,
      applyAppUpdate,
      // boot
      setupInstallAndUpdateFlow,
      registerServiceWorker,
      // pro debug/introspection
      getPwaStatus,
      isUpdateAvailable: () => pwaUpdateAvailable
    };
  }

  window.DomacnostPwa = { createPwa };
})();
