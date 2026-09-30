// =====================================================================
//  KONFIGURACJA – to jedyne miejsce, które instalator musi edytować.
//  Po zmianie: kliknij "Done", a potem "Deploy".
// =====================================================================
const config = {
    // ID zamka w chmurze TTLock (odczytasz go skryptem tools/ttlock_test.py).
    // Puste '' = TRYB NAUKI: zdarzenia z chmury są tylko logowane (z lockId i lockMac
    // do skopiowania), NIE uruchamiają KNX. Przyciski TEST działają zawsze.
    lockId: '',

    // Adres MAC czytnika (drugie zabezpieczenie – callback TTLock nie ma podpisu).
    // Odczytasz go skryptem tools/ttlock_test.py albo z logu w trybie nauki.
    // Puste '' = bez sprawdzania MAC. Format dowolny, np. 'C5:40:E0:9C:8C:C1'.
    lockMac: '',

    // Rekord starszy niż tyle minut nie uruchomi automatyki
    // (np. bramka była offline i wysłała zaległe zdarzenia). Zakres 1–1440.
    maksWiekMinut: 5,

    // Typy otwarcia, które uruchamiają automatykę:
    //  8 = odcisk palca, 4 = kod PIN, 7 = karta/brelok RFID, 55 = pilot
    //  1 = aplikacja (eKey), 12 = zdalnie przez bramkę – dodaj dopiero po teście
    // Dozwolone także: 9 opaska, 49 karta hotelowa, 57 kod QR, 67 twarz,
    //  75/76 otwarcie przez udzielenie z aplikacji/zdalnie, 84/85 żyły dłoni, 92 kod administratora.
    // NIE dodawaj 77–83: to podwójna autoryzacja – pierwsza osoba zweryfikowana,
    //  drzwi nadal ZAMKNIĘTE (czekają na drugą osobę). Konfiguracja je odrzuci.
    typyPrzyjscia: [8, 4, 7, 55],

    // 10 miejsc na osoby. Numer miejsca = adres wyzwalacza KNX 7/3/<nr>.
    //   klucz: PIERWSZE SŁOWO nazwy odcisku/karty/kodu w aplikacji,
    //          małymi literami, bez polskich znaków ("Łukasz - kciuk" -> 'lukasz').
    //          Puste '' = miejsce wolne.
    //   nazwa: tekst na KNX "Ostatnio otworzył" (max 14 znaków)
    //   scena: numer sceny KNX 1–64 wysyłany na 7/1/0 (jak w ETS), 0 = bez sceny
    osoby: [
        /*  1 → 7/3/1  */ { klucz: 'anna',   nazwa: 'Anna',   scena: 1 },
        /*  2 → 7/3/2  */ { klucz: 'piotr',  nazwa: 'Piotr',  scena: 2 },
        /*  3 → 7/3/3  */ { klucz: 'lukasz', nazwa: 'Lukasz', scena: 3 },
        /*  4 → 7/3/4  */ { klucz: '',       nazwa: 'Osoba 4',  scena: 4 },
        /*  5 → 7/3/5  */ { klucz: '',       nazwa: 'Osoba 5',  scena: 5 },
        /*  6 → 7/3/6  */ { klucz: '',       nazwa: 'Osoba 6',  scena: 6 },
        /*  7 → 7/3/7  */ { klucz: '',       nazwa: 'Osoba 7',  scena: 7 },
        /*  8 → 7/3/8  */ { klucz: '',       nazwa: 'Osoba 8',  scena: 8 },
        /*  9 → 7/3/9  */ { klucz: '',       nazwa: 'Osoba 9',  scena: 9 },
        /* 10 → 7/3/10 */ { klucz: '',       nazwa: 'Osoba 10', scena: 10 },
    ],
};

// =====================================================================
//  Poniżej nic nie zmieniaj – sprawdzenie poprawności konfiguracji.
// =====================================================================
function bezOgonkow(t) {
    return String(t).replace(/ł/g, 'l').replace(/Ł/g, 'L')
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function tekstKnx(t) {
    // DPT 16.001 = ISO 8859-1, maks. 14 znaków
    return bezOgonkow(t).replace(/[^\x20-\x7E\xA0-\xFF]/g, '').trim().substring(0, 14);
}

const bledy = [];
const lockId = String(config.lockId === undefined || config.lockId === null ? '' : config.lockId).trim();
if (lockId && !/^\d+$/.test(lockId)) bledy.push('lockId może zawierać tylko cyfry');

const lockMac = String(config.lockMac || '').toUpperCase().replace(/[^0-9A-F]/g, '');
if (lockMac && lockMac.length !== 12) bledy.push('lockMac musi mieć 12 znaków szesnastkowych, np. C5:40:E0:9C:8C:C1');

const maksWiekMinut = Number(config.maksWiekMinut);
if (!(Number.isFinite(maksWiekMinut) && maksWiekMinut >= 1 && maksWiekMinut <= 1440)) {
    bledy.push('maksWiekMinut musi być liczbą 1–1440');
}

const typyPrzyjscia = Array.isArray(config.typyPrzyjscia) ? config.typyPrzyjscia.map(Number) : [];
if (!typyPrzyjscia.length || typyPrzyjscia.some(t => !Number.isInteger(t) || t <= 0)) {
    bledy.push('typyPrzyjscia musi być listą numerów, np. [8, 4, 7, 55]');
}
// Tylko udane otwarcia z możliwą identyfikacją osoby. Bez: klucza mechanicznego (10),
// siły (29), otwarcia od środka (32), alarmów, nieudanych prób i podwójnej autoryzacji 77–83.
const DOZWOLONE_TYPY = [1, 4, 7, 8, 9, 12, 49, 55, 57, 67, 75, 76, 84, 85, 92];
const niedozwolone = typyPrzyjscia.filter(t => !DOZWOLONE_TYPY.includes(t));
if (niedozwolone.length) {
    bledy.push(`typyPrzyjscia: niedozwolone typy ${niedozwolone.join(', ')} – dozwolone: ${DOZWOLONE_TYPY.join(', ')}`);
}

const listaOsob = Array.isArray(config.osoby) ? config.osoby : [];
if (listaOsob.length > 10) bledy.push('maksymalnie 10 osób (flow ma 10 wyzwalaczy KNX)');
const osoby = listaOsob.slice(0, 10).map((o, i) => {
    o = o || {};
    const klucz = bezOgonkow(String(o.klucz || '').trim()).toLowerCase();
    const scena = Number(o.scena === undefined || o.scena === null || o.scena === '' ? 0 : o.scena);
    if (klucz && !/^[a-z0-9]+$/.test(klucz)) bledy.push(`osoba ${i + 1}: klucz może zawierać tylko litery i cyfry (jedno słowo)`);
    if (!Number.isInteger(scena) || scena < 0 || scena > 64) bledy.push(`osoba ${i + 1}: scena musi być liczbą 0–64`);
    const nazwa = tekstKnx(o.nazwa || klucz || `Osoba ${i + 1}`) || `Osoba ${i + 1}`;
    return { klucz, nazwa, scena };
});
const klucze = osoby.map(o => o.klucz).filter(Boolean);
klucze.filter((k, i) => klucze.indexOf(k) !== i)
    .forEach(k => bledy.push(`klucz "${k}" występuje dwa razy`));

if (bledy.length) {
    // Błędna konfiguracja NIE zastępuje ostatniej poprawnej.
    const stara = flow.get('config');
    node.error('Błędna KONFIGURACJA – popraw i kliknij Deploy: ' + bledy.join('; '));
    node.status({ fill: 'red', shape: 'ring',
        text: `BŁĄD: ${bledy[0]}` + (stara ? ' (działa poprzednia konfiguracja)' : '') });
    return null;
}

flow.set('config', { lockId, lockMac, maksWiekMinut, typyPrzyjscia, osoby });
node.status({ fill: lockId ? 'green' : 'yellow', shape: 'dot',
    text: `${klucze.length}/10 osób` + (lockId ? `, zamek ${lockId}` + (lockMac ? ' + MAC' : '') : ', TRYB NAUKI (brak lockId)') });
return null;
