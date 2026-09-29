# Test API: czy dostaniemy nazwę osoby?

Ten test zajmuje ok. 15 minut i potwierdza najważniejsze założenie przed instalacją: **chmura TTLock zwraca, kto otworzył drzwi**.
Potrzebujesz tylko komputera z Pythonem 3 (macOS i Linux mają go domyślnie). Instalacja dodatkowych bibliotek nie jest potrzebna.

## Co mówi dokumentacja
Instrukcja API SX (wersja TTLock Cloud API v3, serwer `euapi.ttlock.com`), rozdział *Unlock record APIs* i *Lock Records Notify*. Pole `username` w rekordzie otwarcia zawiera:

| Sposób otwarcia | `username` |
|---|---|
| aplikacja (eKey) | konto użytkownika aplikacji |
| kod PIN | nazwa kodu |
| karta / brelok | nazwa karty |
| odcisk palca | nazwa odcisku |

Pole `keyboardPwd` zawiera numer odcisku lub karty. **Przy kodzie PIN jest to prawdziwy kod**, więc nigdy go nie loguj.

## Przygotowanie
1. Zatwierdzona aplikacja deweloperska w **euopen.ttlock.com** (clientId, clientSecret). Zobacz krok 1 w [INSTRUKCJA-NODE-RED.md](INSTRUKCJA-NODE-RED.md).
2. W aplikacji SX nazwij 2–3 testowe dane dostępowe, np. `Anna - kciuk`, `Test - brelok`, `Test - kod`.
3. Najlepiej z podłączoną **bramką**. Bez niej rekordy trafiają do chmury tylko wtedy, gdy telefon z aplikacją połączy się z zamkiem.

> ⚠️ Logowanie kontem administratora przekierowuje callbacki tego zamka do Twojej aplikacji deweloperskiej. Jeśli klient ma już inną integrację TTLock, może ona przestać otrzymywać zdarzenia. Testuj na zamku demonstracyjnym albo uzgodnij to z klientem.

## Test 1 – rekordy przez API (bez serwera)
Otwórz drzwi każdym testowym sposobem, a potem:
```bash
export TTLOCK_CLIENT_ID=... TTLOCK_CLIENT_SECRET=... TTLOCK_USER=login-administratora
```
```bash
python3 tools/ttlock_test.py records
```
```bash
python3 tools/ttlock_test.py records <lockId> --hours 2
```
Skrypt zapyta o hasło (nie jest wyświetlane). Wynik zawiera listę odcisków, kart i kodów z nazwami oraz rekordy, np.:
```
2026-09-29 18:42:07        1.8  ok    8 otwarcie odciskiem palca       'Anna - kciuk' 44668054142981
```
**Jeśli widzisz nazwę, np. `'Anna - kciuk'`, integracja jest możliwa.**

## Test 2 – callback na żywo i pomiar opóźnienia
W pierwszym terminalu:
```bash
python3 tools/ttlock_test.py listen --port 8080
```
W drugim terminalu (instalacja na macOS: `brew install cloudflared`):
```bash
cloudflared tunnel --url http://localhost:8080
```
1. `cloudflared` wyświetli tymczasowy adres `https://xxxx.trycloudflare.com`.
2. Wklej go jako **Callback URL** w euopen.ttlock.com/manager → Twoja aplikacja.
3. Otwórz drzwi odciskiem. Pierwszy terminal pokaże zdarzenie z czasem **„drzwi → callback X s”**.

Zapisz wyniki:
- [ ] opóźnienie dla odcisku, karty i kodu
- [ ] czy otwarcie z aplikacji (typ 1) wysyła callback
- [ ] czy nazwa (`username`) jest wypełniona dla każdego typu na tym firmware czytnika UL

Nie używaj serwisów typu webhook.site, ponieważ nazwy osób (i kody PIN w rekordach) trafiłyby do obcej firmy. Lokalny odbiornik z tunelem zatrzymuje dane na Twoim komputerze.
