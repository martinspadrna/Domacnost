# Domácnost+ — centrální handoff

Aktualizováno: 14. 10. 2026. Na začátku nového chatu načíst celý tento soubor, ověřit HEAD a nejnovější verzi. Nepoužívat safepoint, pokud to uživatel výslovně nepožádá.

## Verze a větve
- Ověřená hlavní verze při zahájení: v0.1_536, main HEAD `5e974186b0937778aaa7aad18687a290a38db814`.
- Kandidát v0.1_537 na větvi `fix/p0-subscriptions-sync-537`. Nepřevádět do main/produkce před CI a fyzickým ověřením uživatelem.
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
- Draft PR: https://github.com/martinspadrna/Domacnost/pull/29
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
