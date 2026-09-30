// Odbiera callback TTLock "Lock Records Notify", filtruje i mapuje osobę na automatykę.
// Wyjścia: 1 = odpowiedź HTTP "success", 2 = scena KNX, 3 = tekst KNX,
//          4 = wyzwalacz osoby (msg.miejsce 1–10), 5 = log
const TYPY = {
    1: 'aplikacja (eKey)', 4: 'kod PIN', 7: 'karta/brelok RFID', 8: 'odcisk palca',
    10: 'klucz mechaniczny', 11: 'zamknięcie z aplikacji', 12: 'zdalnie przez bramkę',
    29: 'otwarcie siłowe', 32: 'otwarcie od środka', 44: 'sabotaż', 45: 'autozamykanie',
    46: 'przycisk otwierania', 48: 'blokada po błędnych próbach', 55: 'pilot',
    65: 'nieudane otwarcie', 92: 'kod administratora',
};
const TYPY_PIN = [4, 34, 92];   // w tych rekordach keyboardPwd zawiera prawdziwy PIN
const MAKS_REKORDOW = 50;       // ochrona przed zalaniem dużym zapytaniem
const PAMIEC_DUPLIKATOW = 500;  // ile ostatnich rekordów pamiętać
const ZEGAR_TOLERANCJA_MS = 5 * 60000;

function bezOgonkow(t) {
    return String(t).replace(/ł/g, 'l').replace(/Ł/g, 'L')
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function tekstKnx(t) {
    return bezOgonkow(t).replace(/[^\x20-\x7E\xA0-\xFF]/g, '').trim().substring(0, 14);
}
function klucz(nazwa) {
    return bezOgonkow(String(nazwa).trim().split(/[\s\-_–—.,;:/]+/)[0] || '').toLowerCase();
}
function maskuj(r) {
    const kopia = Object.assign({}, r);
    if (TYPY_PIN.includes(Number(r.recordType)) && kopia.keyboardPwd) kopia.keyboardPwd = '****';
    return kopia;
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
    const uwagaLock = cfg.lockId ? '' : ' | UWAGA: lockId nieustawiony';

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
        else if (!osoba) decyzja = `nieznana osoba "${osobaKlucz}" – dodaj ją w KONFIGURACJI`;
        else if (!wlaczona) decyzja = 'automatyka wyłączona z KNX – pominięto';
        else {
            decyzja = `OSOBA ${miejsce} (7/3/${miejsce})` + (osoba.scena ? `, SCENA ${osoba.scena}` : '');
            if (osoba.scena) sceny.push({ payload: { save_recall: 0, scenenumber: osoba.scena }, osoba: osoba.nazwa });
            wyzwalacze.push({ payload: true, miejsce, osoba: osoba.nazwa });
            teksty.push({ payload: tekstKnx(osoba.nazwa) });
        }
        if (Number.isFinite(czasSerwera) && czasSerwera > 0) widziane.push(id);
        if (wiek < -ZEGAR_TOLERANCJA_MS) decyzja += ' | UWAGA: zegar komputera spóźnia się – sprawdź NTP';

        const czas = Number.isFinite(czasZamka) && czasZamka > 0
            ? new Date(czasZamka).toLocaleString('pl-PL') : '(brak czasu)';
        const opoznienie = Number.isFinite(wiek) ? `${(wiek / 1000).toFixed(1)} s` : '?';
        logi.push({
            payload: `${czas} | ${TYPY[typ] || 'typ ' + typ} | "${nazwa}" | ${decyzja} | opóźnienie ${opoznienie}${uwagaLock}`,
            rekord: maskuj(r),
        });
    }
    flow.set('widziane', widziane.slice(-PAMIEC_DUPLIKATOW));
    if (rekordy.length) flow.set('ostatniCallback', teraz);

    const ostatni = logi.length ? logi[logi.length - 1].payload.split(' | ') : null;
    if (ostatni && ostatni.length > 3) {
        node.status({ fill: wyzwalacze.length ? 'green' : 'grey', shape: 'dot',
            text: `${ostatni[2]}: ${ostatni[3]}`.substring(0, 60) });
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
