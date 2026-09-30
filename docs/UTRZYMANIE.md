# Utrzymanie – plan na 5 lat pracy

Integracja jest zaprojektowana do pracy bez nadzoru, ale zależy od usług zewnętrznych: chmury TTLock, tunelu lub DDNS, domeny i internetu. **Całkowicie bezobsługowo przez 5 lat nie da się tego zagwarantować.**

Ten dokument opisuje:
- co dzieje się automatycznie,
- co trzeba sprawdzać,
- jak szybko wykryć awarię.

## Co działa automatycznie

| Mechanizm | Co chroni |
|---|---|
| **Serwis co 6 h** (część ⑦ flow) | Loguje się do TTLock i odświeża token administratora dla naszego clientId, więc callbacki nie wygasają. Sprawdza, czy bramka widzi czytnik, i porównuje zegar komputera z serwerem. |
| **GA 7/4/1 „Integracja OK”** | `1` = sprawna. `0` = dwie kolejne kontrole nieudane (ok. 12 h), np. bramka offline, złe hasło lub brak internetu. **Pokaż to na wizualizacji lub wyślij powiadomienie z KNX.** |
| Odpowiedź `success` zawsze | Chmura TTLock nie ponawia i nie blokuje wysyłek nawet przy błędnych danych. |
| Walidacja konfiguracji | Błąd w ⚙ KONFIGURACJA nie psuje działania. Zostaje poprzednia poprawna konfiguracja (czerwony status). |
| Odporność na dane | Uszkodzone lub nietypowe callbacki są logowane i pomijane bez zatrzymania flow. Duplikaty i stare rekordy są filtrowane, pamięć ograniczona. |
| Wiek liczony od czasu serwera TTLock | Rozjechany zegar czytnika (np. po zaniku zasilania) nie blokuje automatyki. |
| knx-ultimate `autoReconnect` | Po restarcie interfejsu KNX lub sieci połączenie wraca samo. |
| `restart: unless-stopped` / usługa systemd | Po zaniku prądu Node-RED i tunel startują same. |
| Limit logów Docker (3 × 10 MB) | Logi nie zapełnią dysku. |
| Testy automatyczne (`node tests/test-flow.js`, `python3 tests/test_ttlock_test.py`) | Po każdej zmianie kodu 63 testy flow i 13 testów skryptu sprawdza całą logikę. |

## Ryzyka w ciągu 5 lat i zabezpieczenia

| Ryzyko | Skutek | Zabezpieczenie / co zrobić |
|---|---|---|
| Wygaśnięcie tokenu TTLock (90 dni) | callbacki mogą przestać przychodzić | automatycznie: serwis loguje się co 6 h (wymaga danych z kroku 10a) |
| Zmiana hasła administratora w aplikacji SX | serwis nie zaloguje się, a callbacki mogą wygasnąć | 7/4/1 = 0 → wpisz nowe hasło w zmiennych zakładki (krok 10a) |
| Inna integracja TTLock (np. HA) zaloguje administratora | callbacki trafią tam | serwis co 6 h odzyskuje „najdłużej ważny token”. Nie instaluj drugiej integracji TTLock na tym samym koncie. |
| Bramka offline lub bez zasilania | brak zdarzeń | 7/4/1 = 0 po ok. 12 h |
| Wygaśnięcie domeny (13A) | callback nie dociera | **włącz automatyczne odnowienie domeny** i sprawdzaj kartę płatniczą |
| Stara wersja cloudflared | tunel może przestać działać (Cloudflare wspiera wersje do ok. roku) | aktualizacje automatyczne, patrz niżej |
| Wygaśnięcie klucza Tailscale (13B) | Funnel przestaje działać po 180 dniach | wyłącz wygasanie klucza (krok 13B, pkt 6) |
| Zmiana IP lub CGNAT u operatora (13C) | callback nie dociera | DDNS aktualizuje IP. Przy CGNAT przejdź na 13A/13B. |
| Zużycie karty SD w Raspberry Pi | awaria systemu | dysk SSD przez USB albo karta „High Endurance”, plus kopia zapasowa |
| Utrata pliku z kluczem danych logowania | utrata haseł (keyring KNX, TTLock) | ustaw `credentialSecret` (krok 6) i rób kopię całego katalogu danych |
| Zmiana API TTLock | możliwa niezgodność | testy + `tools/ttlock_test.py`. TTLock API v3 jest stabilne od lat. |
| Zamknięcie konta deweloperskiego TTLock | brak callbacków | loguj się na euopen.ttlock.com raz w roku i odpowiadaj na maile TTLock |
| Zegar komputera (brak NTP) | błędne filtrowanie wieku | serwis ostrzega przy różnicy > 2 min. NTP jest domyślnie włączone w Raspberry Pi OS / Debian. |

## Aktualizacje

**Nie aktualizuj Node-RED ani knx-ultimate automatycznie.** Nowe wersje główne mogą zmienić działanie.

Przetestowane wersje:

| Składnik | Wersja |
|---|---|
| Node-RED | 5.0.7 |
| node-red-contrib-knx-ultimate | 8.0.6 |
| Node.js | 22 |

Edytor nie jest wystawiony do internetu, więc brak aktualizacji nie jest ryzykiem bezpieczeństwa.

**Aktualizuj automatycznie system i tunel.**

- **Raspberry Pi / Debian (bez Dockera):** włącz automatyczne aktualizacje bezpieczeństwa:
  ```bash
  sudo apt install -y unattended-upgrades
  ```
  ```bash
  sudo dpkg-reconfigure -plow unattended-upgrades
  ```
  `cloudflared` i `tailscale` zainstalowane z ich repozytoriów apt aktualizują się razem z systemem, jeśli dodasz ich źródła do unattended-upgrades. Prościej jest raz w roku uruchomić:
  ```bash
  sudo apt update && sudo apt full-upgrade -y
  ```
- **Docker:** raz w miesiącu zaktualizuj tylko tunel (`crontab -e`, ścieżkę dostosuj do swojej):
  ```
  0 4 1 * * cd /opt/ttlock-knx/node-red && docker compose pull cloudflared && docker compose up -d cloudflared
  ```
- **Home Assistant:** w aplikacji Cloudflared włącz automatyczne aktualizacje. Node-RED aktualizuj świadomie, po przeczytaniu listy zmian.

**Świadoma aktualizacja Node-RED (np. co 1–2 lata):**
1. Zrób kopię zapasową (niżej).
2. Docker: zmień wersję w `docker-compose.yml`, uruchom `docker compose pull node-red && docker compose up -d node-red`. Pi: uruchom ponownie skrypt instalacyjny z kroku 5.
3. Kliknij wszystkie przyciski TEST i sprawdź log oraz reakcję KNX.
4. Jeśli coś nie działa, przywróć poprzednią wersję i kopię.

## Kopia zapasowa i odtworzenie

**Co kopiować:** cały katalog danych Node-RED, a nie tylko flow. Zawiera zaszyfrowane dane logowania (TTLock, keyring KNX) i klucz do nich.

| Instalacja | Katalog |
|---|---|
| Raspberry Pi / Debian | `~/.node-red/` |
| Docker | `node-red/data/` |
| Home Assistant | pełna kopia zapasowa HA (zawiera aplikację Node-RED) |

Dodatkowo zanotuj w dokumentacji obiektu:
- clientId, callback URL i sekret,
- lockId,
- dane tunelu lub DDNS,
- adresy grup.

Nie zapisuj tam haseł; trzymaj je w menedżerze haseł.

**Odtworzenie:**
1. Zainstaluj Node-RED jak w kroku 5.
2. Przywróć katalog danych.
3. Uruchom. Jeśli nie masz kopii: zaimportuj `flow-ttlock-knx.json`, ustaw konfigurację, interfejs KNX i zmienne zakładki.

## Coroczny przegląd (15 minut)

- [ ] Status węzła **Serwis TTLock** zielony, GA 7/4/1 = 1
- [ ] Otwarcie odciskiem → wyzwalacz osoby i scena działają, opóźnienie jak przy odbiorze
- [ ] Domena lub DDNS ważne, automatyczne odnowienie włączone
- [ ] Aktualizacje systemu wykonane, a `cloudflared` / `tailscale` nie starsze niż rok
- [ ] Kopia zapasowa aktualna
- [ ] Lista osób w ⚙ KONFIGURACJA zgodna z danymi dostępowymi w aplikacji SX
- [ ] Wolne miejsce na dysku > 20 % (`df -h`)
