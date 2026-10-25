# Domácnost+ — centrální handoff

Aktualizováno: 20. 10. 2026. Na začátku nového chatu načíst celý tento soubor, ověřit HEAD a nejnovější verzi. Nepoužívat safepoint, pokud to uživatel výslovně nepožádá.

## Verze a větve
- **Aktuální produkční verze: v0.1_588** (PR #77, squash `37475176a5b198a14d38e5fe93d434513901ebcb`, Vercel READY, PR i MAIN full CI/Chrome E2E PASS). Předchozí v0.1_587 je rollback bod.
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


### 19. 10. 2026 — v0.1_572 PRODUKCE, pravdivá kompletní synchronizace
- PR #62 https://github.com/martinspadrna/Domacnost/pull/62 **MERGED**; final head `4b9c9e49227f071879239e4f29b58e199a6f67f5`, squash `d538de1325414332bf50f1f0ff90ae6d4032a51d`.
- Úplné CI + reálný Chrome E2E **PASS** na PR `39216103223`; meziverze testu opravily stávající textový assertion `check-cloud-sync-status.mjs` a omezení mockovaného `reconcileConfirmedHouseholdUiPending` na jednu funkci (bez zásahu do prod logiky). Produkční main CI run `39216240248`: první attempt se jedinou nestabilní kontrolou E2E „Dlouho čekající offline změna“ nedokončil; opakované spuštění všech failed jobs s identickým commitem **PASS** full checks + Chrome E2E. Doporučeno stabilizovat tento časově citlivý browser assertion při příští práci na P3 test stability (PR E2E pass bez opakování).
- Vercel prod deployment `dpl_H7ioKb797M5Ub27e8YGc1PjpYZT1` **READY**, správný squash SHA `d538de...`, aktivní `domacnost-plus.vercel.app` a `aliasError=null`.
- `app.js`: odstraněny zavádějící globální `cloud.lastSyncAt` zápisy při dílčích CRUD akcích Nákupu/Garáže/profilů, recovery jedné platby, household UI CAS zápisu/reconciliation, přepínání domácností a přijetí pozvánky; bootstrap nové domácnosti začíná bez potvrzeného času. Zachovány `loadedAt` daných sekcí, `pending`, CAS a všechny write ACK.
- `warranty.js`, `hdo.js`, `waste.js`, `notes.js`, `calendar.js`, `contracts.js`: odstraněny zbývající single-record CRUD změny globálního času. Nyní ho smí měnit pouze ověřený `cloudLoadAllModules`, `cloudBackgroundLoadAllModules` a kompletní `runUnifiedCloudSync`; status čte i trvale selhaný outbox.
- `cloudSyncLocalPendingData`: interaktivní režim po pending replay kontroluje `cloudSyncCompletionState(loadResult)`, při partial network fail nehlásí „Všechno synchronizováno“; tichý autosync replay už sám žádný čas kompletního syncu nenastavuje. Home nyní místo aktuálního času bez ověření píše `Poslední úplná synchronizace: zatím nepotvrzena`.
- Testy: `tools/check-cloud-last-sync-truth.mjs` vykonává režimy pending-only vs full, chybu dílčího SELECT, switch A→B a household UI reconciliation, audit modulových ACK; upraven starší `tools/check-cloud-sync-status.mjs`. Vše integrované do `npm run check`.
- **P0 nadále otevřeno:** správný autorizovaný Supabase projekt Domácnost+, backend CAS `finance_accounts` a serverová idempotence INSERT, skutečné PC↔mobil/offline/restart/konflikt. P1/P2 rozpracované. P3 k prověření flaky E2E offline panelu; bez DB migrací nebo smazání uživatelských dat.


### 19. 10. 2026 — v0.1_573 kandidát: Finance tenant/user/profile read guard + P3 E2E stabilita
- Výchozí produkce v0.1_572, main HEAD `1824c9acae469b24570e8fe7a07e33c3087e930a`, pracovní větev `fix/p1-p3-finance-session-e2e-573`.
- `finance.js`: `cloudLoadFinance` nově kontroluje při obou SELECT i bezprostředně před commitem stejného přihlášeného uživatele, profil, lokální/cloud domácnost; pozdní odpověď staré relace nesmí přepsat novou. Staged account/transaction používají zachycené ID, nikoli proměnlivý aktuální profil během asynchronního načtení. Zachován stávající merge pending/Koš i stránkování.
- `tools/check-finance-read-race.mjs`: vykonatelné simulace přepnutí uživatele (i ve stejné domácnosti), profilu a přepnutí už po první fázi, nadále local edit/trash.
- `tools/check-e2e-smoke.mjs`: offline pending E2E fixture se nastaví právě jednou; vykreslení panelu se vyčká s časově omezeným pollingem, místo jednorázového závodního DOM read. Produkční logika upozornění beze změny.
- Verze 573 v app, loaderu, HTML, SW cache, package a síťovém release markeru. Bez SQL, migrací, zásahů do RLS a bez mazání dat.
- **Kandidát — CI/E2E, merge, produkční Vercel a fyzický test zatím nepotvrzeny.** Po testech doplnit výsledky; pokud PASS, podle release pravidla sloučit.
- P0 stále blokuje skutečný Supabase Domácnost+ backend (účetní CAS/idempotence INSERT) a fyzický PC↔mobil/offline/restart/konflikt. Další P1/P2: cílený audit session guards dalších modulů, P3 stabilizace zbylých E2E.


### 19. 10. 2026 — v0.1_573 PRODUKCE (P1/P3)
- PR #63 https://github.com/martinspadrna/Domacnost/pull/63 **MERGED**, head `3f050fc87e19568bb1741477bd2f11d52d283a5d`, squash `7ba18aaf7b5a28e3f6bd6f660ea1330ad49d8c52`.
- PR plné CI + skutečné Chrome E2E **PASS**: run `39221674637`. Produkční `main` plné CI + Chrome E2E **PASS**: run `39221796624`, oba kroky na přesných SHA.
- Vercel production **READY**, deployment `dpl_FrkohsuPrG6EgvmWPqkgWV9nuGBn`, git SHA `7ba18aaf7b5a28e3f6bd6f660ea1330ad49d8c52`, aktivní alias `domacnost-plus.vercel.app` ověřen.
- `finance.js`: read-only SELECT účetních účtů a pohybů drží user+profile+lokální a cloud domácnost scope přes síť i na commit hranici, tím je zabráněno přepsání dat starým SELECT po přihlášení jiného člena či profilu. Společný snapshot zachovává pending a Koš.
- `tools/check-finance-read-race.mjs` nově opravdu simuluje user switch při stejném household a profile switch po SELECT; závod po první fázi se zastaví před druhým SELECT. Stávající testování lokální editace a pozdního Koše zachováno.
- Browser offline recovery E2E jednou nastaví test data a počká na DOM při pomalejším renderu; nestabilní jednoúčelový assertion se stal determinističtějším. Na tomto release Chrome E2E na PR i `main` prošly napoprvé.
- **P0 otevřené:** autorizace ke správnému Supabase Domácnost+, backend CAS `finance_accounts`/serverová idempotence INSERT a fyzické testy PC↔mobil/offline→online/restart/konflikty. Backend DB beze změn, neprováděno žádné mazání ani force overwrite.
- Další etapa: audit zbývajících asynchronních cloud načítání proti přepínání účtu/profilu a konzistence přehledu pending; P3 vyhodnotit časově citlivé testy bez oslabování asercí.


### 19. 10. 2026 — kandidát v0.1_574, P1/P2: profile-safe cloud read izolace
- Navazuje na produkční v0.1_573 / HEAD `0e6bd841c148faddfcb59de3c63ac1b095239de3`; branch `fix/p1-p2-profile-read-isolation-574`.
- Rozšířena scope ochrana šestice lazy modulů: `hdo.js`, `waste.js`, `notes.js` (Úkoly), `calendar.js` (události+zdroje), `contracts.js` (smlouvy+přílohy), `warranty.js` (přílohy záruk). Každý relevantní SELECT drží userId, cloud householdId, lokální householdId a activeProfileId. Pozdní odpověď po přepnutí profilu či lokální domácnosti už nesmí mutovat data ani hlásit úspěch.
- Cloudové záznamy v HDO/Odpadu/Úkolech/Kalendáři/Smlouvách při úspěšném staged načtení používají zachycené profile/household ID, nikoli pozdější live reference.
- Zachováno atomické čtení, pending/Koš, merge, CAS, PWA, UI, RLS, žádná DB migrace ani force overwrite.
- Vykonatelné VM regresní testy `check-cloud-homecare-read`, `check-cloud-calendar-contracts-read` a `check-cloud-warranty-read` rozšířené o změnu activeProfileId a lokální domácnosti během odloženého SELECT. Verze sjednocena na v0.1_574 v app, cache, indexu, module-loaderu, package a release.json.
- **Stav: kandidát, před CI/E2E, bez merge**. Po PASS dle pravidla sloučit, ověřit produkční Vercel SHA, alias, main CI a doplnit finální handoff.
- P0 blokátory nezměněny: schéma správného Supabase projektu, serverový CAS `finance_accounts`, idempotentní INSERT, fyzický test PC↔mobil / offline↔online / restart a konflikty.


### 19. 10. 2026 — v0.1_574 PRODUKCE (P1/P2)
- PR #64 https://github.com/martinspadrna/Domacnost/pull/64 **MERGED**. Final PR head `78f8d57f5dd0816309a8910ea750d5811c69b5e9`, squash SHA `41272c6ae8fefaa61f56b551198e2ea7339d0632`.
- PR plné CI a skutečné Chrome E2E **PASS** workflow `39227830461`, produkční `main` plné CI i skutečné Chrome E2E **PASS** workflow `39227980528`, obojí na přesném commitu.
- Vercel production **READY**, deployment `dpl_FCYdNuT1rrHrkZVYqQn5dt9UqwHn`, `meta.githubCommitSha=41272c6ae8fefaa61f56b551198e2ea7339d0632`, aktivní `domacnost-plus.vercel.app`, `aliasError=null`.
- `hdo.js`, `waste.js`, `notes.js`, `calendar.js`, `contracts.js`, `warranty.js`: asynchronní cloud SELECT chráněné i vůči změně activeProfileId a lokální household identity při stejné online domácnosti. Dříve zachované pending/merge/CAS a atomic load nezměněny.
- Regresní testy VM rozšířené o aktivní profil a lokální domácnost na opožděných odpovědích. Full CI + browser E2E prošly na větvi i po merge. Uživatel fyzický PC/mobil scénář tohoto releasu dosud nepotvrdil.
- Další **P0**: ověřit autorizovaný Supabase Domácnost+ projekt a schema `finance_accounts` pro serverové CAS / idempotentní účetní INSERT. Pak reálný PC↔mobil, offline→online, restart, současné změny a skutečné konflikty; bez správného DB projektu nepoužívat cizí databázi.
- Následující P1/P2: audit dalších nechráněných asynchronních loaderů, pending UX a možnost retry po změně profilu, P3 výkon/start a mobilní regrese.


### 19.10.2026 — kandidát v0.1_575 (P1/P2) + Supabase DB P0 blokátor ověřen
- Výchozí produkce v0.1_574; main `397f6064face94eac00f5f5dce802e6de21b2f3c`; pracovní branch `fix/p1-p2-shopping-garage-extras-profile-575`.
- **Supabase autorizace ověřena**: frontend Domácnost+ používá samostatný Supabase projekt `hyyehcskthqmncqlechi`, ale připojení Supabase umožňuje jen RaK test (`cgshssdjgzzuprlwnabl`) a RaK hlavní (`bkqamcbkiwumsvelahxr`). **Neprovádět žádné migrace/SQL na RaK**; schema Finance Domácnost+ není možné read-only potvrdit. Backend CAS/idempotentní INSERT proto stále není hotový a nelze ho čestně deklarovat.
- `app.js`: `cloudLoadShoppingData`, `cloudLoadGarageData`, `cloudLoadExtraCollection`, `cloudLoadExtraCollections` nyní drží aktivní profil a lokální household ID vedle už existujícího user/cloud household scope přes každou asynchronní fázi. Stará cloud odpověď se neaplikuje do nového profilu/domácnosti. Mapped Shopping/Garage záznamy nesou zachycená ID.
- Regrese `tools/check-cloud-shopping-garage-read.mjs` a `tools/check-cloud-extra-read-race.mjs`: switch profilu a lokální domácnosti během SELECT, celá extra dávka se zastaví bez dalších query, žádný nepravdivý sync ACK. Dříve pokrytý user/cloud household switch, partial network failure, lokální pending a merge nedotčeny.
- Release surface sjednocena v app, index, SW cache, loader, package, release.json na v0.1_575. Žádný zásah do Supabase DB, RLS, auth, outbox, PWA dat ani destruktivní operace.
- **Kandidát, CI/E2E ještě neověřeny**; po PASS sloučit na main, Vercel READY/alias a main CI zkontrolovat. Přetrvává nutnost fyzického PC↔mobil/offline→online/restart/konflikt testu a backend Finance SQL/CAS v autorizovaném projektu.
- Další P0 práce po připojení projektu: read-only inventura `finance_accounts`, `finance_transactions`, existujících revizí a unique/index constraints; až poté navrhnout a samostatně ověřit CAS/idempotentní INSERT bez přepsání novějších změn.


### 19.10.2026 — v0.1_575 PRODUKCE (P1/P2)
- PR #65 https://github.com/martinspadrna/Domacnost/pull/65 **MERGED**, final PR head `775221fc5c71ea17830d18fe493b744e8d02831e`, squash `014b8a5dfcba67e101fc12ec7cc8bcd5d4389cef`.
- PR plné CI i skutečný Chrome E2E **PASS** workflow `39242266360`; produkční `main` plné CI a Chrome E2E **PASS** workflow `39242436534` na squash SHA.
- Vercel production **READY**, deployment `dpl_FJwYUaqHbx2Nrge9jx5gW4LWWTYU`, commit `014b8a5dfcba67e101fc12ec7cc8bcd5d4389cef`, alias `domacnost-plus.vercel.app` aktivní, `aliasError=null`.
- Nákupy/Garáž/Extras: opožděná cloud SELECT po změně profilu nebo lokální domácnosti se neaplikuje ani nepotvrdí kompletní synchronizaci. Stávající ochrana pending, lokálních editací a owner scope beze změny; extra batch při změně kontextu nepokračuje v jiných kolekcích.
- Regresní testy `tools/check-cloud-shopping-garage-read.mjs` a `tools/check-cloud-extra-read-race.mjs` pokrývají nový profil a lokální domácnost bez SQL zásahů.
- **Stále P0 otevřené:** target Supabase `hyyehcskthqmncqlechi` nepřístupný přes aktuální konektor (zobrazuje pouze RaK projekty), backend revizní CAS Finance a serverově idempotentní INSERT nelze bezpečně opravit ani fyzicky otestovat. Fyzický dvouzařízení PC↔mobil/offline/restart/konflikty stále nebyl proveden. Otestováno jen na CI/Chrome E2E a kontrolou release.
- Další krok: připojit správný Supabase projekt Domácnost+ (bez sdílení tokenů v chatu), read-only inventura DB schématu a následně transakčně bezpečná revizní ochrana `finance_accounts` + idempotence.


### 19.10.2026 — kandidát v0.1_576 (P0: Finance CAS bez nebezpečného přijetí remote revize)
- Výchozí main `4d5dd39690439329b142d587a0ba958877022dbb`, produkce v0.1_575; pracovní branch `fix/p0-finance-revision-cas-576`.
- `finance.js` `cloudUpdateFinance`: při chybějícím `cloudUpdatedAt` dosud SELECT načetl nejnovější `updated_at` a hned použil jako CAS `expectedRevision`. To může bez varování přepsat vzdálenou novější změnu, i když lokální zápis žádnou známou základní revizi nemá.
- Opraveno: bez potvrzené lokální revize UPDATE vůbec neproběhne; remote SELECT slouží jen k nabídnutí záznamového konfliktu (pokud remote vrací `id` a `updated_at`). Uživatelsky zvolený remote `options.expectedRevision` z explicitního řešení konfliktu nadále umožní podmíněný UPDATE. Při chybě remote či chybějící revizi záznam zůstává pending; žádný force overwrite.
- `cloudUpdateFinance` teď chrání síťovou odpověď i mezikrok dotazu na konflikt capturem cloud household, přihlášeného uživatele, aktivního profilu, lokální household a identity aktuálního pohybu + payload. Opožděný konflikt/ACK se po switchi jiného kontextu nesmí zapsat.
- Nový vykonatelný regresní test `tools/check-finance-cas-safe.mjs`: absent base revision, explicit conflict resolution, CAS miss, oddálený remote SELECT, switch user/profile/household, lokální edit a opožděný ACK; součást `npm run check`.
- Release marker sjednocený na 576 v app, HTML, SW cache, module-loader, package a release.json. Není žádná DB migrace, změna RLS, manipulace s daty ani force overwrite.
- **P0 backend stále blokován**: Supabase app (ChatGPT) sice nainstalována, ale přístup `list_projects` vrací přesně `link_id must identify an eligible linked account` i po opakované uživatelské autorizaci. Nelze ověřit project `hyyehcskthqmncqlechi`, backend Finance CAS a idempotentní INSERT. Do RaK DB nezasahovat. Cross-device PC↔mobil/offline/restart/konflikty nejsou fyzicky ověřené.
- **Stav kandidát před CI/E2E/merge/produkční Vercel;** po úspěšných kontrolách sloučit do main a doplnit důkazy.


### 19.10.2026 — v0.1_576 PRODUKCE: Finance CAS guard
- PR #66 https://github.com/martinspadrna/Domacnost/pull/66 MERGED; branch head `0aa91a67e441fee0b936f448ebbac6700b7382db`, squash `ca074bd56aa3d425ba46c4d62641d999513ec8d9`.
- Full CI + skutečné Chrome E2E na PR **PASS** run `39271570325`; full CI a skutečné Chrome E2E na produkčním `main` **PASS** run `39271745157`.
- Vercel production READY, deployment `dpl_DjT6KHnKXze1c9TNEvBNv8n7zhRs`, git sha `ca074bd56aa3d425ba46c4d62641d999513ec8d9`, aktivní alias `domacnost-plus.vercel.app`, `aliasError=null`.
- Oprava nebezpečného CAS fallbacku: UPDATE finančního pohybu bez potvrzené lokální revize již nemůže převzít nejnovější remote updated_at a zapsat přes souběžnou změnu. Místo toho zůstane pending či nabídne záznamový konflikt. Explicitní expectedRevision z UI řešení konfliktů a běžný CAS zachovány.
- Závodní asynchronní síťové potvrzení Finance UPDATE/conflict je nyní hlídané user/profile/household a referencí na stále aktivní lokální pohyb. Nový `check-finance-cas-safe.mjs` ověřuje případy s neznámou revizí, CAS miss, scope switch, explicit resolution a ACK.
- **P0 stále není dokončeno:** autorizované Supabase připojení vrací `link_id must identify an eligible linked account`; frontend používá projekt `hyyehcskthqmncqlechi`, DB přístup nebyl úspěšný a žádná SQL/RLS migrace neproběhla. CAS finance_accounts/idempotentní finance INSERT musí být řešeny na správném backendu až po autorizovaném read-only schema auditu. Fyzický PC↔mobil offline/restart/konflikty také neověřeny.


### 19.10.2026 — kandidát v0.1_577 (P0 Finance: ochrana opožděných INSERT/UPDATE ACK)
- Výchozí produkce v0.1_576, main `a82b79cf34cce1a4ebb52b3444f6c74945557aca`; větev `fix/p0-finance-insert-user-scope-577`.
- `finance.js`: `cloudAddFinanceAccount`, `cloudAddFinance` a `cloudUpdateFinanceAccount` zachycují scope přihlášeného uživatele, cloud domácnosti, aktivního profilu a lokální domácnosti. Validace probíhá po refreshCloudSession, před odesláním a před zpracováním pozdního serverového potvrzení/hlášky. Pokud relace mezitím přepne na jiného člena stejné domácnosti, starý ACK již nelze zapsat do nových lokálních dat.
- Aktualizace účtu odmítne potvrdit záznam, který mezitím formulář nahradil jiným lokálním objektem nebo editoval při čekání. Ponechá pending pro další bezpečné zpracování. Stávající reakce na pozdní INSERT po smazání v rámci stejného scope (Koš/Undo/outbox) je zachována.
- Rozšířené vykonatelné simulace v `tools/check-finance-account-insert.mjs`, `tools/check-finance-inflight.mjs`; nový `tools/check-finance-account-update-scope.mjs` jako součást `npm run check:finance` pro user/profile/workspace switch, opožděný ACK, náhradu objektu, 0-row UPDATE a platnou cestu.
- Sjednocení verze 577 v app, index, cache SW, module-loader, package, release.json. Žádná SQL/RLS změna ani mazání DB.
- **Nezměněný blokátor P0:** Supabase připojení opět vrací `link_id must identify an eligible linked account`, projekt `hyyehcskthqmncqlechi` stále bez autorizovaného přístupu. Opravu serverového CAS `finance_accounts`/idempotentního INSERT nelze bez read-only auditu provést; fyzické PC↔mobil/offline/restart/konflikt také neověřeny. Tento client-side scope guard sám o sobě nezaručuje serverovou idempotenci dvou paralelních zařízení.
- **Kandidát** před PR CI/Chrome E2E, merge a Vercel produkcí; po PASS dokončit release a handoff.


### 19.10.2026 — v0.1_577 PRODUKCE (P0 Finance zápisy mezi relacemi)
- PR #67 https://github.com/martinspadrna/Domacnost/pull/67 **MERGED**. Finální PR head `3fd496715a808767419a468aed6c911978fb52a0` (včetně aktualizovaného E2E kontrolního pravidla), squash `b9c9b6c722943ea8809fa45194f3074874a04833`.
- PR full CI + reálné Chrome E2E **PASS** workflow `39274211752`; produkční main full CI i Chrome E2E **PASS** workflow `39274378251`.
- Vercel production **READY**, deployment `dpl_BijfCoJyiYyFsaN14fwQ8xqykocQ`, git sha `b9c9b6c722943ea8809fa45194f3074874a04833`, aktivní `domacnost-plus.vercel.app`, `aliasError=null`.
- `cloudAddFinanceAccount`, `cloudAddFinance`, `cloudUpdateFinanceAccount`: asynchronní uživatelský/profile/lokální a cloud household scope přes síťové hranice; opožděný ACK z jiné relace stejné domácnosti se neaplikuje na lokální finance. Update účtu vyžaduje stále stejný lokální objekt bez editace během čekání. Offline/pending/Koš a původní single-flight beze změn.
- Testy `check-finance-account-insert`, `check-finance-inflight` a nový `check-finance-account-update-scope` pokrývají prohození relací, pozdní receipt, lokální edity a validní ACK. Po prvním PR CI full PASS Chrome E2E odhalilo zastaralý statický assertion na původní household-only guard; E2E assertion se **zpřísnil na user/profile/household scope**, neoslabil. Následný PR CI+E2E PASS a main CI+E2E PASS.
- Žádná SQL změna, RLS, mazání, force overwrite, fyzické reálné dvouzařízení testy. P0 otevřeno: Supabase target `hyyehcskthqmncqlechi` nepřístupný přes aktuální plugin (`link_id must identify an eligible linked account`), backend revizní CAS `finance_accounts`/serverová idempotence INSERT nelze potvrdit a opravit. Souběžné dvouzařízení klientské INSERT tedy stále vyžaduje backendové řešení.
- Další pokračování: ověřit dostupnost oprávněného Supabase připojení, pokud stále nedostupné pokračovat v bezpečných lokálních regresních auditech a připravit read-only DB audity pro připojení. Nepoužívat cizí RaK databázi.


### 19.10.2026 — kandidát v0.1_578: P0 Finance single-flight UPDATE + scope bezpečné dávky
- Z produkčního main `1271192c4315cb9bc8aece301acaaad28f07dad6` v0.1_577; větev `fix/p0-finance-sync-batch-scope-578`. Nejprve Supabase `list_projects` opět vrací `link_id must identify an eligible linked account`; databáze nebyla dotčena.
- `finance.js`: `cloudUpdateFinanceAccount` má nyní lokální per `householdId:cloudId` mutex/single-flight. Dva formuláře/autosync už nesmějí paralelně odeslat full-row UPDATE téhož účtu a přeházet remote stav; druhý caller po dokončení prvního vrací false a ponechá lokální pending pro následující bezpečný pokus. CAS proti **jinému zařízení** to nenahrazuje, backend stále potřeba.
- Scope helper `financeSyncBatchScope/financeSyncBatchMatches` nyní zastavuje `cloudSyncFinanceAccountById`, `cloudSyncLocalFinanceAccounts`, `cloudSyncFinanceById`, `cloudSyncLocalFinance` a `cloudSyncAllFinance` při změně user/profile/cloud nebo lokální domácnosti v síťovém await nebo během yield. Nedojde k pokračování dávky s jinou relací ani k nepřesnému potvrzení cloud pending v novém workspace.
- `tools/check-finance-account-update-scope.mjs` má nové reálné single-flight testy; `tools/check-finance-sync-batch-scope.mjs` otestuje přepnutí user/profile/household, batch abort, nezměněné happy-path obou kolekcí i orchestrace. Zapojeno do `npm run check:finance`.
- Verze na 578 sjednocena v app/index/sw/module-loader/package/release.json. Žádná SQL/RLS migrace, mazání, force overwrite; stávající PWA a local-first/UI zůstávají.
- **Kandidát, před CI/E2E, merge a produkcí**. P0 backend Finance CAS `finance_accounts`, idempotence 2 zařízení a reálné PC↔mobil offline/restart/konflikty nadále otevřené, bez cílového Supabase přístupu.


### 19.10.2026 — v0.1_578 nasazena do produkce (P0 Finance)
- Uživatelské výslovné schválení: „rovnou to nasad“; vychází z produkční v0.1_577, bez safepointu.
- PR #68 https://github.com/martinspadrna/Domacnost/pull/68 **MERGED**, PR HEAD `8725bae932cea18b64edd795ad1be2cccc2591ea`, squash `181974b882960b3c84f280256f6d8df24853e898`. PR workflow `39280760441` **completed/success**: plné kontroly **PASS**, Chrome E2E **PASS**.
- Vercel produkční deployment `dpl_2d62wRKY981NmvyHsQJmJ6eXAqq4`: **READY**, git sha `181974b882960b3c84f280256f6d8df24853e898`, produkční alias `domacnost-plus.vercel.app` aktivní, `aliasError=null`.
- Produkční main CI workflow `39284012475` bylo při kontrole **queued**; neoznačovat jako PASS, dokud se nedokončí a neověří. PR testy ale byly úspěšné před sloučením.
- `finance.js`: serializace paralelních UPDATE stejného finančního účtu v jedné instanci; čekající druhý caller nesmí nepravdivě potvrdit starý snapshot. `cloudSyncFinanceAccountById`, `cloudSyncLocalFinanceAccounts`, `cloudSyncFinanceById`, `cloudSyncLocalFinance`, `cloudSyncAllFinance` nyní po awaited network/yield kontrolují user/profile/cloud+local household a při přepnutí nepokračují do nového workspace.
- `tools/check-finance-account-update-scope.mjs` a nový `tools/check-finance-sync-batch-scope.mjs`: potvrzené izolované regresní scénáře i celé PR full CI E2E. Verze sjednocená v app/index/service worker/loader/package/release.json na 578.
- Žádná SQL/RLS migrace ani zásah do reálné DB. Připojený Supabase nástroj vracel `link_id must identify an eligible linked account`; backend Finance CAS a idempotence INSERT mezi různými zařízeními stále nehotové; fyzické PC↔mobil/offline/restart/konflikty nebyly otestovány.


### 19.10.2026 — kandidát v0.1_579: Finance sdílené potvrzení UPDATE + přejímací P0 testplan
- Poslední ověřená produkce `v0.1_578`, main `37f68cf22090893f28e8022a41d745413cacc3a2`, branch `fix/p0-finance-shared-update-ack-579`.
- Při auditu v578 zjištěna regrese: když formulář a autosync souběžně požádají o totožný UPDATE účtu, server první UPDATE potvrdí, ale druhý caller (čekající na mutex) vždy vrací false. Druhý sync pak může nesprávně obnovit `syncStatus=pending_update` i pro již potvrzený účet.
- `finance.js` opraven: mutex udržuje i původní user/profile/local-home scope. Duplicitní caller může sdílet **prokazatelně úspěšný** ACK pouze když je scope stejný, lokální objekt je stále aktivní, beze změny je celý cloud payload včetně vypočteného zůstatku a záznam není konflikt. Jinak false/pending, nikdy force overwrite ani paralelní druhý UPDATE.
- `tools/check-finance-account-update-scope.mjs`: regresní kontrola sdíleného ACK, žádného falešného pending, editace během letu, přepnutí uživatele/profilu/domácnosti a bezpečné retry po skutečně rozdílné editaci.
- Nový `DOMACNOST_P0_ACCEPTANCE.md`: přesný, nedestruktivní postup pro uživatelské fyzické PC↔iPhone ověření: start/relace, Předplatné, Finance účet/pohyb, offline→restart→online, skutečný konflikt, Nákupy/Garáž/Nastavení + návratový formulář výsledků. To je fyzická podmínka pro uzavření P0, nikoli náhrada DB auditu. Než provádět konfliktní test E, musí projít A–D.
- Verze 579 sjednocena v app/index/sw/module-loader/package/release.json, bez DB SQL/RLS/mazání dat.
- Stále trvá plugin error `link_id must identify an eligible linked account` pro Supabase Domácnost+ projekt `hyyehcskthqmncqlechi`. Serverový CAS finance_accounts, 2-device idempotentní INSERT a reálné testy nesmějí být označeny hotové.
- Původní `main` CI runy `39284012475` a `39284200765` stále `queued` při zahájení auditu; PR v579 musí projít full CI+Chrome E2E PŘED merge/produkčním release. Uživatelské přejímací testy lze mezitím bezpečně dělat na produkční v578, s uvedením skutečné verze.


### 19.10.2026 — v0.1_579 produkce; potvrzení fyzických testů v0.1_578
- **Uživatel skutečně otestoval na PC a iPhonu produkční v0.1_578 a oznámil všech šest výsledků A–F OK.** Zdroj: přímý výsledek fyzického testu v této konverzaci, nikoli předpoklad z CI.
- **UZAVŘENO — uživatelské funkční ověření**:
  - A spuštění/přihlášení a přístup k modulům na PC+iPhonu;
  - B synchronizace Předplatné PC→iPhone včetně restartu;
  - C Finance: účet a pohyb mezi PC/iPhonem a zpětná změna;
  - D offline vytvoření záznamu → offline restart → online → PC, bez nahlášené duplicity;
  - E detekce konfliktu téhož pohybu při offline/online editaci (uživatel hlásí OK, ale **výběr obou rozhodovacích variant ani výsledný stav vzdálené DB není testem potvrzen**);
  - F synchronizace Nákupů PC↔iPhone (OK). F rovněž požadovalo zjistit **počty historicky čekajících změn Garáž a Nastavení**, tyto počty uživatel v odpovědi nedodal; **nelze je uzavřít jako srovnané jen kvůli F=OK**.
- **Není třeba znovu testovat celé A–D, pokud po nasazení další verze nevznikne nová regrese.** Uživatel už prokázal použitelnou cross-device/offline funkčnost konkrétní produkční v0.1_578. Při v0.1_579 vhodný krátký smoke nové opravy Finance pending.
- **OTEVŘENO pro P0**: volba `Použít cloud` a `Ponechat toto zařízení` pro skutečný konflikt — postupně na dvou **samostatných testovacích pohybech**, nikdy nekonfliktovat s reálnými finančními údaji. Po každé volbě ověřit správný stav na obou zařízeních a po restartu, bez duplicity a druhé ztracené změny. Pokud uživatel konflikt stále má, neřešit automaticky, nepoužívat force. Stačí stručné OK obou variant nebo anonymizovaný screenshot případné chyby.
- **OTEVŘENO**: historické pending Garáž/Nastavení; žádat konkrétní počet + název sekce a případnou starou hodnotu „čeká“ na PC a iPhonu; nepokoušet se pending plošně vymazat.
- **OTEVŘENO backend P0**: serverová idempotence Finance INSERT napříč zařízeními a CAS pro `finance_accounts` + RLS/DB schema. Přístup k cílovému Supabase `hyyehcskthqmncqlechi` byl v aktuální konverzaci opakovaně odmítnut (`link_id must identify an eligible linked account`); nelze bez read-only auditu uzavřít ani opravit produkční DB.
- **RELEASE**: PR #69 https://github.com/martinspadrna/Domacnost/pull/69, PR head `917c68e3a984e9ed15ce9a87d88ec26ad6564e32`, full PR CI/Chrome E2E PASS workflow `39285791873`, squash MERGED `0a72d92bbd2e67cfcc0a43db0a87c0809d56fae9`, Vercel production READY deployment `dpl_AG5yD6zq6PG7tvmkzCGwEZ4j4sCx`, alias `domacnost-plus.vercel.app` active, aliasError=null. Main CI workflow `39289030386` při tomto zápisu ještě běží; aktualizovat stav po skutečném dokončení.
- Implementace v579: druhý shodný caller single-flight UPDATE `finance_accounts` přebírá potvrzený ACK pouze pokud se nezměnil user/profile/household, lokální účet, payload ani `syncStatus=conflict`. Předchozí v578 false-pending regrese opravena; testy kryjí známé situace. Nový `DOMACNOST_P0_ACCEPTANCE.md` je v main.
- **P0 jako celek NEUZAVŘENO.** Fyzická funkčnost a detekce konfliktu ověřeny uživatelem, ale bezpečné řešení konfliktu + historické pending + backendová ochrana a autorizovaný DB audit chybí. P1/P2/P3/P4 zůstávají nezávislé etapy.


### 19. 10. 2026 — kandidát Domácnost+ v0.1_580: transparentní PWA logo, izolovaný icon-only release
- Z výchozí produkce `v0.1_579` a main `480ce9facf0e9ba363a7c0ed563bcda8b6c78457`; pracovní PR #70 `fix/pwa-transparent-logo-580`.
- Stávající originální barevné logo (domeček tmavomodrý, střecha modrá a zelený kříž) uchováno v nezměněné binární podobě `icons/source/domacnost-plus-original-512.png` (původní SHA `e96847e862eb8f85a3ce2fa6eda5b6a7535232db`), takže návrat je možný přes Git revert a z originálu lze ikony znovu vytvořit.
- Z originálu pomocí dependency-free `tools/generate-pwa-icons.mjs` pixelově odseparován motiv od tmavomodrého gradientního čtverce a bledé zaoblené plochy, včetně otvoru dveří; byly ponechány vlastní barvy/motiv a vytvořeny kvalitní RGBA PNG se skutečnou alfou.
- Přegenerovány VŠECHNY existující `icons/domacnost-plus-icon-{16,32,120,152,167,180,192,384,512}.png`, `icons/favicon.ico` (vložené 16/32/48/256 PNG), `icons/apple-touch-icon.png`, `apple-touch-icon-precomposed.png` a obě historické maskable cesty — též průhledné, aby nebyl použit starý neprůhledný soubor ani z přímého staršího odkazu.
- PWA `manifest.webmanifest` deklaruje pouze `purpose: any` pro 192/384/512, s versionovanými icon URLs `?v=0-1-580`; žádný `maskable` icon, protože systémově doplňované maskované pozadí není záměrem. Android/iOS mohou na systémové ploše doplnit vlastní pozadí; tomu web nemůže 100% zabránit.
- `index.html`: favicony, Apple touch ikony, Windows TileImage a boot logo používají stejnou průhlednou kresbu s verzovanými URL; odstraněn `msapplication-TileColor` na starý tmavý čtverec. Ostatní vizuální nastavení aplikace beze změn.
- `sw.js`: nový versionovaný `CACHE_NAME=v0-1-580`, offline precache aktuálních transparentních ikon, odstraněny zastaralé maskable odkazy z precache (soubor sám uložen jako alpha kvůli kompatibilitě).
- Nové regresní ověření `tools/check-pwa-icon-alpha.mjs` testuje přesnou shodu PNG z originálu, per-pixel alfa rohy, barevný obsah/motiv, ICO, Apple touch, manifest `any`, správné versionování favicon/linků i SW cache. `tools/check-static-smoke.mjs` nyní při kontrole manifestových ikon správně odstraní URL query parametry.
- Zvýšena verze na 580 konzistentně v app/index/module-loader/sw/package/release. Žádné změny JS/CSS aplikačních funkcí, Supabase, financí, dat, layoutu ani UI. Pouze ikony a jejich zdroje, HTML metadata, service worker a ověřovací testy.
- **Kandidát čeká na závěrečný full CI a skutečné Chrome E2E, merge a kontrolu produkční Vercel READY.** Následně dopsat skutečný release commit/deployment a výsledky. Původní main v579 zachován pro návrat.


### 19.10.2026 — Domácnost+ v0.1_580 PRODUKCE: sjednocené transparentní systémové ikony
- PR #70 https://github.com/martinspadrna/Domacnost/pull/70 **MERGED**, squash `e471ed1da4c5568c1f33ab3f215eee8625cbc139`.
- Vercel production **READY** `dpl_GyciU93TsxPTJqDUiLqP5VVyG5Mt`, git SHA `e471ed1da4c5568c1f33ab3f215eee8625cbc139`, aktivní `domacnost-plus.vercel.app`, aliasError=null.
- PR workflow `39292906710` complete/success při opakování po selhání infrastruktury Chrome `ECONNREFUSED 127.0.0.1:9341`; úspěšný finální běh měl **plné CI PASS + Chrome E2E PASS**. Produkční main workflow `39293262103` rovněž **plné CI PASS + Chrome E2E PASS**.
- Originál barevného loga z v579 uložen nepoškozeně v `icons/source/domacnost-plus-original-512.png`; návrat možný přes `git revert` PR #70 / revert merge sha `e471ed1`. Z originálu deterministicky generováno 14 alpha souborů (9 PNG velikostí, 2 Apple touch, 2 historické kompatibilní cesty, Windows ICO).
- Úplná alfa kontrola `check:pwa-icon-alpha` porovnává každou binární ikonu s reprodukovaným originálem a nulovou alfu v rozích. Manifest deklaruje jen `purpose: any` (192,384,512), žádné maskable; Android/iOS/Windows mohou systémově použít své pozadí, app mu ale žádný neprůhledný čtverec neposílá.
- HTML favicon/touch/tile linky i manifest URL mají nový cache-busting build `v=0-1-580`; SW `CACHE_NAME=v0-1-580` a aktuální průhledné PNG/ICO v precache, bez deprecated maskable cesty.
- Bez změn funkcí, modulu, UI, Supabase a uživatelských dat. Předchozí P0 status a původní historické pending nejsou těmito grafickými změnami dotčeny.
- **Uživatelská instalace**: zástupce na iPhone často drží screenshot/ikonu mimo běžnou web cache; pro garantovanou výměnu doporučit odstranit z plochy a znovu přidat ze Safari. Windows a Android mohou aktualizovat ikonu samy, ale pokud drží starou, odebrat zástupce či přeinstalovat PWA a znovu přidat. *Neodstraňovat neodeslaná lokální data*, pozor při odinstalaci PWA: nejdřív zkontrolovat pending.


### 19.10.2026 — Kandidát v0.1_581 (Windows desktop PWA ikony)
- Z poslední produkční v0.1_580, main `7c1b5cb3791e086e9f1a54200330b7781700f2c1`, PR #71. Uživatel hlásí, že i po přeinstalování PWA Windows desktop zobrazuje neprůhledné pozadí ikony, zatímco soubory PNG v580 měly správný alfa kanál.
- Identifikována pravděpodobná kompatibilita Windows ICO: dřívější `favicon.ico` v580 obsahoval i malé 16/32/48 varianty jako PNG-komprimované ICO sekce. Windows nativní variantu nově generujeme v `tools/generate-pwa-icons.mjs` jako 16/32/48/64 BGRA32 BITMAPINFOHEADER DIB s AND transparent maskou + 256px alfa PNG sekci; zdrojem je **přesně stejný** originální zachovaný motiv modrého domu a zeleného kříže.
- `icons/favicon.ico` a nově `icons/domacnost-plus-windows.ico` jsou shodné nativně kompatibilní ICO. Přidány kvalitní průhledné PNG pro 48,64,128,256 (ostatní původní beze změny). HTML shortcut favicon výslovně odkazuje na nový Windows ICO soubor s verzovanou URL.
- Manifest nyní uvádí `48/64/128/192/256/384/512` ikony, všechny `purpose:any`, každá s cache-busting `v=0-1-581`. Service worker novou sadu precachuje pod `v0-1-581`. Originální `id`, `start_url`, `theme_color`, `background_color` i UI funkcionalita nezměněny; barvy manifestu jsou systémové splash/title-bar, ne zdroj ikony.
- Test `check-pwa-icon-alpha` rozšířen o rozměry, přesné binární shody vygenerovaných alfa PNG, DIB/AND transparentní ICO vrstvu a PNG256. Výslovně ověřujeme Windows soubor. Rollback: předchozí plně funkční v0.1_580 na Git `e471ed1da4c5568c1f33ab3f215eee8625cbc139` / následný docs HEAD `7c1b5cb...`, revert PR #71.
- Nezaměňovat úspěch manifestu/CI s potvrzením, že Windows Shell přímo na počítači uživatele přestane doplňovat systémovou plochu nebo cache; je potřeba fyzické ověření screenshotem pokud problém přetrvá. NIKDY neodstraňovat neodeslaná lokální data pro icon refresh.
- **PŘED RELEASE: čeká finální CI + skutečný Chrome E2E a potvrzení produkčního Vercel READY.**


### 19. 10. 2026 — v0.1_581 NASAZENO (Windows nativní ICO pro transparentní desktop PWA)
- PR #71 https://github.com/martinspadrna/Domacnost/pull/71 MERGED. Final commit PR `c15d901c3180a6dbc0b18ca0e617d1f26493f13e`, squash `3f48d4c4c0a3364230b954eb737587690798de49`.
- Na PR full CI i skutečné Chrome E2E **PASS** workflow `39296998024`; na main full CI i Chrome E2E **PASS** workflow `39297239320`.
- Vercel production `dpl_EU1kQi9xhfnpGyqsmbyjc6vM56zs` **READY**, správný commit `3f48d4c4c0a3364230b954eb737587690798de49`, aktivní alias `domacnost-plus.vercel.app`, bez aliasError.
- Opravena binární Windows kompatibilita .ico: čtyři nativní DIB32/AND-alpha vrstvy 16/32/48/64 a PNG-alfa 256. Soubor `icons/domacnost-plus-windows.ico` je identický s nově vygenerovaným `favicon.ico`, přímo odkazován z HTML. Žádný modrý/černý čtverec není součástí obrazových pixelů.
- PNG 48/64/128/256 jsou nové ze stejného originálu; manifest nyní používá `purpose:any` 48/64/128/192/256/384/512 s novým cache-busting parametrem v581. SW cache v581 obsahuje všechny aktivní obrázky včetně Windows ICO.
- Vykonatelný test `tools/check-pwa-icon-alpha.mjs` kontroluje přesnou PNG alfu, AND masku/DIB strukturu ICO i manifest a precache; full pipeline a Chrome E2E PASS. Nepřepisují se jiné funkce ani uživatelská data.
- **Fyzická kontrola Windows ikony ještě není uživatelem potvrzena.** Nainstalované PWA ikonky spravují Windows/Chromium a mohou mít vlastní cache/backplate, i když zdroj je RGBA. Pokud se problém objeví i na 581, nabídnout uživateli ruční nastavení desktop shortcut ikony pomocí `https://domacnost-plus.vercel.app/icons/domacnost-plus-windows.ico?v=0-1-581` (Vlastnosti → Zástupce → Změnit ikonu). Pokud nezafunguje, vyžádat screenshot + zda Chrome/Edge + Windows 10/11; další commit bez přesné diagnózy by byl nepodložený.
- Návrat dostupný k `v0.1_580` na commitu `7c1b5cb3791e086e9f1a54200330b7781700f2c1`, případně revert PR #71. Před odinstalací PWA ověřit pending lokální data.


### 20. 10. 2026 — v0.1_582 TEST ONLY (Edge iOS, RaK-ověřené PWA ikony)
- Oddělená větev `test/ios-edge-pwa-icon-v582-20261020` založena z produkčního main 889f5eb (v0.1_581). Main ani produkce se touto změnou nemění.
- Nový skutečný soubor `ios-install.html` v Git repozitáři, s neprůhledným originálním logem 180×180 px v `rel=apple-touch-icon` jako `data:image/png;base64` a okamžitým `location.replace` do `index.html?source=pwa` při spuštění z plochy.
- Nová neprůhledná Apple ikona `icons/domacnost-plus-ios-180.png`, samostatná oproti zachovaným průhledným ICO/PNG Windows a Android. Hlavní index odkazuje pouze na nový neprůhledný Apple obrázek. Manifest pro Android ponechává `purpose:any` a existující průhledné ikony.
- Verze, asset query, release marker, lazy loader a SW cache přecházejí na 582. SW přednačítá instalační soubor a iOS PNG, upřednostňuje síť u instalační stránky, takže předchozí navigační fallback neskryje její obsah.
- Přidán samostatný test `tools/check-ios-install.mjs`; DB, synchronizace, vzhled a moduly beze změn.
- **TEST nasazení a skutečné HTTP 200 je nutné ověřit po sestavení preview, nesmí být zaměněno za samotné READY.** Fyzickou ikonu na iPhonu potvrzuje uživatel.
- Rollback testu: návrat testovací větve na commit `889f5eb`, produkční main i v0.1_581 jsou nedotčené.


### 20. 10. 2026 večer — TEST v0.1_582: stabilní instalační alias bez dočasného Vercel share odkazu
- Zjistilo se, že Vercel preview je pod `ssoProtection.enabled=true` (ochrana Vercel Authentication); dočasný `_vercel_share` odkaz expiruje 27. 10. 2026. Přidání přes Edge a otevření ve standalone iOS nemusí sdílet cookies.
- Jen pro testovací branch alias `domacnost-git-test-ios-edge-pwa-df2aa1-martinspadrnas-projects.vercel.app` na preview `dpl_9MRcn2RVWCQrMUxc9mhZTWVscjBU` se nastavila Vercel `alias-protection-override` exception pro tento alias. Toto je přístupová výjimka: tento JEDINÝ preview hostname je veřejně dostupný; projektové pravidlo autentizace na ostatních doménách ani produkční alias se nemění.
- Použít trvalý instalační odkaz `https://domacnost-git-test-ios-edge-pwa-df2aa1-martinspadrnas-projects.vercel.app/ios-install.html` bez query secretu. Je to testovací app s nezměněným stávajícím aplikačním Supabase přihlášením.
- Z testovacího aliasu byla opětovně zjištěna skutečná HTTP odpověď 200 pro `ios-install.html`, `icons/domacnost-plus-ios-180.png?v=0-1-582`, `manifest.webmanifest?v=0-1-582`, `index.html`; Vercel API hlásí `protectionBypass.*.scope=alias-protection-override` na testovacím aliasu.
- Vercel produkce stále READY z commitu `889f5eb19d077387278fabcde13b473e798eefea` (v0.1_581); žádné změny DB, sync ani aplikační logiky. UI instalované aplikace na fyzickém iPhone musí prověřit uživatel.
- Při ukončení testu je možné preview výjimku odvolat (`alias-protection-override action=revoke`) bez dopadu na produkci. Oproti původnímu stavu jde pouze o změnu přístupu k testovacímu preview.

### 20. 10. 2026 — v0.1_582 publikována na MAIN a produkci
- Na výslovné přání uživatele se MAIN posunul bez force z `889f5eb19d077387278fabcde13b473e798eefea` na `34cff99bde76e3848e9defe0d450ae30ec8dee20`; předchozí produkční verze v0.1_581 je rollback bod.
- Porovnání hlavní a testovací větve před nasazením: jen 12 souborů PWA/iOS ikon, instalační stránky, verzí, testů a handoffu; bez změn financí, databáze a synchronizace.
- Vercel produkční deployment `dpl_8hNFNSUUQPZa5FLEGR93dj9F27H2` dosáhl stavu READY, doména `https://domacnost-plus.vercel.app` přidělena tomuto deploymentu. Produkční build prošel testy `check-ios-install`, `check-pwa-icon-alpha`, `check-release` a dalšími.
- Produkční HTTP 200 ověřeno pro `/ios-install.html`, `/icons/domacnost-plus-ios-180.png?v=0-1-582`, `/index.html`, `/manifest.webmanifest?v=0-1-582`, `/sw.js`, `/release.json`, `/icons/domacnost-plus-windows.ico?v=0-1-582` a `/icons/domacnost-plus-icon-192.png?v=0-1-582`.
- Používat veřejný iOS instalační odkaz `https://domacnost-plus.vercel.app/ios-install.html` namísto testovacího aliasu. Fyzické ověření výsledné ikony a spuštění standalone na uživatelově iPhone zůstává uživatelským úkolem; přes HTTP nelze ověřit SpringBoard cache.
- Produkční runtime log pro nový deployment: žádné error/fatal za posledních 30 minut v okamžiku kontroly. Testovací alias má dosud explicitní Vercel výjimku z ochrany; pokud test skončí, zvážit odvolání této JEDINÉ výjimky.


### 20. 10. 2026 — kandidát v0.1_583, P0 Finance account optimistic CAS
- Výchozí MAIN/prod v0.1_582, HEAD `55c28e6e9072a620e3212d643634b3df1693825b`; větev `fix/p0-finance-account-cas-583`. Grafika ikon v582 zůstává nedotčená, pouze synchronizovaná PWA asset/cache verze 583.
- **Nově se podařilo připojit OPRÁVNĚNOU Supabase Domácnost+** přes účet `link_6ad62065d29081918ee329a3a8ece7f3`: správný projekt `hyyehcskthqmncqlechi` je ACTIVE_HEALTHY. RaK ani jiné DB nebyly upravovány.
- Read-only DB audit (bez výpisu soukromých řádků): `public.finance_accounts` (2 účty) a `public.finance_transactions` (41 pohybů) mají RLS, `updated_at timestamptz` a BEFORE UPDATE triggery `set_updated_at()`. `finance_accounts` má UNIQUE `(household_id,name)`, ale nemá revizní CAS v klientském UPDATE; `finance_transactions` mají pouze UUID PK a nemají serverový business-key nebo idempotency-key unikátní index. U obou RLS SELECT člen a UPDATE/INSERT owner/admin/member; do RLS se nezasahovalo.
- Kandidát 583: úprava `finance_accounts` dostala podmínku `.eq('updated_at', expectedRevision)`, povinný serverový ACK `id,updated_at` a kontrolu 0 změněných řádků. Staré pending bez známé revize/novější remote změna vyvolají bezpečný konflikt, nikoli přepsání. Lokální nedokončená data zůstávají pending. Finance účty nově přijímají revizi z INSERT a SELECT; konflikt lze rozhodnout `Použít cloud` / `Ponechat toto zařízení` přes stávající panel, druhá volba zapisuje přes znovu kontrolovaný CAS. Pozdní odpovědi hlídané user/profile/household a lokálním objektem.
- Vykonatelný test `tools/check-finance-account-cas.mjs` (přidán do check:finance) + adaptace stávajících testů Finance. Sjednocena verze v APP_BUILD, module loaderu, release.json, HTML, SW, manifestu a checkech.
- **Bez databázových změn a mazání dat.** Zbytek P0: serverová idempotence Finance INSERT napříč zařízeními (nynější DB nabízí pouze UUID PK, klient dosud používá generovaný serverový UUID), ověření živé CAS souběžné editace na dvou zařízeních a dvou variant konfliktu, historické pending Garáž/Nastavení. Případné zavedení idempotency_key/DB migrace vyžaduje samostatný návrh kompatibility a bezpečné schválení.
- Release podmínky: full CI + Chrome E2E PASS a preview ověření, následně PR merge do main a produkční Vercel READY + HTTP kontrola. Test musí zvlášť prověřit, že se conflict stav v úpravě účtu nepřepíše na pending_update.

### 20. 10. 2026 — v0.1_583 PRODUKCE, P0 účetní CAS
- PR #72 `https://github.com/martinspadrna/Domacnost/pull/72`, squash `b61589143ba0937d216366a49df0b6d312816152` do `main`; produkční Vercel `dpl_xajp6XTXBH4uHKM5ftcDQpDxigWC` READY, alias `domacnost-plus.vercel.app`.
- GitHub PR full CI + Chrome E2E PASS run `39474651760`, produkční MAIN full CI + E2E PASS run `39474909643`. Vercel preview v583 `dpl_993yetGywYQ2KvpVtEXP8pdPfQV7` READY. Po merge produkční HTTP 200 pro `release.json`, `index.html`, `finance.js`, `ios-install.html`, `manifest.webmanifest`, `sw.js`; release marker v0.1_583.
- Finance: revizní CAS pro účet, rozpoznání skutečného souběhu, bezpečné volby konfliktu, žádné mazání dat nebo zásahy do SQL. Zpětná kompatibilita původních účtů bez revize: pokud mají lokální čekající editaci, nelze ji bezpečně odeslat bez vyřešení konfliktu; nový cloud read i INSERT už revizi uchovává.
- Zbývá P0: **serverová idempotence účetních INSERT napříč zařízeními**. Projektový plugin Supabase nyní správný DB projekt `hyyehcskthqmncqlechi` čte; další krok je návrh kompatibilní migrace (unikátní per-household idempotency key nebo klientem generované stabilní UUID s ACK recovery), revizní RLS audit a samostatné bezpečné nasazení. Fyzicky ověřit obě volby konfliktu na testovacích záznamech PC ↔ mobil. Historické pending Garáž/Nastavení bez mazání.
- Rollback k produkčnímu `v0.1_582`, commit `55c28e6e9072a620e3212d643634b3df1693825b` (nebo app commit `34cff99b...`) a předchozí Vercel deployment `dpl_CKQTTYyYhFjwADRwYQaqa6gStjGH`.


### 20. 10. 2026 — v0.1_584 ROZPRACOVÁNO, NESLUČOVAT
- Výchozí MAIN/produkce v0.1_583 na `9ab5de8362483da48a17082422e5dc337c3a5723`, pracovní branch `fix/p0-finance-insert-idempotence-584`.
- Read-only závěr Supabase auditu: finance_accounts a finance_transactions mají `id uuid PRIMARY KEY`, takže stabilní klientský UUID umožní DB idempotenci opakovaného INSERTu bez změny schématu.
- Do `finance.js` na pracovní větvi je připraven `ensureFinanceInsertId` (perzistence UUID před odesláním), opakovaný INSERT pod stejným UUID a read-only ACK recovery ověřující celý payload i household; žádná DB úprava.
- Jsou jen částečně upravené verze `index.html`, `manifest.webmanifest`, `sw.js`; při pokusu o aktualizaci `module-loader.js` nástroj dvakrát vrátil blokaci bezpečnostními kontrolami. **Verzování 584 JE NEKONZISTENTNÍ, automatické testy a reálné zařízení nebyly provedeny. NESLUČOVAT do main ani nenasazovat na produkci.**
- Pro dokončení je nutné sjednotit `module-loader.js`, `app.js`, `package.json`, `release.json`, `ios-install.html`, testy PWA, upravit INSERT/ACK test harnessy na klientem dodávaná stabilní UUID, přidat test pro ztracený ACK a rozdílný obsah, spustit full CI/Chrome E2E. Následně auditovat skutečnou DB RLS přes read-only dotaz a ověřit všechny negative cases. Nepokoušet se obcházet bezpečnostní blokaci nástroje.
- **Produkce zůstává v0.1_583 READY**, bez ztráty dat, bez změn SQL, bez merge.


### 20. 10. 2026 večer — v0.1_584: regresní testy hotové, jediné blokující verzování module-loader.js
- Na branch `fix/p0-finance-insert-idempotence-584` jsou hotové: `finance.js` (stabilní klientský UUID před INSERT, full-payload read-only recovery po ztraceném ACK, perzistence před requestem), `tools/check-finance-account-insert.mjs`, `tools/check-finance-inflight.mjs`, nový `tools/check-finance-insert-idempotence.mjs` a registrace v `package.json`.
- Nový test kryje oba typy finančních INSERTů, ztracenou odpověď, falešný/pozměněný remote obsah, opakování pod stejným ID, nový record stejného názvu, restart z lokálně perzistovaného snapshotu a jinou domácnost.
- APP_BUILD, APP_VERSION, index.html, sw.js, manifest, release.json, module PWA testy, iOS instalační stránka a balíček mají v584. **Zůstává pouze `module-loader.js`: `const ASSET_VERSION = '0-1-583';` → `const ASSET_VERSION = '0-1-584';`.** GitHub `update_file` při dvou pokusech o tento konkrétní soubor vrátil bezpečnostní blokaci. Nepokoušet se ji obcházet alternativními rozhraními; změnu je třeba povoleným způsobem dokončit.
- Vercel preview `dpl_7awJeeeCGizNdQikLmfeS2dwqG23` ukončeno ERROR v `npm run check:release`. Do tohoto bodu prošly všechny postupné statické a vykonatelné kontroly včetně `check:finance` s novým testem. Výpis `check-release` potvrzuje, že **jediná zbývající chyba** je `module-loader.js ASSET_VERSION=583 neodpovídá APP_BUILD=584`.
- **Neprovádět merge ani produkční deploy před sjednocením loaderu a následným kompletním CI a Chrome E2E.** Produkční main v0.1_583 `9ab5de8362483da48a17082422e5dc337c3a5723` nadále READY, žádné SQL migrace ani ztráta dat.


### 20. 10. 2026 — FINÁLNÍ RELEASE v0.1_584 NA MAIN A PRODUKCI
- P0 Finance INSERT idempotence: vydá se stabilní UUID pro finanční účet/pohyb, perzistuje se lokálně ještě před síťovým requestem, při opakování se znovu použije stejné UUID PK; nejednoznačná odpověď se dořeší čtením stejného řádku se stejným UUID a přesně shodným odeslaným obsahem a `household_id`. Rozdílný/nesprávný řádek není ACK. Není nutná SQL migrace.
- Dříve blokovaná úprava `module-loader.js` **ÚSPĚŠNĚ PROVEDENA**, `const ASSET_VERSION = '0-1-584'` commit `54cc1f8f2f8dfeb4eb6f29fa8a48ff76414a1f2d`. Starší WIP poznámky výše o nesouladu a zákazu merge jsou historické a již neplatí.
- PR <https://github.com/martinspadrna/Domacnost/pull/73> je squash-merged do main jako `03a178f26266c5dac81701f71702431c104c5cde`. PR CI (including Chrome E2E) `39482899006` SUCCESS; main CI (including Chrome E2E) `39483156223` SUCCESS.
- Produkční Vercel deployment `dpl_6VRTvuHCisoQ7v2p4iXkPYGQwVCc` READY a má alias `domacnost-plus.vercel.app`. HTTP 200 na `/release.json` (build 584), `/index.html`, `/module-loader.js?v=0-1-584` (ověřeno ASSET_VERSION), `/finance.js?v=0-1-584` (ověřena funkce ensureFinanceInsertId), `/ios-install.html` (inline iOS logo), `/manifest.webmanifest?v=0-1-584`, `/sw.js`, `/icons/domacnost-plus-ios-180.png?v=0-1-584`.
- Databáze/SQL nebyly měněny, stávající data zůstala nedotčená; rollback produkční v0.1_583 commit `9ab5de8362483da48a17082422e5dc337c3a5723`, Vercel `dpl_EtJEEJ9PzoaYyxpuHZNU14nZkxBs`. Další P0: fyzický PC/iPhone cross-device test synchronizace a konfliktních finančních editací, historické pending Garáž/Nastavení, a read-only RLS audit. Idempotence je zajištěna pro opakování stejného lokálního finančního záznamu, nikoliv automatickou deduplikaci nezávisle vytvořených položek na různých zařízení.


### 21. 10. 2026 — P0 read-only audit Garáž/Nastavení, zjištěné riziko async scope
- Produkce ověřena na v0.1_584, Vercel READY commit `59160985056972be747bdba3e52a3deea4058a64`. Žádná data/SQL nebyla v tomto auditu změněna.
- Read-only `pg_policies` na správném Supabase projektu `hyyehcskthqmncqlechi`: `households`, `vehicles`, `finance_accounts`, `finance_transactions` mají zapnuté RLS. `households` UPDATE jen owner/admin, auta a finanční záznamy SELECT pro členy, UPDATE pro owner/admin/member. `households` má `updated_at` a `dashboard_layout jsonb`; `vehicles` má `updated_at` i rozšířené sloupce včetně `technical_specs`, vlastnictví a údajů o prodeji.
- `app.js:performCloudSaveHouseholdUiSettings` (přibližně řádky 23096–23240 v584) při čtení remote baseline i potvrzování UPDATE zachovává CAS podle `updated_at`, ale během asynchronních `await` ověřuje pouze nepřímo `cloudReady` na začátku; **neověřuje workspace scope (userId/householdId) po jednotlivých čekáních**. Při přepnutí účtu/domácnosti uprostřed requestu hrozí záměna lokálního ACK nebo konfliktního stavu. Před dalším releasem doplnit scope capture a guards po každém await a před cloud UPDATE, a test simulace user/household switch. Nepřidávat force/nový SQL write.
- `diagnoseGaragePending` (cca ř. 18947–18988) je read-only a porovnává lokální pending auta se vzdálenými; guard však sleduje jen cloud household ID, nikoliv user/profile switch. Doplnit jej, aniž by se jakákoliv lokální značka mazala. `diagnoseSubscriptionPending` používá analogický household-only guard; při úpravě diagnostiky zkontrolovat i ten.
- `shouldApplyRemoteHouseholdUi` a `reconcileConfirmedSnapshotSectionPendings` porovnávají skutečný obsah před potvrzením starých pending. Zachovat toto chování: žádné globální clearing lokálních značek podle samotného času/revize.
- **Neproveden live PC↔iPhone test**, protože přímá kontrola uživatelských zařízení není z prostředí dostupná. Bezpečný další krok: branch `fix/p0-household-ui-async-scope-585`, v585 konzistentně bumpnout release markery a PWA, nové regresní testy user switch během GET/UPDATE, kompletní CI/E2E, potom release. Původní v584 ponechat rollbackem.


### 21. 10. 2026 — RELEASE v0.1_585 (P0 async identity scope)
- PR <https://github.com/martinspadrna/Domacnost/pull/74> sloučen do MAIN `1782c547d197d48a56a410b0e1bfa6a0a9194dc0`. Preview READY, PR CI/Chrome E2E PASS run `39653891058`. Produkční deployment `dpl_ESa6yPw9zE9ZcgJL4D53SQ9Tv4bb` READY, alias `domacnost-plus.vercel.app`. HTTP 200 pro `/release.json` build 585 a `/app.js?v=0-1-585` s novým scope guardem.
- `performCloudSaveHouseholdUiSettings` zachycuje workspace scope na začátku, po načtení závislostí/remote baseline, před UPDATE, po jeho ACK a po následném conflict fetch. Při přepnutí uživatele/domácnosti stará asynchronní odpověď nepřepíše lokální nové nastavení. CAS a stávající pending chování zachovány.
- `diagnoseGaragePending` drží scope userId + householdId při vzdáleném SELECT i catch větvi. Žádné garážové záznamy ani pending značky nebyly odstraněny.
- Nový source regression `tools/check-household-ui-async-scope.mjs` zapojený do `package.json`; v585 synchronizované PWA SW, manifest, module-loader, iOS installer a kontrolní skripty. Žádné SQL migrace ani změny reálných uživatelských dat.
- Rollback produkce v0.1_584 commit `6863ca7cc8cc249cf297439cf9d5d5a7029a8209` (dokumentační MAIN), app commit `03a178f26266c5dac81701f71702431c104c5cde`, deployment `dpl_8bLaqSG1W9ivB1yvqcxk9EuuoNaC`.
- Otevřené P0: fyzické PC↔iPhone testy obou voleb CAS konfliktu, konkrétní lokální historické pending v Garáži/Nastavení; RLS read-only audit dokončen. Čekat na finální MAIN CI run `39654082103` (v okamžiku zápisu ještě mohl běžet).


### 22. 10. 2026 — kandidát v0.1_586 P0 identity guard v diagnostice a obnově
- MAIN základ produkční v0.1_585, commit `30e0ac7630d0bd96759ec286652906b032cfd49a`. Branch `fix/p0-recovery-identity-scope-586`.
- `diagnoseHouseholdUiPending()` (Nastavení) a `diagnoseSubscriptionPending()` (Předplatné) nyní používají `cloudSyncWorkspaceScope()/cloudSyncWorkspaceMatches()` po asynchronních `await`, včetně `catch`. Diagnostika Předplatného před zpracováním změn kontroluje identitu uživatele; pokud se při načítání změní účet v téže domácnosti, nedojde k importu vzdálených plateb ani k potvrzení starého `pendingAt`.
- `recoverSingleMissingSubscriptionPayment()` (ruční bezpečná obnova jediné platby přes household `updated_at` CAS) nyní drží stejnou user+household identitu už při zařazení do fronty, po načtení závislostí a remote baseline, před SQL CAS UPDATE, po jeho ACK i v chybové větvi. Opožděné odpovědi nesmějí měnit aktivní nový účet. Bez změn SQL, bez silového přepisování a bez odstranění čekajících změn.
- Nový vykonatelný test `tools/check-recovery-identity-scope.mjs`: přepnutí user i household během diagnostického dependency await; user/household switch během vzdáleného SELECT u Předplatného; přepnutí uživatele před CAS UPDATE a po odeslaném CAS UPDATE před ACK. Ve všech negativních scénářích nesmí dojít k lokálnímu ACK, importu nebo vymazání pending. Test je zapojen do `package.json` a společného Vercel `npm run check`.
- Verze konzistentně 586: APP_VERSION/APP_BUILD, HTML, SW cache, module-loader, manifest, iOS installer a PWA regression skripty. Preview Vercel po posledním testovacím commitu READY.
- Před release vyžaduje PR CI i Chrome E2E SUCCESS, kontrolu preview a poté MAIN production READY + MAIN CI. Předchozí produkční v585 rollback.
- **Další konkrétní P0:** `cloudUpdateVehicle()` v Garáži porovnává `householdId` + `cloudId`, ale po jednotlivých async `await` nesleduje `userId` (stejná domácnost při přihlášení jiným uživatelem). `cloudAddVehicle()` nemá úplnou scope kontrolu ani stabilní insert ACK recovery. Připravit izolovanou v587 větev, zachovat její `updated_at` CAS a `pending`, přidat simulaci user switch během read/update i insert. Zároveň dokončit fyzické PC↔iPhone kontroly historie pending a konfliktů, které automatické testy nenahrazují.


### 22. 10. 2026 — RELEASE v0.1_586 P0 identity guard v Nastavení/Předplatném
- PR <https://github.com/martinspadrna/Domacnost/pull/75> úspěšně squash-merged do MAIN jako `ebb4c275410e87bc75533577382841e7bdff76f1`; PR CI včetně Chrome E2E `39807697338` SUCCESS, produkční MAIN CI včetně Chrome E2E `39807972034` SUCCESS.
- Vercel prod `dpl_E5zS6dobhecgUBdUNXBdHh1BKcX1` READY, alias `domacnost-plus.vercel.app`. Ověřeno HTTP 200 `/release.json` build 586, `/index.html`, `/app.js?v=0-1-586`, `/ios-install.html`, `/module-loader.js?v=0-1-586`, `/manifest.webmanifest?v=0-1-586` a `/sw.js`.
- V Nastavení a diagnostice Předplatného se po await kontroluje, že user i domácnost odpovídají zahájené operaci. Ruční obnovení jediné chybějící platby chrání CAS přípravnou fázi i pozdní ACK; stale odpověď nesmí importovat platby, nulovat pending ani potvrdit zápis v jiném přihlášeném účtu.
- Nový vykonatelný regresní test `tools/check-recovery-identity-scope.mjs` simulující user/household přepnutí během načítání a user switch před/po CAS update, který musí zachovat pending. Součástí standardního check řetězce.
- DB ani soukromá data nebyla měněna, nebyly zapnuté force přepisy či nové SQL migrace. PWA ikonky beze změny. Předchozí prod v585 pro návrat: commit `30e0ac7630d0bd96759ec286652906b032cfd49a`, Vercel `dpl_ANw9E1YSN6QTZ3UszwCabWJbgcnd`.
- Další P0: `cloudAddVehicle` a `cloudUpdateVehicle` v Garáži po await stále nemají kompletní kontrolu uživatele pro stejnou cloudovou domácnost. Opravit v izolovaném navazujícím releasu s testy user switch během SELECT/UPDATE/INSERT, a zvážit idempotenci INSERT UUID bez destruktivní migrace. Fyzické testy obou variant konfliktů mezi PC↔iPhone a historické lokální pending zůstávají otevřené; to, že na uživatelově zařízení v585 vše vypadalo OK, je cenné, ale neprokazuje oba simulované závodní scénáře.


### 22. 10. 2026 — kandidát v0.1_587: Garáž scope pro INSERT a CAS UPDATE
- Výchozí produkce v0.1_586, MAIN SHA `585272d741b01a814083517d95af7e87fcfeb1c8`. Samostatná branch `fix/p0-garage-vehicle-scope-587`.
- `app.js:cloudAddVehicle` nyní zachycuje identity scope na začátku, po session refresh kontroluje shodu userId i domácnosti, po každém INSERT kontroluje, zda se mezitím nepřepnul uživatel; stale/schema error nesmí spustit fallback INSERT nebo přepsat nový profil. Při platném ACK propojí `cloudId` k aktuálnímu lokálnímu objektu (i po jeho normalizaci); při editaci během POST ponechá `pending_update` a okamžitě perzistuje potvrzené ID. Smazaný lokální záznam se po pozdním ACK neobnovuje do UI.
- `app.js:cloudUpdateVehicle` porovnává `scope.userId + scope.householdId` po session refresh, vzdáleném GET a před potvrzením CAS UPDATE. Původní `updated_at` CAS zůstává zachováno a stale ACK nezruší `pending_update`.
- Přidaný vykonatelný regresní test `tools/check-garage-vehicle-scope.mjs`: user/household switch před/po session refresh, během INSERT, schema fallback error; editace auta během INSERT, nahrazený local state objekt, smazané auto, přepnutí user/household během remote GET i CAS ACK, pozitivní potvrzení. Zaregistrován ve standardním `check:finance` řetězci.
- `tools/check-app-wiring.mjs` očekává novou podmínku potvrzení `current.syncStatus = usedSchemaFallback || !stillSame ? 'pending_update' : '';`, která zachovává novější lokální data. Všechna relevantní čísla build/cache/PWA/iOS testů sjednocena na 587. Vercel preview po aktualizaci statického testu READY. Před merge nutný GitHub PR CI a Chrome E2E.
- Žádné SQL migrace ani ruční zásahy do produkčních dat. Rollback na v586. **Zbývá vysoká priorita P0:** idempotence `cloudAddVehicle` při ACK ztraceném po serverovém INSERT. Dnešní guard zabrání chybnému lokálnímu přiřazení, ale pokud přepnutí účtu nebo výpadek nastane až po serverovém commit a před receipt, stávající opakování může založit další remote řádek. Příští samostatný krok zvážit stabilní lokální UUID primárního klíče před POST, persisted before network, read-only shodu remote payload/household, single-flight a tombstone DELETE/outbox pro smazání během INSERT. Nepřepisovat staré záznamy, nehledat duplicity podle jména, nečistit žádné pending značky bez potvrzení.
- Fyzické PC ↔ iPhone oboustranné konflikty a kontrola konkrétních dlouhodobých pending v Nastavení/Garáži stále otevřené. Nezaměňovat automatické simulace za fyzické otestování.


### 22. 10. 2026 — FINÁLNÍ RELEASE v0.1_587 Garáž (P0)
- PR <https://github.com/martinspadrna/Domacnost/pull/76> úspěšně squash-merged do MAIN jako `c1ceb0477d9f8d24dd64008ce43bb6a3185eab3f`. PR CI (včetně Chrome E2E) `39827942095` SUCCESS; MAIN CI (včetně Chrome E2E) `39828290489` SUCCESS.
- Produkční Vercel `dpl_Bgbm3YdLT9SY17YEBmX5WCExU53k` READY, alias `domacnost-plus.vercel.app`; dostupnost HTTP 200: `/release.json` (build 587), `/app.js?v=0-1-587`, `/module-loader.js?v=0-1-587`, `/manifest.webmanifest?v=0-1-587`, `/ios-install.html`.
- Garáž `cloudAddVehicle` a `cloudUpdateVehicle` kontrolují userId i householdId po refresh session a při síťových odpovědích. Úspěšný INSERT propojí cloudId s aktuálním lokálním objektem a při novější lokální editaci ponechá `pending_update`; změna identity a pozdní ACK nesmějí potvrdit staré lokální změny v novém účtu. UPDATE zachovává `updated_at` CAS a bezpečné blokování částečného schema-fallback UPDATE.
- Vykonatelný test `tools/check-garage-vehicle-scope.mjs` pokrývá switching user/household při session, insertu, fallbacku, remote GET, CAS ACK, změnu během INSERT, nahrazený objekt i smazaný záznam. Žádné SQL ani skutečná cloudová data v rámci oprav neměněny.
- Rollback na v0.1_586: poslední MAIN před změnou `585272d741b01a814083517d95af7e87fcfeb1c8` (dokumentace), app commit `ebb4c275410e87bc75533577382841e7bdff76f1`, Vercel `dpl_D5saQVTCXL7oFMWF66wL96SNLXD4`.
- **Zbývá P0 kritické:** idempotence CREATE auta po ztraceném síťovém potvrzení, kdy server mohl vložit záznam, ale lokální `cloudId` nebylo přijato. Zvaž stabilní klientské UUID PK perzistované před POST + read-only porovnání potvrzeného řádku v téže domácnosti, kontrolu souběhu/single-flight a vazbu na tombstone při smazání během INSERT. Neprovádět deduplikaci podle názvu auta, nepřepisovat staré řádky a nemaž pending bez přesného potvrzení.
- Otevřené: fyzický test PC↔iPhone konfliktů/pending a P1 local-first výkonnost; nikdy nezaměňovat simulované E2E za fyzické potvrzení dat v uživatelských zařízeních.


### 23. 10. 2026 — kandidát v0.1_588: P0 idempotence vytvoření vozidla
- MAIN základ v0.1_587, `e536b6ffd3363b59f5d5e4ad9c825825c9bd414f`, branch `fix/p0-garage-vehicle-idempotence-588`.
- `cloudAddVehicle()` nyní před prvním POST ukládá na lokální vozidlo stabilní `cloudInsertId` UUID s okamžitým snapshot persistence. Všechna opakování a schema fallback používají stejný UUID PK. Při chybě nebo ztraceném ACK pouze SELECT by `id`+household, ověření úplného odeslaného payloadu, bez hledání podle názvu/SPZ a bez silového UPDATE.
- Per-identity/per-logical-vehicle in-flight single-flight zabraňuje dvěma POST současně. Scope guard user+household z v587 zachován. Při změně během INSERT remote potvrzení propojí cloudId jen s aktuální verzí záznamu a zachová `pending_update`. Smazané auto se znovu nevloží lokálně; starý objekt dostane receipt pro Undo-expiry cleanup, a `deleteVehicle()` onExpire čeká na rozpracovaný INSERT před cloud DELETE.
- `tools/check-garage-vehicle-scope.mjs` aktualizován na klientské UUID a test snapshotu před POST. Nový vykonatelný `tools/check-garage-vehicle-idempotence.mjs` ověřuje ztracený ACK, offline→restart→retry, schema fallback, jinou domácnost, změněný cloudový řádek, souběh, smazání během POST a stale auth. Oba přidány do standardního `npm run check`; Vercel preview build na větvi READY.
- Konzistentní bump v588: APP_BUILD/APP_VERSION, release.json, index.html, SW, manifest, module-loader, iOS instalace a PWA testy. DB schema **neměněno**: existující `vehicles.id` je UUID PK, nepoužívá se migrace.
- **Důležité otevřené riziko P0:** po smazání vozidla během INSERT je Undo-expiry cleanup zabezpečen vůči běžnému in-flight ACK, ale zatím není trvale uložená tombstone/outbox fronta napříč restartem pro scénář, kdy dojde k serverovému INSERTu a současně výpadku/odhlášení před potvrzením i smazáním. Samostatně přidat perzistentní outbox/rekonciliační recovery pro takové delete-after-insert případy, bez mazání existujících cloud dat a s ochranou proti Undo. Rovněž P0 fyzický PC↔iPhone test a historické pending.
- Před merge ověřit PR CI + Chrome E2E SUCCESS; po merge MAIN CI, READY produkční Vercel a veřejné release markery. Rollback v587 k `e536b6ffd3363b59f5d5e4ad9c825825c9bd414f`.


### 23. 10. 2026 — FINÁLNÍ PRODUKČNÍ RELEASE v0.1_588
- PR <https://github.com/martinspadrna/Domacnost/pull/77> squash-merged do MAIN jako `37475176a5b198a14d38e5fe93d434513901ebcb`. PR CI + Chrome E2E `39994244466` SUCCESS, MAIN CI + Chrome E2E `39994463861` SUCCESS.
- Vercel produkce `dpl_7h3F6v5TWziNGp5d4iyxSeMYfdHw` READY, správný commit + alias `domacnost-plus.vercel.app`. Public HTTP 200: `/release.json` build 588, `/index.html`, `/app.js?v=0-1-588`, `/module-loader.js?v=0-1-588`, `/manifest.webmanifest?v=0-1-588`, `/ios-install.html`, `/sw.js`.
- P0 Garáž CREATE auta používá stabilní klientské UUID perzistované před network INSERT a v retry; odolnost vůči ztracenému ACK (bez hledání auta dle názvu/SPZ), single-flight a scope control, Undo delete čeká na nedokončený POST. Původní CAS UPDATE chráněn a zachován.
- Nové runtime regresní testy pokrývají lost ACK, retry offline/restar­t, schema fallback, mismatch, PK kolizi, jinou domácnost, souběh a smazání za POST. Nedošlo k žádné SQL migraci ani zápisu do produkční DB během testu.
- **Nevyřešená návaznost P0:** po dokončeném INSERTu při současném ztraceném ACK + vypršení Undo + restartu/odhlášení nemusí být delete trvale uložen; je vhodný durable tombstone/outbox recovery. Fyzické PC↔iPhone konflikty a historické lokální pending zůstávají nutné. Neprezentovat jako fyzicky otestované.
- Rollback na v0.1_587: předchozí MAIN `e536b6ffd3363b59f5d5e4ad9c825825c9bd414f`, předchozí Vercel deployment `dpl_6EsXoaJAyBeHPCWpbLKDe1W9VdDB`.


### 24. 10. 2026 — RELEASE v0.1_589: Garáž, potvrzení INSERT tankování a servisu
- Uživatelský test: PC opakovaně hlásilo neodeslanou Garáž, ačkoliv mobil po konfliktu a převzetí novějších cloudových dat zobrazil tankování i nákup pneumatik. Přesný konflikt na PC nelze určit bez anonymizované diagnostiky; nepovažovat toto za fyzicky potvrzenou opravu. Nerušit historické pending bez obsahového ověření.
- P0 příčina v kódu před opravou: cloudAddFuelLog a cloudAddServiceLog po INSERT chybě včetně SQLSTATE 23505 vracely null a nechávaly záznam čekat; neuměly obnovit potvrzení již vloženého záznamu. V reálném Supabase projektu hyyehcskthqmncqlechi read-only ověřeny UNIQUE indexy (household_id, vehicle_id, source_hash) u fuel_logs a service_logs, UUID PK a odpovídající sloupce vehicles. Žádná SQL migrace ani produkční uživatelský write.
- Nově v app.js: logické tankování/servis má stabilní cloudInsertId UUID perzistované před POST; single-flight per user/household/item a scope guards po await. Při ztraceném ACK read-only kontrola přes id + přesná shoda všech odeslaných polí; při historickém serverovém ID je recovery přes UNIQUE source_hash v téže domácnosti/vozidle povoleno výhradně po přesné obsahové shodě. Jinak pending zůstává; editace během POST zůstává pending_update.
- Prověřit Garáž nově zobrazuje kromě aut také počty čekajících tankování a servisů/nákupů; ruční odeslání zobrazuje počet položek stále čekajících na potvrzení. Bez force overwrite a bez čištění neověřených dat.
- Nový vykonatelný tools/check-garage-log-insert-recovery.mjs pokrývá fuel a service: primární INSERT, ztracený ACK, historický 23505, odmítnutí jiné ceny, offline retry, přepnutí účtu při requestu a editaci během POST. Všechny relevantní release/PWA markery sjednoceny na v589.
- PR https://github.com/martinspadrna/Domacnost/pull/78 squash-merged jako MAIN 023bc4b332c249a112312465f9e7d316d749fc68. PR CI + Chrome E2E run 40117483937 SUCCESS; MAIN CI + Chrome E2E 40117612144 SUCCESS. Preview finálního commitu dpl_285oC2CfNAxkEnQJfGrC8dPzygvo READY. Produkční Vercel dpl_FYU29rAW5V4rjjVuUTe7owwpTCHo READY a alias domacnost-plus.vercel.app odpovídá danému commitu.
- Rollback na předchozí v588: MAIN b328da84706be8a470f4e9974db21428378b5ed0, Vercel READY dpl_8dabQjyuSYXPYR3GkeE6UEPTNY7K. Další P0: fyzicky ověřit PC->mobil pending a právě jednu kopii tankování/nákupu pneu; pokud přetrvá čekající auto/Nastavení, využít read-only diagnostiku před další volbou konfliktu. Otevřené riziko: cloudUpdateFuelLog a cloudUpdateServiceLog zatím nemají CAS; stále chybí persistentní delete tombstone po ztraceném INSERT ACK i některé fyzické PC↔mobil konfliktní testy.


### 25. 10. 2026 — RELEASE v0.1_590: CAS úpravy tankování a servisů
- Uživatel 25.10. potvrdil po testu na PC, že oprava v589 Garáže funguje (původní čekající změny / tankování / nákup pneumatik). To je pozitivní fyzický akceptační signál k původnímu problému, nikoli úplný oboustranný PC↔iPhone konfliktový test.
- Izolovaná PR větev fix/p0-garage-log-cas-590 navazuje na produkční v589. Zjištění: cloudUpdateFuelLog a cloudUpdateServiceLog používaly UPDATE bez CAS; tichý přepis změny z druhého zařízení. Read-only ověřeno, že reálná Supabase databáze má na fuel_logs a service_logs BEFORE UPDATE triggery set_updated_at, takže `updated_at` lze použít jako ochrannou revizi.
- V app.js jsou nyní fuel i service aktualizace sjednoceny do cloudUpdateGarageLog s workspace scope, per-record single-flight, snapshot guardem a updated_at CAS. cloudLoadGarageData ukládá cloudUpdatedAt pro obě kolekce; CREATE logu ukládá confirmed cloudUpdatedAt při ACK nebo přesném read-only obnovení po ztracené odpovědi. Legacy pending bez revize nesmí automaticky přepsat jiný cloudový záznam.
- Změna obsahu nebo revize proti známému baseline vyvolá registrovaný konflikt fuel/services; karty 'Použít cloud' / 'Ponechat toto zařízení' nyní fungují také pro Garáž. Cloud volba vždy znovu čte aktuální řádek; lokální volba vyžaduje CAS shodu s poslední známou cloud revizí. Pokud se cloud změní ještě během volby, konflikt se bezpečně obnoví. Network error bez změny cloud revize nechává pending, nikoliv falešný konflikt. Žádné force SQL overwrite a žádné SQL migrace.
- Nový runtime test tools/check-garage-log-update-cas.mjs pokrývá fuel+services: pozitivní CAS, konflikt jiné revize, chybějící baseline, ztracený UPDATE ACK, network error, nula řádků při souběhu, editaci během requestu, změnu účtu a obě ruční volby. Aktualizován test v589 tools/check-garage-log-insert-recovery.mjs na nové kotvy zdrojových funkcí. Konzistentní build/PWA markery v590.
- PR https://github.com/martinspadrna/Domacnost/pull/79 merged squash na MAIN 50ed0ce2276d690bb7326059f203c9cf100bfe16. PR CI včetně Chrome E2E run 40206223255 SUCCESS; MAIN CI včetně Chrome E2E run 40206300849 SUCCESS. Preview dpl_9gyshz62AHgHjuH1t6K12kDMqfBT READY; produkční Vercel dpl_FUbEmaEeJvsZ8t4mHVdjZLMdpxNH READY, alias domacnost-plus.vercel.app, aplikace v590. Reálný PC↔telefon scénář obou voleb nového konfliktu uživatel ještě neotestoval.
- Rollback na v589 MAIN aebc514425e2b064131f74521105270324c1bd9d a Vercel dpl_269tsX8yH9FboJY9ewYb6ZNK7PYT. Další P0 podle plánu: persistentní tombstone/outbox pro smazání během ztraceného INSERT ACK, read-only audit starších případných pending a fyzické oboustranné testy konfliktů; pak P1 local-first/rychlost.
