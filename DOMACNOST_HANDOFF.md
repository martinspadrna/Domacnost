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
- [ ] GitHub CI: syntax, release, static, memo, wiring, CSS a forms
- [ ] Browser E2E včetně testu serializace zápisů
- [ ] Uživatelský fyzický test: Předplatné Netflix 1/2 a OnePlay, čekající změna 29. 6. 2026; po přihlášení nebo restartu ověřit, zda skutečně sedí cloud snapshot; pokud ne, zachovat konflikt a vyžádat anonymizovaný rozdíl
- [ ] Dvě zařízení: souběžná editace, skutečný konflikt, restart a offline → online
- [ ] Finance: kompletní P0 audit všech pending markerů a jejich zachování při souběžných úpravách
- [ ] Mobil Safari iPhone, Android Chrome, desktop; regresní smoke ostatních modulů
- [ ] Prověřit i `cloudSyncLocalPendingData`, které může aktualizovat `lastSyncAt` během neúplného syncu
- [ ] Až po fyzickém schválení bezpečně nasadit do produkce

## Pravidlo pokračování
Nejdřív dokončit P0, potom P1 → P2 → P3 → P4. Po každé dokončené etapě doplnit sem přesně: verze, branch/commit, změny, výsledky testů, rizika, stav (%), další konkrétní úkol.
