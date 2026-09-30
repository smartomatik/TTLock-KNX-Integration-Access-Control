# Instrukcja instalacji krok po kroku (Node-RED)

Czas pracy to około 2–3 godziny, nie licząc oczekiwania na zatwierdzenie konta deweloperskiego TTLock (kilka dni roboczych, więc złóż wniosek najpierw).

**Spis kroków**

| Etap | Kroki |
|---|---|
| A. Przygotowanie (biuro) | 1 Konto deweloperskie · 2 Nazwy w aplikacji · 3 Test API |
| B. ETS | 4 Adresy grup i sceny |
| C. Node-RED (obiekt) | 5 Instalacja (Raspberry Pi / Docker / Home Assistant) · 6 Hasło · 7 knx-ultimate · 8 Import flow · 9 Interfejs KNX · 10 Konfiguracja osób · 10a Serwis (dane TTLock) · 11 Test lokalny |
| D. Połączenie z chmurą | 12 Sekretny adres · 13 Publiczny adres HTTPS (Cloudflare / Tailscale / przekierowanie portów) · 14 Callback URL w TTLock · 15 Test z drzwi |
| E. Przekazanie | 16 Obsługa na co dzień · 17 Rozwiązywanie problemów |

---

## Czego potrzebujesz

- [ ] Czytnik **UL** zamontowany i działający w aplikacji SX
- [ ] **Bramka** (SX Wi-Fi lub TTLock G2/G6) w zasięgu Bluetooth czytnika, widoczna w aplikacji
- [ ] Login i hasło **administratora** zamka (konto w aplikacji SX)
- [ ] Komputer 24/7 w sieci LAN obiektu, np. Raspberry Pi 4/5 (2 GB+), NAS z Dockerem albo mini PC z Linuxem
- [ ] **Interfejs KNX IP** z wolnym tunelem, najlepiej KNX IP Secure (np. MDT SCN-IP100.03, Weinzierl 732)
- [ ] Projekt **ETS** obiektu
- [ ] Jeden sposób na publiczny adres HTTPS (krok 13):
  - darmowe konto **Cloudflare** z domeną, **albo**
  - darmowe konto **Tailscale** (bez domeny), **albo**
  - publiczny adres IPv4 z możliwością przekierowania portów w routerze

---

## A. Przygotowanie (można zrobić w biurze)

### Krok 1 – Konto deweloperskie TTLock
1. Zarejestruj się na **https://euopen.ttlock.com/register**. To konto dewelopera, osobne od konta w aplikacji.
2. Zaloguj się i wybierz **Create application**. Podaj nazwę, np. „KNX Dom Kowalskich”.
3. Aplikacja ma status *Under Review*. Zatwierdzenie jest ręczne i trwa kilka dni roboczych.
4. Po zatwierdzeniu zapisz **clientId** i **clientSecret**.

### Krok 2 – Nazwy odcisków, kart i kodów w aplikacji SX
Scena jest wybierana po **pierwszym słowie** nazwy, więc nazwy muszą zaczynać się od imienia:

| Dobrze | Źle |
|---|---|
| `Anna - kciuk prawy` | `Kciuk Anny` |
| `Anna - brelok` | `Brelok 1` |
| `Piotr kod` | `Kod główny` |
| `Łukasz - palec wskazujący` | `Palec ŁK` |

Wielkość liter i polskie znaki nie mają znaczenia: `Łukasz` zostanie dopasowany do klucza `lukasz`.
Kod PIN wspólny dla kilku osób identyfikuje kod, a nie osobę. Każda osoba powinna mieć własny kod.

**Nie nazywaj kodu PIN samym kodem** (np. `1234`). Numer PIN jest w logach maskowany, ale **nazwa** trafia do logu i na KNX bez zmian.

### Krok 3 – Test API i odczyt lockId
Instrukcja jest w [TEST-API.md](TEST-API.md). W skrócie:
```bash
python3 tools/ttlock_test.py records
```
```bash
python3 tools/ttlock_test.py records <lockId>
```
Otwórz drzwi odciskiem, uruchom drugie polecenie i sprawdź, czy przy rekordzie widać nazwę, np. `'Anna - kciuk'`. Zapisz **lockId** i **lockMac**. Pierwsze polecenie pokazuje oba.

> ⚠️ Logowanie kontem administratora powoduje, że **callbacki tego zamka trafiają do Twojej aplikacji deweloperskiej**. Jeśli klient ma już inną integrację TTLock (np. Home Assistant), może ona przestać otrzymywać zdarzenia.

---

## B. ETS

### Krok 4 – Adresy grup i sceny
Flow obsługuje **do 10 osób**. Gdy osoba otworzy drzwi, Node-RED wysyła jednocześnie:
- **wyzwalacz tej osoby**: wartość `1` na jej własny adres 7/3/1 … 7/3/10,
- **numer jej sceny** na wspólny adres 7/1/0,
- **jej imię** na adres tekstowy 7/2/0.

Automatykę możesz więc uruchomić na dwa sposoby. Wybierz ten, który pasuje do obiektu, albo użyj obu.

| Sposób | Kiedy | Jak w ETS |
|---|---|---|
| **A. Wyzwalacz osoby** (7/3/n) | Dowolna automatyka: logika, moduł czasowy, sekwencja, warunek „tylko po zmroku”, powiadomienie | Połącz 7/3/n z wejściem bloku logicznego, obiektem sceny, przyciskiem wirtualnym itp. |
| **B. Numer sceny** (7/1/0) | Proste sceny w aktorach | Połącz 7/1/0 z obiektami scen wszystkich aktorów i zaprogramuj w nich sceny 1–10 |

Utwórz adresy grup (propozycja, grupa główna 7 = Dostęp/Obecność):

| GA | Typ (DPT) | Funkcja |
|---|---|---|
| **7/1/0** | 18.001 (sterowanie sceną) | Scena przyjścia. Numer sceny = osoby (domyślnie osoba 1 → scena 1 … osoba 10 → scena 10). |
| **7/2/0** | 16.001 (tekst 14 znaków) | „Ostatnio otworzył”, do wizualizacji lub panelu dotykowego |
| **7/3/1 … 7/3/10** | 1.001 (przełącznik) | **Wyzwalacz osoby 1 … 10**: `1` przy każdym otwarciu przez tę osobę |
| **7/4/0** | 1.001 (przełącznik) | Automatyka wł./wył. (urlop, goście, sprzątanie). **Ustaw flagę odczytu (R)** na jednym obiekcie, aby Node-RED mógł odczytać stan po starcie. |
| **7/4/1** | 1.001 (przełącznik) | **Integracja OK**: `1` sprawna, `0` awaria (bramka offline, złe hasło, brak internetu). Wysyłane co 6 h, patrz krok 10a. Pokaż na wizualizacji lub użyj do powiadomienia. |

Przykład:

| Miejsce | Osoba | Wyzwalacz | Scena | Co się dzieje |
|---|---|---|---|---|
| 1 | Anna | 7/3/1 | 1 | salon 60 %, rolety w górę, ogrzewanie tryb Komfort |
| 2 | Piotr | 7/3/2 | 2 | gabinet 100 %, kuchnia 40 % |
| 3 | Łukasz | 7/3/3 | 3 | pokój dziecka, korytarz 30 % |

Następnie:
1. Zaprogramuj automatykę w ETS: sceny w aktorach (sposób B) i/lub logikę podpiętą pod 7/3/n (sposób A).
2. Numer sceny w Node-RED jest **taki sam jak w ETS** (1–64).
3. Wyzwalacz wysyła zawsze `1`, bez `0`. Logika powinna reagować na **odebranie 1**, a nie na zmianę wartości.
4. Zarezerwuj tunel w interfejsie KNX IP dla Node-RED.
5. **KNX Secure:** wyeksportuj keyring: *ETS → Projekt → Eksportuj keyring* (plik `.knxkeys` i hasło). Adres tunelu Node-RED i wszystkie adresy 7/x/x muszą być w keyringu.

---

## C. Node-RED (na obiekcie)

### Krok 5 – Instalacja Node-RED
Wybierz jedną opcję.

**Opcja A – Raspberry Pi / Debian / Ubuntu (najprościej)**
```bash
bash <(curl -sL https://github.com/node-red/linux-installers/releases/latest/download/update-nodejs-and-nodered-deb)
```
Na pytania odpowiedz `y`. Następnie włącz autostart:
```bash
sudo systemctl enable --now nodered.service
```

**Opcja B – Docker (NAS, serwer)**
Skopiuj katalog `node-red/` z tego repozytorium na serwer:
```bash
mkdir -p data && sudo chown 1000:1000 data
```
```bash
docker compose up -d node-red
```
Kontener działa w sieci hosta (`network_mode: host`), bo KNX IP (UDP) działa tak najpewniej.

Edytor otworzysz pod adresem **http://IP-komputera:1880**.

**Opcja C – Home Assistant (aplikacja / dodatek Node-RED)**
Wybierz tę opcję, jeśli klient ma już Home Assistant OS lub Supervised. Flow jest taki sam i nie wymaga zmian w kodzie. Różnice opisuje sekcja [Wariant: Node-RED w Home Assistant](#wariant-node-red-w-home-assistant) poniżej. Przeczytaj ją przed krokiem 6.

#### Wariant: Node-RED w Home Assistant

**Instalacja**
1. **Ustawienia → Aplikacje** (w starszych wersjach: *Dodatki*) → **Sklep** → wyszukaj **Node-RED** (Home Assistant Community Apps) → **Zainstaluj**.
2. Zakładka **Konfiguracja** aplikacji:
   - **`ssl: false`**. Domyślnie jest `true`, a bez plików `fullchain.pem` i `privkey.pem` w folderze `/ssl/` aplikacja się nie uruchomi. Szyfrowanie z internetu i tak zapewnia tunel lub proxy z kroku 13.
   - **`credential_secret`**: wpisz długie hasło i **nigdy go nie zmieniaj**, bo zapisane dane logowania (np. hasło keyringu KNX) przestaną działać.
   - **`http_node`**: zostaw **puste** (username i password). TTLock nie potrafi się logować, a callback chroni sekret w adresie.
   - **`npm_packages`**: dodaj `node-red-contrib-knx-ultimate`. Możesz też pominąć to i zrobić krok 7 przez paletę.
   - Sekcja **Sieć**: port **1880** musi być ustawiony (bezpośredni dostęp). Bez niego callback z zewnątrz nie dotrze do Node-RED.
3. Zapisz, uruchom aplikację, sprawdź **Dziennik** i włącz **Pokaż na pasku bocznym**.

**Różnice w dalszych krokach**

| Krok | Co inaczej w Home Assistant |
|---|---|
| 6 Hasło | **Pomiń.** Edytor jest chroniony logowaniem Home Assistant. |
| 7 knx-ultimate | Bez zmian, chyba że dodałeś pakiet w `npm_packages`. |
| 8 Import flow | Bez zmian. Edytor otwierasz z paska bocznego HA. |
| 9 Interfejs KNX | Bez zmian, bo aplikacja działa w sieci hosta. Plik keyringu wczytaj w oknie węzła gateway. Jeśli Home Assistant ma też własną integrację KNX, interfejs KNX IP potrzebuje **dwóch wolnych tuneli** (jeden dla HA, jeden dla Node-RED). |
| 12 Sekretny adres | Ścieżka w węźle zostaje `/ttlock/<twój-sekret>`, ale aplikacja dodaje przed nią **`/endpoint`**. Pełny adres w sieci lokalnej: `http://<IP-HA>:1880/endpoint/ttlock/<twój-sekret>` |
| 13 Publiczny adres | Patrz tabela poniżej. **Nabu Casa nie zadziała**, bo przekazuje tylko webhooki samego Home Assistant, a nie ścieżki Node-RED. |
| 14 Callback URL | Adres zawiera `/endpoint`, np. `https://drzwi.twojadomena.pl/endpoint/ttlock/<twój-sekret>` |

**Test lokalny adresu** (z dowolnego komputera w sieci obiektu). Odpowiedź musi brzmieć `success`:
```bash
curl -X POST http://<IP-HA>:1880/endpoint/ttlock/<twój-sekret> -d "lockId=1&notifyType=1&records=[]"
```

**Publiczny adres (krok 13) przy Home Assistant**

| Instalacja HA | Zalecany wariant | Ustawienia |
|---|---|---|
| **Home Assistant OS** (np. HA Green/Yellow, Raspberry Pi z HA OS) | **13A Cloudflare Tunnel przez aplikację Cloudflared** | Opis poniżej |
| Home Assistant OS | 13B / 13C | Nie da się ich zainstalować obok HA OS w zwykły sposób. Aplikacja Tailscale w HA udostępnia przez Funnel tylko interfejs HA, a nie Node-RED. Możliwe tylko z **innego komputera z Linuxem** w sieci: Tailscale `--set-path=/endpoint/ttlock http://<IP-HA>:1880/endpoint/ttlock` albo Caddy `handle /endpoint/ttlock/* { reverse_proxy <IP-HA>:1880 }` |
| **Home Assistant Supervised** (Debian) | 13A, 13B lub 13C na tym samym komputerze | Jak w kroku 13, ale z prefiksem `/endpoint`, np. Tailscale `--set-path=/endpoint/ttlock http://127.0.0.1:1880/endpoint/ttlock`, Caddy `handle /endpoint/ttlock/*` |

**13A w Home Assistant OS – aplikacja Cloudflared**
1. W panelu Cloudflare utwórz tunel (krok 13A, pkt 1) i skopiuj **token** tunelu.
2. W Home Assistant dodaj repozytorium aplikacji Cloudflared: **Ustawienia → Aplikacje → Sklep → ⋮ → Repozytoria** → `https://github.com/homeassistant-apps/app-cloudflared`. Zainstaluj aplikację **Cloudflared**.
3. W konfiguracji aplikacji wpisz token w opcji **`tunnel_token`** i uruchom ją. Z tokenem aplikacja ignoruje pozostałe opcje, a trasy ustawiasz tylko w panelu Cloudflare.
4. W panelu Cloudflare dodaj **Public hostname**:
   - **Path:** `^/endpoint/ttlock/.*`
   - **Service:** `HTTP` → `<IP-HA>:1880`

   Nie dodawaj reguły dla całego Home Assistant, chyba że klient tego chce.
5. Test z zewnątrz (dane komórkowe):
   - `https://drzwi.twojadomena.pl/` → **404** ✔
   - callback:
     ```bash
     curl -X POST https://drzwi.twojadomena.pl/endpoint/ttlock/<twój-sekret> -d "lockId=1&notifyType=1&records=[]"
     ```
     Odpowiedź: `success` ✔

Twój adres callbacku: `https://drzwi.twojadomena.pl/endpoint/ttlock/<twój-sekret>`

### Krok 6 – Hasło do edytora (obowiązkowo)
1. Wygeneruj skrót hasła:
   - Opcja A: `node-red admin hash-pw`
   - Opcja B: `docker exec -it node-red node-red admin hash-pw`
2. Otwórz plik `settings.js`:
   - Opcja A: `~/.node-red/settings.js`
   - Opcja B: `data/settings.js`
3. Znajdź sekcję `adminAuth`, odkomentuj ją i wklej skrót:
   ```js
   adminAuth: {
       type: "credentials",
       users: [{ username: "admin", password: "WKLEJ_SKRÓT_TUTAJ", permissions: "*" }]
   },
   ```
4. W tym samym pliku ustaw **klucz szyfrowania danych logowania**. Bez niego Node-RED tworzy klucz losowo w ukrytym pliku, a jego utrata oznacza utratę zapisanych haseł (TTLock, keyring KNX). Wygeneruj klucz (`openssl rand -hex 24`) i wpisz:
   ```js
   credentialSecret: "WKLEJ_WYGENEROWANY_KLUCZ",
   ```
   Zapisz go w menedżerze haseł i **nigdy go nie zmieniaj**.
5. Zrestartuj Node-RED:
   - Opcja A: `sudo systemctl restart nodered`
   - Opcja B: `docker restart node-red`

### Krok 7 – Instalacja węzłów KNX
W edytorze: **Menu (☰) → Manage palette → Install** → wpisz `node-red-contrib-knx-ultimate` → **Install**.

### Krok 8 – Import flow
1. **Menu (☰) → Import → select a file to import** → wybierz `node-red/flow-ttlock-knx.json`.
2. Kliknij **Import**. Pojawi się zakładka **TTLock → KNX**.
3. Kliknij **Deploy** (czerwony przycisk w prawym górnym rogu).

Flow składa się z siedmiu części:

| Część | Co robi |
|---|---|
| ① KONFIGURACJA | 10 miejsc na osoby, sceny, lockId. Błędna konfiguracja jest odrzucana (czerwony status). |
| ② Callback TTLock | odbiera zdarzenia z chmury i zawsze odpowiada `success` |
| ③ Wyjścia KNX | scena (7/1/0) i tekst (7/2/0) |
| ④ Automatyka wł./wył. | nasłuchuje GA 7/4/0 |
| ⑤ Testy | przyciski symulujące otwarcie drzwi |
| ⑥ Wyzwalacze osób | 10 węzłów KNX „Osoba N otworzyła” (7/3/1 … 7/3/10) |
| ⑦ Serwis | co 6 h: odświeżenie tokenu TTLock, kontrola bramki i zegara → „Integracja OK” (7/4/1). Dodatkowo „Log błędów” zbiera wszystkie błędy zakładki. |

Ponowny import nowszej wersji flow **zastępuje** istniejącą zakładkę, bo węzły mają stałe identyfikatory. Przed importem skopiuj swoją listę osób z ⚙ KONFIGURACJA i wklej ją z powrotem po imporcie.

### Krok 9 – Interfejs KNX IP
1. Kliknij dwukrotnie węzeł **Scena przyjścia (7/1/0)**, a następnie ołówek przy **Gateway: Interfejs KNX IP**.
2. Ustaw:
   - **IP** interfejsu KNX IP, np. `192.168.1.50`
   - **Port** `3671`
   - **Protokół:** `TunnelUDP`, a przy KNX Secure `TunnelTCP`
   - **Interfejs sieciowy:** zwykle `Auto`
3. **KNX Secure:** w zakładce Secure wskaż plik keyringu `.knxkeys`, podaj hasło i wybierz adres tunelu.
4. Sprawdź adresy grup w węzłach KNX: scena 7/1/0, tekst 7/2/0, automatyka 7/4/0, integracja OK 7/4/1 i 10 wyzwalaczy 7/3/1 … 7/3/10. Jeśli w ETS używasz innych adresów, popraw je tutaj. Nieużywane wyzwalacze możesz zostawić, bo bez przypisanej osoby nic nie wysyłają.
   - Możesz też zaimportować adresy z ETS w węźle gateway (ETS CSV).
5. Kliknij **Deploy**. Pod węzłami KNX powinien pojawić się zielony status połączenia.

### Krok 10 – Konfiguracja osób
Kliknij dwukrotnie węzeł **⚙ KONFIGURACJA** i zmień tylko sekcję `config`:
```js
lockId: '1234567',            // z kroku 3; puste '' = TRYB NAUKI (zdarzenia z chmury tylko w logu)
lockMac: 'C5:40:E0:9C:8C:C1', // z kroku 3; drugie zabezpieczenie; puste '' = bez sprawdzania
maksWiekMinut: 5,             // starsze rekordy nie uruchomią automatyki
typyPrzyjscia: [8, 4, 7, 55], // odcisk, PIN, karta, pilot (dozwolone też 1, 9, 12, 49, 57, 67, 75, 76, 84, 85, 92)
osoby: [
    /*  1 → 7/3/1  */ { klucz: 'anna',   nazwa: 'Anna',     scena: 1 },
    /*  2 → 7/3/2  */ { klucz: 'piotr',  nazwa: 'Piotr',    scena: 2 },
    /*  3 → 7/3/3  */ { klucz: 'lukasz', nazwa: 'Lukasz',   scena: 3 },
    /*  4 → 7/3/4  */ { klucz: '',       nazwa: 'Osoba 4',  scena: 4 },
    // … aż do miejsca 10
],
```
- **lockId puste = tryb nauki.** Zdarzenia z chmury są tylko zapisywane w logu razem z lockId i lockMac do skopiowania. KNX nic nie dostaje. Przyciski TEST działają zawsze.
- **lockMac:** callback TTLock nie ma podpisu, więc jego fałszywą wersję może wysłać każdy, kto zna adres. Sprawdzenie lockId i lockMac (oraz sekret w adresie) sprawia, że działają tylko zdarzenia Twojego czytnika. Wielkość liter i separatory nie mają znaczenia.
- **typyPrzyjscia** przyjmuje tylko udane otwarcia. Konfiguracja odrzuci np. 32 (od środka), nieudane próby, alarmy i **77–83 (podwójna autoryzacja: pierwsza osoba zweryfikowana, drzwi nadal zamknięte)**.
- **Miejsce** (1–10) to kolejność na liście. Decyduje, który wyzwalacz 7/3/n dostanie `1`.
- **klucz** to pierwsze słowo nazwy z aplikacji, małymi literami, bez polskich znaków. Pusty `''` oznacza wolne miejsce.
- **nazwa** to tekst na KNX, maks. 14 znaków. Polskie znaki są zamieniane automatycznie, bo DPT 16.001 ich nie obsługuje.
- **scena** to numer sceny jak w ETS. Domyślnie równa numerowi miejsca. `0` oznacza tylko wyzwalacz, bez sceny.
- Kilka danych dostępowych tej samej osoby (np. odcisk i brelok) uruchamia to samo, jeśli nazwy zaczynają się tym samym słowem.
- Typ **1** (aplikacja) i **12** (zdalnie przez bramkę) dodaj dopiero po teście z kroku 15, bo nie zawsze wysyłają callback.

Kliknij **Done**, a następnie **Deploy**. Pod węzłem pojawi się np. „3/10 osób, zamek 1234567”.
Jeśli status jest **czerwony**, konfiguracja zawiera błąd (np. scena 70, powtórzony klucz, litery w lockId). Opis błędu jest w statusie i w panelu Debug. Do czasu poprawki działa poprzednia poprawna konfiguracja.

### Krok 10a – Dane TTLock dla serwisu (zalecane przy pracy wieloletniej)
Serwis (część ⑦) co 6 godzin:
- loguje się do TTLock i **odświeża token administratora**, więc callbacki nie wygasają,
- sprawdza, czy bramka widzi czytnik,
- kontroluje zegar komputera.

Wynik wysyła na **GA 7/4/1 „Integracja OK”**. Bez tych danych serwis jest wyłączony (żółty status) i token trzeba odnawiać ręcznie skryptem co ~2 miesiące.

1. Kliknij dwukrotnie **nazwę zakładki „TTLock → KNX”** u góry edytora.
2. W sekcji **Environment Variables** (Zmienne środowiskowe) są cztery pozycje typu *credential*. Uzupełnij je:

| Zmienna | Wartość |
|---|---|
| `TTLOCK_CLIENT_ID` | clientId z kroku 1 |
| `TTLOCK_CLIENT_SECRET` | clientSecret z kroku 1 |
| `TTLOCK_USER` | login administratora zamka (aplikacja SX) |
| `TTLOCK_PASS` | hasło administratora zamka |

3. Kliknij **Done**, a następnie **Deploy**. Po ok. minucie węzeł **Serwis TTLock** pokaże np. „OK: token ważny 90 dni | bramka -62 dBm”.

Wartości typu *credential* są przechowywane zaszyfrowane (plik `flows_cred.json`). Nie trafiają do eksportu flow ani do kopii `flows.json`.

**Zmiana hasła administratora** w aplikacji SX wymaga wpisania nowego hasła tutaj. Do tego czasu 7/4/1 = 0.

W ETS połącz **7/4/1** (DPT 1.001) z wizualizacją lub logiką alarmową, np. komunikat „Integracja drzwi – sprawdź” przy wartości `0`. Wartość `0` pojawia się dopiero po dwóch kolejnych nieudanych kontrolach (ok. 12 h), więc krótka przerwa internetu nie alarmuje.

### Krok 11 – Test lokalny (bez zamka)
1. Otwórz panel **Debug** (ikona 🐞 po prawej).
2. Kliknij kwadratowe przyciski po lewej stronie przy węzłach testowych:

| Przycisk | Oczekiwany wynik w Debug | Na KNX |
|---|---|---|
| TEST: odcisk palca „Anna” | `odcisk palca \| "Anna - kciuk" \| OSOBA 1 (7/3/1), SCENA 1` | 7/3/1 = 1, scena 1, tekst „Anna” |
| TEST: kod PIN „Piotr” | `kod PIN \| "Piotr kod" \| OSOBA 2 (7/3/2), SCENA 2` | 7/3/2 = 1, scena 2, tekst „Piotr” |
| TEST: otwarcie od środka | `ten typ nie uruchamia sceny` | nic |
| TEST: nieznany brelok | `nieznana osoba "gosc"` | nic |

3. Sprawdź w monitorze grup ETS lub na obiekcie, że scena się wykonała.

> Jeśli lockId jest już ustawiony, testy używają go automatycznie.

---

## D. Połączenie z chmurą TTLock

### Krok 12 – Sekretny adres
Adres callbacku zawiera losowy sekret, który chroni przed fałszywymi wywołaniami. Wygeneruj go:
```bash
openssl rand -hex 16
```
Kliknij dwukrotnie węzeł **Callback TTLock (POST)** i zmień URL z `/ttlock/zmien-ten-sekret` na `/ttlock/<twój-sekret>`. Kliknij **Deploy**.

### Krok 13 – Publiczny adres HTTPS (wybierz jeden wariant)
TTLock wymaga publicznego adresu `https://` na porcie 443 z ważnym certyfikatem. Flow Node-RED jest taki sam we wszystkich wariantach. Zmienia się tylko sposób udostępnienia adresu.

| Wariant | Kiedy wybrać | Potrzebne | Zmiany w routerze |
|---|---|---|---|
| **13A Cloudflare Tunnel** | Ty lub klient macie domenę w Cloudflare | Darmowe konto Cloudflare i domena | brak |
| **13B Tailscale Funnel** | Brak domeny, najmniej kroków | Darmowe konto Tailscale | brak |
| **13C Przekierowanie portów** | Klient nie chce zewnętrznych usług tunelowych | Publiczny adres IPv4, DDNS, reverse proxy z certyfikatem | porty 80 i 443 |

We wszystkich wariantach **na zewnątrz ma być widoczna tylko ścieżka `/ttlock/…`**. Edytor Node-RED (port 1880) nigdy nie może być dostępny z internetu.

#### 13A – Cloudflare Tunnel

1. Zaloguj się na **dash.cloudflare.com** (domena musi być w Cloudflare) → **Zero Trust → Networks → Tunnels** → **Create a tunnel** → **Cloudflared** → nazwa, np. `dom-kowalskich`.
2. Zainstaluj konektor. Cloudflare pokaże polecenie z tokenem.
   - **Raspberry Pi / Debian:** wybierz Debian i architekturę (arm64 dla Pi 4/5), a potem skopiuj oba polecenia (instalacja i `sudo cloudflared service install <TOKEN>`).
   - **Docker:** skopiuj sam token do pliku `node-red/.env` (wzór w `.env.example`) i uruchom:
     ```bash
     docker compose up -d cloudflared
     ```
3. Dodaj **Public hostname** (w nowszym panelu: *Published application routes*):
   - **Subdomain:** `drzwi`, **Domain:** `twojadomena.pl`
   - **Path:** `^/ttlock/.*` ← **ważne**: bez tego udostępnisz w internecie cały edytor Node-RED
   - **Service:** `HTTP` → `localhost:1880`
4. Sprawdź z telefonu na danych komórkowych (poza siecią obiektu):
   - `https://drzwi.twojadomena.pl/` → **404** (edytor niewidoczny ✔)
   - test callbacku z dowolnego komputera:
     ```bash
     curl -X POST https://drzwi.twojadomena.pl/ttlock/<twój-sekret> -d "lockId=1&notifyType=1&records=[]"
     ```
     Odpowiedź: `success` ✔

Twój adres callbacku: `https://drzwi.twojadomena.pl/ttlock/<twój-sekret>`

#### 13B – Tailscale Funnel (bez domeny i bez zmian w routerze)
Tailscale Funnel udostępnia wybraną ścieżkę z komputera pod stałym adresem `https://<nazwa>.<twoja-sieć>.ts.net`. Certyfikat HTTPS jest tworzony automatycznie. Funnel jest dostępny w darmowym planie Personal.

1. Załóż konto na **https://login.tailscale.com** (logowanie np. kontem Google lub Microsoft).
2. Na Raspberry Pi lub serwerze z Node-RED zainstaluj Tailscale:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   ```
   ```bash
   sudo tailscale up
   ```
   Otwórz wyświetlony link i zaloguj się, aby dodać urządzenie do swojej sieci Tailscale.
   - **Docker:** zainstaluj Tailscale na komputerze-gospodarzu (nie w kontenerze). Node-RED działa w sieci hosta, więc jest dostępny pod `127.0.0.1:1880`. Usługi `cloudflared` nie uruchamiaj.
3. Nadaj urządzeniu czytelną nazwę (będzie częścią adresu):
   ```bash
   sudo tailscale set --hostname=dom-kowalskich
   ```
4. Udostępnij **tylko ścieżkę `/ttlock`**:
   ```bash
   sudo tailscale funnel --bg --set-path=/ttlock http://127.0.0.1:1880/ttlock
   ```
   Przy pierwszym uruchomieniu polecenie wyświetli link do włączenia Funnel, HTTPS i MagicDNS w panelu Tailscale. Otwórz go, zatwierdź i uruchom polecenie ponownie.
5. Sprawdź adres i konfigurację:
   ```bash
   tailscale funnel status
   ```
   Adres ma postać `https://dom-kowalskich.tail1234.ts.net`. Nowy adres może potrzebować do 10 minut, zanim zacznie działać w DNS.
6. **Wyłącz wygasanie klucza urządzenia.** Domyślnie urządzenie wylogowuje się po 180 dniach i Funnel przestaje działać. W panelu **login.tailscale.com → Machines → dom-kowalskich → ⋯ → Disable key expiry**.
7. Sprawdź z telefonu na danych komórkowych lub z komputera spoza sieci obiektu:
   - `https://dom-kowalskich.tail1234.ts.net/` → brak strony lub błąd (edytor niewidoczny ✔)
   - test callbacku:
     ```bash
     curl -X POST https://dom-kowalskich.tail1234.ts.net/ttlock/<twój-sekret> -d "lockId=1&notifyType=1&records=[]"
     ```
     Odpowiedź: `success` ✔
   - **Jeśli dostajesz 404**, Tailscale mógł przekazać ścieżkę bez prefiksu. Usuń regułę i dodaj ją bez `/ttlock` na końcu celu, a potem powtórz test:
     ```bash
     sudo tailscale funnel reset
     ```
     ```bash
     sudo tailscale funnel --bg --set-path=/ttlock http://127.0.0.1:1880
     ```

Twój adres callbacku: `https://dom-kowalskich.tail1234.ts.net/ttlock/<twój-sekret>`

Wyłączenie Funnel w razie potrzeby: `sudo tailscale funnel reset`.

#### 13C – Przekierowanie portów na routerze (bez usług zewnętrznych)
Wymaga więcej pracy i otwartych portów w routerze klienta. Wybierz ten wariant tylko wtedy, gdy klient nie zgadza się na Cloudflare ani Tailscale.

**1. Sprawdź, czy łącze ma publiczny adres IPv4.**
Porównaj adres WAN w panelu routera z adresem pokazanym przez https://ifconfig.me (otwórz go z komputera w sieci obiektu).
- **Adresy są takie same:** można kontynuować.
- **Adresy różnią się**, albo adres WAN zaczyna się od `100.64.`–`100.127.`, `10.`, `172.16.`–`172.31.` lub `192.168.`: łącze jest za CGNAT i przekierowanie **nie zadziała**. Poproś operatora o publiczny adres IP (często płatny) albo wybierz 13A lub 13B.

**2. Stały adres IP komputera z Node-RED.**
W routerze ustaw rezerwację DHCP (stały adres), np. `192.168.1.20`.

**3. Nazwa domenowa (DDNS).**
Publiczny adres domowy zwykle się zmienia, więc potrzebna jest nazwa, która za nim podąża.
- Wbudowane DDNS w routerze, np. MyFRITZ!, ASUS DDNS, TP-Link DDNS, jeśli jest dostępne.
- Albo darmowe **DuckDNS**:
  1. Zaloguj się na https://www.duckdns.org i utwórz nazwę, np. `dom-kowalskich` → adres `dom-kowalskich.duckdns.org`.
  2. Na komputerze z Node-RED dodaj automatyczną aktualizację co 5 minut (`crontab -e`) i wklej jedną linię z Twoim tokenem z DuckDNS:
     ```
     */5 * * * * curl -s "https://www.duckdns.org/update?domains=dom-kowalskich&token=TWOJ-TOKEN&ip=" >/dev/null
     ```

**4. Reverse proxy z automatycznym certyfikatem (Caddy).**
Caddy sam pobiera i odnawia certyfikat Let's Encrypt.
1. Zainstaluj Caddy:
   ```bash
   sudo apt install -y caddy
   ```
2. Otwórz plik `/etc/caddy/Caddyfile`, zastąp całą zawartość poniższą i wpisz swoją nazwę domeny:
   ```
   dom-kowalskich.duckdns.org {
       handle /ttlock/* {
           reverse_proxy 127.0.0.1:1880
       }
       respond 404
   }
   ```
   Tylko ścieżka `/ttlock/…` trafia do Node-RED. Wszystko inne zwraca 404.
3. Przeładuj Caddy:
   ```bash
   sudo systemctl reload caddy
   ```
- **Docker:** zainstaluj Caddy na komputerze-gospodarzu tak samo. Usługi `cloudflared` nie uruchamiaj.

**5. Przekierowanie portów w routerze.**
Przekieruj do komputera z Node-RED (np. `192.168.1.20`):

| Port zewnętrzny | Port wewnętrzny | Protokół | Po co |
|---|---|---|---|
| 443 | 443 | TCP | HTTPS dla TTLock |
| 80 | 80 | TCP | wydawanie i odnawianie certyfikatu Let's Encrypt |

**Nigdy nie przekierowuj portu 1880** (edytor Node-RED).

**6. Test** z telefonu na danych komórkowych (poza siecią obiektu):
- `https://dom-kowalskich.duckdns.org/` → **404** ✔
- test callbacku:
  ```bash
  curl -X POST https://dom-kowalskich.duckdns.org/ttlock/<twój-sekret> -d "lockId=1&notifyType=1&records=[]"
  ```
  Odpowiedź: `success` ✔

Twój adres callbacku: `https://dom-kowalskich.duckdns.org/ttlock/<twój-sekret>`

Utrzymanie: aktualizuj system komputera (`sudo apt update && sudo apt upgrade`), bo port 443 jest otwarty na internet. Jeśli operator zmieni adres na CGNAT, przejdź na wariant 13A lub 13B.

### Krok 14 – Callback URL w TTLock
1. **https://euopen.ttlock.com/manager** → Twoja aplikacja → szczegóły → **Callback URL**: wklej adres z kroku 13, np.:
   - 13A: `https://drzwi.twojadomena.pl/ttlock/<twój-sekret>`
   - 13B: `https://dom-kowalskich.tail1234.ts.net/ttlock/<twój-sekret>`
   - 13C: `https://dom-kowalskich.duckdns.org/ttlock/<twój-sekret>`
2. Zapisz.
3. Upewnij się, że administrator zamka zalogował się przez Twój clientId (krok 3). Bez tego chmura nie wyśle zdarzeń.

### Krok 15 – Test z drzwi
Otwórz drzwi po kolei odciskiem, kartą, kodem i z aplikacji. W panelu Debug powinny pojawić się wpisy, np.:
```
29.09.2026, 18:42:07 | odcisk palca | "Anna - kciuk" | OSOBA 1 (7/3/1), SCENA 1 | opóźnienie 3.4 s
```
Zapisz:
- **opóźnienie** dla każdego typu otwarcia. To wartość, którą podajesz klientowi.
- czy otwarcie z aplikacji (typ 1) w ogóle przychodzi. Jeśli tak i ma uruchamiać scenę, dodaj `1` do `typyPrzyjscia`.
- czy przy karcie i kodzie pojawia się nazwa.

Jeśli **lockId** jest jeszcze puste (tryb nauki), log pokaże przy każdym zdarzeniu: `TRYB NAUKI: wpisz lockId '…' i lockMac '…' w KONFIGURACJI`. Skopiuj obie wartości do ⚙ KONFIGURACJA i kliknij **Deploy**. Dopiero wtedy zdarzenia z drzwi uruchamiają KNX.

---

## E. Przekazanie klientowi

### Krok 16 – Obsługa na co dzień
| Zadanie | Jak |
|---|---|
| Nowa osoba (maks. 10) | W aplikacji SX dodaj odcisk lub kartę z nazwą `Imię - opis`. W ⚙ KONFIGURACJA wpisz `klucz` i `nazwa` w wolnym miejscu i kliknij Deploy. W ETS zaprogramuj scenę lub logikę dla jej wyzwalacza 7/3/n. |
| Usunięcie osoby | Usuń odcisk lub kartę w aplikacji i ustaw `klucz: ''` w jej miejscu. |
| Urlop, goście, sprzątanie | Wyłącz automatykę przyciskiem lub w wizualizacji (GA 7/4/0). |
| Kopia zapasowa | Skopiuj **cały katalog danych** Node-RED, bo zawiera zaszyfrowane hasła i klucz. Szczegóły w [UTRZYMANIE.md](UTRZYMANIE.md). |

**Token administratora:** token TTLock jest ważny 90 dni. Serwis (krok 10a) odnawia go automatycznie co 6 h. Jeśli serwis nie jest skonfigurowany, co ~2 miesiące uruchom `python3 tools/ttlock_test.py records`.

**Praca wieloletnia:** plan utrzymania, kopie zapasowe, aktualizacje i coroczny przegląd są w [UTRZYMANIE.md](UTRZYMANIE.md).

### Krok 17 – Rozwiązywanie problemów
| Objaw | Przyczyna / rozwiązanie |
|---|---|
| Nic nie przychodzi w Debug po otwarciu drzwi | Sprawdź po kolei: bramka online w aplikacji? Rekord widoczny w aplikacji? Callback URL zapisany w euopen? Administrator zalogowany Twoim clientId (krok 3)? Czy inna integracja nie przejęła callbacków? |
| `curl` na adres zwraca 404 | Ścieżka w węźle „Callback TTLock” różni się od adresu. Albo błędna reguła: Path w Cloudflare (13A), cel `--set-path` w Tailscale (13B, patrz wariant zapasowy) lub blok `handle` w Caddyfile (13C). |
| Home Assistant: adres zwraca stronę logowania HA, 401 albo nie odpowiada | Brak prefiksu `/endpoint` w adresie albo nieustawiony port 1880 w sekcji Sieć aplikacji Node-RED. |
| Home Assistant: aplikacja Node-RED nie startuje | `ssl: true` bez plików certyfikatu w `/ssl/`. Ustaw `ssl: false`. |
| Tailscale: adres przestał działać po kilku miesiącach | Wygasł klucz urządzenia. Zaloguj ponownie (`sudo tailscale up`) i wyłącz wygasanie klucza (13B, pkt 6). |
| Przekierowanie portów: brak certyfikatu lub przekroczony czas połączenia | Port 80/443 nie jest przekierowany, DDNS wskazuje stary adres albo łącze jest za CGNAT (13C, pkt 1). |
| `nieznana osoba "xyz"` | Dodaj klucz `xyz` w KONFIGURACJI albo popraw nazwę w aplikacji. |
| `rekord zbyt stary` | Bramka była offline i wysłała zaległe zdarzenia. To zamierzone zachowanie. Zwiększ `maksWiekMinut`, jeśli trzeba. |
| `automatyka wyłączona z KNX` | GA 7/4/0 = 0. Włącz automatykę. |
| Serwis: żółty „wyłączony” | Brak danych TTLock w zmiennych zakładki (krok 10a). |
| Serwis: „logowanie TTLock nieudane” | Błędny clientId lub clientSecret, albo administrator zmienił hasło w aplikacji. Popraw w kroku 10a. |
| Serwis: „żadna bramka nie widzi czytnika” | Bramka bez zasilania lub Wi-Fi, albo za daleko od czytnika. Sprawdź w aplikacji SX. |
| Serwis: „zegar komputera różni się” | Brak synchronizacji czasu (NTP). Na Pi/Debian: `timedatectl` powinien pokazać „System clock synchronized: yes”. |
| Węzeł Serwis TTLock: błąd modułu (`crypto`/`https`) | W `settings.js` ustawiono `functionExternalModules: false`. Zmień na `true` i zrestartuj Node-RED. |
| Log: `TRYB NAUKI – KNX nie wysłany` | lockId nieustawiony. Wpisz lockId i lockMac z logu do ⚙ KONFIGURACJA (krok 10). |
| Log: `Niezgodny lockMac` | lockMac w konfiguracji różni się od MAC czytnika. Popraw lub wyczyść `lockMac`. |
| Log: `czas rekordu ponad 1 h w przyszłości` | Zegar serwera lub komputera jest bardzo rozjechany, albo zdarzenie jest fałszywe. Sprawdź NTP (`timedatectl`). |
| Czerwony status ⚙ KONFIGURACJA | Błąd w konfiguracji (opis w statusie i w Debug). Działa poprzednia poprawna konfiguracja. |
| Węzły KNX czerwone lub „disconnected” | Zły adres IP lub protokół interfejsu, brak wolnego tunelu, albo błąd keyringu przy Secure. |
| Scena przychodzi, ale nic się nie dzieje | Obiekty scen aktorów nie są połączone z 7/1/0 albo numer sceny w aktorze jest inny. |
| Ta sama osoba dwa razy – scena tylko raz | Zamierzone, jeśli to ten sam rekord (duplikat z chmury). Różne otwarcia działają zawsze. |

---

## Bezpieczeństwo – zasady

- **Tylko zamek → KNX.** Nie dodawaj do tego flow żadnej funkcji otwierającej drzwi.
- **Nie rozbrajaj alarmu** na podstawie otwarcia. Co najwyżej wyślij powiadomienie. Dotyczy to też kodów przekazywanych dalej i otwarć siłowych.
- Edytor Node-RED **tylko z hasłem** (krok 6) i **niedostępny z internetu** (tylko ścieżka `/ttlock/…` jest publiczna – krok 13).
- **Sekret w adresie** traktuj jak hasło. Callback TTLock nie ma podpisu ani tokenu, więc ochronę tworzą razem: sekret w adresie, **lockId** i **lockMac** (krok 10).
- **RODO:** w domu prywatnym ma zastosowanie wyłączenie domowe. W wynajmie, biurze lub przy zatrudnionych osobach (sprzątanie, opieka) właściciel staje się administratorem danych: potrzebna jest informacja dla osób, ograniczony czas przechowywania i minimalizacja danych. Na KNX wysyłaj tylko imiona. Log Node-RED nie zawiera kodów PIN, bo są maskowane.
