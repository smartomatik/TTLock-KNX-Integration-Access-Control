# TTLock – integracja KNX (kontrola dostępu)

Uruchamianie **automatyki KNX zależnej od osoby**, która otworzyła drzwi czytnikiem **UL** (platforma TTLock). Obsługiwanych jest **do 10 osób**.
Anna otwiera odciskiem palca → na KNX idzie jej wyzwalacz 7/3/1 i scena 1 (światła, rolety, ogrzewanie, muzyka). Piotr otwiera kodem PIN → wyzwalacz 7/3/2 i scena 2.

Rozwiązanie działa w **Node-RED** z gotowymi węzłami i nie wymaga Home Assistant ani programowania.
Instalator edytuje jedną tabelę „osoba → scena” w przeglądarce.

```
Czytnik UL ──BLE──► Bramka (SX / TTLock G2/G6) ──Wi-Fi──► Chmura TTLock EU
                                                               │ HTTPS POST (callback)
                                                               ▼
    Cloudflare Tunnel / Tailscale Funnel /
           przekierowanie portów + Caddy ──► Node-RED ──KNX IP (Secure)──► magistrala KNX
                                                 osoba 1–10          7/3/1…7/3/10 wyzwalacz osoby (DPT 1.001)
                                                                     7/1/0 scena osoby (DPT 18.001)
                                                                     7/2/0 „Ostatnio otworzył” (DPT 16.001)
                                                                     7/4/1 „Integracja OK” (DPT 1.001, serwis co 6 h)
```

## Jak to działa

1. Bramka przesyła każde otwarcie do chmury TTLock.
2. Chmura wywołuje nasz adres URL (**Lock Records Notify**). Pole `username` zawiera **nazwę nadaną w aplikacji** odciskowi palca, karcie lub kodowi PIN, np. `Anna - kciuk`. Przy otwarciu z aplikacji jest to nazwa konta.
3. Node-RED filtruje rekord (typ otwarcia, sukces, duplikaty, wiek rekordu) i wyszukuje osobę (1–10) po pierwszym słowie nazwy. Następnie wysyła na KNX:
   - wyzwalacz tej osoby (`1` na 7/3/n), pod który w ETS podpinasz dowolną automatykę,
   - jej scenę (7/1/0),
   - jej imię (7/2/0).

## Zawartość repozytorium

| Plik | Opis |
|---|---|
| [docs/INSTRUKCJA-NODE-RED.md](docs/INSTRUKCJA-NODE-RED.md) | **Instrukcja krok po kroku dla instalatora** – zacznij tutaj |
| [node-red/flow-ttlock-knx.json](node-red/flow-ttlock-knx.json) | Gotowy flow do zaimportowania w Node-RED |
| [node-red/docker-compose.yml](node-red/docker-compose.yml) | Node-RED i opcjonalnie Cloudflare Tunnel w Dockerze |
| [tools/ttlock_test.py](tools/ttlock_test.py) | Skrypt testowy: logowanie do API, lista zamków, odcisków i rekordów, lokalny odbiornik callbacków |
| [docs/TEST-API.md](docs/TEST-API.md) | Jak sprawdzić, czy API zwraca osobę, zanim cokolwiek zainstalujesz |
| [docs/UTRZYMANIE.md](docs/UTRZYMANIE.md) | Plan pracy na 5 lat: co działa automatycznie, ryzyka, aktualizacje, kopie zapasowe, coroczny przegląd |
| [node-red/src/](node-red/src/) i [node-red/build-flow.py](node-red/build-flow.py) | Kod źródłowy węzłów i generator flow (dla osób zmieniających kod) |
| [tests/](tests/) | 60 testów logiki flow (`node tests/test-flow.js`) i 13 testów skryptu (`python3 tests/test_ttlock_test.py`), bez instalacji i bez sieci |
| [docs/RAPORT.md](docs/RAPORT.md) | Raport wykonalności: dane z zamka, ograniczenia, porównanie rozwiązań KNX, bezpieczeństwo, RODO |

## Wymagania w skrócie

- Czytnik UL podłączony do **bramki** (bez bramki chmura nie dostaje rekordów w czasie rzeczywistym)
- Konto **administratora** zamka w aplikacji SX
- Konto deweloperskie **TTLock Open Platform** (euopen.ttlock.com, darmowe, zatwierdzane ręcznie w kilka dni roboczych)
- Komputer pracujący 24/7 w sieci obiektu: Raspberry Pi, NAS z Dockerem, mini PC albo **istniejący Home Assistant** (aplikacja Node-RED, bez zmian w flow)
- Interfejs **KNX IP** z tunelowaniem, najlepiej z KNX IP Secure (np. MDT SCN-IP100.03)
- Publiczny adres HTTPS dla callbacku, do wyboru:
  - **Cloudflare Tunnel** (darmowe konto i domena),
  - **Tailscale Funnel** (darmowe konto, bez domeny),
  - **przekierowanie portów** w routerze (wymaga publicznego IPv4).

## Ważne

- Kierunek jest **tylko zamek → KNX**. Nic po stronie KNX nie może otwierać drzwi.
- Nie rozbrajaj alarmu automatycznie na podstawie otwarcia.
- Tożsamość przychodzi przez chmurę TTLock. Bez internetu drzwi działają normalnie, ale scena się nie uruchomi.
- Opóźnienie od otwarcia do sceny zmierz na obiekcie. TTLock nie podaje wartości, oczekuj kilku sekund.

## Niezawodność (wersja 2.1)

- **Samokontrola co 6 h:** odświeżenie tokenu TTLock, kontrola bramki i zegara. Wynik trafia na KNX (7/4/1), więc awaria jest widoczna na wizualizacji.
- **Odporność na błędy:** każdy callback dostaje odpowiedź `success`. Uszkodzone dane są logowane i pomijane, a błędna konfiguracja nie zastępuje poprawnej.
- **Bezpieczeństwo danych:** kody PIN są maskowane, a hasła przechowywane zaszyfrowane (credential).
- **Ochrona przed fałszywymi zdarzeniami:** callback TTLock nie ma podpisu. Działają tylko zdarzenia z właściwym lockId i lockMac, a bez lockId działa tryb nauki (tylko log).
- **Testy:** 60 testów flow i 13 testów skryptu. Uruchom je po każdej zmianie kodu:
  ```bash
  node tests/test-flow.js
  ```
  ```bash
  python3 tests/test_ttlock_test.py
  ```

## Zmiana kodu

Kod węzłów funkcyjnych znajduje się w `node-red/src/*.js`. Po zmianie:
```bash
python3 node-red/build-flow.py
```
```bash
node tests/test-flow.js
```
```bash
python3 tests/test_ttlock_test.py
```
Następnie zaimportuj nowy `node-red/flow-ttlock-knx.json`. Węzły mają stałe identyfikatory, więc import zastępuje poprzednią wersję.
