(function () {
  'use strict';

  const ASSET_VERSION = '0-1-487';
  const definitions = {
    shopping: {
      styles: ['shopping.css'],
      scripts: ['shopping-utils.js', 'shopping-render.js', 'shopping-actions.js'],
      ready: () => Boolean(window.DomacnostShoppingUtils && window.DomacnostShoppingRender && window.DomacnostShoppingActions)
    },
    tasks: {
      scripts: ['notes.js'],
      ready: () => Boolean(window.DomacnostNotes)
    },
    contracts: {
      scripts: ['contracts.js'],
      ready: () => Boolean(window.DomacnostContracts)
    },
    subscriptions: {
      scripts: ['subscriptions.js'],
      ready: () => Boolean(window.DomacnostSubscriptions)
    },
    warranties: {
      scripts: ['warranty.js'],
      ready: () => Boolean(window.DomacnostWarranty)
    },
    hdo: {
      scripts: ['hdo.js'],
      ready: () => Boolean(window.DomacnostHdo)
    },
    waste: {
      scripts: ['waste.js'],
      ready: () => Boolean(window.DomacnostWaste)
    },
    finance: {
      scripts: ['finance.js'],
      ready: () => Boolean(window.DomacnostFinance)
    },
    pool: {
      scripts: ['pool.js'],
      ready: () => Boolean(window.DomacnostPool)
    },
    calendar: {
      scripts: ['calendar.js'],
      ready: () => Boolean(window.DomacnostCalendar)
    },
    vape: {
      scripts: ['vape.js'],
      ready: () => Boolean(window.DomacnostVape)
    }
  };

  const assetPromises = new Map();
  const modulePromises = new Map();

  function versionedUrl(path) {
    return new URL(`./${path}?v=${ASSET_VERSION}`, document.baseURI).href;
  }

  function loadScript(path) {
    const key = `script:${path}`;
    if (assetPromises.has(key)) return assetPromises.get(key);
    const existing = Array.from(document.scripts).find((node) => new URL(node.src || '', document.baseURI).pathname.endsWith(`/${path}`));
    if (existing?.dataset.loaded === 'true') return Promise.resolve(true);

    const promise = new Promise((resolve, reject) => {
      const script = existing || document.createElement('script');
      const onLoad = () => {
        script.dataset.loaded = 'true';
        resolve(true);
      };
      const onError = () => reject(new Error(`Nepodařilo se načíst ${path}`));
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onError, { once: true });
      if (!existing) {
        script.src = versionedUrl(path);
        script.async = false;
        script.dataset.domacnostAsset = path;
        document.head.appendChild(script);
      }
    });
    assetPromises.set(key, promise);
    return promise;
  }

  function loadStyle(path) {
    const key = `style:${path}`;
    if (assetPromises.has(key)) return assetPromises.get(key);
    const existing = Array.from(document.styleSheets)
      .map((sheet) => sheet.ownerNode)
      .find((node) => node?.href && new URL(node.href, document.baseURI).pathname.endsWith(`/${path}`));
    if (existing) return Promise.resolve(true);

    const promise = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = versionedUrl(path);
      link.dataset.domacnostAsset = path;
      link.addEventListener('load', () => resolve(true), { once: true });
      link.addEventListener('error', () => reject(new Error(`Nepodařilo se načíst ${path}`)), { once: true });
      document.head.appendChild(link);
    });
    assetPromises.set(key, promise);
    return promise;
  }

  async function ensure(moduleId) {
    const id = String(moduleId || '');
    const definition = definitions[id];
    if (!definition || definition.ready?.()) return true;
    if (modulePromises.has(id)) return modulePromises.get(id);

    const promise = (async () => {
      await Promise.all((definition.styles || []).map(loadStyle));
      for (const script of definition.scripts || []) await loadScript(script);
      if (!definition.ready?.()) throw new Error(`Modul ${id} se nenačetl úplně`);
      window.dispatchEvent(new CustomEvent('domacnost:module-code-ready', { detail: { moduleId: id } }));
      return true;
    })().catch((error) => {
      modulePromises.delete(id);
      throw error;
    });
    modulePromises.set(id, promise);
    return promise;
  }

  function isReady(moduleId) {
    const definition = definitions[String(moduleId || '')];
    return !definition || Boolean(definition.ready?.());
  }

  async function start() {
    // Domovské souhrny používají lehké datové adaptéry v app.js. Žádný celý
    // funkční modul proto nesmí blokovat první obrazovku, ani když je jeho
    // widget připnutý na domovské stránce.
    await loadScript('app.js');
  }

  window.DomacnostModuleLoader = { ensure, isReady, start };
  start().catch((error) => {
    console.error('Domácnost+ module bootstrap failed', error);
    window.dispatchEvent(new CustomEvent('domacnost:boot-error', { detail: { message: error?.message || String(error) } }));
  });
})();
