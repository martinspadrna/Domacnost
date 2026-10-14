# Domácnost+ — centrální handoff

Aktualizováno: 14. 10. 2026. Na začátku nového chatu načíst celý tento soubor, ověřit HEAD a nejnovější verzi. Nepoužívat safepoint, pokud to uživatel výslovně nepožádá.

## Verze a větve
- **Aktuální produkční verze: v0.1_541** (merge PR #33 `abf6a62ddb625ee9a31f7ff85bf19767ab4ccad2`, Vercel READY, CI PASS). Nové konverzace musí ověřit HEAD znovu.
- Historické kandidáty 537–540 už byly nasazeny. Hlavní P0 cloud sync **stále není fyzicky uzavřený**; další práce vychází z aktuálního main.
- Každá funkční změna = zvýšit verzi konzistentně ve všech release souborech. Zachovat PWA, Supabase Auth/DB/RLS, local-first, kompatibilitu a data.

## Plán projektu
| Fáze | Popis | Stav |
|---|---|---|
| P0 | Cloud sync a ochrana dat (fronty, konflikty, offline, restart) | ROZPRACOVÁNO |
| P1 | Local-first/start, okamžitá použitelnost UI | ČEKÁ |
| P2 | Cloud pokrytí všech modulů | ČEKÁ |
| P3 | Stabilita a výkon UI | ČEKÁ |
| P4 | UX a vzhled, mobil-first | ČEKÁ |

## P0: zjištění a řešení
1. **Předplatné:** Uživatel opakovaně vidí „1 změna čeká“, staré datum 29. 6. 2026, další pokus a zavádějící zelený text „Synchronizováno právě teď“. Zdroj je `subscriptionsCloud.pendingAt`. Snapshoty lze bezpečně porovnat funkcí `reconcileConfirmedSubscriptionPending`. Pokud se liší, nic automaticky nevymazávat ani nepřepsat.
2. **Možná kořenová příčina:** paralelní `cloudSaveHouseholdUiSettings` nad jednou `households.updated_at` CAS revizí; souběžné požadavky z jednoho zařízení mohou způsobit falešné konflikty. Kandidát 537 zařazuje všechny takové zápisy do fronty a kontroluje ID domácnosti při provedení.
3. **Finance:** `financeCloud.pendingAt` sleduje účty/pohyby, `templatesPendingAt` a `loansPendingAt` společný cloudový snapshot. `finance.js` po úspěšné odpovědi přímo mazal příznaky a mohl ztratit novější změnu. Kandidát 537 předává potvrzení pouze centrální kontrole snapshotu. Doplněno ověření shodných snapshot sekcí během baseline cloud save.
4. **UX:** Při `pending > 0` se nesmí zobrazovat „Synchronizováno“ jako stav bez výhrady. Kandidát 537 má stav „Čekají změny na uložení“.
5. **Bezpečnost:** zachovat CAS ochranu skutečných konfliktů mezi zařízeními, žádný force-overwrite, žádné plošné mazání pending markerů, storage, outboxu nebo dat uživatele.

## Ověření a otevřené body
- [x] GitHub CI: syntax, release, static, memo, wiring, CSS a forms — PASS, run 38565732520
- [x] Browser E2E včetně testu serializace zápisů — PASS, run 38565732520
- [ ] Uživatelský fyzický test: Předplatné Netflix 1/2 a OnePlay, čekající změna 29. 6. 2026; po přihlášení nebo restartu ověřit, zda skutečně sedí cloud snapshot; pokud ne, zachovat konflikt a vyžádat anonymizovaný rozdíl
- [ ] Dvě zařízení: souběžná editace, skutečný konflikt, restart a offline → online
- [ ] Finance: kompletní P0 audit všech pending markerů a jejich zachování při souběžných úpravách
- [ ] **P0 vysoká priorita:** `finance.js` / `cloudUpdateFinanceAccount` vrací `true` při chybějícím klientovi nebo domácnosti a používá `UPDATE` bez potvrzení změněného řádku i bez CAS. Může chybně potvrdit `syncStatus` a skrýt neodeslaná data. U `cloudUpdateFinance` je obdobný předčasný `true` guard. Nejdřív ověřit DB schéma `finance_accounts` a revize (Supabase připojení zde zobrazuje jen jiné projekty); pak bezpečně upravit s testy. Nesahat do cizí Supabase.
- [ ] Mobil Safari iPhone, Android Chrome, desktop; regresní smoke ostatních modulů
- [ ] Prověřit i `cloudSyncLocalPendingData`, které může aktualizovat `lastSyncAt` během neúplného syncu
- [ ] Až po fyzickém schválení bezpečně nasadit do produkce

## Odkazy a kontrolní bod
- Historické PR #29–#33: poslední https://github.com/martinspadrna/Domacnost/pull/33
- Úspěšné CI: https://github.com/martinspadrna/Domacnost/actions/runs/38565732520
- **Zůstává nutný fyzický test konkrétního účtu** před merge; bezpečný snapshot nesmí bez potvrzení vymazat reálnou změnu.

## Pravidlo pokračování
Nejdřív dokončit P0, potom P1 → P2 → P3 → P4. Po každé dokončené etapě doplnit sem přesně: verze, branch/commit, změny, výsledky testů, rizika, stav (%), další konkrétní úkol.

## 14. 10. 2026 — přetrvávající Předplatné po produkční 537
- Uživatel potvrdil: problém **stále stejný** i po nasazení 537, nelze považovat P0 Předplatné za dokončené. Nevypínat ochranu CAS ani nemazat pending bez potvrzení.
- Nasazená **v0.1_538** (PR #30, merge `af861855f2b7dbdd37c6f1a994d820c1ec9eaeb9`) připravená na větvi `fix/p0-subscription-recovery-538`: v Cloud domácnosti lze tlačítkem **Prověřit Předplatné** bezpečně a read-only porovnat skutečná cloudová data s lokálními. Výpis jen počtů a názvů rozdílných polí; při bezpečně potvrzené shodě může vyčistit starý marker, jinak data zachová.
- Serverem potvrzený zápis household snapshotu nově odbaví shodné moduly i když se během sítě změnil jiný modul; každý stále rozdílný zůstane ve frontě.
- **CI PASS** (branch i main; main run `38578111957`). **Vercel production READY**, `af861855f2b7dbdd37c6f1a994d820c1ec9eaeb9`. Aktuálně čeká pouze fyzický výsledek **Prověřit Předplatné** na původní produkční adrese; dle výsledku určit kořenovou příčinu. Nic nepřepisovat bez shody.

## Release v0.1_538 — stav po nasazení
- 14. 10. 2026: v0.1_538 je na produkčním `main`, Vercel READY, CI PASS; soubor handoffu aktualizován.
- Uživatel musí ověřit původní případ s lokální čekající změnou 29. 6. Tlačítko **Nastavení → Cloud domácnosti → Prověřit Předplatné** načte cloudový snapshot a ukáže důvod odlišnosti bez přepsání dat.
- Pokud diagnostika říká shoda a potvrdí starou změnu, ověřit po restartu že se fronta znovu neobjeví. Při rozdílu ověřit konkrétní pole a příčinu; nepřepisovat data.
- P0 Finance (účty/transakce/šablony/půjčky) stále otevřená, další etapa po potvrzení Předplatného.

## 14. 10. 2026 — potvrzena skutečná chybějící platba
- Uživatel na v0.1_538 poskytl diagnostiku: **Služby zařízení 7/cloud 7 (rozdíl 0), Lidé 14/14 (rozdíl 0), Platby 90/89 (jedna pouze lokálně, žádná pouze cloudová, změněných 0).** Předplatné je tedy rozdílné o jednu lokální platbu; žádné automatické čištění markeru!
- Kandidát **v0.1_539** na `fix/p0-single-subscription-payment-539`. V diagnostice se pouze pokud lze prokázat bezpečný přesný rozdíl zobrazí tlačítko „Doplnit 1 chybějící platbu“. Uživatelské potvrzení, čerstvé opakované načtení cloudu, přesné kontroly shody služeb/lidí a 89 ostatních plateb, integrita odkazů, zákaz podezřelých duplicit, izolace household_id a **CAS UPDATE na aktualizované revizi**. Úprava skládá REMOTE snapshot s jedinou lokální platbou, ne celý starý lokální snapshot. Při rozdílu, nulovém CAS zásahu, chybě nebo konfliktu nic nesmaže a zachová pending.
- **Bez automatického nasazení na main**, nejdřív CI + browser E2E a manuální prověření; po nasazení fyzicky otestovat obsluhu původního záznamu, restart a druhé zařízení.
- P0 Finance dále otevřené.

## 14. 10. 2026 večer – Předplatné na PC neviditelné na mobilu
- Po zapsání platby na PC uživatel na iPhone nevidí platbu. Mobil hlásí 3 čekající změny: Garáž 2 (od 29. 6. 2026), Nastavení domácnosti 1 (od 5. 10. 2026); žádnou čekající změnu Předplatného. **Nedělat force overwrite ani mazat lokální data.**
- Kořenová příčina blokovaného příjmu **pokud platba už je na cloudu**: `shouldApplyRemoteHouseholdUi()` odmítne aplikovat *celý* `households.dashboard_layout`, pokud čeká jiná sekce (např. nastavení domácnosti). Mobil tak nedostane vzdálené nové platby.
- Kandidát **v0.1_540**, pracovní větev `fix/p0-subscription-read-through-540`: při zablokovaném celkovém snapshotu (bootstrap a načtení modulu) pouze konzervativně doplní do mobilu nové potvrzené cloudové platby, ale jen pokud sedí všechny lokální společné platby a shodují se služby a lidé, bez místních pending změn v Předplatném. **Žádná změna existující platby**, žádné mazání markerů jiných modulů, kontrola vazeb, duplicit a domácnosti. `Prověřit Předplatné` v cloudu nyní lze použít i bez subscriptions pending, aby šlo zjistit, zda PC platbu opravdu odeslalo.
- E2E testuje: blokace při subscriptions pending, přesně jedno cloud-only doplnění, idempotence, zachování ostatních pending, blokace jiného household, změněného záznamu, lokální-only platby.
- **Před nasazením**: CI + browser E2E, ověřit na preview, sloučit až po odsouhlasení. Poté na mobilu porovnat s cloudem a zkontrolovat, zda nová platba dorazila. Pokud ne, ověřit cloudový zápis z PC (může být také lokální-only).

## 14. 10. 2026 — v0.1_540 nasazena, čeká fyzický cross-device test
- Fyzická indicie: platba přidaná na PC neviditelná na iPhone; mobil má 2 Garáž pending od 29. 6. a 1 Nastavení domácnosti od 5. 10., nikoli Předplatné pending. Root code-level: blokovaný celý household snapshot při unrelated pending, i když Předplatné nemá žádné neodeslané lokální změny.
- Implementace: aditivní pouze remote-only plateb v případě úplné shody lokálních služeb, lidí a stávajících plateb; blokace při subscriptions pending, konfliktu daného záznamu, jiném household, duplicitě nebo místním neodeslaném záznamu. Nic se nemaže, ostatní pending zůstávají.
- Přidáno **Prověřit Předplatné** i pro stav bez subscriptions pending, aby šlo odlišit chybu zápisu PC od blokovaného načtení iPhonu.
- PR: https://github.com/martinspadrna/Domacnost/pull/32, merge commit `f362193fc2c05bf33cb0d9b4b657490c5a5310a8`, verze `0.1_540` na produkčním Vercelu READY.
- Statické CI + browser E2E včetně simulované cloud-only platby a negativních případů: **PASS**, PR run 38615872708 a produkční main run 38616122219.
- **DŮLEŽITÉ: Není fyzicky potvrzeno**, zda PC platbu skutečně uložilo do cloudu nebo zda iPhone převzal správný výsledek. Další krok na iPhone: po aplikování verze 540 otevřít Předplatné, pak Cloud domácnosti → Prověřit Předplatné, poslat srovnání; nepoužívat force ani nemaž lokální data. Pokud cloud neobsahuje poslední PC platbu, prověřit cloud pending na PC.
- Zůstává P0 audit Garáže pending (2) a Nastavení domácnosti pending (1), poté Finance problém s potvrzením aktualizací účtů.

## 14. 10. 2026 pozdě večer – skutečný P0 problém vape.js
- PC v0.1_540 při potvrzeném doplnění jedné platby hlásilo `Doplnění se nepovedlo: vape.js není načtený`. Uživatel po otevření modulu Předplatné dokázal operaci dokončit, ale na mobilu platba stále nebyla vidět. Samotná chyba `vape.js` vzniká v `householdUiSnapshotMatchesRemote()` i potenciálně po úspěšném serverovém zápisu; **není sama o sobě důkazem, že UPDATE selhal**.
- V kódu existuje lazy factory `normalizeVapeState()` volaná při běžném načtení `applyCloudHouseholdUiSettings` i při ukládání `householdUiPayload()`. `ensureHouseholdUiSyncDependencies()` dříve načítala pouze subscriptions, nikoli vape. To může po startu blokovat i aplikaci nových cloudových dat bez otevření Vape.
- Kandidát **v0.1_541** na `fix/p0-household-lazy-sync-541`: před každým household snapshot save/compare/load připravit lazy subscriptions+vape; na mobilní kontrolu Předplatného přidat bezpečný aditivní read-through potvrzených plateb s textem o převzetí. Žádné force ani mazání dat. Browser E2E ověřuje, že snapshot funguje s načtenými závislostmi.
- Před merge ověřit CI, browser E2E a případné regrese. Po nasazení nejdřív na PC `Prověřit Předplatné`, zjistit zda cloud platbu skutečně obsahuje; na iPhone totéž, včetně kontroly zvoleného měsíce v UI. P0 Garáž, Nastavení domácnosti a Finance stále nedokončeny.

## 14. 10. 2026 — v0.1_541 PRODUKCE
- **Kořenová příčina ověřena v kódu:** `normalizeVapeState()` vždy používala lazy `getVapeModule()`, ale `ensureHouseholdUiSyncDependencies()` před save/compare načítala jen `subscriptions.js`. Po úspěšném doplnění platby mohl následný `householdUiSnapshotMatchesRemote()` spadnout na `vape.js není načtený` a mylně hlásit, že uložení neproběhlo. Také `applyCloudHouseholdUiSettings` mohl při načítání vzdáleného layoutu selhat na nenahraných modulech.
- **Fix v0.1_541**: zajistit lazy `subscriptions.js` + `vape.js` před household save/compare i při převzetí remote layoutu. Tlačítko `Prověřit Předplatné` po SELECT bezpečně a aditivně přijme nové serverem potvrzené platby pouze při přesné shodě zbytku dat, bez přepsání lokálních změn a konfliktů. Výsledek vypíše počet převzatých plateb.
- PR https://github.com/martinspadrna/Domacnost/pull/33, merge `abf6a62ddb625ee9a31f7ff85bf19767ab4ccad2`, produkční Vercel READY. GitHub CI včetně browser E2E **PASS**, branch run `38626634585`, main run `38626810412`.
- **Fyzický test zatím chybí**: (a) na PC `Prověřit Předplatné` a skutečný stav PC vs cloud po kliknutí na `Doplnit 1 chybějící platbu`; (b) iPhone otevřít v541 a `Prověřit Předplatné` → zda přibylo 1, zda nová platba vidět ve **stejném měsíci a filtru**. Pokud shoda, ale UI nezobrazuje, audit filtru a aktivního profilu. Pokud rozdíl, podívat se na count/ids/conflict, nesmazat lokální cache.
- iPhone navíc má stále 2× Garáž pending od 29.6. a 1× Nastavení domácnosti pending od 5.10. **Nemaž a nenutit overwrite.** Po Předplatném pokračovat P0 auditem Garáž, Nastavení domácnosti, pak Finance (account false-success guard a CAS).

## 14. 10. 2026 večer — Předplatné potvrzeno na iPhone
- **DONE – funkční cross-device Předplatné**: uživatel po nasazení v0.1_541 potvrdil „na mobilu předplatné ok“ (nová platba z PC již viditelná). Produkční oprava PR #33 je tak fyzicky ověřená; uzavřít příslušný krok P0 bez opakovaných zásahů.
- Konfliktující a nadbytečný alternativní **draft PR #34 uzavřen bez merge**, protože je zastaralý vůči nejnovějšímu main a jeho funkce jsou již pokryty PR #33.
- **DALŠÍ PRIORITA P0:** Garáž — 2 čekající lokální změny na iPhonu od 29. 6. 2026; zjistit per-record pending, cloud revize a možné duplicity na vozidlech Fabia/Toyota Auris. Nepřepisovat bez shody, nemaž local data.
- Potom Nastavení domácnosti — 1 pending od 5. 10. 2026, ověřit čistě přes snapshot/CAS a možný technický marker.
- Nakonec P0 Finance: bankovní účty false-success a CAS, transakce, šablony/půjčky, 2 zařízení, offline→online.
- Aktuální produkční verze **v0.1_541**. Nové změny vyžadují navýšení na **0.1_542** a CI/E2E.

## P0 Garáž — první kódový audit po potvrzení Předplatného
- `markGarageRecordPending` nastavuje `pending_update` pro auto s cloudId, `pending_add` pro nové auto. Dashboard počítá přímo `syncStatus`, nikoli skutečný rozdíl v DB.
- `cloudUpdateVehicle` při chybě chybějících rozšířených sloupců `vehicles` provede fallback zápis pouze základních údajů a **záměrně ponechá `pending_update`**. Pokud schéma stále nepodporuje `purchase_*`, `sale_*`, `technical_specs`, `ownership_status` nebo `insurance_contract_id`, může fronta Fabia + Toyota Auris zůstat trvale viset. **Hypotéza, zatím neověřená proti DB.**
- `garageVehicleNeedsCloudSync` zohledňuje příznak `garageVehicleExtendedColumnsPending`, takže opakované pokusy se samy nevypnou; ověřit reálné Supabase schema (správný projekt) a detaily cloudové odpovědi.
- `cloudUpdateVehicle`, `cloudUpdateFuelLog`, `cloudUpdateServiceLog` sice ověřují existenci vráceného řádku, ale neporovnávají `updated_at` přes CAS: audit mezizařízení a skutečných konfliktů je nutný před opravou.
- **Další bezpečný krok:** read-only diagnostika pro každé ze 2 aut (cloudId přítomen?, syncStatus, fallback/schema error, absence/přítomnost rozšířených sloupců). Nic nemaž, nevynucuj přepis. Priorita kořenová příčina, ne smazat pending marker.

## P0 Garáž — diagnostika v0.1_542 (PR #35)
- Bezpečný read-only audit dvou vozidel čekajících od 29.6.2026: přes SELECT ze správné domácnosti zkontrolovat existenci řádku, chybějící databázové sloupce, rozdílné názvy polí a případně novější cloudovou revizi. Žádné UPDATE, force overwrite ani smazání pending markeru.
- Kandidát v0.1_542, větev `fix/p0-garage-pending-audit-542`, PR https://github.com/martinspadrna/Domacnost/pull/35.
- Před nasazením CI/E2E. Pak tlačítko **Prověřit Garáž** v Nastavení → Cloud domácnosti. Pokud chybí rozšířené sloupce, řešit databázovou migraci správného projektu; pokud se pole shodují, ověřit potvrzovací tok bez ztráty dat. U vzdálených rozdílů zachovat konflikt bez přepsání.
