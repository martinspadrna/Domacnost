# Domácnost+ — P0 přejímací testy synchronizace

Aktualizováno 19. 10. 2026. Platí pro produkční v0.1_578 a novější verze (po ověření shody verzí). 
Tyto kroky se mají skutečně provést na PC a iPhonu. Automatické CI/E2E nedokazuje správnou synchronizaci na reálném Supabase backendu.

## Bezpečnost před testem

- Na PC i iPhonu používat **stejnou cloudovou domácnost**, zamýšlený aktivní profil a běžné přihlášení. Ověřit číslo verze v „O aplikaci“.
- **Nemaž data, nepoužívej reset, force overwrite, „použít cloud/lokální verzi“ ani odhlášení při neodeslaných změnách.** Pokud systém zobrazí konflikt, přestaň a pošli jen anonymizovaný stav/screenshot.
- Používej **nové, jasně označené testovací záznamy**, např. „TEST SYNC 19-10“, nikoli již existující skutečné platby nebo půjčky. Předem volit taková data, která je bezpečné ponechat do konce testu.
- Zaznamenej stav čekajících změn („Cloud domácnosti“) **na obou zařízeních před testem**. Pokud už čekají historické Garáž/Nastavení/Předplatné, ručně je nemaž.
- U každého testu poznač: **OK / CHYBA / NETESTOVÁNO**. Není nutné posílat žádná osobní jména, účty, tokeny ani skutečné částky.

## A — Načtení, relace a stav cloudu (kritické)

1. PC: přihlas se, otevři Domů → Finance → Předplatné → Nákupy → Nastavení/Cloud domácnosti. UI by se mělo otevřít rychle, bez nekonečného načítání a opakované hlášky o vypršení bezpečného přihlášení.
2. iPhone: totéž. Na obou porovnej cloudovou domácnost a aktivní profil, přítomnost stávajících dat, počty čekajících změn.
3. Obě aplikace zavři a znovu otevři; přihlášení a lokálně již uložené položky musí zůstat použitelné.
**Výsledek:** A = OK / CHYBA; případná přesná hláška a kde se objevila.

## B — Předplatné PC → iPhone → restart (kritické, historický problém)

1. Na PC v již existujícím předplatném vlož **jeden nový testovací záznam platby** s rozpoznatelným datem a malou testovací částkou (nemusí jít o skutečnou bankovní platbu).
2. Po dokončení pozoruj stav fronty Předplatného. Pokud se záznam neodešle, **nepokračuj na mobilu přepisováním dat** a pošli stav čekajících změn.
3. Na iPhonu otevři Předplatné (aby se lazy modul načetl), zkontroluj přesný nový záznam, zda tam je **právě jednou**, a porovnej i celkový počet plateb.
4. Ukonči a otevři aplikaci na obou zařízeních. Platba musí zůstat na obou **jednou**. V „Cloud domácnosti“ případně použij jen read-only „Prověřit Předplatné“.
**Výsledek:** B = OK / CHYBA; viditelné na PC/mobilu, počet plateb, pending Předplatného.

## C — Finance: účet, pohyb a změna z mobilu (kritické)

1. Na PC založ **jeden testovací finanční účet** s jednoznačným názvem a potom do něj vlož **jeden testovací pohyb** (např. výdaj 1 Kč). Sleduj pending.
2. Na iPhonu otevři Finance. Musí být vidět **tentýž účet a jediný pohyb** a součet musí sedět. Nepřidávej jej podruhé ručně.
3. Na iPhonu změň **pouze název nebo poznámku testovacího pohybu**. Na PC Finance znovu otevři/načti a ověř změnu.
4. Restartuj obě aplikace, zkontroluj jedinečnost účtu/pohybu, změnu a čekající frontu.
**Výsledek:** C = OK / CHYBA; zda se objevil účet i pohyb jednou, stav pending.

## D — Offline → restart → online → druhé zařízení (kritické)

1. Na iPhonu zapni režim letadlo (Wi-Fi i mobilní data opravdu odpojena).
2. Ve Financích vytvoř **jiný nový testovací pohyb**. Po uložení musí zůstat v aplikaci a být uveden jako čekající na cloud (žádné falešné „synchronizováno“).
3. **Stále offline** aplikaci úplně zavři a znovu otevři. Záznam musí zůstat. Pokud není offline dostupné celé UI, poznač to jako samostatnou chybu PWA.
4. Připoj internet, znovu otevři Finance a Cloud domácnosti. Pending má po úspěšném přenosu zmizet a PC musí záznam uvidět **právě jednou** i po restartu.
**Výsledek:** D = OK / CHYBA; zachování po offline restartu, pending a duplicity.

## E — Skutečný konflikt stejného pohybu (kritické, prováděj až po B–D)

1. Vyber **jen testovací finanční pohyb, který je prokazatelně synchronizovaný na PC i iPhonu** (má potvrzenou cloudovou verzi).
2. iPhone odpoj od internetu; offline uprav *poznámku* na hodnotu „TEST MOBIL OFFLINE“.
3. Na online PC uprav **poznámku téhož pohybu** na „TEST PC ONLINE“ a ověř, že změna byla v cloudu skutečně potvrzená.
4. iPhone připoj. Správný výsledek je **viditelný konflikt / nutnost vybrat verzi**; žádná z obou poznámek se nesmí potichu přepsat a nesmí se vytvořit druhý pohyb.
5. **Pokud se konflikt objeví, zatím nevybírej žádnou možnost.** Pošli anonymizovaný screenshot nabídky a stav pending; podle toho půjde ověřit obě větve bezpečného řešení.
**Výsledek:** E = OK / CHYBA; konflikt se ukázal? Obě verze dohledatelné?

## F — Další moduly a starší pending (důležité)

1. **Nákupy:** na PC přidej jednu jasně označenou položku do jednoho seznamu; na iPhonu otevři Nákupy a ověř jediný výskyt, stav po restartu a zpětnou změnu množství.
2. **Garáž:** zkontroluj, zda stále čekají historické změny (dříve 2). Bez ručního mazání pošli pouze počty a text důvodu.
3. **Nastavení domácnosti:** zkontroluj případnou starší čekající změnu (dříve 1), bez ručního resetu. Nesmí blokovat příjem nové potvrzené platby z B.
4. **Nákupy/Předplatné/Finance při změně profilu:** pokud používáš více profilů, otevři na stejném zařízení druhý profil a zpět. Data různých profilů/domácností se nesmějí nepřiměřeně přepsat ani ztratit.
**Výsledek:** F = OK / CHYBA; Nákupy synchronní? Kolik starých pending Garáž/Nastavení?

## Co stačí poslat zpět

```text
Verze PC / iPhone:
A Načtení a přihlášení: OK / CHYBA / NETESTOVÁNO
B Předplatné PC → iPhone: OK / CHYBA / NETESTOVÁNO
C Finance účet a pohyb: OK / CHYBA / NETESTOVÁNO
D Offline → restart → online: OK / CHYBA / NETESTOVÁNO
E Konflikt dvou zařízení: OK / CHYBA / NETESTOVÁNO
F Nákupy / Garáž / Nastavení: OK / CHYBA / NETESTOVÁNO
Čekající změny PC:
Čekající změny iPhone:
Poznámka / anonymizovaný screenshot chyby:
```

## Pravidla uzavírání P0

- **Klientské regresní opravy** lze označit jako automaticky ověřené, pokud CI i Chrome E2E projdou na odpovídajícím release HEAD.
- **Reálná cross-device synchronizace** se uzavře až po skutečném **OK v A–D**, bez duplicit a ztracených lokálních úprav.
- **Konflikty** se uzavřou až po ověření E včetně bezpečného zachování obou verzí a následně samostatném otestování voleb.
- **Serverový CAS finance_accounts, idempotentní INSERT na různých zařízeních a RLS** se neuzavírají na základě frontendových testů. Je nutný oprávněný read-only audit **skutečné Supabase Domácnost+** (projekt `hyyehcskthqmncqlechi`) a teprve potom schválená kompatibilní DB úprava + testy. Připojení nyní hlásí `link_id must identify an eligible linked account`.
- Historické pending marker(y) se nesmějí mazat jen proto, aby test „prošel“. Aplikace nesmí zobrazovat synchronizováno, pokud u ní zůstávají skutečně čekající změny.
