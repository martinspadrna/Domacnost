# Domácnost+ — centrální handoff

Aktualizováno: 18. 10. 2026. Na začátku nového chatu načíst celý tento soubor, ověřit HEAD a nejnovější verzi. Nepoužívat safepoint, pokud to uživatel výslovně nepožádá.

## Verze a větve
- **Aktuální produkční verze: v0.1_571** (PR #61, squash `c4bf563c6cbc3dafdc444c80b274be25e0f6767e`, Vercel READY, full checks + Chrome E2E PASS na finálním PR i produkčním `main`). Při zahájení nového chatu vždy ověřit aktuální HEAD, release marker a produkční alias.
- Historické kandidáty 537–540 už byly nasazeny. Hlavní P0 cloud sync **stále není fyzicky uzavřený**; další práce vychází z aktuálního main.
- Každá funkční změna = zvýšit verzi konzistentně ve všech release souborech. Zachovat PWA, Supabase Auth/DB/RLS, local-first, kompatibilitu a data.

## Pravidlo nasazování (výslovné přání uživatele, 16. 10. 2026)
- **Po úspěšných CI, browser E2E a kontrole kompatibility rovnou slučuj ověřené opravy do `main` a nasazuj na produkci bez další otázky.** Uživatel doslova napsal: „rovnou to tam davej vzdy“. Po nasazení ověř Vercel READY, správný commit/alias a produkční main CI; výsledek sděl.
- Automatický souhlas **není souhlas k destruktivním DB migracím, mazání uživatelských dat, přepsání konfliktujících změn, vypnutí RLS, force push nebo jiným vysoce rizikovým nevratným zásahům**. Ty musí mít zvláštní kontrolu a případně potvrzení.
- I při automatickém release zachovej `pending` a CAS bez silového sloučení. Každá funkční změna navýší verzi ve všech relevantních souborech, průběh a následné testy zapiš sem.

## Plán projektu
| Fáze | Popis | Stav |
|---|---|---|
| P0 | Cloud sync a ochrana dat (fronty, konflikty, offline, restart) | ROZPRACOVÁNO |
| P1 | Local-first/start, okamžitá použitelnost UI | ROZPRACOVÁNO |
| P2 | Cloud pokrytí všech modulů | ROZPRACOVÁNO |
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
- **Nasazeno v produkci v0.1_542** přes PR https://github.com/martinspadrna/Domacnost/pull/35; merge `ee6ca7b4a9b4b9b395ad7900e129464bdb7ff6e2`. CI a browser E2E **PASS**: PR run 38628240345 a main run 38628438893; Vercel production READY.
- **Další fyzický test:** tlačítko **Prověřit Garáž** v Nastavení → Cloud domácnosti. Pokud chybí rozšířené sloupce, řešit databázovou migraci správného projektu; pokud se pole shodují, ověřit potvrzovací tok bez ztráty dat. U vzdálených rozdílů zachovat konflikt bez přepsání.

- **Pozor:** Diagnostika neřeší migraci schématu a není důkazem, že staré změny lze automaticky odstranit. Výsledek reálných aut Fabia/Auris zatím chybí. Po obdržení auditovat konkrétní příčinu a provést malou verzi 0.1_543 jen se správnou opravou, kompatibilní s CAS a ochranou dat.

## 14. 10. 2026 — fyzická diagnostika Garáže, kandidát v0.1_543
- V produkční v0.1_542: Fabia + Toyota Auris mají **chybějící `vehicles.insurance_contract_id`**, u obou má cloud novější `updated_at`, ale žádné ostatní rozdílné pole nebylo hlášeno. Nadále 2 pending auta, 1 pending Nastavení domácnosti.
- Kořenová příčina v kódu: `cloudUpdateVehicle` při chybě rozšířeného schématu opakovaně prováděl základní fallback UPDATE bez CAS. Tím mohl sám zvyšovat cloudovou revizi.
- **Kandidát v0.1_543, branch `fix/p0-garage-schema-cas-543`**: před UPDATE čerstvý SELECT, bez všech sloupců žádný fallback PATCH, při úplné shodě lze potvrdit sync bez UPDATE, rozdílná data s novější remote revizí blokovat, při přenosu použít `updated_at` CAS (0 řádků = konflikt), zabránit potvrzení novější lokální úpravy během requestu. E2E regresní scénáře.
- Připraven aditivní SQL `sql/garage_insurance_contract_id.sql`. **NEPROVEDENO:** připojený Supabase zpřístupňuje pouze RaK TEST/MAIN, nikoli projekt Domácnost+. Nesmí se omylem provést v RaK.
- Po PASS CI a schválení lze migrovat jen správnou DB, udělat schema reload a znovu změřit Fabii/Auris z mobilu/PC. **P0 Garáž stále OPEN, pending zachovat.** Produkce v0.1_542 zatím beze změny.
- Dále 1 pending Nastavení domácnosti a následně P0 Finance, žádné mazání nebo force.

### 14. 10. 2026 — ověřena a provedena DB migrace Garáže
- Správný projekt Supabase nalezen dle URL aplikace: **Domácnost+**, ref `hyyehcskthqmncqlechi`, ACTIVE_HEALTHY; předchozí seznam Supabase ukazoval jen RaK, ale přímý `get_project` správný projekt zpřístupnil.
- Před změnou: 151 vozidel; `insurance_contract_id` chyběl; `contracts.id` i `vehicles.id` typu UUID; RLS u `vehicles` zapnuto.
- Aditivní migrace `domacnost_garage_insurance_contract_link_20261014` přes Supabase `apply_migration` **SUCCESS**. Přidán nullable `public.vehicles.insurance_contract_id uuid` a proveden PostgREST schema reload.
- Po změně ověřeno SQL: **151 vozidel**, sloupec UUID dostupný, 0 existujících nenulových vazeb, RLS stále TRUE. Žádné přepsání dat či mazání.
- PR #36 pro klientský bezpečný CAS guard: https://github.com/martinspadrna/Domacnost/pull/36 ; commit `e811bca911a31c54dc408c44dcd8343da9d9d4de`. **CI PASS**, run https://github.com/martinspadrna/Domacnost/actions/runs/38630467510 .
- Pozor: migrace **nepotvrzuje** odstranění 2 pending na uživatelském iPhone. Na produkční v0.1_542 je nutný fyzický test **Zkusit uložit teď → Prověřit Garáž**, restart a ověření druhého zařízení. Pokud zůstane rozdíl, neposílat force a zkontrolovat konkrétní sloupce. Klientská v0.1_543 zatím pouze draft PR a není na main.
- Security Advisor hlásí existující obecné upozornění na 4 veřejně volatelné SECURITY DEFINER funkce a vypnutou kontrolu kompromitovaných hesel; nesouvisí přímo s novým sloupcem. Auditovat zvlášť, nezasahovat bez kontroly současných RLS/funkčních vazeb.

## 16. 10. 2026 — potvrzení Garáže a další krok P0 Nastavení
- Uživatel: mobil bez čekajících změn, Garáž Fabia a Auris po migraci `vehicles.insurance_contract_id` již nezůstává ve frontě. **PC má 1 pending „Nastavení domácnosti“ od 14.10.** Stav se opakovaně pokouší synchronizovat.
- Produkce main stále v0.1_542, bezpečnostní klientský CAS Garáže v draft PR #36 v0.1_543. DB migrace projektu Domácnost+ byla provedena a ověřena (151 vozidel beze změny, RLS zachováno).
- `householdUiPendingAt` je fallback značka pro celý snapshot. Sama neříká, zda se změnila konkrétní sekce, profilový UI stav, počasí, anebo jde jen o technický marker. Existující porovnání `reconcileConfirmedHouseholdUiPending` bezpečně potvrzuje výhradně identický snapshot.
- **Kandidát v0.1_544** navazuje na v0.1_543: v Nastavení → Cloud domácnosti tlačítko **Prověřit Nastavení**. Jen SELECT podle aktivního household, srovnání semantického snapshotu na úrovni top-level sekcí bez hodnot, informace o jiné revizi; ochrana změny během SELECT; žádný UPDATE, force či mazání pending. Browser E2E ověřuje shodu, odlišná pole, chybějící pole a počasí.
- Bez fyzického výsledku diagnostiky na PC **kořenová příčina posledního čekajícího markeru není prokázaná**. Nesnažit se ho odstranit naslepo. Po diagnostice malá cílená oprava, potom P0 Finance.

### 16.10.2026 — CI korekce kandidáta
- První CI pro v0.1_544 selhalo pouze v `tools/check-e2e-smoke.mjs`: duplicitní lokální `settingsCheck` v jednom bloku. Syntaktická kontrola `app.js` prošla. Kandidát navýšen na v0.1_545 a testovací proměnné dostaly jedinečná jména; opakovat celé CI včetně browser E2E. Žádný merge/produkce zatím.

### 16. 10. 2026 — oprava E2E reference, kandidát v0.1_546
- v0.1_545 statické CI PASS, browser E2E FAIL kvůli chybnému pojmenování testovací proměnné v původním testu Nastavení. Opraven výhradně E2E test: starý `settingsCheck` zachován, nová kontrola používá `householdDiagnosticCheck`. Znovu spustit kompletní CI. Produkce main stále v0.1_542.

### 16.10.2026 — v0.1_546 validace dokončena
- Kandidát v0.1_546 na PR #37: https://github.com/martinspadrna/Domacnost/pull/37. **CI full check + browser E2E PASS** na commit `c6f9f9207fb34a72d3c5d12e3cb0b74259e30f4e`, run https://github.com/martinspadrna/Domacnost/actions/runs/38850789241.
- Nadbytečný PR #36 (v0.1_543) **uzavřen bez merge**, jeho změny obsahuje PR #37. Produkční main zůstává `v0.1_542`, žádný nový release zatím nebyl nasazen.
- Reálný výsledek PC pending se nedá spolehlivě zjistit z preview na jiné doméně, protože se pending ukládá k původnímu zařízení/originu. Po uživatelském odsouhlasení bezpečně nasadit diagnostiku, pak na PC `Prověřit Nastavení` a teprve podle výsledku řešit konkrétní rozdíly, bez force overwrite.

### 16. 10. 2026 — v0.1_546 MAIN + produkce (uživatelsky schváleno)
- Uživatel schválil nasazení odpovědí „j“ na nabídku publikace v0.1_546.
- PR #37 https://github.com/martinspadrna/Domacnost/pull/37 byl označen ready a sloučen do main, **merge commit `a41dece2ef89e727888e59d081162d4a7a9fcc56`**. Obsahuje CAS Garáže + pouze read-only diagnostiku Nastavení domácnosti.
- GitHub PR CI full check včetně browser E2E **PASS**: run https://github.com/martinspadrna/Domacnost/actions/runs/38851013005 .
- Vercel **produkční deployment READY** `dpl_5YY4Cxe3RooGhyfCxtHy1aANAiqa` pro tentýž merge commit; alias `domacnost-plus.vercel.app`. Nyní je vydaná verze **v0.1_546**, dřívější v0.1_542 nahrazena.
- Přetrvávající **1 čekající Nastavení domácnosti na PC** zatím **NEVYŘEŠENO**. K potvrzení obsahu nutný reálný test na původní doméně a PC: Nastavení → Cloud domácnosti → **Prověřit Nastavení**; zaslat text/screenshot názvů rozdílných sekcí. Diagnostika jen SELECT, nic nemaže ani nepřepisuje.
- Mobilní Garáž po DB opravě uživatelsky OK. Další práce: až po výsledku PC diagnostiky bezpečně vyřešit případný pending marker / konkrétní konflikt; potom P0 Finance. Bez force overwrite.

### 16.10.2026 – fyzický test PC cloud sync + kandidát v0.1_547
- Uživatel poslal dva screenshoty produkční v0.1_546: před otevřením Financí **„Kontrola Nastavení selhala: finance.js není načtený“**; po kliknutí na Finance a návratu vzniklo upozornění **„Na jiném zařízení vznikla novější změna“**, 1 pending Nastavení domácnosti z 14.10.2026, vzdálená revize 15.10.2026.
- Read-only porovnání teď vypisuje rozdílné `profileUiSettings`, `trash`, `vehicleIconColors`, `vehicleIconShapes`. Ani jeden z těchto rozdílů nebyl automaticky přepsán. Zatím nelze prokázat, zda rozdíly představují reálné změny profilu, koše nebo jen aliasy ikon aut; **NEKLIKAT „Použít cloud“ / „Ponechat toto zařízení“**, dokud se nevyhodnotí rozdíly.
- Kódový root prvního problému: `householdUiPayload()` volá `financeTypeFilter()` → `getFinanceModule()` vyžaduje `finance.js`, ale `ensureHouseholdUiSyncDependencies()` načítala jen subscriptions a vape. Diagnostika i příprava cloud save tím mohly selhat ještě před validací.
- Kandidát **v0.1_547**, větev `fix/p0-household-lazy-finance-diff-547`: před každým household snapshotem zajistit také lazy Finance, po neúspěšném načtení zachovat pending; v read-only diagnostice doplnit souhrn počtu změněných profilů a pojmenování oblastí (bez osobních ID), počty položek koše na PC/cloud a porovnání klíčů ikon a jejich výsledného efektu u lokálně známých aut. **Bez UPDATE/DELETE, bez mazání pending, bez změny CAS nebo merge politiky.**
- Doplň E2E regresi pro lazy Finance a nové diagnostické souhrny včetně zákazu prozrazení názvů/ID záznamů; všechny verze/asset klíče navýšit. Po PASS PR držet mimo produkci do schválení; teprve následný fyzický PC test umožní bezpečnou per-section opravu konfliktu. P0 Finance následuje.

### 16.10.2026 – v0.1_547 CI dokončeno
- PR #38: https://github.com/martinspadrna/Domacnost/pull/38, kandidát pro opravu lazy Finance a podrobnou read-only diagnostiku.
- Full check + browser E2E **PASS** v GitHub Actions: https://github.com/martinspadrna/Domacnost/actions/runs/38854818417, commit `713495135e02c68820022bfcded1470507c16d89`.
- Zatím pouze branch/draft PR, main/produkce v0.1_546. Konečné řešení PC konfliktu musí vycházet z diagnostických počtů na původním PC. Nepoužívat force overwrite.

### 16. 10. 2026 — v0.1_547 nasazena na produkci
- Uživatel výslovně povolil automatické nasazování dalších bezpečně ověřených verzí, bez pokaždé dalšího dotazu: „rovnou to tam davej vzdy“. Nové trvalé pravidlo zapsáno výše.
- PR #38 **sloučen do main**: https://github.com/martinspadrna/Domacnost/pull/38, merge `77768772c6e7feb803803369953254aef228f374`.
- Kandidát měl **full CI + browser E2E PASS** v PR po aktualizaci handoffu (run `38854905692`). Produkční Vercel `domacnost-plus.vercel.app`: deployment `dpl_AcwVrvdXoLd1z8hsozyMy5LpDHhQ` je **READY** na stejném SHA.
- Obsah v0.1_547: oprava lazy Finance před household snapshot sync, konzervativní read-only detail diagnostiky profilového UI, Koše a ikon vozidel. **Konflikt 1× Nastavení domácnosti na PC zůstává otevřený**, nesmí se mazat naslepo.
- Fyzický test: na PC ve stejné produkční doméně po aktualizaci aplikace kliknout `Prověřit Nastavení` **bez předchozího otevření Financí**. Získat podrobné počty profilů, Koše a ikon. Při skutečných rozdílech a novější revizi cloudu zachovat obě verze a navrhnout per-section řešení bez force overwrite.
- Dále P0 Finance: audit false-success guard / potvrzení serverových UPDATE a CAS, prioritně bankovní účty a transakce.

### 16. 10. 2026 — P0 Nastavení domácnosti vyřešeno uživatelem (PC)
- Uživatel potvrdil, že na PC předtím zvolil **převzetí cloudové verze** („uložil z cloudu“) ve střetu nastavení a **nyní je synchronizace OK**. Jde o uživatelské vyřešení konfliktu, **nikoliv o automatický per-section merge**. Lokální konfliktní snapshot byl nahrazen vybranou cloudovou verzí; žádné další silové přepsání, mazání markerů ani DB zásah nedělat.
- Tři dříve uživatelsky potvrzené oblasti: **Předplatné cross-device OK, Garáž (Fabia + Toyota Auris) OK, Nastavení domácnosti PC OK**. Označit konkrétní čekající konflikt P0 Nastavení jako **DONE (user confirmed)**. Neodvozovat z toho, že všechny ostatní moduly nebo veškerá synchronizace jsou bezchybné.
- Poslední ověřený release: **v0.1_547**, PR #38 merged na main, Vercel produkce READY, CI včetně browser E2E PASS. Nevyžaduje se nová app verze pro pouhý záznam stavu v handoffu.
- **Následující priorita P0 Finance**: audit cloudUpdateFinanceAccount, cloudUpdateFinance a jejich pending/false-success chování, CAS a potvrzení serverového UPDATE; dále transakce, šablony a půjčky a cross-device/offline testy. Začít z posledního HEAD. Žádný force overwrite, bezdestruktivní změny po testech rovnou main/produkce dle trvalého souhlasu uživatele.

### 16. 10. 2026 — P0 Finance audit I, kandidát v0.1_548
- Potvrzeno ze zdrojového `finance.js`: `cloudUpdateFinanceAccount()` dosud vracela `true` při chybějícím klientovi/cloudId/householdId a neověřovala počet změněných DB řádků (UPDATE bez SELECT), takže se mohl smazat pending marker i bez serverového zápisu. Stejný předčasný úspěch v `cloudUpdateFinance()`, která má jinak CAS pro transakce.
- Bezpečný malý fix v0.1_548: account UPDATE vrací `true` teprve po odpovědi konkrétního řádku s očekávaným ID; 0 rows, chyba, změna domácnosti, záznamu nebo lokálního payloadu během requestu = **false**, pending se zachová. U transakcí chybějící klient = false, neznámá revize = žádný UPDATE naslepo, po SELECT potvrzení kontrola cloud ID a zachování právě odeslaného lokálního payloadu.
- E2E testuje kladné/záporné případy potvrzení ID a staticky střeží account SELECT i povinnou CAS revizi u transakcí.
- **Zůstává otevřené pro další P0:** finance_accounts nemá v lokálním modelu sledovanou serverovou revizi; ověřit skutečné DB schéma `finance_accounts` a navrhnout bezpečný CAS (nepřidávat naslepo sloupce bez přístupu/schématu). Dále add/update závislosti účtů, delete/outbox, simultánní editace, Finance loans/templates a cross-device/offline testy.
- Handoff aktuálně DONE: Předplatné/Garáž/Nastavení domácnosti potvrzené uživatelem. Nevyvozovat z toho DONE všech Financí.

### 16.10.2026 — kandidát posunut na v0.1_549
- Oprava před CI: E2E finance source check používal neimportované `readFile`; přepnuto na existující `readFileSync(join(projectRoot, 'finance.js'), 'utf8')`. Verze navýšena konzistentně. Čeká full CI včetně reálného Chrome E2E.

### 16.10.2026 — v0.1_549 PRODUKCE, P0 Finance audit I
- PR #39: https://github.com/martinspadrna/Domacnost/pull/39, merge commit `85216e494c535292738763af4ec993edd25d4bcc`.
- **Full CI + browser E2E PASS**: PR run https://github.com/martinspadrna/Domacnost/actions/runs/38862724679 a main run https://github.com/martinspadrna/Domacnost/actions/runs/38862874116.
- **Vercel produkce READY**, deployment `dpl_64hX6aCMUjawUB5GsWL2djLG6E4M`, alias `domacnost-plus.vercel.app`, commit odpovídá main.
- `finance.js`: update účtu teď potvrzuje skutečný řádek s očekávaným ID, nedostupný cloud už není „success“, kontroluje household i nezměněný odeslaný lokální payload. U update finančního pohybu zamezen nehlídaný UPDATE bez známé CAS revize; výsledná odpověď a lokální hodnoty se kontrolují před vymazáním pending.
- **NEDOKONČENÉ P0 FINANCE:** account-level CAS proti souběžné editaci z více zařízení — reálné DB schéma `finance_accounts.updated_at` nejprve ověřit (Supabase přímý přístup v tomto chatu nefungoval); opravit vazby při neúspěšném vytvoření účtu, bezpečné mazání/transakční outbox; následně financeTemplates/Loans a offline→online + cross-device. Bez bezpečné migrace naslepo.
- Uživatelský fyzický test této konkrétní verze zatím nebyl proveden. Předplatné, Garáž a Nastavení domácnosti z předchozích kroků uživatelsky OK. Automatické nasazování dalších ověřených oprav nadále povoleno.

### 16.10.2026 — P0 Finance další krok: vazby účtů, kandidát v0.1_550
- **Backend schéma finance_accounts je nyní nepřístupné**: Supabase get_project/list_tables pro projekt Domácnost+ (`hyyehcskthqmncqlechi`) vrací permission denied. Nevymýšlet SQL migrace a CAS bez ověření skutečného schématu a baseline serverové revize.
- Další prokázané riziko v `finance.js`: nový nebo upravovaný pohyb po neúspěchu `cloudAddFinanceAccount()` přesto pokračoval INSERT/UPDATE; `account_id` nebo `transfer_account_id` mohly být null, takže pohyb mohl ztratit vazbu na účet.
- Kandidát v0.1_550: `ensureFinanceTransactionAccounts` vyžaduje existující lokální účty a potvrzená cloud ID, kontroluje i přepnutí domácnosti; `financeTransactionAccountsBound` blokuje neúplný účet nebo převod před INSERT i UPDATE. Při chybě se ponechá pending a v UI zobrazí zpráva. **Neprovádí DB migraci, force overwrite ani mazání záznamů**.
- Browser E2E: 6 scénářů povoleného/nepovoleného odeslání, statické kontroly INSERT a UPDATE. Po PASS CI automaticky main + produkce dle výslovného souhlasu uživatele.
- Dále P0: anti-race potvrzení account INSERT, idempotentní ochrana před duplicitním INSERT po ztracené odpovědi, account-level CAS po ověření DB a bezpečné delete/outbox. Finance pořád **IN PROGRESS**.

### 16.10.2026 — v0.1_550 nasazení potvrzeno, P0 Finance II
- PR #40 https://github.com/martinspadrna/Domacnost/pull/40 sloučen do main `30813254daa4f8deb73fdcad4b130862ea62eeb3`, PR full CI + browser E2E **PASS** run https://github.com/martinspadrna/Domacnost/actions/runs/38868616118 .
- Vercel produkce **READY** `dpl_9ZhPVuRjYrQ7z4emuZWhw9rMGeWm`, SHA přesně odpovídá main, release.json = build 550.
- Opraveny vazby pohybů na účty před INSERT i UPDATE, bez cloud account ID se transakce neodešle a pending se zachová. Žádné změny DB ani mazání dat.
- Přístup ke schématu Supabase Domácnost+ stále nemá oprávnění. Account-level CAS a správnou idempotenci add operací **nepovažovat za hotové**. Další P0: účet při změně během pending INSERT, kontrola chybných/dvojitých INSERT, bezpečné delete/outbox, šablony a půjčky.
- Uživatel dosud neprovedl fyzický test této úpravy mezi PC a mobilem, automatické CI neznamená fyzické potvrzení.

### 16.10.2026 — P0 Finance III, kandidát v0.1_551 (čeká CI)
- Navazuje na produkční v0.1_550 / HEAD hlavní větve `020f0ce9068f337adb9b595465e57bc47a875ced`. Pracovní větev `fix/p0-finance-account-insert-551`, zatím **bez nasazení**.
- V `finance.js` přidán per-household/per-account single-flight na `cloudAddFinanceAccount`: souběžné odeslání stejného lokálního účtu z formuláře a synchronizační fronty sdílí jeden probíhající INSERT.
- Před odesláním i při odpovědi se znovu kontroluje aktivní domácnost a aktuální lokální účet. Po potvrzeném INSERT se uchová cloudové ID a při mezitímní změně dat zůstává `pending_update`, aby navazoval UPDATE místo duplicitního INSERT. Volající mohou čistit marker pouze po potvrzeném, nezměněném záznamu.
- Přidána statická kontrola v browser E2E smoke a samostatná testovací sada `tools/check-finance-account-insert.mjs` zapojená do `npm run check`: dvojitý INSERT, editace za běhu, immutable náhrada účtu, DB chyba/retry, změna domácnosti. PR: https://github.com/martinspadrna/Domacnost/pull/41. Aktualizována release surface `package.json`, `release.json`, `index.html`, `app.js`, `module-loader.js`, `sw.js` na 551.
- **Omezení:** single-flight funguje pouze během běžící instance. Při ztracené odpovědi serveru, přepnutí domácnosti po úspěšném INSERT nebo odstranění účtu během requestu nelze bez DB idempotency key zaručit automatické dohledání vytvořeného řádku; nenasazovat spekulativní SQL. Supabase přístup ke schématu `finance_accounts` zůstává permission denied. Account-level CAS a bezpečné mazání/outbox stále **OPEN**.
- Ověřit kompletní CI + browser E2E a regresní chování ostatních modulů; až po PASS merge do main/produkce dle trvalého souhlasu uživatele a ověřit READY. Fyzický cross-device a offline→online test stále chybí.

- **Stav po přípravě PR #41:** P0 cloud sync **rozpracováno (pracovní odhad 60 %)**; P0 Finance **rozpracováno**, účetní INSERT race čeká na CI a nasazení. Ověřovat pouze konkrétní PASS run z posledního commit SHA (starší run při změně testů nepostačí).

### 16. 10. 2026 — v0.1_551 PRODUKCE, P0 Finance III
- PR #41 https://github.com/martinspadrna/Domacnost/pull/41 **MERGED** do `main` (squash SHA `fea59007eafbde2a10e267ede7569a1d3ef4e434`).
- **PR full CI + browser E2E PASS**, final head `af5d496309776947a599c729e2285d47c15a0e82`, run https://github.com/martinspadrna/Domacnost/actions/runs/38870423071; cílené Node testy pro single-flight / pending race PASS.
- Vercel produkce **READY**, deployment `dpl_DNsqqWy8yasiF5keSH1VMr4eqP52`, SHA = merge, alias `domacnost-plus.vercel.app`, žádná chyba aliasu. Build marker 551.
- **Hotovo v této etapě:** ochrana proti duplicitnímu vytváření stejného účtu souběžnými voláními v jedné běžící instanci a zachování neodeslané úpravy během INSERT. Bez DB migrace, bez mazání dat, PWA verze konzistentní.
- **Zbývající P0 Finance (OPEN):** DB-level idempotentní INSERT a rozpoznání úspěchu po ztracené odpovědi, account-level CAS po ověření reálného schématu, bezpečné delete/outbox, šablony a půjčky; následně 2 zařízení, restart a offline→online. Supabase get_project/list_tables pro Domácnost+ stále permission denied — žádné neověřené SQL ani force overwrite.
- **Fyzické potvrzení uživatelem této funkce ještě chybí.** P0 celkově rozpracováno (pracovní odhad 60 %); P1–P4 dosud čekají.

### 16.10.2026 — P0 Finance IV, kandidát v0.1_552 (čeká úplné CI)
- Navazuje na v0.1_551, větev `fix/p0-finance-trash-outbox-552`. Širší konzervativní balík pro **mazání Finance, account archivaci, cloud-load anti-resurrection, Koš/Undo a outbox**.
- Předtím `finance.js` smazal lokální finanční záznam nebo účet a hned zavolal DB DELETE/archivaci, přestože centrální `saveState` již položku zachytil do 30denního Koše a `showUndoToast` vyvolá trvalý outbox při konci možnosti Undo. Při offline/reload vznikaly dvě soutěžící logiky a data se mohla vracet.
- Nyní odstranění prochází **jen existujícím Košem**: lokální uložení immediate, možnost Undo obnoví identitu před odesláním; po vypršení Undo se požadavek dostane do cloud outboxu, který přetrvá restart. `cloudLoadFinance` filtruje cloudové ID z Koše i čekajícího outboxu, takže se bez konfliktu lokálně smazaná položka nevrátí z remote SELECTu; současně načítá účty/pohyby atomicky do state až po obou úspěšných SELECTech, s kontrolou stejné domácnosti.
- `replayCloudOutbox` nyní **financeAccounts archivuje** (`is_archived=true`, ověření skutečného ID nebo potvrzeného archived flag) místo fyzického DELETE. Finance transakce bez známé `updated_at` revize se nemažou naslepo — existence remote vytvoří konflikt; při CAS 0 rows se čerstvým SELECTem kontroluje skutečná vzdálená verze i bez expectedRevision. Historická přímá `cloudDeleteFinance` v resolveru odmítá chybějící klient i chybějící CAS revizi.
- Testy `tools/check-finance-trash.mjs` + dřívější `tools/check-finance-account-insert.mjs` jsou v `npm run check`. PWA release surface v0.1_552 konzistentně navýšena; žádné DB migrace, mazání uživatelských dat ani force overwrite.
- **Známá omezení:** Koš synchronizovaný přes household snapshot/CAS může být na druhém zařízení blokovaný nesouvisejícím pending konfliktem; poté je smazání fyzicky potvrzeno outboxem, ale vizuální stav druhého zařízení se projeví až po plném načtení či vyřešení konfliktu. U archivace účtu dosud není DB account-level CAS (Supabase schema permission denied), proto zahrnout fyzický cross-device test. Finance templates/loans používají existující snapshot/CAS; jejich souběžné úpravy a skutečné mazání dále OPEN.
- **Před nasazením:** plné PR CI, browser E2E, testy stabilního startu, domácností a release cache. Po PASS dle svolení automaticky main + produkce, ověřit alias/commit. P0 rozpracováno, pracovní odhad po implementaci 65 % (fyzické potvrzení chybí).

### 16.10.2026 — v0.1_552 PRODUKCE, P0 Finance IV
- PR #42 https://github.com/martinspadrna/Domacnost/pull/42 **MERGED**, main commit `a1d1f4d80f39a2eededcc60e4e212e8c3236cee8`.
- CI full check (včetně Finance INSERT race + Finance trash/outbox) a browser E2E **PASS**: https://github.com/martinspadrna/Domacnost/actions/runs/38871510870, PR head `a863566d1e374a2b134df0e68b96da1229180f27`.
- Produkční Vercel **READY**, deployment `dpl_AssJSsFo4HRnirMGjudSLHTr2LHs`, git SHA odpovídá merge, alias `domacnost-plus.vercel.app`, žádný aliasError.
- Finance pohyby/účty nyní používají existující Koš + cloud outbox, místo okamžitého paralelního DB DELETE/archivu; lokálně smazaná ID jsou filtrovaná při cloud načtení; account outbox archivuje a ověřuje ACK; transaction delete bez revize přechází do conflict místo nehlídaného mazání; obnovování Undo nevolá cloud INSERT během stále běžícího outboxu.
- Šablony a půjčky nadále používají snapshot CAS, ale **nejsou tímto releasem fyzicky ani race-testem kompletně uzavřené**. Další otevřené priority: financeTemplates/Loans cross-device konflikt/smazání, account-level CAS po DB schématu, idempotence po ztracené odpovědi INSERT, account/transaction INSERT×DELETE race a offline→online na reálných zařízeních. Pro P0 další práce vytvořit širší stabilizační balík, ale neodstraňovat data naslepo.
- Celkové P0 **IN PROGRESS ~65 % (pracovní odhad)**. Uživatelský fyzický test této release zatím chybí.

### 16. 10. 2026 — P0 Finance V, kandidát v0.1_553 (čeká CI)
- Navazuje na v0.1_552, větev `fix/p0-finance-snapshot-tombstones-553`.
- **Šablony:** vlastní i výchozí při smazání dostanou `deleted:true` tombstone s `updatedAt`. Obnovení přes Undo vytváří nový čas změny a `deleted:false`. Mazání vlastní šablony už neodebere ID z snapshotu, takže starý cloud merge ji nemůže bez povšimnutí vrátit. Lokální změna se při ukládání šablony ihned perzistuje.
- **Půjčky:** normalizace nyní uchovává `deleted` (i s nulovou částkou), deduplikuje podle ID, UI skrývá tombstones, při úpravě jedné aktivní půjčky zachová tombstones ostatních. Smazání/Undo tvoří novou revizi namísto prostého odebrání z pole. Stejná normalizace je v `finance.js` i fallback `createLazyDataCore` kvůli obnově při PWA startu.
- **Příjem cloud snapshotu:** po úspěšném CAS/no-pending je remote seznam šablon a půjček autoritativní (odstraněné položky se již nevracejí díky union merge). Pokud příslušná sekce má pending marker, lokální seznam včetně tombstones se při apply nenahrazuje. `shouldApplyRemoteHouseholdUi` nadále hlídá revize a konflikty; žádné force přepisy. Uživatel při explicitním `Použít cloud` nejprve potvrdí zahozování lokálního pending, teprve pak se remote aplikuje.
- **P0 bug:** obnova kolekce `financeLoans` v hlavním Koši nyní označí `loansPendingAt`, dříve chybně pouze `templatesPendingAt`.
- **Regrese:** nový vykonatelný Node test `tools/check-finance-snapshot.mjs` pro tombstones, mazání/Undo, lazy PWA start, remote odstranění vs pending a správnou per-section značku. Je zapojen do `npm run check` spolu s předchozími Finance testy. Release klíče PWA navýšeny konzistentně na 553.
- **Omezení / OPEN:** account-level CAS a idempotentní INSERT po ztracené server odpovědi, account/transakční INSERT×DELETE race, cross-device a offline→online fyzický test, 30denní Koš pro půjčky/šablony (zde zůstává krátké Undo + trvalá tombstone). DB schéma Domácnost+ dosud permission denied. Celkové P0 IN PROGRESS ~70 % (pracovní odhad), fyzické ověření pending.
- **Před produkcí:** full CI + browser E2E musí projít na posledním PR HEAD. Po PASS merge automaticky do main a ověř Vercel READY i správný alias.

### 16.10.2026 — v0.1_553 PRODUKCE, P0 Finance V
- PR #43 https://github.com/martinspadrna/Domacnost/pull/43 **MERGED** do `main`, squash commit `c6fee82f351f24750bfaf7963fc6e963fc217dfb`.
- **Full CI + browser E2E PASS**, PR run https://github.com/martinspadrna/Domacnost/actions/runs/38876541162, head `e3e7eaa173c94ccf5fddb4beca4eeca58fd9bf26`. Nový vykonatelný Node test kontroluje normalizaci tombstones při startu PWA, editaci/mazání/Undo, ochranu pending lokálních dat, cloud-only smazání i obnovu markerů. Regresní Finance tests z 551–552 zachovány.
- **Vercel production READY**, deployment `dpl_AKjyQ5D7PmnB7pkuR8o2NAmYRwmB`, SHA přesně odpovídá merge commit, alias `domacnost-plus.vercel.app`, bez aliasError.
- Půjčky a šablony mají trvalé `deleted` tombstone + čas revize, Undo vytváří novou revizi. `getFinanceLoans` je nezobrazuje, editace jiné půjčky je nemaže, offline/lazy normalizace je zachová. Šablony se ukládají okamžitě do localStorage. Při bezpečném remote apply bez pending už klient nedoplňuje staré lokální položky z union merge; pending sekce chrání lokální snapshot a existující household CAS.
- Fix: obnova půjčky z hlavního Koše vyplní `financeCloud.loansPendingAt`, ne mylně `templatesPendingAt`.
- **Zbývá (OPEN):** skutečný fyzický cross-device test Finance PC + mobil a offline→online/restart; account-level CAS podle DB schématu a idempotentní INSERT po ztracené odpovědi serveru; delete×insert race a vyřešení konfliktů na skutečných účtech. Žádné DB migrace ani force. Automatické CI nenahrazuje fyzické potvrzení.
- P0 IN PROGRESS cca **70 % orientačně**. P1–P4 podle plánu dále čekají.

### 16. 10. 2026 — P0 Finance VI, kandidát v0.1_554 (čeká CI)
- Navazuje na produkční v0.1_553, `main` `19079be925cd562e6195e27a0a65d5c217b679e3`; pracovní větev `fix/p0-finance-inflight-recovery-554`. Širší bezpečnostní balík **Finance INSERT×autosync×edit×delete**.
- `finance.js`: nový per-household/per-local-ID **single-flight pro cloudAddFinance**. Dvě současná volání formuláře/ručního syncu/fronty sdílí jediný probíhající INSERT. Vždy se znovu vyhledá živý záznam po asynchronních krocích; při ACK se uloží cloud ID+revize, ale pokud se záznam mezitím změnil, zůstane `pending_update` a další synchronizace provede UPDATE místo duplicitního INSERT.
- Starší účetní single-flight z 551 rozšířen o ochranu **smazání během INSERT**. V obou typech Finance při úspěšném serverovém potvrzení a chybějícím lokálním řádku callback předá cloud ID/updated_at do příslušného záznamu **30denního Koše** v aktuální domácnosti. Pokud je Undo ještě aktivní, neodesílá předčasný cloud DELETE; po expiraci stávající `enqueueTrashCloudDeletes` zařadí záznam do outboxu. Pokud Undo již doběhlo, late ACK zaktivuje outbox. Doplnění Koše se ihned perzistuje.
- Stávající cesty kopírování, přidání, editací, ručního a automatického syncu nyní před přepisem `syncStatus` po odpovědi kontrolují, zda je *stejný živý objekt* stále v aktuálním poli. Výsledek INSERTu se považuje za potvrzený jen při shodném serverovém ID a prázdném pending markeru.
- `app.js`: injektovaný callback `linkFinanceLateInsertToTrash`, stav `activeUndoTrashIds` a okamžité perzistování pozdního ID do Koše. Verze v `app.js`, PWA cache, SW, release a package zvednuta na v0.1_554.
- **Vykonatelná regrese:** `tools/check-finance-inflight.mjs` testuje dvojí souběžný INSERT, immutable editaci při letu, smazání/Undo, pozdní ACK účtu, síťový error a opakování, izolaci domácností. Rozšířen `tools/check-e2e-smoke.mjs`, zachovány předchozí P0 regresní sady.
- **Před vydáním:** zelený úplný CI včetně browser E2E na posledním PR SHA, poté merge a Vercel READY + alias. DB migrace a reálná data nedotčeny.
- **Dále OPEN:** serverová idempotence při ztracené HTTP odpovědi (client neví ID), pozdní ACK po přepnutí domácnosti nebo zavření procesu před perzistencí, DB account-level CAS, fyzický 2-device/offline→online test. Reálné Supabase schéma bez autorizovaného přístupu nehádat. Pracovní P0 ~75 % až po CI, reálný test pending.

### 16. 10. 2026 — v0.1_554 PRODUKCE, P0 Finance VI
- PR #44 https://github.com/martinspadrna/Domacnost/pull/44 **MERGED**, squash commit `aef0754deb53e1eb1d0d32cb958c6aa6b7d92444` na `main`.
- **PR full CI + browser E2E PASS**, poslední PR commit `b2fdc866791c9f808600f1332af7631e680ea5cb`, run https://github.com/martinspadrna/Domacnost/actions/runs/38878033875. Nový vykonatelný `check-finance-inflight.mjs` ověřuje souběžné pokusy INSERT, editaci během requestu, smazání během INSERT, Undo gate, pozdní archivaci účtu a opakování po síťové chybě; zachovány všechny dosavadní Finance testy.
- **Vercel production READY**, deployment `dpl_CPAd8Bx9G5BmsHru1d7v9q9FLGum`, git SHA odpovídá merge, produkční alias `domacnost-plus.vercel.app`, `aliasError=null`.
- Opraveny závody při souběžném vytváření stejného finančního pohybu z formuláře a sync fronty (single-flight), zachování `pending_update` pro mezitímní editaci, přesměrování pozdního ACK po lokálním smazání účtu/pohybu do Koše/outboxu. Živé Undo zůstává dostupné; před jeho koncem se DB deletion neodesílá. Detachované async callbacky nesmějí přepsat aktuální lokální řádek.
- P0 **IN PROGRESS cca 75 % (pracovní odhad)**; **reálný cross-device / offline→online fyzický test stále chybí**. DB level idempotentní INSERT při ztracené odpovědi a account-level CAS vyžadují přístup ke skutečnému Supabase schématu. Po restartu před uložením serverového ACK se stále může objevit osiřelý INSERT, nelze poctivě označit za vyřešené.
- Další etapa: potvrdit přenos edit/delete přes PC↔mobil, přes restart při aktivním outboxu; samostatně řešit trvanlivé pending markery a riziko neviditelného Koše po pádu klienta. Neprovádět neověřené SQL/migrace ani neautorizované destruktivní zásahy.

### 16. 10. 2026 — P0 Finance VII, kandidát v0.1_555 (čeká kompletní CI)
- Vychází z produkční v0.1_554 a aktuálního `main` `c002019be1d2bfc07feed56151f174cb79cefe35`; větev `fix/p0-finance-trash-restart-replay-555`.
- Zjištěn restart bug: `saveState()` vytváří 30denní Koš okamžitě, ale `showUndoToast` teprve za cca 8 s z něj vytvoří cloud DELETE outbox. Když PWA/iPhone zavře/uspí stránku, JS timer se může ztratit; po restartu záznam v Koši zůstane, cloud operace se nikdy nepřehraje.
- **Oprava:** `recoverFinanceTrashCloudDeletes` při autosyncu a ruční synchronizaci dohledá z permanentního Koše všechny nedokončené finanční DELETE/archivace, starší 8 s a s potvrzeným cloud ID; explicitně vynechá živé/obnovené lokální záznamy, záznamy jiných domácností, aktivní/pending Undo, záznamy už v outboxu a serverem potvrzená smazání. Znovu zařadí jen bezpečné finance/financeAccounts do stávající fronty a ihned persistuje; nedělá nové DB DELETE napřímo.
- **Potvrzení ze serveru:** `confirmFinanceTrashCloudDelete` zapíše `cloudDeleteConfirmedAt` do zálohy záznamu v Koši na konci úspěšného outbox replay. Při dalším restartu se úspěšné smazání znovu nezakládá. Při obnově z Koše se tento interní příznak odstraní.
- **Cloud read-through:** `mergeFinanceTrashReceipts` při cloud snapshot merge zachová novější lokální cloudId/cloudUpdatedAt/cloudDeleteConfirmedAt ve stejném tombstone (pouze při shodné identitě). Starší kopie Koše z jiného zařízení tak nevrátí nezjištěný nebo zdánlivě nedokončený cloud delete.
- **Testy:** nový čistě lokální vykonatelný `tools/check-finance-restart.mjs` ověřuje restart po pádu Undo, opakovanou obnovu (idempotence), potvrzení DELETE a přežití ACK v Koši, jinou domácnost, aktivní Undo i starou cloud kopii Koše. Spouští se v `npm run check` s předchozími Finance regresními testy. Žádné DB migrace nebo zásahy do uživatelských dat.
- **Limity:** bez potvrzeného `cloudId` po ztracené odpovědi serveru nelze dokončit delete bez DB idempotency; account-level CAS také závisí na přístupu ke schématu Supabase. Fyzický PC↔mobil test bude až po dalších opravách dle uživatele. P0 pracovní odhad ~80 % po CI/produkci, nikoli fyzicky potvrzené dokončení.
- **Před main:** úplné GitHub CI + browser E2E PASS. Po sloučení ověřit poslední Vercel deployment READY, odpovídající git SHA a alias.

### 16. 10. 2026 — v0.1_555 PRODUKCE, P0 Finance VII
- PR #45 https://github.com/martinspadrna/Domacnost/pull/45 **MERGED**, squash `e4a5c7cef80e7b0bcc10f61e1b459b8fe7b033f2`.
- **Full CI + browser E2E PASS** na PR SHA `73c6a40a912a68c87821fc2d1f8e0b78c55fab34`: https://github.com/martinspadrna/Domacnost/actions/runs/38879826076. První CI run selhal kvůli starému testovacímu source extractor podpisu (ne produkčnímu kódu), poté opraven a kompletně PASS.
- **Produkční Vercel READY** `dpl_Ci9mZyNTy4YTbKQuAfvRfgrfaB2h`, SHA odpovídá release, alias `domacnost-plus.vercel.app`, `aliasError=null`.
- Trvalý Koš po pádu/uzavření PWA během Undo nyní obnovuje bezpečně ztracené čekající smazání Finance do outboxu. Smazání čeká na Undo (~8s), hlídá domácnost i živé záznamy; potvrzené serverové DELETE/archivace mají persistentní `cloudDeleteConfirmedAt` a neopakují se. Příjem staršího Koše z cloudu tento marker neodstraňuje.
- P0 IN PROGRESS cca **80 % (orientační)**. Uživatelský fyzický test až při dokončení širší etapy; stále OPEN serverová idempotence INSERT po ztracené odpovědi, account-level CAS po ověření DB, kompletní cross-device/offline restart. Uživatele neobtěžovat testováním po každém releasu.

### 16. 10. 2026 — P0 Cloud VIII, kandidát v0.1_556 (čeká CI)
- Navazuje na produkční v0.1_555 a HEAD `3822fa40dde7950f3bd909ba177c60850d86328f`; větev `fix/p0-cloud-sync-truthful-status-556`.
- V auditu zjištěn zavádějící sync status: `runUnifiedCloudSync` vždy nastavil `autosyncStatus:'done'`, `lastSyncAt` a „Všechno je synchronizované“ bez kontroly, jestli některý loader nevrátil false, jestli zůstaly čekající změny/outbox nebo konflikt.
- **Oprava:** zaveden `cloudSyncCompletionState(loadResult)` (pending, blocking conflict, permanent outbox error, incomplete load). `runUnifiedCloudSync` nyní aktualizuje `lastSyncAt` a hlásí úplný úspěch **pouze** při úplném načtení všech modulů a nulovém pending/konfliktu. Pokud část práce zbývá, nastaví stav pending/blocked, zachová čas posledního úspěšného syncu a oznámí počet neodeslaných změn/selhání načtení; bezpečný pending dostane automatický další pokus.
- `cloudSyncLocalPendingData` už neposouvá čas úspěšné synchronizace při čekajících změnách či blokaci. `cloudLoadAllModules` respektuje explicitní `false` z loaderu (nepočítá jako úspěch), vrací `{loaded,total}`, neaktualizuje `lastSyncAt` při neúplném stahování nebo pending. Starší API volající může výsledek ignorovat — kompatibilita zachována.
- **Regrese:** nový vykonatelný `tools/check-cloud-sync-status.mjs` simuluje kompletní úspěch, pending, blokaci konfliktu, permanentní outbox chybu a částečné načtení. Doplněno do `npm run check` vedle Finance testů z 551–555; navýšená PWA verze 556.
- **Limity:** neřeší neznámé skutečné schéma databáze; Supabase konektor nyní zobrazuje pouze RaK-test a RaK-hlavní, nikoli projekt Domácnost+ — žádné nepodložené SQL ani migrace. Zbývá fyzický 2-device test (uživatel chce až na konci etapy) a DB-level INSERT idempotence / account CAS.
- **Další krok:** full CI + browser E2E, merge po PASS do main a produkční Vercel READY/alias, aktualizace handoffu. P0 pracovní odhad max ~85 % po nasazení, nikoliv fyzické uzavření.

### 16. 10. 2026 — v0.1_556 PRODUKCE, P0 Cloud VIII
- PR #46 https://github.com/martinspadrna/Domacnost/pull/46 **MERGED**, squash commit `ddf5688471aff029414f5a6ecb5e856d7841ad0b` do `main`.
- **PR full CI + browser E2E PASS** https://github.com/martinspadrna/Domacnost/actions/runs/38880747187 (PR commit `8baba03c5cb7feeb57add150e22d9ef7f14f4505`). Spustil se nový vykonatelný cloud status test, Finance INSERT/snapshot/trash/inflight/restart regressions a dosavadní full pipeline.
- **Produkce Vercel READY**, deployment `dpl_4qTk49mM96daowxahnmzQSVHPVH6`, odpovídající git SHA, alias `domacnost-plus.vercel.app`, `aliasError=null`.
- `runUnifiedCloudSync` hlásí hotovo pouze po ověřeném úplném načtení všech loaderů, nulovém pending a absenci blokací. Při chybě zachová čas poslední úspěšné synchronizace, zobrazí čekající položky a naváže další retry dle rizika. `cloudSyncLocalPendingData` ani `cloudLoadAllModules` nesmí přepsat `lastSyncAt` při čekajících/neúplných operacích; loader `false` se nepočítá jako úspěch.
- P0 **IN PROGRESS ~85 % orientačně**, fyzický PC↔mobil test odložen dle přání uživatele až po dokončení zbytku. Supabase plugin list_projects vrací pouze `RaK- test` a `RaK- hlavní`; projekt Domácnost+ není dostupný, proto nelze v této relaci bezpečně ověřit/změnit DB schéma, account-level CAS a DB idempotentní INSERT. **NEPROVÁDĚT NEOVĚŘENÉ SQL**.
- Otevřené před fyzickým uzavřením: 2-device/suspend/restart/offline→online realita, ztracený ACK nového INSERT před perzistencí, databázový account-level CAS, plný multi-device acceptance. Ostatní P0 klientská opatření automaticky otestovaná; nic nepřepisovat bez důvodu.

### 16. 10. 2026 — P0 Finance IX, kandidát v0.1_557 (čeká CI)
- Výchozí poslední produkční main v0.1_556, SHA `269be24b28f3bdd5aa9024fedd3537f24895bc06`. Větev `fix/p0-finance-recovery-observability-557`.
- **Koš/outbox i při ruční synchronizaci:** `cloudSyncLocalPendingData` volá `recoverFinanceTrashCloudDeletes` před `replayCloudOutbox`. Dříve vynechávala pozdní DELETE po pádu Undo, pokud se mezitím neaktivoval automatický sync.
- **Indikace čekajících změn ihned po restartu:** `recoverableFinanceTrashDeleteIds` odděleno jako čistý, read-only výpočet. `getCloudSyncOverviewItems` započítá recoverable finance/financeAccounts mazání do „Čekající smazání“ a tím také do `cloudLocalPendingCount()`. Obnova má nadále stejné bezpečnostní podmínky: správná domácnost, dostupné cloud ID, žádný aktivní lokální záznam, starší než 8 s, neaktivní Undo, bez ACK i duplicity v outboxu. Watchdog tedy nezůstane slepý k čekající práci bez outboxu.
- **Ochrana lokálních financí před stale read:** `cloudLoadFinance` je dvoufázový SELECT: načítá účty a pak pohyby. Pokud se během asynchronního načítání změní finance nebo financeAccounts, cloud loader vrátí false a **nezapíše zastaralý staged snapshot**. Před potvrzením SELECT znovu načte skryté cloud ID z Koše/outboxu, takže smazání během druhého SELECT se neresurrectuje. Ostatní modulové chování beze změn.
- **Regrese:** nový `tools/check-finance-read-race.mjs` provádí skutečně asynchronní mock čtení s lokální změnou mezi SELECTy, kontroluje návrat false a zachování lokálního záznamu, úspěšné načtení bez souběhu, novou tombstone během SELECTu; kontrola obnovy a viditelnosti pending. Přidáno do `npm run check` se všemi regresními testy 551–556. Verze cache/release sjednocena na v0.1_557.
- **Otevřené:** DB-level idempotence pro ztracenou HTTP odpověď INSERT a atomický account CAS vyžadují přístup do správného Supabase projektu Domácnost+ (aktuálně konektor nabízí jen RaK projekty). Žádné SQL/migrace. Fyzický PC ↔ mobil a offline/restart test až po dokončení dle uživatele. Procento P0 zatím **IN PROGRESS ~85 %**, nelze automaticky prohlásit 100 %.
- **Před vydáním:** poslední PR SHA → full CI a browser E2E PASS, pak merge main a ověřit Vercel READY/alias.

### 16. 10. 2026 — v0.1_557 PRODUKCE, P0 Finance IX
- PR #47 https://github.com/martinspadrna/Domacnost/pull/47 **MERGED**, squash commit `2adcc3e65cc2c36d2707afb207a91cbe080ccad3` do `main`.
- **Full CI + browser E2E PASS** na PR head `6b6f41ac4e026013937e92c8f00baf4088bba375`, run https://github.com/martinspadrna/Domacnost/actions/runs/38882985600.
- **Vercel production READY**, deployment `dpl_5H4kdzaZRdmimJJ1cyuoxdNtj1MN`, SHA `2adcc3e65cc2c36d2707afb207a91cbe080ccad3`, alias `domacnost-plus.vercel.app`, `aliasError=null`.
- Ruční i automatický sync nyní rekonstruují z Koše nedokončená smazání financí před cloud outbox replay; nevyřízené smazání se zobrazuje v čekajících změnách ještě před vytvořením outboxu. Zmizí při potvrzeném serverovém ACK.
- Dvoufázový cloud SELECT účtů/pohybů již nesmí přepsat lokální zápis provedený během čekání. Pokud mezitím stav Finance změnil, loader abortuje starší remote snapshot. Před commit znovu aplikuje aktuální Koš/outbox filtr. Nový asynchronní `check-finance-read-race.mjs` testuje pozdní SELECT, lokální úpravu, nově smazaný cloud záznam a normální načtení.
- P0 **IN PROGRESS orientačně ~85 %**. Fyzické potvrzení PC↔mobil/offline→online až na konci dle uživatele. Trvale OPEN: DB-level idempotence INSERT po ztracené odpovědi, účetní atomický CAS a přístup k Supabase projektu Domácnost+ (konektor vrací jen RaK projekty). Bez správné DB neopravovat schema ani nevymýšlet migrace. Další klientské ochrany dělat pouze tam, kde najdeme konkrétní riziko/regresi.

### 16. 10. 2026 — P0 Finance X, kandidát v0.1_558 (ověřit CI a nasazení)
- Vychází z ověřené produkční v0.1_557 / main `6977286bcb40c300c5d79f62f5443874a2f41bbb`. Pracovní větev `fix/p0-finance-disconnected-pending-558`.
- **Cloudově propojená domácnost i bez připravené relace:** vytvoření/editace finančního účtu, finančního pohybu, dvojice spravovaných účtů a měsíční kopie nyní označují durable pending podle zachovaného `cloud.provider === 'supabase'` + householdId, nikoli jen `cloudReady()` (ta vyžaduje userId). Při dočasně nepřipraveném přihlášení se lokální změna bezpečně uloží a následující cloud SELECT ji nesmí přepsat.
- Nový pohyb získá `pending_add` před prvním `saveState`; kopie nepřebírají cloudovou revizi originálu. Chování pro čistě lokální domácnost se nemění. Skutečný upload se dál provádí výhradně při `cloudReady()`; žádný anonymní nebo cizí cloud zápis.
- **Pravdivý čas úplného syncu:** jednotlivé Finance INSERT/UPDATE/DELETE už nepřepisují `cloud.lastSyncAt`; tento údaj potvrzuje centrální synchronizace po kontrole všech modulů, outboxu, pending a konfliktů.
- Account sync fronta explicitně přeskočí `syncStatus: 'conflict'`; případnou konfliktní úpravu účtu neodesílá naslepo. DB account-level CAS a idempotentní INSERT nadále čekají na oprávněný přístup ke správnému Supabase projektu.
- Test `tools/check-finance-cloud-link.mjs` kryje nepřipravenou relaci, přesné pending před persist, zabránění přepsání cloud načtením, účty/pohyby/kopie, čistě lokální režim i čas syncu. Navazuje na kompletní finance a browser E2E regresní sady.
- **Před produkcí:** full GitHub CI včetně browser E2E PASS na posledním PR SHA, poté merge dle dřívějšího souhlasu a Vercel READY/alias. Fyzický PC↔mobil/offline→online test až po širší etapě, jak uživatel požádal.
- P0 nadále **IN PROGRESS cca 85 %**; ztracené ACK INSERT a account-level CAS bez ověřeného backendu nejsou vyřešené.

### 16. 10. 2026 — v0.1_558 PRODUKCE, P0 Finance X
- PR #48 https://github.com/martinspadrna/Domacnost/pull/48 **MERGED**, squash commit `af90f45a57ac533ed9bbcee8edac436481e5a355` na `main`.
- Kompletní **CI a browser E2E PASS**: PR `38884574167` na `2ca23e23881979886b49c7e4b07c3e5a210e7d9b`; main `38884682912` na squash `af90f45a57ac533ed9bbcee8edac436481e5a355`.
- Vercel produkce **READY**, deployment `dpl_75HF3xLvZv65mEFVb2ixB64uMvvP`, commit souhlasí s main; alias `domacnost-plus.vercel.app`, `aliasError=null`.
- Nasazeno trvalé pending Finance u cloudově propojené domácnosti při nepřipravené relaci, nové pohyby čekají již před prvním uložením, kopie nedědí cloudovou revizi, konfliktní účet se neodesílá automaticky, jednotlivý Finance ACK neposouvá čas úspěchu celé synchronizace.
- **Fyzicky ještě nepotvrzeno na reálných zařízeních.** P0 stále IN PROGRESS přibližně **85 %** (orientační, po ověření klientské vrstvy).
- **Další krok:** nepřidávat další spekulativní změny. U správného Supabase projektu Domácnost+ zajistit oprávněný schema audit `finance_accounts` pro účetní CAS a server-side INSERT idempotency. Do té doby jen konzervativní klientské opravy při konkrétní reprodukované chybě. Po uzavření backendu připravit jeden souhrnný fyzický test PC↔mobil: účet/pohyb create/edit/delete/Undo, 2 souběžné editace stejného záznamu, přepnutí domácnosti, offline→online, restart PWA a obnova outboxu/Koše; porovnat počty i hodnoty a zkontrolovat `lastSyncAt`/pending/konflikty. Žádné force, migrace či mazání bez ověření.

### 16. 10. 2026 — P0 Finance XI, kandidát v0.1_559
- Navazuje na produkční v0.1_558, `main` `33770056d46bd406678abe404e359df794655534`. Pracovní větev `fix/p0-finance-cloud-pagination-559`.
- **Oprava rizika neúplného cloudu:** `cloudLoadFinance` dosud použil jednorázový SELECT pro účty a pohyby. Supabase Data API může omezit počet řádků; větší historie se tak mohla tvářit jako kompletní a nahradit lokální obsah neúplným cloud snapshotem.
- Nový `cloudFinanceFetchAll` čte po 250 pomocí `.range` a `count:'exact'`, stabilně řadí podle názvu/data a `id`, hlídá počet mezi stránkami, duplicitní ID i aktivní domácnost. Chyba či neúplná stránka vrací `false` **bez výměny lokálních účtů a pohybů**. Existující ochrana proti změně lokálních dat během awaitu, Koš/outbox a ochrana pending zůstaly zachované.
- Nový vykonatelný test `tools/check-finance-pagination.mjs` pro 253 záznamů, návaznost na účet, ztracenou druhou stránku a změnu počtu. Adaptovány stávající testy `check-finance-read-race` a `check-finance-cloud-link`. PWA release surface sjednocena na build 559.
- **Známé omezení:** stránkování není transakční snapshot v DB; změna dat se stejným count uprostřed čtení zůstává teoreticky možná. DB-level account CAS a server-side idempotence INSERT stále vyžadují autorizovaný přístup k Supabase Domácnost+. Žádná DB migrace ani force overwrite.
- **Před nasazením:** celé CI včetně browser E2E na finálním SHA PASS, po merge ověřit produkční Vercel READY a alias. Fyzický PC↔mobil/offline→online test podle přání až po širší etapě. P0 stále IN PROGRESS přibližně 85 %.

### 16. 10. 2026 — v0.1_559 PRODUKCE, P0 Finance XI
- PR #49 https://github.com/martinspadrna/Domacnost/pull/49 **MERGED**, squash `f2aca5c1b3a917d0ba2d647afae9d398516e00ef` do main.
- Kompletní CI + browser E2E PASS: PR run `38907083078` na `baa51570ccc47175cdde59233b86a874afc6095b` a produkční main run `38907209697` na merge SHA.
- Vercel produkce **READY**, deployment `dpl_435RbP8X2DkrHR1Y9aQhrX4pvJ5B`, SHA přesně odpovídá main, alias `domacnost-plus.vercel.app`, `aliasError=null`.
- Načítání Finance Accounts a Transactions stránkované přes `range` a count, při chybné / neúplné stránce se lokální stav nepřepisuje. Regrese testovala 253 pohybů, vazby účtů, výpadek druhé stránky i změněný count. Zachována předešlá ochrana stale read, pending, Koše a outboxu.
- **P0 IN PROGRESS orientačně cca 85 %.** Fyzický PC↔mobil/offline restart test stále čeká na závěrečnou etapu dle uživatele. Účetní DB CAS/idempotence INSERT bez ověřeného Supabase schématu Domácnost+ stále otevřené; konektor hlásil permission denied. Nelze tvrdit dokončenou synchronizaci všech edge cases.
- **Další postup:** zajistit autorizovaný read-only přístup ke správnému Supabase projektu Domácnost+ pro `finance_accounts`, `finance_transactions`, revize a RLS. Žádné SQL ani migrace naslepo, žádné mazání nebo force overwrite. Po ověření schématu navrhnout bezpečný CAS a idempotentní create; pak souhrnný fyzický test přenosů PC↔mobil (create/edit/delete/Undo/Koš), současné konfliktní editace, offline→online a restart PWA. P1–P4 nadále čekají.

### 16. 10. 2026 — kandidát v0.1_560, P0/P3 globální hledání
- Výchozí produkční `main` SHA `8686d78e4690485492162f9bac3db07919bd065a`, poslední funkční build 559. PR #49/main run `38907354871` poprvé hlásil **flaky browser E2E:** „Globální hledání po zadání dotazu neudrželo fokus v poli“, při opakování PASS. Zdroj rizika je ověřen v kódu: `renderOverlaysOnly` a dílčí/plný render obnovují `innerHTML` celé vrstvy, čímž mohou odpojit aktivní vyhledávací input od DOM; obecný formulářový snapshot jej nechrání, protože není ve `<form>`.
- Cílená oprava `captureGlobalSearchFocus` / `restoreGlobalSearchFocus`: pouze při skutečném fokusovaném globálním hledání zachovat fokus, selection start/end a horizontální scroll při náhradě overlaye, renderu aktivního modulu i plném renderu. Úmyslný blur do jiného prvku nesmí vyvolat automatické znovuzaměření, a zavření hledání se nemění. Původní formulářová ochrana je zachována.
- Nový reálný Chrome E2E scénář v `tools/check-e2e-smoke.mjs` přes pouze testovací `__DOMACNOST_E2E_SEARCH_FOCUS_RENDER__` vynucuje DOM přestavbu ve všech třech render větvích, ověřuje fokus, dotaz a pozici kurzoru. Stávající hledání a navigace zůstávají testované. PWA/release v0.1_560 sjednocena.
- Čeká full check + browser E2E PASS na posledním head a následné merge/produkce dle trvalého souhlasu uživatele. DB CAS/idempotence Finance nadále otevřené bez správného Supabase oprávnění. Celkové P0 stále ~85 % orientačně; fyzický cross-device test odložen na závěr.

### 16. 10. 2026 — v0.1_560 PRODUKCE, globální hledání / render
- PR #50 https://github.com/martinspadrna/Domacnost/pull/50 **MERGED**, squash `c4ad05cd3c1aeff3ecf6f8c16c72cd782d454ceb` do main.
- **Full check i skutečný Chrome browser E2E PASS**: PR run `38909062530` (head `15e1f312a4e6cfa5bc1012bdef6cf4937865a38e`), produkční main run `38909184022` (merge SHA).
- Vercel produkce **READY**, deployment `dpl_4d6tH6njapj72Ga2d6GpacmR3Lc3`, git SHA přesně odpovídá merge; produkční alias `domacnost-plus.vercel.app` bez aliasError.
- Globální hledání zachovává fokus/selection při změně innerHTML overlaye, modulového renderu i plného shell renderu. Chrome E2E nyní cíleně vynucuje všechny tři DOM náhrady a potvrzuje fokus, text i kurzor.
- Fyzické ověření iPhone/Android uživatelem čeká na závěrečnou etapu. P0 Finance stále **IN PROGRESS ~85 %** orientačně; autoritativní DB account CAS a idempotentní INSERT po ztracené odpovědi nejsou bez oprávněného přístupu do Supabase projektu Domácnost+ uzavřené. Neprovádět migrace ani force přepisy naslepo.
- Další krok: ověřit oprávnění ke správnému Supabase projektu Domácnost+ pro read-only schema/revize, bezpečně navrhnout server-side ochrany. Teprve potom širší fyzické PC↔mobil/offline/restart/konfliktové testy. Další klientské zásahy dělat jen při konkrétním reprodukovaném problému.

### 16. 10. 2026 — P0 Finance XII: izolace cloud outboxu při přepnutí domácnosti, kandidát v0.1_561
- Vychází z produkční v0.1_560, `main` `0c4786e0166ba0dd4df7372e5556dcee131bfc49`.
- **Reprodukovaná logická race v `replayCloudOutbox`:** po zahájení DELETE v domácnosti A může uživatel přepnout do domácnosti B; pozdní ACK pak původně mohl přepsat B `state.cloud.outbox`, případně vyznačit cizí smazání za potvrzené. Stejně tak vložení dalšího DELETE během HTTP await mohlo být ztraceno použitím zastaralé `queue.slice(1)`.
- Oprava uzamyká identitu domácnosti + uživatele pro jeden replay, explicitně scope-uje všechny HTTP dotazy na původní domácnost, po každé odpovědi kontroluje aktuální workspace a přítomnost odpovídající outbox položky. Při změně domácnosti/revize fronty se bezpečně zastaví **bez zápisu do nové fronty**. Při ACK/FAIL vždy složí frontu z jejího aktuálního stavu, takže dodatečně vytvořená mazání nezmizí.
- Nový vykonatelný test `tools/check-cloud-outbox-race.mjs` simuluje reálné asynchronní odpovědi: přepnutí během archivace Finance Account, přidání dalšího DELETE při prvním await, chybovou odpověď a finance read-before-delete při změně domácnosti. Bez potřeby přístupu k produkční DB; žádná migrace ani úprava RLS.
- Verze a PWA cache sjednocena na v0.1_561. **Před nasazením** plné CI + Chrome browser E2E PASS, poté merge a Vercel READY / alias. P0 stále **IN PROGRESS ~85 %**, správné Supabase oprávnění, účetní CAS/idempotentní INSERT a fyzický PC↔mobil test zůstávají otevřené.

### 16. 10. 2026 — v0.1_561 PRODUKCE, P0 Finance XII
- PR #51 https://github.com/martinspadrna/Domacnost/pull/51 **MERGED**, squash commit `724f6e67b085b2b9b60ff3cdd051cc86aaf6402c` na `main`.
- PR full checks a browser E2E **PASS** na head `eeb683397c31ba956d04bfd1f8b18e893b5c4905`, run `38910893824`. Starší statický Finance restart test byl upraven na nové bezpečné pořadí potvrzování ACK.
- Vercel produkce **READY**: deployment `dpl_BEN9aghsT6NoibpPF1aoQgtZ1Af9`, commit souhlasí s main; `domacnost-plus.vercel.app` alias přidělen a `aliasError=null`.
- Scoped DELETE outbox: žádné přepsání fronty nové domácnosti pozdním ACK ze staré, žádná ztráta dalších DELETE vzniklých během síťového požadavku. Testováno se simulovaným network await, chybovou odpovědí a změnou domácnosti; uživatelský fyzický test není dosud hotový.
- **Main CI**: run `38911025385` zahájen pro merge SHA; ověřit konečný PASS po doběhnutí, případné selhání rozebrat podle logu.
- **P0 IN PROGRESS cca 85 %.** Blokátor posledního kroku je autorizovaný přístup k projektu Supabase Domácnost+ kvůli DB account CAS a serverové idempotenci INSERT. Žádné DB zásahy bez ověření schématu a práv. Až poté souhrnný PC↔mobil/offline/restart test. Nepřidávat spekulativní klientské změny bez konkrétního rizika.

### 18. 10. 2026 — P0 tenant isolation: kandidát v0.1_562
- Vychází z produkční v0.1_561, `main` `add35cc8d3a460f82532af3ee790ccb296e08388`. P0 stále IN PROGRESS.
- **Zjištěné riziko:** v561 je izolovaná pouze cloudová DELETE fronta, ale ruční/automatická synchronizace a multi-module read cykly provádějí více `await` operací; při změně domácnosti mezi nimi mohou další operace běžet již v jiné domácnosti a stará odpověď může nové domácnosti změnit `autosyncStatus`/`lastSyncAt`.
- `cloudSyncWorkspaceScope` zachytí aktuální `householdId`/`userId`, `cloudSyncWorkspaceMatches` ověří jeho platnost. Cílená ochrana v `runCloudAutosyncNow`, `cloudSyncLocalPendingData`, `runUnifiedCloudSync`, `cloudLoadAllModules`, `cloudLoadModuleForNav` i `cloudBackgroundLoadAllModules` přeruší starou dávku po čekání na moduly/síť a před následující operací či potvrzením úspěchu. Autosync blokuje souběžné vyvolání dalšího `runCloudAutosyncNow`, při přepnutí zachovává stav nové domácnosti a případný nový pending naplánuje pod jejím kontextem.
- Vykonatelný regresní test `tools/check-cloud-workspace-scope.mjs` simuluje opožděné odpovědi z A po přepnutí na B u všech šesti cest; kontroluje, že se následný loader/sync již nespustí a `lastSyncAt`, fronty a stav B nejsou falešně potvrzeny. V konzervativním rozsahu pouze frontend orchestrátor, bez Supabase SQL/migrací.
- **Omezení:** jednotlivé již běžící remote requesty nelze tímto klientským guardem atomicky zrušit ani zaručit, že jejich interní loader nezmění lokální stav; to vyžaduje další audit všech jednotlivých loaderů a backend CAS. Guard zajišťuje ukončení zbytku starého cyklu a že orchestrátor nepotvrdí úspěch v novém workspace.
- Před merge nutné plné CI + reálné Chrome E2E PASS a poté ověřit Vercel production READY + alias a zapsat finální SHA.
- Supabase konektor 18.10. zobrazuje pouze RaK test `cgshssdjgzzuprlwnabl` a hlavní `bkqamcbkiwumsvelahxr`, nikoli Domácnost+; neprovádět zásahy v cizích projektech. Účetní DB CAS a idempotentní INSERT plus fyzický cross-device test zůstávají otevřené (~85 % orientačně).

### 18. 10. 2026 — v0.1_562 PRODUKCE, P0 tenant isolation
- PR #52 https://github.com/martinspadrna/Domacnost/pull/52 **MERGED**, squash `2c90e2c4432a40846886af38650001618eec1907`.
- PR **full checks a skutečné Chrome E2E PASS** na kandidát SHA `e329402a065ae968b85ca41fb7da19a7e9dbe3fd`, GitHub run `39107876530`.
- Produkční main **full checks + Chrome E2E PASS**, GitHub run `39107959294` na squash SHA.
- Vercel produkce **READY**, deployment `dpl_2Wtma18H4cn3j8taToUWPT63zXgB`, `meta.githubCommitSha` odpovídá merge SHA, alias `domacnost-plus.vercel.app`, `aliasError=null`.
- Ochrana scope manuálního i automatického cloudu a targeted/bulk/background loaderů při přepnutí domácnosti, bez DB změn, bez přepisů pending/konfliktů. Autotesty zahrnují odložené odpovědi všech šesti cyklů; fyzický test není hotov.
- **P0 IN PROGRESS orientačně ~85 %.** Na uzavření chybí Supabase Domácnost+ DB CAS a idempotence INSERT (konektor ukazuje pouze jiné RaK projekty), plus souhrnný test PC↔mobil, offline/online, restart PWA, konflikty a Undo dle uživatelova přání až po širší etapě. Žádné spekulativní migrace nebo force.

### 18. 10. 2026 — P0 cloud extra SELECT / realtime závod, kandidát v0.1_563
- Výchozí produkční main `a44b57127059ceecf06b01b0a866ef52873291e0`, release 562. Bez nových oprávnění ke správnému Supabase projektu Domácnost+ (přístupné byly pouze RaK).
- Konkrétní bug v `cloudLoadExtraCollection`: po `await` SELECT nebyla kontrola identity domácnosti ani stejného lokálního snapshotu. Staré A mohlo načíst B do `state.notes/coupons/warranties`; stará cloud data mohla také přepsat edit, která vznikla během HTTP čekání. Výsledek navíc vždy nastavoval `lastSyncAt`, přestože šlo jen o dílčí čtení.
- Fix: scope `householdId` + `userId`, explicitní filter SELECT na počáteční domácnost, po odpovědi kontrola scope a lokálního snapshotu (bez aktuálnosti nepřebírat nic). Zachovat stávající merge lokálně pending; neúplný DB response je failure bez vyprázdnění kolekce. Dílčí SELECT neoznačuje kompletní sync za hotový. Batch `cloudLoadExtraCollections` ověřuje scope po každém loaderu, zastaví se bez změny B a vrací false při částečně neúspěšném načtení.
- Realtime: callback `postgres_changes` a `subscribe` ověřuje identitu původního kanálu, domácnosti i uživatele; starý A kanál po přepnutí nesmí spustit B reload ani změnit B `realtimeStatus`. Běžící refresh chrání scope před následným potvrzením `online` a před fallbackem; refresh více zdrojů se po přepnutí zastaví.
- Přidány dependency-free regresní testy `tools/check-cloud-extra-read-race.mjs` (časově opožděné SELECT, lokální edit, pending merge, B, partial batch) a `tools/check-cloud-realtime-scope.mjs` (staré eventy/subscription callbacky, opožděný refresh a error/fallback). Verze + PWA cache 563 všude sjednocené.
- **Před merge:** vyžadovat full `npm run check` + Chrome `check:e2e` PASS na posledním PR SHA, následně main a produkce READY i správný alias, aktualizovat finální handoff.
- **P0 stále IN PROGRESS cca 85 %.** Správný Supabase DB account CAS/idempotence INSERT, test reálného PC↔mobil offline/restart/konflikt a audit jednotlivých zbývajících loaderů nejsou tímto fixem vyřešené; nepoužívat force ani migrovat jiné Supabase projekty.

### 18. 10. 2026 — v0.1_563 PRODUKCE, P0 extra data/realtime ochrany
- PR #53 https://github.com/martinspadrna/Domacnost/pull/53 **MERGED**, produkční squash commit `d8da8b01b0818bcca4993c115eafecb13e6c833a`.
- PR full checks a browser Chrome E2E **PASS** na posledním head `578c6ec8a6f71e70ce74386af027240c3495137a`, run `39112548643` (počáteční testovací timing chybu jsme opravili před merge).
- Produkční main full checks a Chrome E2E **PASS**, run `39112609253` na přesném merge SHA.
- Vercel produkce **READY**, deployment `dpl_H2hXNYQPPDkn9y21kgVHWYv8RDFC`; produkční alias `domacnost-plus.vercel.app`, `aliasError=null` a git SHA odpovídá merge.
- `cloudLoadExtraCollection` nyní chrání workspace i rozpracovanou lokální editaci během čtení Notes/Coupons/Warranties; chybné/partial SELECT nezahodí lokální data ani nepředstírá kompletní sync. Batch partial failure vrací false. Staré realtime callbacky/odpovědi z jiné domácnosti nebo účtu nemohou dát aktuální domácnosti `online` ani spouštět její targeted refresh.
- Dva nové asynchronní regresní testy integrovány do npm check; PWA cache/release build 563 konzistentní.
- **P0 zůstává IN PROGRESS přibližně 85 %.** Chybí DB account-level CAS a serverově idempotentní INSERT po lost ACK; aktuální konektor Supabase nemá přístup ke správnému projektu Domácnost+ (pouze RaK), žádné migrace naslepo. Reálný PC↔mobil, offline/restart/konfliktový test uživatel chce až po širší etapě; jednotlivé loader/write paths mimo rozsah této opravy dále auditovat pouze s reprodukovaným rizikem.

### 18. 10. 2026 — P0 větší balík: Cloud Extra Writes + true complete sync (kandidát v0.1_564)
- Základ produkce v0.1_563, main `e42ba0ca7294d5ede5964b4a54ca08117d7372dd`. Dle přání uživatele větší koherentní dávka místo série malých vydání.
- **Nalezeno:** `cloudUpdateExtraItem` vracel úspěch i bez klienta a po `UPDATE` bez potvrzeného řádku; opožděný ACK po novější editaci mazal `syncStatus`. `cloudAddExtraItem` po změně domácnosti, editaci při requestu nebo smazání původního záznamu mohl chybně přidělit cloud ID a zahlásit hotovo. `cloudSyncLocalExtraCollections` neměl tenant scope během celé dávky. Ruční `cloud-sync-note` volal INSERT i pro poznámku s cloudId. Neúspěch `toggleBoolean` vracel editaci lokálně zpět. `cloudLoadAllModules` počítal jako chybu vždy-false no-op `cloudLoadUserVisualSettings`; realtime fallback mohl ignorovat incomplete výsledek.
- **Úpravy:** INSERT i UPDATE pro stejnou položku lokálně sekvenčně přes single-flight Map; ID účtu + domácnosti a objekt musí souhlasit před requestem i po ACK. Po změně během INSERT přidělit serverové ID, ale ponechat `pending` a re-sync; UPDATE vyžaduje `.select('id').maybeSingle()` a správné ID, nepovažuje 0 řádků za úspěch. Dirty local snapshot zachovává pending. Opožděná odpověď staré domácnosti nesmí zapsat nový stav. Batch extra sync kontroluje tenant při každém kroku. Cloud delete extra vyžaduje potvrzené ID; nedostupný klient znamená false. Bez serverové CAS **nelze zaručit mezi dvěma zařízeními bezkonfliktní UPDATE**.
- Note sync se správně dělí INSERT/UPDATE, coupon edit a extra toggle ponechají lokální hodnotu při offline/network fail jako `pending`, místo rollbacku uživatelské změny. V plném cloud loaderu odstraněn neexistující samostatný `user_app_settings` loader; skutečné settings dál čte household dashboard_layout, aby se false nepočítalo jako trvale nedokončená synchronizace. Realtime full fallback vyžaduje kompletní výsledek, jinak nehlásí zelené online.
- Nový `tools/check-cloud-extra-writes.mjs` simuluje lost/no-row ACK, concurrent update, mutaci během INSERT/UPDATE, A→B při čekání, offline, delete a batch scope. Bez backend oprávnění, žádné SQL/migrace ani přepis uživatelských dat.
- **Omezení:** serverově idempotentní INSERT a databázové revision CAS stále čekají na autorizovaný přístup do správného Supabase projektu. Pozdní INSERT u už odstraněného záznamu nelze bez serverového idempotentního klíče plně automaticky deduplikovat. P0 zůstává IN PROGRESS přibližně 85–88 %, fyzický PC↔mobil/offline/restart test až po této širší etapě podle přání uživatele.
- K vydání nutné zelené full CI + Chrome E2E na finálním PR SHA, merge a kontrola main CI, Vercel READY a produkční alias; poté finální handoff záznam.

### 18. 10. 2026 — v0.1_564 PRODUKCE, větší P0 cloud balík
- PR #54 https://github.com/martinspadrna/Domacnost/pull/54 **MERGED**, merge SHA `39923b74402ce81a18b27bbe0cc620107020c634` na main.
- PR full checks + Chrome E2E **PASS** na head `2487df95ab3e3ad54092b0d1fd9cfd4af262e40f`, GitHub run `39117734650`; původní dva běhy na PR odhalily a opravily pravdivé vykazování po přepnutí domácnosti a starší test očekávající odstraněný no-op loader.
- Produkční Vercel **READY**, deployment `dpl_4qRqf72GHc3Awnj1UB1FPm15Unda`; `githubCommitSha` přesně odpovídá merge, alias `domacnost-plus.vercel.app` bez chyby.
- Main CI GitHub run `39117838244`: první pokus Chrome E2E **FAIL** na jediné kontrolní větvi „Upozornění nejdou nastavovat samostatně podle typu“, všechny ostatní browser scénáře a celé npm check PASS. **Opakování bez změny commitu PASS** včetně upozornění. Flaky E2E je nadále otevřený test-harness úkol, není potvrzena aplikační regresní chyba. Neprohlašovat první run za PASS — hlídat stabilitu v dalších bězích, ideálně čekat na panel/re-render místo pevného 180ms timeoutu.
- Změny: extra cloud INSERT/UPDATE potvrzuje správný řádek a tenant, per-item single-flight, dirty snapshot během čekání zůstane pending; offline/error nepřepíše lokální editaci, cloudSyncLocalExtraCollections má tenant ochranu i po await. Ruční notes retry rozlišuje INSERT/UPDATE. Odebrán falešný always-false user settings loader z full-load početníku, realtime fallback kontroluje úplnost.
- Test `tools/check-cloud-extra-writes.mjs` plus existující regresní sada a Chrome E2E, bez databázového zásahu. PWA release značky 564 ve všech relevantních souborech.
- **P0 IN PROGRESS cca 85–88 %**, neuzavřený serverově idempotentní INSERT, `finance_accounts` DB CAS, přístup do správného Supabase projektu Domácnost+, fyzické PC↔mobil/offline/restart a konflikty. Bez správných práv do Supabase neprovádět žádnou migraci. Potenciálně osiřelé řádky po smazání během insertu je nutné dořešit backendově nebo bezpečným outboxem; současný klient si je po ztracené odpovědi nedokáže zaručeně deduplikovat.
- **Další krok většího rozsahu:** buď autorizovat správný Supabase projekt a provést backend revize/idempotence s read-only auditem nejprve, nebo pokračovat samostatným P1/P2 průchodem skutečných modulů a stabilizačními regresními testy bez databázových zásahů; nepřidávat stále další drobné náhodné cloud patche.


### 18. 10. 2026 — P1 offline lazy moduly + stabilnější browser E2E, kandidát v0.1_565
- Výchozí main v0.1_564 / HEAD 4148d73c7, větev `feat/p1-offline-module-cache-565`. P0 backend DB CAS a idempotence zůstávají otevřené, přístupný Supabase konektor nadále vidí pouze dva projekty RaK, ne Domácnost+; bez migrací.
- P1 nalezená mezera: `LAZY_APP_ASSETS` se do offline cache načítaly až po prvním otevření každého modulu, tedy po čisté instalaci byla většina modulů při prvním offline vstupu nedostupná. Po registraci aktivního SW se nyní po prodlevě 8 s na pozadí a pouze online (ne skrytý tab, saveData, 2G/cellular pokud je dostupná informace o připojení) vyšle `CACHE_LAZY_MODULES`. SW stáhne všechny nepřítomné odložené CSS/JS přímo do cache aktuálního buildu, deduplikuje souběžné požadavky a toleruje selhání jednotlivých fetchů/kvóty. Jádro a install zůstávají beze změny, nic neblokuje první render ani update SW. iOS bez informace o typu připojení může přednačíst na mobilních datech; pouze malý soubor statických modulů, uživatelská data se nenahrávají.
- Regrese: nový samostatný `tools/check-pwa-offline-cache.mjs` dynamicky spouští service worker v testovaném mocku, kontroluje úplnost registry lazy modulů, deduplikaci dvou požadavků, správný build cache, idempotenci a ignorování cizích zpráv. Zapojeno do `npm run check`.
- Stabilita CI: browser E2E Upozornění čeká na vykreslení 10 přepínačů a poté na skutečně změněnou hodnotu `aria-checked`, místo pevného čekání 180 ms a okamžitého čtení v tomtéž JS ticku.
- Před merge: full npm check + Chrome E2E PASS na finálním PR SHA; pak produkční main CI, Vercel READY, alias a finální handoff. P0 nezavírat; fyzický PC/mobil offline, restart a konflikt test stále otevřený.


### 18. 10. 2026 — v0.1_565 PRODUKCE, P1 offline moduly a test harness
- PR #55 https://github.com/martinspadrna/Domacnost/pull/55 **MERGED** squash `806af9130138618975d4726073220b04e495d376`.
- Finální PR head `bd30711d8e2e87b2790dd57c60b23c6239460294`: **full checks i Chrome E2E PASS**, run https://github.com/martinspadrna/Domacnost/actions/runs/39119196211.
- Produkční main na squash SHA: **full checks i Chrome E2E PASS**, run https://github.com/martinspadrna/Domacnost/actions/runs/39119299864.
- Vercel **READY**: deployment `dpl_2QKbhPY136CTFF8dmFCaC2JtSuKQ`, `githubCommitSha` odpovídá squash SHA, `domacnost-plus.vercel.app` v aktivních aliases, `aliasError=null`.
- Nové lazy moduly se po startu aplikace online nenápadně přednačítají do aktuální cache; na pomalém/šetřeném připojení pouze při povolených podmínkách. Start, install/update PWA nejsou blokované. Offline dostupnost nově instalované appky je zaručena až po dokončení tohoto úspěšného přednačtení; při ztrátě sítě se nedotažené moduly zkusí při příštím startu.
- Browser E2E Upozornění čeká na skutečný přepínač a změnu stavu, odstraněn flaky fixní delay. Nový dependency-free test integrovaný do CI.
- **P0 pořád IN PROGRESS ~85–88 %.** Backend účetní CAS, idempotence INSERT, autorizovaný Supabase Domácnost+ a reálný PC↔mobil/offline/restart/konflikt test jsou otevřené. P1 je nyní rozpracované (offline připravenost vylepšena), další P1/P2 moduly auditovat a řešit pouze konkrétní potvrzené riziko.


### 18. 10. 2026 — P1/P2 větší blok: cloud fresh-read při startu a pravdivý stav (kandidát v0.1_566)
- Výchozí produkční `v0.1_565`, main `8e2bc56c4363f08f821d877a3eb6a1ba3241404d`. Větev `fix/p1-p2-cloud-refresh-completeness-566`; bez Supabase SQL nebo migrací.
- Audit odhalil: `scheduleBootHomePriorityCloudLoad` zůstalo bez volání, takže Home datové moduly nebyly při warm-start automaticky aktualizované. Připojeno po prvním lokálním renderu a obnovení cloud household/profile; klidový asynchronní refresh nyní aktualizuje nejprve panely Home a až poté zbytek modulů. Offline a úsporné/pomalé připojení priority nespouští; navazující background opět kontroluje síť. Lokální UI se neblokuje.
- Další tři chyby: lazy `scheduleLazyCloudLoadForModule` označovalo i nezdařené volání za `loaded` a sdílelo marker mezi domácnostmi; `cloudLoadModuleForNav` hlásilo úspěch pokud uspěl jediný subloader; `cloudBackgroundLoadAllModules` bezpodmínečně přepisovalo `lastSyncAt` i při částečném selhání/pending a vracelo `true`. Nyní je loaded pouze úplný úspěch, další pokusy nejsou blokované, marker lazy modulu má tenant klíč, priority/background chrání scope přes async čekání, timestamp pouze při kompletním načtení bez pending/konfliktu/outbox permanent error. Skip-modules denominator vychází jen z platných modulů.
- Test `tools/check-cloud-module-completion.mjs` skutečně vykonává funkce z `app.js` s řízeným network failure/delayed response/tenant switch a kontrolou markerů/timestampů. Zapojen do `npm run check`.
- Před sloučením: plné CI a Chrome E2E PASS na head, potom main CI/Vercel/alias a finální handoff. P0 DB CAS + idempotence INSERT, autorizace k Domácnost+ Supabase, fyzický PC↔mobil/offline/restart test stále otevřené.


### 18. 10. 2026 — v0.1_566 PRODUKCE (P1/P2)
- PR #56 https://github.com/martinspadrna/Domacnost/pull/56 **MERGED**, squash SHA `9605f07f5a8ebac1ba4f10b8b47b892cf13bc14d`; finální PR head `4a712d08d8d9a468e264a160b950bc92cf18a587`.
- **Full checks + skutečné Chrome E2E PASS** na posledním PR SHA, run `39123775886`. První PR run `39123729923` FAIL: starý test PWA cache měl natvrdo číslo 565; opraven na aktuální `release.json`, následný kompletní run PASS.
- Produkční `main` full checks + Chrome E2E **PASS**, run `39123853433` na přesném squash SHA.
- Vercel production **READY**, deployment `dpl_2jrUmooD4feL7da5VmE61qLNZoYN`, `githubCommitSha` odpovídá merge SHA, `domacnost-plus.vercel.app` v alias a `aliasError=null`.
- Implementované: po rychlém local-first Home startu se klidově dočtou panelové datové moduly z cloudu, následně se dočítají zbývající moduly; u partial load už loaded neblokuje retry a lastSyncAt nevydává falešné potvrzení; lazy marker je tenant-scoped, priority/background drží workspace scope i přes síť, full load vyžaduje nulový pending/konflikt/outbox blocking. Reálný PC/mobil test stále nepotvrzen.
- **P0 stále IN PROGRESS ~85–88 %**: backend účetní CAS/idempotentní INSERT, autorizovaný přístup ke správnému Supabase projektu, fyzické PC↔mobil/offline/restart/konflikt. P1/P2 **ROZPRACOVÁNO**: další větší etapa může být konzistence ostatních modulů/uživatelský fyzický test, bez zásahu do jiné Supabase DB.


### 18. 10. 2026 — větší P1/P2 balík: cloud bootstrap tenant-race, kandidát v0.1_567
- Výchozí `main` `60ea4c5068da62b57853b9c8c9eb04bf87d07203`, produkční v0.1_566. Větev `fix/p1-p2-bootstrap-read-isolation-567`.
- Nalezeno v `cloudLoadHouseholds`, `cloudLoadHouseholdUiSettings`, `cloudLoadProfilesForCurrentHousehold`: opožděné SELECT odpovědi po změně účtu/domácnosti se mohly aplikovat do aktuálního lokálního stavu. Profiles navíc mohly při síťovém čekání přepsat novější lokální edit a aktivní profil. Žádná SQL migrace.
- Tyto čtečky nyní fixují původní `householdId`/`userId`, SELECT je na původní tenant, po await kontrolují scope, UI loaders i po případném lazy `ensureHouseholdUiSyncDependencies`, nulová/neúplná odpověď household listu není důvod smazat domov, profiles zachovají současnou editaci. `cloudWarmStartLoad` před dalšími kroky i potvrzením kontroluje účet/scope.
- Tři dílčí čtení přestala přepisovat globální `state.cloud.lastSyncAt`, který má znamenat potvrzenou souhrnnou synchronizaci. Ostatní legacy lokální moduly ještě čítač používají; jejich kompletní sjednocení je samostatný audit, nesmí se přepisovat bez důkazů a testů.
- Nový vykonatelný `tools/check-cloud-bootstrap-races.mjs` v CI simuluje opožděný SELECT, A→B, user switch, lokální edit, změnu profilu, chybějící data a warm-start. Následně ověřit full CI i Chrome E2E, pak merge/main/produkční alias a final handoff.
- **P0** DB CAS/idempotence stále otevřené, fyzický PC↔mobil/offline/restart až po širším balíku; neposílat migrační SQL do nepřipojeného Supabase projektu.


### 18. 10. 2026 — v0.1_567 PRODUKCE, bootstrap čtení izolovaná podle domácnosti
- PR #57 https://github.com/martinspadrna/Domacnost/pull/57 **MERGED** do main; squash commit `d5f4515cec25c7ad03ec07bd33c69ec91b2af9a3`. Kandidát `6dd29625050568a30ca02bdd1e90d51de61ea9ea`.
- PR plné CI + reálný Chrome E2E **PASS**, run `39128314833`. Produkční main na squash SHA: full checks i Chrome E2E **PASS**, run `39128394164`.
- Produkční Vercel **READY**, deployment `dpl_ENJF6qRWdQ8vUQuRrgxBnD86b3bs`, `meta.githubCommitSha` odpovídá squash SHA, alias `domacnost-plus.vercel.app` aktivní, `aliasError=null`.
- P1/P2: SELECT domácností/layoutu/profilů neaplikuje stale výsledek po přepnutí účtu nebo domácnosti; místní editace profilu a změna aktivního profilu při HTTP čekání mají přednost. Cloud warm-start po asynchronních krocích ověřuje identity scope, po přepnutí se nepokračuje v profile/home refresh staré domácnosti. Dílčí SELECT u těchto tří cest už nepřepisuje globální `lastSyncAt`; ostatní historické zápisy do `lastSyncAt` dále auditovat selektivně.
- `tools/check-cloud-bootstrap-races.mjs` simuluje opožděné odpovědi, local edit, špatný/missing remote řádek i switch při dependency await. Full CI Chrome E2E a PWA release marker konzistentně 567.
- P0 zůstává otevřené: Supabase Domácnost+ backend schema, account CAS a serverově idempotentní INSERT plus skutečný test PC↔mobil/offline/online/restart/konflikty; žádné DB zásahy bez autorizace. P1/P2 nadále rozpracované. Následující krok: další cílený audit načítání jednotlivých modulů a agregovaného sync stavu, bez zbytečného zásahu do hotových částí.


### 18. 10. 2026 — P1/P2 Nákup + Garáž atomické čtení, kandidát v0.1_568
- Výchozí produkce v0.1_567, `main` HEAD `7c24487ed18788914c0a269d8c0f2983bcf2d851`. Větev `fix/p1-p2-shopping-garage-read-568`.
- **Nákup:** původně v `cloudLoadShoppingData` načtené seznamy, katalog a `shoppingCloud` měnily lokální state dříve než doběhl SELECT `shopping_list_items`; při selhání zůstaly nové seznamy a staré položky. Nyní atomicky nejprve čeká na všechny 4 katalogové SELECT a na položky (nebo validní prázdný seznam), teprve poté mutuje stav. Neúspěšné/neúplné `data:null`, A→B/user switch nebo současná lokální změna skončí `false` bez přepsání původních dat. Lokálně pending položky se dál mergují stávající implementací, bez změny algoritmu.
- **Garáž:** `cloudLoadGarageData` nyní SELECT všech tří tabulek váže na původní workspace, čeká na všechna data, kontroluje `Array.isArray`, A→B/user switch a in-flight local edit. Při partial/HTTP error vrací `false` místo `undefined`, při potvrzeném úspěchu `true`. Existing pending merge zachován beze změny.
- Oba moduly už samostatným SELECT neoznačují celý cloud synchronizovaný přes `lastSyncAt`. Orchestrátor `cloudLoadAllModules` explicitní `null` počítá jako chybu, `lastSyncAt` nezmění při permanentním outbox failure. Legacy `undefined` po dobu postupné migrace loaderů zůstává kompatibilně jako úspěch, ostatní moduly dále auditovat.
- Regresní test `tools/check-cloud-shopping-garage-read.mjs` vykonává reálné extrahované funkce s mock síťovými odpověďmi (neúplná data, failure 5. shopping SELECT, A→B, user switch, současný local edit, happy path i pending) a kontrolu sync statusu. Připojen do `npm run check`; `check-cloud-sync-status.mjs` upraven podle nové null podmínky.
- Bez Supabase SQL/migrací. Ověřit full CI+Chrome E2E před merge, pak main CI+Vercel READY/alias a aktualizovat handoff. **P0 backend CAS/idempotence + autorizace a fyzický PC↔mobil test zůstávají otevřené.**


### 18. 10. 2026 — v0.1_568 PRODUKCE, atomické čtení Nákupu a Garáže
- PR #58 https://github.com/martinspadrna/Domacnost/pull/58 **MERGED**. Finální head `7e073f3a7f1c4d06ef412323c5e08af924349f71`, squash commit `bdd7d898d2dd05d27ade09608d1cba6162eb2390`.
- Full CI + Chrome E2E PR **PASS**, workflow run `39147045895`. První run `39146998340` spadl výhradně na zastaralém textovém assertionu `check-cloud-sync-status.mjs`, který jsem upravil; druhý run prošel kompletně.
- Produkční main full checks + Chrome E2E **PASS**, run `39147126716` na squash SHA. Vercel production **READY**, deployment `dpl_2ukvZfE7ZySuGC3PeCAyDiDV5iYK`, `githubCommitSha` odpovídá squash SHA, doména `domacnost-plus.vercel.app` v aktivních alias, `aliasError=null`.
- Nákup: žádná částečná mutace po selhání 5. SELECT, stale household/user a lokální změny během fetchů bezpečně odmítnuty; merge pending zůstává. Garáž: trojité SELECT validované najednou, scope a local edit ochrana, explicitní true/false. Obě dílčí čtení už nemění globální `lastSyncAt`. Bulk loader respektuje explicitní null selhání a permanentní outbox failure. Nový regresní test integrován do `npm run check`.
- **P0** zatím neuzavřeno (backend DB CAS + idempotentní INSERT, správný Supabase projekt, skutečné PC↔mobil/offline/restart/konflikty). P1/P2 pokračuje auditem ostatních datových zdrojů a oprávněných full-sync timestampů; bez náhodných velkých přepisů existujících funkčních modulů.


### 18. 10. 2026 — P1/P2 HDO, Odpad a Úkoly, kandidát v0.1_569
- Výchozí produkce v0.1_568, main `f65e9acae91d4d691c619c2f7dea1e48de9dd259`, větev `fix/p1-p2-hdo-waste-tasks-read-569`.
- HDO: dva následné SELECT (`hdo_settings`, `hdo_windows`) nyní atomicky dokončí před jakoukoli mutací `hdoCloud` nebo `hdoWindows`. Workspace zachycen před dotazy, kontrola po await, při pozdní odpovědi původního účtu/domácnosti nebo současné místní editaci se zahodí výsledek. Explicitní true/false, validace array místo `data || []` a tichý background error.
- Svoz odpadu: tenant-bound SELECT, ochrana změn při síťovém čekání, data:null neznamená prázdný seznam, explicitní failure/success. Stávající normalizace a zachování lokálních řádků nedotčeny.
- Úkoly/Zápisník: analogický tenant-bound SELECT, lokální edit během requestu má přednost; zachová se dosavadní merge pending úkolů i `tasksCloud.loadedAt` jen po potvrzeném úspěchu.
- HDO a Odpad už při dílčím SELECT nepřepisují `cloud.lastSyncAt`, ten nyní zůstává na souhrnném orchestrátoru. Nový test `tools/check-cloud-homecare-read.mjs` spouští celé skutečné moduly v izolovaném JS VM se simulací network failure, A→B, user switch a místní editace. Připojen do `npm run check`.
- Hranice: žádné DB změny ani migrace. P0 DB účetní CAS a serverové idempotentní INSERT, správná Supabase autorizace a skutečný PC↔mobil/offline/restart/konflikt test zůstávají otevřeny. Další etapa kalendář/smlouvy.


### 18. 10. 2026 — v0.1_569 PRODUKCE, HDO/Odpad/Úkoly cloud čtení
- PR #59 https://github.com/martinspadrna/Domacnost/pull/59 **MERGED**. Final PR head `2534f308ffd73c10bc0b96b1c286284e7983c689`, squash commit `4372d3aa1495d654085e9c05c0d058d88a0c84c6`.
- Full checks + Chrome E2E **PASS** na PR `39148331797`; první `39148278549` selhal pouze chybou nového test harness (asynchronní `begin` omylem čekal na pending promise). Oprava testu bez změny implementační logiky, následný run PASS.
- Main full CI + Chrome E2E **PASS** na squash SHA `39148409452`; Vercel production **READY** na `dpl_2JSaSEWNGrQK1tQ8MKmuve4SdEJm`, alias `domacnost-plus.vercel.app` aktivní, `aliasError=null`, správný git SHA.
- HDO atomické dva SELECT a ochrana domácnosti/účtu/in-flight local edits; Odpad tenant-safe SELECT a explicit failure/true; Úkoly tenant-safe SELECT a zachování lokálního pending při síťovém čekání. HDO a Odpad už při samostatném načtení nemění `lastSyncAt`. Nový VM test `check-cloud-homecare-read.mjs` začleněn do `npm run check`.
- **P0 otevřeno:** správný Supabase projekt, backend `finance_accounts` CAS a serverově idempotentní INSERT, fyzický PC↔mobil / offline / restart / konflikty. **P1/P2 rozpracováno**, další věcný blok především kalendář a smlouvy, nezavádět nepodložené přepisy funkčního UI.


### 18. 10. 2026 — P1/P2 Kalendář + Smlouvy a přílohy (kandidát v0.1_570)
- Produkční základ v0.1_569, HEAD main `ca08f347a3d1c44c091781ff4072cde35f0495ac`, větev `fix/p1-p2-calendar-contracts-atomic-570`.
- Kalendář: `cloudLoadCalendarSources(false,{stage:true})` nyní umožňuje připravit zdroje bez předčasné mutace; při načítání událostí se oba remote SELECT dokončí dříve, než se změní `calendar` / `calendarCloud`. Selhání 2. SELECT, prázdná/neúplná odpověď, přepnutí účtu/domácnosti a in-flight místní edit vrátí false bez změn. Samostatný loader zdrojů zachovává kompatibilní API, ale chrání workspace a editace. ICS auto sync se v full load plánuje až po potvrzeném načtení.
- Smlouvy: `cloudLoadContractFiles(false,{stage:true})` předá surové výsledky, až potom se společně aplikují vzdálené smlouvy i vazba jejich souborů. Neúspěšný SELECT příloh už neoznámí úspěch ani nezanechá napůl zapsané smlouvy; obě query scope-bound, local edit guard. Stávající preserve-pending merge smluv a standalone načítání příloh zachováno. Oba samostatné SELECT přestaly nastavovat globální `lastSyncAt`, který patří souhrnné synchronizaci.
- Přidán VM test `tools/check-cloud-calendar-contracts-read.mjs` pro late SELECT, missing/error, tenant switch, local edit, related file mapping a empty remote. Kompletní CI + Chrome E2E před merge; poté main CI, Vercel READY a alias a dokončit záznam.
- Žádný zásah do Supabase DB, Google auth, kalendářového API, RLS ani pending outboxu. P0 DB CAS/idempotentní INSERT a fyzický PC↔mobil offline/restart/konflikt nadále otevřený.


### 18. 10. 2026 — v0.1_570 PRODUKCE, Kalendář/Smlouvy/přílohy
- PR #60 https://github.com/martinspadrna/Domacnost/pull/60 **MERGED**. Finální head `dd45d73d09fc6350fa320c4187eb37d2e51920fe`, squash SHA `9fd9b55d28328835c45e597e74a26da828d204e5`.
- Plné CI a skutečné Chrome E2E **PASS** na PR SHA, workflow `39153192791`. Produkční main **full CI + Chrome E2E PASS**, run `39153270097` na squash SHA.
- Vercel production **READY** deployment `dpl_CnMceuMF8mtXgVtL1nCB4GAj9wki` na správném merge SHA, `domacnost-plus.vercel.app` aktivní alias, `aliasError=null`.
- Kalendář: bezpečné staged sources + eventy, žádný partial commit po selhání 2. SELECT, tenant userId/householdId guard, in-flight local source/event/conflict edit guard, iCal plánování po úspěšném commitnu; standalone zdroje zachovány. Smlouvy: staged SELECT metadata příloh, společná aplikace smluv+příloh, mapování cloudContractId na správný lokální contractId, tenant guard a ochrana editací; standalone soubory chráněné, full-sync lastSyncAt zde nenastavován.
- Dependency-free test `tools/check-cloud-calendar-contracts-read.mjs` pro reálné modulové funkce: druhý SELECT failure/null, A→B, user switch, local edit, valid remote vazba souboru a standalone čtení. Součást `npm run check`.
- **P0 zůstává otevřeno:** právoplatný Supabase Domácnost+ projekt, DB CAS a serverová idempotence INSERT, reálné PC↔mobil/offline/restart/konflikt. P1/P2 rozpracované: následný audit dalších cloud loaderů a full-sync statusu. Bez DB zásahu a bez reálného fyzického testu.


### 18. 10. 2026 — P1/P2 přílohy záruk + optimalizace full cloud read (kandidát v0.1_571)
- Výchozí prod v0.1_570, main `d6fc83d759fd7047b57efb6488c991c1a30b8284`, větev `fix/p1-p2-warranty-read-and-dedupe-571`.
- `warranty.js`: `cloudLoadWarrantyFiles` přibírá původní userId/householdId a snapshot `warranties` + `warrantyFiles`; SELECT na fixní tenant, po HTTP await kontrola scope, místní in-flight editace a validního `data: Array`. Při síťové chybě/null/switch/local edit vrátí false bez jakéhokoli přepsání; úspěch merguje dosavadní local-only přílohy a cloud metadatové řádky jen pro existující záruky. Dílčí SELECT už nepřepisuje full-sync `lastSyncAt`. Bez změny storage ani uploadů.
- `app.js`: `cloudLoadModuleForNav` pro `calendar` a `contracts` už nespouští extra samostatné loaders `cloudLoadCalendarSources` a `cloudLoadContractFiles` — od v570 je jejich atomická práce součástí `cloudLoadCalendar`/`cloudLoadContracts`. Totéž v `cloudLoadAllModules`; odstraněny dva duplicitní síťové dotazy pro full sync, celkový denominator přepočítaný automaticky z aktuálního seznamu. Větší výkon i méně možných závodů. Nezměněné standalone UI akce zůstávají.
- Regrese: `tools/check-cloud-warranty-read.mjs` spouští skutečný warranty.js v Node VM s odloženým SELECT (A→B, switch user, local edit, null data, HTTP error, valid empty i navázané soubory), plus dynamickou kontrolu cloud loader mapy a full sync. Připojen do `npm run check`.
- Nutné plné CI + Chrome E2E na PR, poté na main a Vercel alias; zapsat finální čísla do handoffu. **P0** DB CAS/idempotentní INSERT a fyzické PC↔mobil/offline/restart/konflikt otevřené; nepoužívat jiný Supabase projekt.


### 18. 10. 2026 — v0.1_571 PRODUKCE, záruky a odstranění redundantních SELECT
- PR #61 https://github.com/martinspadrna/Domacnost/pull/61 **MERGED**. Finální PR head `6a86c78604fdffeeb5bffdafa74f1edba010b8be`; squash SHA `c4bf563c6cbc3dafdc444c80b274be25e0f6767e`.
- PR full CI + Chrome E2E **PASS** `39159649807`, produkční main full CI + Chrome E2E **PASS** `39159733325` přesně na squash SHA.
- Vercel production **READY** `dpl_CE6ZkccW5qmxyoUTBu9B396r84ue`, odpovídající git commit a aktivní alias `domacnost-plus.vercel.app`, `aliasError=null`.
- Záruky: tenant-scoped a in-flight-local-edit safe `cloudLoadWarrantyFiles`, SELECT null/SQL-error nesmí nahradit validní data, partial loader nezapisuje full-sync `lastSyncAt`. Lokální-only přílohy a existující mapování do záruk zůstaly zachovány.
- Cloud orchestrátory: odstraněné dvojí načítání calendar_sources a contract_files z `cloudLoadModuleForNav` i `cloudLoadAllModules`. Oba composite loadery v570 tato data načítají samy atomicky; méně síťových volání a možných závodů, zachované samostatné UI načítání podle potřeby. Úspěch full-sync stále hlídá počet loaderů i pending/konflikty/permanent outbox failure.
- Nový `tools/check-cloud-warranty-read.mjs` opravdu vykonává warranty.js v izolovaném VM, kontroluje A→B, jiné userId, současný edit, null/SQL error, prázdný i vyplněný remote, timestamp i seznam loaderů; zapojen do `npm run check`.
- **P0 stále otevřeno**: správný Supabase Domácnost+ projekt, backend CAS/idempotentní INSERT a fyzické PC↔mobil/offline/restart/konflikt. Další práce P1/P2: audit zbývajících datových modulů a oprávněných globálních `lastSyncAt` zápisů, bez plošných rizikových změn.


### 19. 10. 2026 — P0/P2 pravdivý globální čas synchronizace, kandidát v0.1_572
- Start z produkční v0.1_571, main `82e05309398d333c4809a2c0df1597f2460e89d4`, větev `fix/p0-p2-truthful-global-sync-572`.
- Nalezeno zavádějící potvrzování globálního `cloud.lastSyncAt` při jednotlivých CRUD (Nákup/Garáž/profily a recovery), při potvrzení částí household dashboard layout, při pouhém switch household, přijetí pozvánky a bootstrapu. Jeden remote ACK totiž nedokazuje kompletní cloud sync a může maskovat pending ostatních částí.
- V těchto cílených cestách odstraněny nepravdivé zápisy `lastSyncAt`; dílčí modulové `loadedAt` a revize, pending a existující algoritmy zápisu/CAS zůstávají. `reconcileConfirmedHouseholdUiPending` a `performCloudSaveHouseholdUiSettings` už nemění full-sync čas. Switch domácnosti uchovává vlastní uložený potvrzený čas workspace, nové cloud bootstrap domácnosti začínají bez potvrzení; invalid domácnost resetuje tento čas.
- `cloudSyncLocalPendingData`: pending-only režim čas nezmění; ruční režim navíc skutečně prověří výsledek kompletního `cloudLoadAllModules` pomocí `cloudSyncCompletionState` a při partial failure už nehlásí všechno synchronizováno. Poslední kompletní čas zůstává výhradně na aggregate verifikačních loaderech (`cloudLoadAllModules`, `cloudBackgroundLoadAllModules`, `runUnifiedCloudSync`).
- Home odstraněn vymyšlený fallback na aktuální čas: místo toho při absenci full-sync uvede `zatím nepotvrzena` a přesný label `Poslední úplná synchronizace`.
- Přidané vykonatelné regresní testy `tools/check-cloud-last-sync-truth.mjs`, zaintegrovány do `npm run check`. Bez DB migrací, změn RLS či mazání pending; fyzické PC↔mobil offline/restart/konflikt testy P0 a přístup ke správnému Supabase projektu stále čekají. Po ověření full CI + Chrome E2E sloučit a Vercel ověřit.
