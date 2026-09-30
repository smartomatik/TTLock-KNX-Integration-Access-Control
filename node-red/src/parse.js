// Odbiera callback TTLock "Lock Records Notify", filtruje i mapuje osobę na automatykę.
// Wyjścia: 1 = odpowiedź HTTP "success", 2 = scena KNX, 3 = tekst KNX,
//          4 = wyzwalacz osoby (msg.miejsce 1–10), 5 = log
// Wszystkie 61 typów z dokumentacji TTLock "Record type of cloud" (tylko do opisu w logu).
const TYPY = {
    1: 'aplikacja (eKey)', 4: 'kod PIN', 5: 'podniesienie (parking)', 6: 'opuszczenie (parking)',
    7: 'karta/brelok RFID', 8: 'odcisk palca', 9: 'opaska', 10: 'klucz mechaniczny',
    11: 'zamknięcie z aplikacji', 12: 'zdalnie przez bramkę', 29: 'otwarcie siłowe',
    30: 'czujnik drzwi: zamknięte', 31: 'czujnik drzwi: otwarte', 32: 'otwarcie od środka',
    33: 'zamknięcie odciskiem', 34: 'zamknięcie kodem', 35: 'zamknięcie kartą', 36: 'zamknięcie kluczem',
    37: 'sterowanie przyciskiem w aplikacji', 42: 'nowa poczta lokalna', 43: 'nowa poczta z innego miasta',
    44: 'sabotaż', 45: 'autozamykanie', 46: 'przycisk otwierania', 47: 'przycisk zamykania',
    48: 'blokada po błędnych próbach', 49: 'karta hotelowa', 50: 'otwarcie z powodu wysokiej temperatury',
    51: 'próba usuniętą kartą', 52: 'blokada (dead lock) z aplikacji', 53: 'blokada (dead lock) kodem',
    54: 'samochód wyjechał (parking)', 55: 'pilot', 57: 'kod QR', 58: 'kod QR wygasły – nieudane',
    59: 'podwójne zamknięcie', 60: 'anulowanie podwójnego zamknięcia', 61: 'zamknięcie kodem QR',
    62: 'kod QR – zamek podwójnie zamknięty', 63: 'autootwarcie (tryb przejścia)',
    64: 'alarm: drzwi niezamknięte', 65: 'nieudane otwarcie', 66: 'nieudane zamknięcie', 67: 'twarz',
    68: 'twarz – zamknięte od środka', 69: 'zamknięcie twarzą', 71: 'twarz – nieważna',
    75: 'udzielenie z aplikacji', 76: 'udzielenie zdalne',
    77: 'podwójna autoryzacja: Bluetooth – czeka na 2. osobę', 78: 'podwójna autoryzacja: kod – czeka na 2. osobę',
    79: 'podwójna autoryzacja: odcisk – czeka na 2. osobę', 80: 'podwójna autoryzacja: karta – czeka na 2. osobę',
    81: 'podwójna autoryzacja: twarz – czeka na 2. osobę', 82: 'podwójna autoryzacja: pilot – czeka na 2. osobę',
    83: 'podwójna autoryzacja: żyły dłoni – czeka na 2. osobę',
    84: 'żyły dłoni', 85: 'żyły dłoni', 86: 'zamknięcie żyłami dłoni', 88: 'żyły dłoni – nieważne',
    92: 'kod administratora',
};
// W tych rekordach keyboardPwd może zawierać prawdziwy PIN – zawsze maskowany w logu.
const TYPY_PIN = [4, 34, 53, 78, 92];
const MAKS_REKORDOW = 50;       // ochrona przed zalaniem dużym zapytaniem
const PAMIEC_DUPLIKATOW = 500;  // ile ostatnich rekordów pamiętać
const ZEGAR_TOLERANCJA_MS = 5 * 60000;     // do 5 min w przyszłości: bez uwag
const PRZYSZLOSC_MAKS_MS = 60 * 60000;     // ponad 1 h w przyszłości: rekord niewiarygodny

function bezOgonkow(t) {
    return String(t).replace(/ł/g, 'l').replace(/Ł/g, 'L')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // usuwa znaki diakrytyczne po NFD
}
function klucz(nazwa) {
    return bezOgonkow(String(nazwa).trim().split(/[\s\-_–—.,;:/]+/)[0] || '').toLowerCase();
}
function maskuj(r) {
    const kopia = Object.assign({}, r);
    if (TYPY_PIN.includes(Number(r.recordType)) && kopia.keyboardPwd) kopia.keyboardPwd = '****';
    return kopia;
}
function normalizujMac(m) {
    return String(m === undefined || m === null ? '' : m).toUpperCase().replace(/[^0-9A-F]/g, '');
}
function czytajRekordy(pole) {
    let v = pole;
    if (typeof v === 'string') v = JSON.parse(v);
    if (v && !Array.isArray(v) && typeof v === 'object') v = [v];
    return Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [];
}

// TTLock oczekuje odpowiedzi "success" – odpowiadamy ZAWSZE, także przy błędach,
// żeby chmura nie ponawiała wysyłki. Testy z przycisków nie mają msg.res.
const odpowiedz = msg.res ? { req: msg.req, res: msg.res, statusCode: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }, payload: 'success' } : null;

function przetworz() {
    const cfg = flow.get('config');
    if (!cfg) {
        node.warn('Brak poprawnej konfiguracji – popraw węzeł ⚙ KONFIGURACJA i kliknij Deploy.');
        return [odpowiedz, null, null, null, { payload: 'Brak konfiguracji – zdarzenie pominięte' }];
    }

    const body = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
    const lockId = String(body.lockId === undefined ? '' : body.lockId).trim();
    if (cfg.lockId && lockId !== cfg.lockId) {
        return [odpowiedz, null, null, null, { payload: `Obcy lockId "${lockId}" – zignorowano` }];
    }
    if (cfg.lockMac && normalizujMac(body.lockMac) !== cfg.lockMac) {
        return [odpowiedz, null, null, null, { payload: `Niezgodny lockMac "${body.lockMac || '(brak)'}" – zignorowano` }];
    }
    if (body.notifyType !== undefined && String(body.notifyType) !== '1') {
        return [odpowiedz, null, null, null, { payload: `notifyType=${body.notifyType} (to nie rekord otwarcia) – pominięto` }];
    }

    let rekordy;
    try {
        rekordy = czytajRekordy(body.records);
    } catch (e) {
        return [odpowiedz, null, null, null, { payload: 'Nieczytelne pole "records" – pominięto: ' + e.message }];
    }
    const logi = [];
    if (rekordy.length > MAKS_REKORDOW) {
        logi.push({ payload: `Za dużo rekordów (${rekordy.length}) – przetwarzam ostatnie ${MAKS_REKORDOW}` });
        rekordy = rekordy.slice(-MAKS_REKORDOW);
    }

    const wlaczona = flow.get('automatykaWlaczona') !== false;
    const widziane = flow.get('widziane') || [];
    const teraz = Date.now();
    const sceny = [], teksty = [], wyzwalacze = [];
    let ostatni = null;   // do statusu węzła
    // Tryb nauki: bez lockId zdarzenia z chmury tylko logujemy (przyciski TEST nie mają msg.res).
    const trybNauki = !cfg.lockId && !!msg.res;
    const uwagaLock = cfg.lockId ? ''
        : (msg.res ? ` | TRYB NAUKI: wpisz lockId '${lockId}' i lockMac '${body.lockMac || ''}' w KONFIGURACJI`
            : ' | TEST (lockId nieustawiony – zdarzenia z chmury tylko w logu)');

    for (const r of rekordy) {
        const typ = Number(r.recordType);
        const nazwa = String(r.username === undefined || r.username === null ? '' : r.username);
        const czasZamka = Number(r.lockDate);
        // Wiek liczony od czasu serwera TTLock – zegar czytnika może się rozjechać
        // (np. po zaniku zasilania), zegar serwera jest pewny.
        const czasSerwera = Number(r.serverDate) > 0 ? Number(r.serverDate) : czasZamka;
        const id = `${lockId}|${r.lockDate}|${typ}|${nazwa}`;
        const osobaKlucz = klucz(nazwa);
        const miejsce = osobaKlucz ? cfg.osoby.findIndex(o => o.klucz === osobaKlucz) + 1 : 0;
        const osoba = miejsce ? cfg.osoby[miejsce - 1] : null;
        const wiek = teraz - czasSerwera;
        let decyzja;

        if (!Number.isFinite(czasSerwera) || czasSerwera <= 0) decyzja = 'brak czasu w rekordzie – pominięto';
        else if (widziane.includes(id)) decyzja = 'duplikat – pominięto';
        else if (Number(r.success) !== 1) decyzja = 'nieudana próba – pominięto';
        else if (!cfg.typyPrzyjscia.includes(typ)) decyzja = 'ten typ nie uruchamia automatyki';
        else if (wiek > cfg.maksWiekMinut * 60000) decyzja = 'rekord zbyt stary – pominięto';
        else if (wiek < -PRZYSZLOSC_MAKS_MS) decyzja = 'czas rekordu ponad 1 h w przyszłości – niewiarygodny, pominięto';
        else if (!osoba) decyzja = `nieznana osoba "${osobaKlucz}" – dodaj ją w KONFIGURACJI`;
        else if (!wlaczona) decyzja = 'automatyka wyłączona z KNX – pominięto';
        else if (trybNauki) decyzja = `rozpoznano OSOBĘ ${miejsce}, ale TRYB NAUKI – KNX nie wysłany`;
        else {
            decyzja = `OSOBA ${miejsce} (7/3/${miejsce})` + (osoba.scena ? `, SCENA ${osoba.scena}` : '');
            if (osoba.scena) sceny.push({ payload: { save_recall: 0, scenenumber: osoba.scena }, osoba: osoba.nazwa });
            wyzwalacze.push({ payload: true, miejsce, osoba: osoba.nazwa });
            teksty.push({ payload: osoba.nazwa });   // oczyszczona do DPT 16 w KONFIGURACJI
        }
        if (Number.isFinite(czasSerwera) && czasSerwera > 0) widziane.push(id);
        if (wiek < -ZEGAR_TOLERANCJA_MS && wiek >= -PRZYSZLOSC_MAKS_MS) decyzja += ' | UWAGA: zegar komputera spóźnia się – sprawdź NTP';
        // recordTypeFromLock = co fizycznie zrobił zamek (może różnić się od typu z chmury) – do diagnostyki
        const zZamka = r.recordTypeFromLock !== undefined && r.recordTypeFromLock !== null ? ` (zamek: ${r.recordTypeFromLock})` : '';

        const czas = Number.isFinite(czasZamka) && czasZamka > 0
            ? new Date(czasZamka).toLocaleString('pl-PL') : '(brak czasu)';
        const opoznienie = Number.isFinite(wiek) ? `${(wiek / 1000).toFixed(1)} s` : '?';
        ostatni = { nazwa, decyzja };
        logi.push({
            payload: `${czas} | ${TYPY[typ] || 'typ ' + typ}${zZamka} | "${nazwa}" | ${decyzja} | opóźnienie ${opoznienie}${uwagaLock}`,
            rekord: maskuj(r),
        });
    }
    flow.set('widziane', widziane.slice(-PAMIEC_DUPLIKATOW));
    if (rekordy.length) flow.set('ostatniCallback', teraz);

    if (ostatni) {
        node.status({ fill: wyzwalacze.length ? 'green' : 'grey', shape: 'dot',
            text: `"${ostatni.nazwa}": ${ostatni.decyzja}`.substring(0, 60) });
    }
    return [odpowiedz, sceny, teksty, wyzwalacze, logi];
}

try {
    return przetworz();
} catch (e) {
    node.error('Błąd przetwarzania callbacku: ' + e.message);
    node.status({ fill: 'red', shape: 'ring', text: 'błąd: ' + String(e.message).substring(0, 50) });
    return [odpowiedz, null, null, null, { payload: 'BŁĄD przetwarzania: ' + e.message }];
}
