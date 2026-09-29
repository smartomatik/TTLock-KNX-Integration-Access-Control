# Instrukcja instalacji krok po kroku (Node-RED)

Czas pracy to około 2–3 godziny, nie licząc oczekiwania na zatwierdzenie konta deweloperskiego TTLock (kilka dni roboczych, więc złóż wniosek najpierw).

**Spis kroków**

| Etap | Kroki |
|---|---|
| A. Przygotowanie (biuro) | 1 Konto deweloperskie · 2 Nazwy w aplikacji · 3 Test API |
| B. ETS | 4 Adresy grup i sceny |
| C. Node-RED (obiekt) | 5 Instalacja · 6 Hasło · 7 knx-ultimate · 8 Import flow · 9 Interfejs KNX · 10 Konfiguracja osób · 11 Test lokalny |
| D. Połączenie z chmurą | 12 Sekretny adres · 13 Cloudflare Tunnel · 14 Callback URL w TTLock · 15 Test z drzwi |
| E. Przekazanie | 16 Obsługa na co dzień · 17 Rozwiązywanie problemów |

---

## Czego potrzebujesz

- [ ] Czytnik **UL** zamontowany i działający w aplikacji SX
- [ ] **Bramka** (SX Wi-Fi lub TTLock G2/G6) w zasięgu Bluetooth czytnika, widoczna w aplikacji
- [ ] Login i hasło **administratora** zamka (konto w aplikacji SX)
- [ ] Komputer 24/7 w sieci LAN obiektu, np. Raspberry Pi 4/5 (2 GB+), NAS z Dockerem albo mini PC z Linuxem
- [ ] **Interfejs KNX IP** z wolnym tunelem, najlepiej KNX IP Secure (np. MDT SCN-IP100.03, Weinzierl 732)
- [ ] Projekt **ETS** obiektu
- [ ] Konto **Cloudflare** (darmowe) z domeną, np. klienta lub instalatora

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

### Krok 3 – Test API i odczyt lockId
Instrukcja jest w [TEST-API.md](TEST-API.md). W skrócie:
```bash
python3 tools/ttlock_test.py records
```
```bash
python3 tools/ttlock_test.py records <lockId>
```
Otwórz drzwi odciskiem, uruchom drugie polecenie i sprawdź, czy przy rekordzie widać nazwę, np. `'Anna - kciuk'`. Zapisz **lockId**.

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
4. Zrestartuj Node-RED:
   - Opcja A: `sudo systemctl restart nodered`
   - Opcja B: `docker restart node-red`

### Krok 7 – Instalacja węzłów KNX
W edytorze: **Menu (☰) → Manage palette → Install** → wpisz `node-red-contrib-knx-ultimate` → **Install**.

### Krok 8 – Import flow
1. **Menu (☰) → Import → select a file to import** → wybierz `node-red/flow-ttlock-knx.json`.
2. Kliknij **Import**. Pojawi się zakładka **TTLock → KNX**.
3. Kliknij **Deploy** (czerwony przycisk w prawym górnym rogu).

Flow składa się z sześciu części:

| Część | Co robi |
|---|---|
| ① KONFIGURACJA | 10 miejsc na osoby, sceny, lockId |
| ② Callback TTLock | odbiera zdarzenia z chmury i odpowiada `success` |
| ③ Wyjścia KNX | scena (7/1/0) i tekst (7/2/0) |
| ④ Automatyka wł./wył. | nasłuchuje GA 7/4/0 |
| ⑤ Testy | przyciski symulujące otwarcie drzwi |
| ⑥ Wyzwalacze osób | 10 węzłów KNX „Osoba N otworzyła” (7/3/1 … 7/3/10) |

### Krok 9 – Interfejs KNX IP
1. Kliknij dwukrotnie węzeł **Scena przyjścia (7/1/0)**, a następnie ołówek przy **Gateway: Interfejs KNX IP**.
2. Ustaw:
   - **IP** interfejsu KNX IP, np. `192.168.1.50`
   - **Port** `3671`
   - **Protokół:** `TunnelUDP`, a przy KNX Secure `TunnelTCP`
   - **Interfejs sieciowy:** zwykle `Auto`
3. **KNX Secure:** w zakładce Secure wskaż plik keyringu `.knxkeys`, podaj hasło i wybierz adres tunelu.
4. Sprawdź adresy grup w węzłach KNX: scena 7/1/0, tekst 7/2/0, automatyka 7/4/0 i 10 wyzwalaczy 7/3/1 … 7/3/10. Jeśli w ETS używasz innych adresów, popraw je tutaj. Nieużywane wyzwalacze możesz zostawić, bo bez przypisanej osoby nic nie wysyłają.
   - Możesz też zaimportować adresy z ETS w węźle gateway (ETS CSV).
5. Kliknij **Deploy**. Pod węzłami KNX powinien pojawić się zielony status połączenia.

### Krok 10 – Konfiguracja osób
Kliknij dwukrotnie węzeł **⚙ KONFIGURACJA** i zmień tylko sekcję `config`:
```js
lockId: '1234567',            // z kroku 3; puste '' = każdy zamek (tylko do testów)
maksWiekMinut: 5,             // starsze rekordy nie uruchomią automatyki
typyPrzyjscia: [8, 4, 7, 55], // odcisk, PIN, karta, pilot
osoby: [
    /*  1 → 7/3/1  */ { klucz: 'anna',   nazwa: 'Anna',     scena: 1 },
    /*  2 → 7/3/2  */ { klucz: 'piotr',  nazwa: 'Piotr',    scena: 2 },
    /*  3 → 7/3/3  */ { klucz: 'lukasz', nazwa: 'Lukasz',   scena: 3 },
    /*  4 → 7/3/4  */ { klucz: '',       nazwa: 'Osoba 4',  scena: 4 },
    // … aż do miejsca 10
],
```
- **Miejsce** (1–10) to kolejność na liście. Decyduje, który wyzwalacz 7/3/n dostanie `1`.
- **klucz** to pierwsze słowo nazwy z aplikacji, małymi literami, bez polskich znaków. Pusty `''` oznacza wolne miejsce.
- **nazwa** to tekst na KNX, maks. 14 znaków. Polskie znaki są zamieniane automatycznie, bo DPT 16.001 ich nie obsługuje.
- **scena** to numer sceny jak w ETS. Domyślnie równa numerowi miejsca. `0` oznacza tylko wyzwalacz, bez sceny.
- Kilka danych dostępowych tej samej osoby (np. odcisk i brelok) uruchamia to samo, jeśli nazwy zaczynają się tym samym słowem.
- Typ **1** (aplikacja) i **12** (zdalnie przez bramkę) dodaj dopiero po teście z kroku 15, bo nie zawsze wysyłają callback.

Kliknij **Done**, a następnie **Deploy**. Pod węzłem pojawi się np. „3/10 osób, zamek 1234567”.

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

### Krok 13 – Cloudflare Tunnel (stały adres HTTPS, bez otwierania portów)
TTLock wymaga publicznego adresu `https://` na porcie 443 z ważnym certyfikatem. Cloudflare Tunnel zapewnia go bez przekierowania portów na routerze.

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

### Krok 14 – Callback URL w TTLock
1. **https://euopen.ttlock.com/manager** → Twoja aplikacja → szczegóły → **Callback URL**:
   `https://drzwi.twojadomena.pl/ttlock/<twój-sekret>`
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

Na koniec wpisz **lockId** w KONFIGURACJI (jeśli jeszcze go nie ma) i kliknij **Deploy**.

---

## E. Przekazanie klientowi

### Krok 16 – Obsługa na co dzień
| Zadanie | Jak |
|---|---|
| Nowa osoba (maks. 10) | W aplikacji SX dodaj odcisk lub kartę z nazwą `Imię - opis`. W ⚙ KONFIGURACJA wpisz `klucz` i `nazwa` w wolnym miejscu i kliknij Deploy. W ETS zaprogramuj scenę lub logikę dla jej wyzwalacza 7/3/n. |
| Usunięcie osoby | Usuń odcisk lub kartę w aplikacji i ustaw `klucz: ''` w jej miejscu. |
| Urlop, goście, sprzątanie | Wyłącz automatykę przyciskiem lub w wizualizacji (GA 7/4/0). |
| Kopia zapasowa | Menu → Export → All flows → zapisz plik JSON. |

**Token administratora:** token TTLock jest ważny 90 dni. Nie wiadomo, czy callbacki działają po jego wygaśnięciu (do sprawdzenia na obiekcie). Na wszelki wypadek co ~2 miesiące uruchom `python3 tools/ttlock_test.py records`, co odnawia logowanie.

### Krok 17 – Rozwiązywanie problemów
| Objaw | Przyczyna / rozwiązanie |
|---|---|
| Nic nie przychodzi w Debug po otwarciu drzwi | Sprawdź po kolei: bramka online w aplikacji? Rekord widoczny w aplikacji? Callback URL zapisany w euopen? Administrator zalogowany Twoim clientId (krok 3)? Czy inna integracja nie przejęła callbacków? |
| `curl` na adres zwraca 404 | Ścieżka w węźle „Callback TTLock” różni się od adresu, albo reguła Path w Cloudflare jest błędna. |
| `nieznana osoba "xyz"` | Dodaj klucz `xyz` w KONFIGURACJI albo popraw nazwę w aplikacji. |
| `rekord zbyt stary` | Bramka była offline i wysłała zaległe zdarzenia. To zamierzone zachowanie. Zwiększ `maksWiekMinut`, jeśli trzeba. |
| `automatyka wyłączona z KNX` | GA 7/4/0 = 0. Włącz automatykę. |
| Węzły KNX czerwone lub „disconnected” | Zły adres IP lub protokół interfejsu, brak wolnego tunelu, albo błąd keyringu przy Secure. |
| Scena przychodzi, ale nic się nie dzieje | Obiekty scen aktorów nie są połączone z 7/1/0 albo numer sceny w aktorze jest inny. |
| Ta sama osoba dwa razy – scena tylko raz | Zamierzone, jeśli to ten sam rekord (duplikat z chmury). Różne otwarcia działają zawsze. |

---

## Bezpieczeństwo – zasady

- **Tylko zamek → KNX.** Nie dodawaj do tego flow żadnej funkcji otwierającej drzwi.
- **Nie rozbrajaj alarmu** na podstawie otwarcia. Co najwyżej wyślij powiadomienie. Dotyczy to też kodów przekazywanych dalej i otwarć siłowych.
- Edytor Node-RED **tylko z hasłem** (krok 6) i **niedostępny z internetu** (reguła Path w kroku 13).
- **Sekret w adresie** traktuj jak hasło.
- **RODO:** w domu prywatnym ma zastosowanie wyłączenie domowe. W wynajmie, biurze lub przy zatrudnionych osobach (sprzątanie, opieka) właściciel staje się administratorem danych: potrzebna jest informacja dla osób, ograniczony czas przechowywania i minimalizacja danych. Na KNX wysyłaj tylko imiona. Log Node-RED nie zawiera kodów PIN, bo są maskowane.
