# Testy end-to-end

Sprawdzają cały tor na prawdziwym oprogramowaniu: callback HTTP w formacie TTLock → Node-RED → flow z repozytorium → knx-ultimate → tunel KNX IP → telegramy na magistrali.

Zamiast fizycznego interfejsu KNX używany jest emulator `knx_gateway_sim.py` (KNXnet/IP tunneling po UDP, bez KNX Secure). Zapisuje on telegramy wysłane przez Node-RED i potrafi wysłać telegram „z magistrali”, np. 7/4/0.

## Przygotowanie (jednorazowo, w dowolnym katalogu poza repozytorium)

```bash
npm install node-red@5.0.7
```
```bash
mkdir userdir && cd userdir && npm init -y && npm install node-red-contrib-knx-ultimate@8.0.6
```

## Uruchomienie

```bash
python3 tests/e2e/run_e2e.py --node-red <katalog>/node_modules/.bin/node-red --userdir <katalog>/userdir
```

Trwa ok. 3 minuty. Używa portów lokalnych 18811 (Node-RED), 13671 (KNX) i 13672 (sterowanie emulatorem). Nadpisuje `flows.json` w podanym `userdir`, więc **nie wskazuj produkcyjnego katalogu Node-RED**.

Test serwisu łączy się z prawdziwym serwerem TTLock. Bez zmiennych środowiskowych używa fikcyjnych danych aplikacji (oczekiwany błąd 10000). Z prawdziwymi danymi aplikacji sprawdza też, czy serwer je przyjmuje (oczekiwany błąd 10007 dla nieistniejącego użytkownika):

```bash
TTLOCK_CLIENT_ID=... TTLOCK_CLIENT_SECRET=... python3 tests/e2e/run_e2e.py --node-red ... --userdir ...
```

## Co jest sprawdzane (41 testów)

| Grupa | Zakres |
|---|---|
| 1. Start i tryb nauki | odczyt 7/4/0 po starcie; bez lockId nic nie trafia na KNX |
| 2. Osoby | wyzwalacz 7/3/n, scena 7/1/0, tekst 7/2/0; polskie znaki; dwie osoby naraz; duplikat |
| 3. Zdarzenia zabronione | 13 przypadków, które nie mogą uruchomić automatyki |
| 4. Protokół HTTP | 404 dla złego adresu, callback jako JSON, odrzucenie zbyt dużego zapytania |
| 5. 7/4/0 | wyłączenie i włączenie automatyki z KNX |
| 6. Obciążenie | 40 callbacków naraz, 120 telegramów bez strat |
| 7. Serwis | prawdziwy serwer TTLock, 7/4/1 = 0 po dwóch nieudanych kontrolach |
| 8. Odporność | restart interfejsu KNX i restart Node-RED |
| 9. Poufność | PIN, hasło i secret nie występują w logu ani w `flows.json` |

## Czego te testy nie obejmują

- prawdziwego czytnika, bramki i callbacku z chmury TTLock,
- fizycznego interfejsu KNX i KNX Secure,
- publicznego adresu (Cloudflare Tunnel, Tailscale Funnel, przekierowanie portów).
