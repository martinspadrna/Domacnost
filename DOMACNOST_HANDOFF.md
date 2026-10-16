# Domácnost+ — centrální handoff

Aktualizováno: 16. 10. 2026. Na začátku nového chatu načíst celý tento soubor, ověřit HEAD a nejnovější verzi. Nepoužívat safepoint, pokud to uživatel výslovně nepožádá.

## Verze a větve
- **Aktuální produkční verze: v0.1_555** (merge PR #45 `e4a5c7cef80e7b0bcc10f61e1b459b8fe7b033f2`, Vercel READY, PR CI PASS). Nové konverzace musí ověřit HEAD znovu.
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
