# Raport wykonalności: kto otworzył drzwi? Automatyka KNX zależna od osoby (czytnik UL, platforma TTLock)

*Stan wiedzy: wrzesień 2026. Źródła: dokumentacja TTLock Open Platform, instrukcja API SX (TTLock Cloud API v3), kod źródłowy integracji hass-ttlock, dokumentacja Home Assistant i producentów KNX.*

## Werdykt

**Tak, integracja jest wykonalna** przez callback chmury TTLock *Lock Records Notify*. Matter nie identyfikuje osoby, a natywnej integracji z KNX nie ma.

| | |
|---|---|
| **Skąd tożsamość** | Bramka przesyła każdy rekord otwarcia do chmury TTLock EU, a chmura wysyła go metodą POST na Twój adres HTTPS. Przy odcisku, PIN-ie i karcie pole `username` zawiera **nazwę nadaną tym danym w aplikacji SX**, np. „Anna – kciuk”. Przy aplikacji/eKey jest to nazwa konta. |
| **Most do KNX** | Node-RED z węzłami knx-ultimate na małym komputerze w obiekcie oraz interfejs KNX IP (najlepiej Secure). Odbiera callback, mapuje osobę na wyzwalacz i scenę, zapisuje adresy grup. |
| **Warunki konieczne** | Bramka (SX Wi-Fi lub TTLock G2/G6) w zasięgu Bluetooth czytnika. Zatwierdzona aplikacja TTLock Open Platform (darmowa). Publiczny adres HTTPS na porcie 443. |
| **Opóźnienie** | TTLock określa je jako „quasi-real-time”, bez podanej wartości. Oczekuj kilku sekund. **Zmierz na obiekcie**, zanim obiecasz klientowi „światło w chwili otwarcia”. |
| **Koszt sprzętu (orientacyjnie)** | ok. 450–600 € plus robocizna: komputer 100–150 €, interfejs KNX IP Secure 180–280 €, publiczny adres HTTPS za darmo (Cloudflare Tunnel lub Tailscale Funnel), bramka (jeśli jej brak). |

---

## 1. Czym jest czytnik UL

Czytnik UL 2.0 to **czytnik dostępu**, a nie zamek z ryglem:
- na zewnątrz: odcisk palca, klawiatura i RFID,
- wewnątrz: osobny moduł przekaźnika (1 A / 30 V), który steruje elektrozaczepem lub zamkiem silnikowym,
- zasilanie 12/24 V DC, więc bez ograniczeń bateryjnych,
- pojemność: 100 odcisków, 150 kodów, 200+ kart/breloków, 5 pilotów, dowolna liczba eKey.

System SX działa na platformie TTLock. Instrukcja API SX to TTLock Cloud API v3, a wszystkie endpointy są na `euapi.ttlock.com`. Konta aplikacji SX są przechowywane w chmurze TTLock EU. Dane rekordów są przechowywane w chmurze przez 6 miesięcy, a producent nie deklaruje gwarancji jakości (QoS) dla interfejsu.

**Wniosek:** stan „zamknięte/otwarte” ma tu mniejsze znaczenie. Użytecznym zdarzeniem jest **rekord otwarcia** (kto i jak), i dokładnie ten rekord dostarcza callback.

---

## 2. Architektura

```
Czytnik UL ─BLE─► Bramka ─Wi-Fi─► Chmura TTLock EU ─HTTPS POST─► Cloudflare Tunnel / Tailscale Funnel / przekierowanie portów ─► Node-RED ─KNX IP Secure─► KNX
```

Kierunek jest **tylko zamek → KNX**. Nic po stronie KNX nie może otwierać drzwi.

---

## 3. Zawartość callbacku

TTLock wysyła `application/x-www-form-urlencoded` z polami:
- `notifyType`, `lockId`, `lockMac`, `admin`,
- `records`: **tekst JSON** z listą rekordów.

Przykład rzeczywisty (otwarcie kartą):
```
lockId=7252408  notifyType=1  lockMac=16:72:4C:CC:01:C4
records=[{"lockId":7252408,"recordType":7,"recordTypeFromLock":17,
          "success":1,"username":"Jonas","keyboardPwd":"<nr karty>",
          "lockDate":1680810186000,"serverDate":1680810180029,
          "electricQuantity":93}]
```

**Identyfikacja osoby**
- **Odcisk, PIN, karta:** `username` to nazwa danych dostępowych w aplikacji.
- **Aplikacja / eKey / zdalnie:** `username` to konto TTLock/SX.
- Stabilny klucz można uzyskać, mapując `keyboardPwd` (numer odcisku lub karty) przez `/v3/fingerprint/list` i `/v3/identityCard/list`.

**Ostrożnie z danymi**
- Przy kodzie PIN pole `keyboardPwd` **to prawdziwy kod**. Nie wolno go logować ani wysyłać na KNX.
- Callback może przyjść dwa razy. Usuwaj duplikaty po `lockDate + recordType`.
- Brak callbacku dla autozamykania i zmian danych dostępowych.

### Typy rekordów (tylko `success = 1`)

| Kod | Znaczenie | Uruchamia automatykę? |
|---|---|---|
| 8 | odcisk palca | tak |
| 4 | kod PIN | tak (kod wspólny identyfikuje kod, a nie osobę) |
| 7 | karta / brelok RFID | tak |
| 55 | pilot | tak |
| 1 | aplikacja (eKey Bluetooth) | do sprawdzenia: może przyjść z opóźnieniem albo wcale |
| 12 | zdalnie przez bramkę | opcjonalnie: osoba może nie stać przy drzwiach |
| 32 | otwarcie od środka | nie |
| 10 | klucz mechaniczny | nie (brak tożsamości) |
| 29 / 44 / 48 | otwarcie siłowe / sabotaż / blokada | tylko alarm lub powiadomienie |

---

## 4. Warunki działania callbacku

- **Bramka jest obowiązkowa.** Bez niej chmura nie dostaje rekordów na bieżąco i nie wysyła callbacku.
- **Administrator zamka musi mieć token dla Twojego clientId.** Wystarczy logowanie OAuth (password grant) istniejącym loginem z aplikacji SX, z hasłem jako MD5. Konto deweloperskie nie może posiadać zamków.
- **Jeden callback URL na aplikację deweloperską.** Jeśli administrator ma tokeny dwóch aplikacji, callbacki trafiają do tej z dłużej ważnym tokenem. Istniejąca integracja (np. Home Assistant) albo inny instalator może więc „przejąć” zdarzenia.
- **Zatwierdzenie jest ręczne.** Rejestracja na `euopen.ttlock.com`, status „Under Review” trwa kilka dni roboczych. Callback URL da się ustawić dopiero po zatwierdzeniu. Brak środowiska testowego.
- **Wymagania adresu:** `https://`, publiczna domena, port 443 lub 80, ważny certyfikat. Odpowiedź powinna zawierać tekst `success`.
- **Darmowy plan:** 30 000 wywołań API miesięcznie na aplikację. Callbacki przychodzące się nie liczą, więc rozwiązanie oparte na callbackach prawie nie zużywa limitu.
- **Otwarcia z aplikacji:** według opiekuna integracji hass-ttlock webhooki przychodzą tylko przy fizycznych zdarzeniach na zamku. Typ 1 traktuj jako niepotwierdzony do czasu testu.

---

## 5. Dlaczego nie Matter (bramka G6)

**Matter poda „otwarto odciskiem”, ale nigdy „otworzyła Anna”.**
- Zdarzenie Matter `LockOperation` może zawierać indeks użytkownika, ale Home Assistant odczytuje tylko źródło operacji (klawiatura, RFID, biometria…). Propozycja zmiany została odrzucona.
- Jedyny certyfikowany produkt Matter TTLock (moduł Wi-Fi SN8102) ma wyłączone logowanie zdarzeń.
- Raporty z G6 opisują podstawowe otwieranie i zamykanie z wolną aktualizacją stanu.

G6 nadal dobrze sprawdza się jako **bramka** dla callbacku w chmurze. Nie opieraj jednak identyfikacji na Matter.

---

## 6. Porównanie rozwiązań po stronie KNX

| Rozwiązanie | Koszt ok. | Odbiór callbacku TTLock | KNX Secure | Ocena |
|---|---|---|---|---|
| **Node-RED + knx-ultimate** | 0 € + komputer | tak (węzeł http in) | IP + Data Secure | **wybrane – najprostsze dla instalatora** |
| Home Assistant + integracja KNX | 0 € + komputer | tak (webhook) | IP + Data Secure przez keyring ETS | dobre, jeśli klient i tak chce HA |
| Własny skrypt (Python + xknx) | 0 € + komputer | tak | IP + Data Secure | najlżejsze, ale wymaga programisty do zmian |
| Timberwolf Server 3500 | ~725–1250 € | tak (serwer REST), potrzebny reverse proxy | natywne KNX TP | profesjonalne jedno urządzenie |
| Enertex EibPC² + NP | ~830 € | tak, własne parsowanie HTTP | – | tylko dla programistów |
| Gira X1 / HomeServer 4 | ~800 / ~2200 € | nie bezpośrednio, potrzebny pośrednik | Gira | tylko jeśli już jest na obiekcie |
| Loxone + KNX Extension | ~1240 € netto | tylko parametry w URL, potrzebny pośrednik | – | tylko na obiektach Loxone |
| Weinzierl BAOS 777 | ~390 € | tylko cel REST, bez logiki | – | element składowy |
| JUNG Smart Visu, Hager domovea, Theben, Siemens IPCC | 500–900 €+ | brak udokumentowanego webhooka | różnie | nieodpowiednie |
| openHAB KNX | 0 € | osobna obsługa HTTP | brak zapisu Data Secure | unikać przy Data Secure |

Interfejsy KNX IP:
- MDT SCN-IP100.03 (IP + Data Secure): ≈ 258–282 €
- Weinzierl 732 secure
- Weinzierl 731 (≈ 177 €) **nie** obsługuje Secure.

Na GitHubie nie ma gotowego rozwiązania TTLock → KNX. Istnieją tylko integracje Home Assistant (hass-ttlock, HASS-TTlock-Connect), biblioteki API TTLock, projekty lokalnego Bluetooth oraz ogólne mosty KNX ↔ MQTT.

---

## 7. Wybrane rozwiązanie

Node-RED z gotowym flow z tego repozytorium. Szczegóły w [INSTRUKCJA-NODE-RED.md](INSTRUKCJA-NODE-RED.md).
- Obsługa **do 10 osób**.
- Każda osoba ma **własny wyzwalacz** KNX (7/3/1 … 7/3/10, DPT 1.001) i **własną scenę** (7/1/0, DPT 18.001).
- Imię trafia na adres tekstowy (7/2/0, DPT 16.001).
- Automatykę można wyłączyć z KNX (7/4/0).

| GA | DPT | Funkcja |
|---|---|---|
| 7/1/0 | 18.001 | Scena przyjścia (numer sceny osoby) |
| 7/2/0 | 16.001 | „Ostatnio otworzył” (14 znaków) |
| 7/3/1 … 7/3/10 | 1.001 | Wyzwalacz osoby 1 … 10 |
| 7/4/0 | 1.001 | Automatyka wł./wył. (urlop, goście, sprzątanie) |

---

## 8. Bezpieczeństwo i RODO

**Drzwi i alarm**
- Nie może istnieć żadna ścieżka z KNX do „otwórz drzwi”. Zwykłe KNX TP nie ma uwierzytelniania, więc każdy z dostępem do magistrali mógłby wstrzyknąć telegram.
- Nie rozbrajaj alarmu automatycznie po otwarciu. Zamiast tego skróć czas wejścia lub wyślij powiadomienie, albo użyj certyfikowanej integracji dostępu w centrali alarmowej.
- Sprawdzaj `lockId`, stosuj długi losowy sekret w adresie i nigdy nie reaguj na typ 10 ani 29.

**RODO**
- W prywatnym domu ma zastosowanie wyłączenie domowe, choć interpretowane wąsko.
- W wynajmie, biurze lub przy osobach zatrudnionych (sprzątanie, opieka) właściciel staje się administratorem danych. Potrzebna jest informacja dla osób, ograniczenie czasu przechowywania i minimalizacja danych.
- Na KNX wysyłaj tylko imiona, ogranicz historię i nigdy nie zapisuj kodów PIN.

---

## 9. Lista kontrolna pilotażu (przed wyceną)

- [ ] Opóźnienie od odcisku do sceny KNX przez bramkę (cel: poniżej 5 s)
- [ ] Czy `username` jest wypełnione dla odcisku i karty na obecnym firmware czytnika UL i jakie `recordType` wysyła moduł przekaźnika
- [ ] Czy otwarcie z aplikacji (eKey) wysyła callback przy podłączonej bramce
- [ ] Czy logowanie administratora z aplikacji SX działa na `euapi.ttlock.com` z własnym clientId (dokumentacja to sugeruje, ale nie zostało to przetestowane)
- [ ] Czy inna integracja nie ma już tokenu administratora i nie przejmie callbacków
- [ ] Czy callbacki działają po wygaśnięciu 90-dniowego tokenu administratora
- [ ] Zachowanie bez internetu lub chmury TTLock: drzwi działają, ale automatyka się nie uruchomi. Poinformuj o tym klienta z góry.

**Zależność od chmury.** Tożsamość przychodzi przez chmurę TTLock bez gwarancji jakości. Istnieje lokalna alternatywa Bluetooth (`ha-ttlock-ble` przez ESPHome Bluetooth proxy), ale ma ograniczenia:
- nie była testowana z UL,
- nie identyfikuje użytkowników PIN,
- może konkurować z bramką o połączenie Bluetooth.

Traktuj ją jako eksperyment w drugim etapie.

---

## Źródła

- TTLock Lock Records Notify: https://euopen.ttlock.com/document/doc?urlName=cloud%2FlockRecord%2FnotifyEn.html
- TTLock FAQ: https://euopen.ttlock.com/documentPages/htmlPages/example/FAQEn.html
- Typy rekordów: https://euopen.ttlock.com/documentPages/htmlPages/cloud/lockRecord/recordTypeFromCloudEn.html
- lockRecord/list: https://euopen.ttlock.com/document/doc?urlName=cloud%2FlockRecord%2FlistEn.html
- OAuth token: https://euopen.ttlock.com/document/doc?urlName=cloud%2Foauth2%2FgetAccessTokenEn.html
- Pierwsze kroki: https://euopen.ttlock.com/documentPages/htmlPages/userGuide/getStartedEn.html
- Instrukcja API SX (TTLock Cloud API v3, wersja 1.0, 10/2022) – dokument producenta
- hass-ttlock: https://github.com/jbergler/hass-ttlock (webhook.py, models.py, sensor.py; issue #154)
- HASS-TTlock-Connect: https://github.com/jotaccf/HASS-TTlock-Connect
- ha-ttlock-ble: https://github.com/roquerodrigo/ha-ttlock-ble
- Matter i indeks użytkownika w HA: https://github.com/orgs/home-assistant/discussions/2611
- Lista Matter TTLock: https://matter-survey.org/device/sn8102-wifi-module-5450-33026
- node-red-contrib-knx-ultimate: https://github.com/Supergiovane/node-red-contrib-knx-ultimate
- Home Assistant KNX: https://www.home-assistant.io/integrations/knx/
- Timberwolf HTTP-API: https://elabnet.atlassian.net/wiki/spaces/TSKB/pages/1861615701
- openHAB KNX: https://www.openhab.org/addons/bindings/knx/
- MDT SCN-IP100.03: https://geizhals.at/mdt-ip-router-scn-ip100-03-a2684436.html
- Gira IoT REST API: https://partner.gira.de/data3/Gira_IoT_REST_API_v2_EN.pdf
