#!/usr/bin/env node
// Testy logiki flow bez Node-RED i bez zależności: uruchamia kod węzłów funkcyjnych
// bezpośrednio z node-red/flow-ttlock-knx.json w atrapie środowiska Node-RED.
//   node tests/test-flow.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const flowJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'node-red', 'flow-ttlock-knx.json'), 'utf8'));
const kod = id => flowJson.find(n => n.id === id).func;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function srodowisko() {
    const flowCtx = new Map();
    return { flowCtx, ctxMap: new Map(), env: {}, logi: [], statusy: [] };
}

async function uruchom(id, s, msg = {}, libs = {}) {
    const node = {
        warn: m => s.logi.push(['warn', m]),
        error: m => s.logi.push(['error', m]),
        status: st => s.statusy.push(st),
    };
    const flow = { get: k => s.flowCtx.get(k), set: (k, v) => s.flowCtx.set(k, v) };
    const context = { get: k => s.ctxMap.get(k), set: (k, v) => s.ctxMap.set(k, v) };
    const env = { get: k => s.env[k] };
    const fn = new AsyncFunction('msg', 'node', 'flow', 'context', 'env', 'crypto', 'https', 'Buffer', 'URLSearchParams',
        kod(id));
    return fn(msg, node, flow, context, env, libs.crypto || crypto, libs.https, Buffer, URLSearchParams);
}

const CONFIG = 'ttknx_fn_config01', PARSE = 'ttknx_fn_parse001', SERWIS = 'ttknx_fn_serwis01';

// Podmienia fragment konfiguracji w kodzie węzła KONFIGURACJA
async function wczytajConfig(s, podmiany = {}) {
    let k = kod(CONFIG);
    for (const [z, na] of Object.entries(podmiany)) {
        if (!k.includes(z)) throw new Error('brak fragmentu w config: ' + z);
        k = k.replace(z, na);
    }
    const node = { warn: m => s.logi.push(['warn', m]), error: m => s.logi.push(['error', m]), status: st => s.statusy.push(st) };
    const flow = { get: x => s.flowCtx.get(x), set: (x, v) => s.flowCtx.set(x, v) };
    await new AsyncFunction('msg', 'node', 'flow', k)({}, node, flow);
}

const teraz = () => Date.now();
function callback(rekordy, extra = {}) {
    return { res: {}, req: {}, payload: Object.assign({ lockId: '1234567', notifyType: '1', records: JSON.stringify(rekordy) }, extra) };
}
function rekord(o = {}) {
    return Object.assign({ recordType: 8, success: 1, username: 'Anna - kciuk', keyboardPwd: '4466',
        lockDate: teraz() - 2000, serverDate: teraz() - 1000 }, o);
}
const tekstLogu = wynik => (wynik[4] || []).map(m => m.payload).join('\n');

const testy = [];
const test = (nazwa, f) => testy.push([nazwa, f]);
function oczekuj(warunek, opis) { if (!warunek) throw new Error(opis); }

// ---------------- KONFIGURACJA ----------------
test('konfiguracja domyślna jest poprawna', async () => {
    const s = srodowisko(); await wczytajConfig(s);
    const c = s.flowCtx.get('config');
    oczekuj(c && c.osoby.length === 10, 'brak 10 miejsc');
    oczekuj(c.osoby[0].klucz === 'anna' && c.osoby[0].scena === 1, 'osoba 1');
});
test('scena spoza zakresu odrzuca konfigurację', async () => {
    const s = srodowisko(); await wczytajConfig(s, { "nazwa: 'Anna',   scena: 1": "nazwa: 'Anna',   scena: 70" });
    oczekuj(!s.flowCtx.get('config'), 'błędna konfiguracja zapisana');
    oczekuj(s.logi.some(l => l[0] === 'error'), 'brak błędu');
});
test('błędna konfiguracja zostawia poprzednią', async () => {
    const s = srodowisko(); await wczytajConfig(s);
    await wczytajConfig(s, { "klucz: 'piotr'": "klucz: 'anna'" });
    oczekuj(s.flowCtx.get('config').osoby[1].klucz === 'piotr', 'nadpisano poprawną konfigurację');
});
test('lockId z literami jest odrzucany', async () => {
    const s = srodowisko(); await wczytajConfig(s, { "lockId: '',": "lockId: 'abc',", });
    oczekuj(!s.flowCtx.get('config'), 'zaakceptowano lockId z literami');
});
test('typ 32 (od środka) w typyPrzyjscia jest odrzucany', async () => {
    const s = srodowisko(); await wczytajConfig(s, { 'typyPrzyjscia: [8, 4, 7, 55]': 'typyPrzyjscia: [8, 32]' });
    oczekuj(!s.flowCtx.get('config'), 'zaakceptowano typ 32');
});
test('klucz z polskimi znakami jest normalizowany', async () => {
    const s = srodowisko(); await wczytajConfig(s, { "klucz: 'lukasz'": "klucz: 'Łukasz'" });
    oczekuj(s.flowCtx.get('config').osoby[2].klucz === 'lukasz', 'brak normalizacji');
});

// ---------------- CALLBACK ----------------
async function przygotuj(podmiany) {
    const s = srodowisko(); await wczytajConfig(s, Object.assign({ "lockId: '',": "lockId: '1234567'," }, podmiany || {}));
    return s;
}
test('odcisk Anny → wyzwalacz 1, scena 1, tekst, odpowiedź success', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord()]));
    oczekuj(w[0] && w[0].payload === 'success', 'brak odpowiedzi success');
    oczekuj(w[1].length === 1 && w[1][0].payload.scenenumber === 1, 'scena');
    oczekuj(w[2][0].payload === 'Anna', 'tekst');
    oczekuj(w[3][0].miejsce === 1 && w[3][0].payload === true, 'wyzwalacz');
});
test('duplikat nie uruchamia drugi raz', async () => {
    const s = await przygotuj(); const r = rekord();
    await uruchom(PARSE, s, callback([r]));
    const w = await uruchom(PARSE, s, callback([r]));
    oczekuj(w[3].length === 0 && /duplikat/.test(tekstLogu(w)), 'duplikat przeszedł');
});
test('ta sama osoba ponownie (nowe otwarcie) uruchamia znowu', async () => {
    const s = await przygotuj();
    await uruchom(PARSE, s, callback([rekord({ lockDate: teraz() - 5000 })]));
    const w = await uruchom(PARSE, s, callback([rekord({ lockDate: teraz() - 1000 })]));
    oczekuj(w[3].length === 1, 'drugie otwarcie zablokowane');
});
test('PIN jest maskowany w logu', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord({ recordType: 4, username: 'Piotr kod', keyboardPwd: '123456' })]));
    oczekuj(w[4][0].rekord.keyboardPwd === '****', 'PIN widoczny');
    oczekuj(!JSON.stringify(w).includes('123456'), 'PIN w wyjściu');
    oczekuj(w[3][0].miejsce === 2, 'Piotr');
});
test('otwarcie od środka (32) nic nie uruchamia', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord({ recordType: 32, username: '' })]));
    oczekuj(w[3].length === 0 && w[1].length === 0, 'uruchomiono');
});
test('nieudana próba nic nie uruchamia', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord({ success: 0 })]));
    oczekuj(w[3].length === 0, 'uruchomiono');
});
test('stary rekord (wg czasu serwera) jest pomijany', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord({ lockDate: teraz() - 3600e3, serverDate: teraz() - 3600e3 })]));
    oczekuj(w[3].length === 0 && /zbyt stary/.test(tekstLogu(w)), 'stary przeszedł');
});
test('rozjechany zegar czytnika nie blokuje (liczy się czas serwera)', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord({ lockDate: teraz() - 7 * 86400e3, serverDate: teraz() - 1000 })]));
    oczekuj(w[3].length === 1, 'zablokowano przez zegar czytnika');
});
test('rekord bez czasu jest pomijany (bez wyjątku)', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord({ lockDate: undefined, serverDate: undefined })]));
    oczekuj(w[3].length === 0 && /brak czasu/.test(tekstLogu(w)), 'rekord bez czasu przeszedł');
});
test('obcy lockId jest ignorowany', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord()], { lockId: '999' }));
    oczekuj(w[0].payload === 'success' && !w[3], 'obcy zamek przeszedł');
});
test('notifyType inny niż 1 jest ignorowany', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord()], { notifyType: '3' }));
    oczekuj(!w[3] && /notifyType/.test(w[4].payload), 'notifyType przeszedł');
});
test('uszkodzony JSON w records → success, bez wyjątku', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, { res: {}, req: {}, payload: { lockId: '1234567', notifyType: '1', records: '[{zepsute' } });
    oczekuj(w[0].payload === 'success' && /Nieczytelne/.test(w[4].payload), 'brak obsługi');
});
test('records jako tablica (JSON zamiast formularza) działa', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, { res: {}, req: {}, payload: { lockId: 1234567, records: [rekord()] } });
    oczekuj(w[3].length === 1, 'tablica nieobsłużona');
});
test('records jako pojedynczy obiekt działa', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback(rekord()));
    oczekuj(w[3].length === 1, 'obiekt nieobsłużony');
});
test('pusty lub dziwny payload → success, bez wyjątku', async () => {
    const s = await przygotuj();
    for (const p of [undefined, null, 'tekst', 42, [], {}]) {
        const w = await uruchom(PARSE, s, { res: {}, req: {}, payload: p });
        oczekuj(w[0].payload === 'success', 'brak success dla ' + JSON.stringify(p));
    }
});
test('za dużo rekordów jest przycinane do 50', async () => {
    const s = await przygotuj();
    const lista = Array.from({ length: 80 }, (_, i) => rekord({ recordType: 32, lockDate: teraz() - i }));
    const w = await uruchom(PARSE, s, callback(lista));
    oczekuj(w[4].length === 51, 'brak przycięcia: ' + w[4].length);
});
test('nieznana osoba nic nie uruchamia', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord({ username: 'Gosc brelok', recordType: 7 })]));
    oczekuj(w[3].length === 0 && /nieznana osoba "gosc"/.test(tekstLogu(w)), 'nieznany przeszedł');
});
test('polskie znaki i separatory w nazwie z aplikacji', async () => {
    const s = await przygotuj();
    for (const n of ['Łukasz – kciuk', 'ŁUKASZ_palec', 'łukasz', 'Lukasz,brelok']) {
        const w = await uruchom(PARSE, s, callback([rekord({ username: n, lockDate: teraz() - Math.random() * 1e4 })]));
        oczekuj(w[3].length === 1 && w[3][0].miejsce === 3, 'nie rozpoznano: ' + n);
    }
});
test('automatyka wyłączona z KNX blokuje', async () => {
    const s = await przygotuj(); s.flowCtx.set('automatykaWlaczona', false);
    const w = await uruchom(PARSE, s, callback([rekord()]));
    oczekuj(w[3].length === 0 && /wyłączona/.test(tekstLogu(w)), 'przeszło mimo wyłączenia');
});
test('scena 0 = tylko wyzwalacz', async () => {
    const s = await przygotuj({ "nazwa: 'Anna',   scena: 1": "nazwa: 'Anna',   scena: 0" });
    const w = await uruchom(PARSE, s, callback([rekord()]));
    oczekuj(w[1].length === 0 && w[3].length === 1, 'scena 0');
});
test('brak konfiguracji → success i log, bez wyjątku', async () => {
    const s = srodowisko();
    const w = await uruchom(PARSE, s, callback([rekord()]));
    oczekuj(w[0].payload === 'success' && /Brak konfiguracji/.test(w[4].payload), 'brak obsługi');
});
test('test z przycisku (bez msg.res) nie wysyła odpowiedzi HTTP', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, { payload: callback([rekord()]).payload });
    oczekuj(w[0] === null && w[3].length === 1, 'odpowiedź bez res');
});
test('pamięć duplikatów jest ograniczona', async () => {
    const s = await przygotuj();
    for (let i = 0; i < 12; i++) {
        const lista = Array.from({ length: 50 }, (_, j) => rekord({ recordType: 32, lockDate: 1e12 + i * 100 + j }));
        await uruchom(PARSE, s, callback(lista));
    }
    oczekuj(s.flowCtx.get('widziane').length === 500, 'pamięć: ' + s.flowCtx.get('widziane').length);
});

// ---------------- WERSJA 2.1 ----------------
const MAC = "lockMac: '',";
test('2.1 tryb nauki: bez lockId callback z chmury NIE wysyła KNX', async () => {
    const s = srodowisko(); await wczytajConfig(s);
    const w = await uruchom(PARSE, s, callback([rekord()], { lockMac: 'C5:40:E0:9C:8C:C1' }));
    oczekuj(w[0].payload === 'success' && w[3].length === 0 && w[1].length === 0, 'wysłano w trybie nauki');
    oczekuj(/TRYB NAUKI/.test(tekstLogu(w)) && /1234567/.test(tekstLogu(w)) && /C5:40:E0:9C:8C:C1/.test(tekstLogu(w)), 'log bez lockId/lockMac');
});
test('2.1 tryb nauki: przyciski TEST (bez msg.res) nadal działają', async () => {
    const s = srodowisko(); await wczytajConfig(s);
    const w = await uruchom(PARSE, s, { payload: callback([rekord()]).payload });
    oczekuj(w[3].length === 1, 'test nie działa w trybie nauki');
});
test('2.1 lockMac zgodny (inny zapis) → działa', async () => {
    const s = await przygotuj({ [MAC]: "lockMac: 'c5-40-e0-9c-8c-c1'," });
    const w = await uruchom(PARSE, s, callback([rekord()], { lockMac: 'C5:40:E0:9C:8C:C1' }));
    oczekuj(w[3].length === 1, 'zgodny MAC odrzucony');
});
test('2.1 lockMac niezgodny → ignorowany', async () => {
    const s = await przygotuj({ [MAC]: "lockMac: 'C5:40:E0:9C:8C:C1'," });
    const w = await uruchom(PARSE, s, callback([rekord()], { lockMac: 'AA:BB:CC:DD:EE:FF' }));
    oczekuj(w[0].payload === 'success' && !w[3] && /Niezgodny lockMac/.test(w[4].payload), 'obcy MAC przeszedł');
});
test('2.1 lockMac ustawiony, brak w callbacku → ignorowany', async () => {
    const s = await przygotuj({ [MAC]: "lockMac: 'C5:40:E0:9C:8C:C1'," });
    const w = await uruchom(PARSE, s, callback([rekord()]));
    oczekuj(!w[3] && /Niezgodny lockMac/.test(w[4].payload), 'brak MAC przeszedł');
});
test('2.1 błędny lockMac w konfiguracji jest odrzucany', async () => {
    const s = srodowisko(); await wczytajConfig(s, { [MAC]: "lockMac: 'C5:40:E0'," });
    oczekuj(!s.flowCtx.get('config'), 'zaakceptowano krótki MAC');
});
test('2.1.1 lockMac bez znaków szesnastkowych NIE wyłącza kontroli po cichu', async () => {
    for (const v of ['XYZ', 'ZZ:ZZ:ZZ:ZZ:ZZ:ZZ', 'brak', 'C5:40:E0:9C:8C', 'C5:40:E0:9C:8C:C1:00', 'G5:40:E0:9C:8C:C1', 'C5 40 E0 9C 8C C1']) {
        const s = srodowisko(); await wczytajConfig(s, { [MAC]: `lockMac: ${JSON.stringify(v)},` });
        oczekuj(!s.flowCtx.get('config') && s.logi.some(l => l[0] === 'error'), 'zaakceptowano: ' + v);
    }
});
test('2.1.1 poprawne zapisy lockMac są akceptowane i normalizowane', async () => {
    for (const v of ['C5:40:E0:9C:8C:C1', 'c5-40-e0-9c-8c-c1', 'C540E09C8CC1', '  C5:40:E0:9C:8C:C1  ']) {
        const s = srodowisko(); await wczytajConfig(s, { [MAC]: `lockMac: ${JSON.stringify(v)},` });
        const c = s.flowCtx.get('config');
        oczekuj(c && c.lockMac === 'C540E09C8CC1', 'odrzucono: ' + v);
    }
});
test('2.1.1 puste lockMac = bez kontroli MAC (świadomie)', async () => {
    const s = srodowisko(); await wczytajConfig(s);
    oczekuj(s.flowCtx.get('config').lockMac === '', 'pusty MAC');
});
test('2.1 przycisk TEST przechodzi kontrolę lockMac', async () => {
    const s = await przygotuj({ [MAC]: "lockMac: 'C5:40:E0:9C:8C:C1'," });
    const sim = await uruchom('ttknx_fn_sim00001', s, { topic: 'palec' });
    const w = await uruchom(PARSE, s, sim);
    oczekuj(w[3].length === 1, 'symulacja odrzucona przez MAC');
});
test('2.1 czas ponad 1 h w przyszłości → pominięty', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord({ lockDate: teraz() + 3 * 3600e3, serverDate: teraz() + 3 * 3600e3 })]));
    oczekuj(w[3].length === 0 && /w przyszłości/.test(tekstLogu(w)), 'przyszły rekord przeszedł');
});
test('2.1 czas 10 min w przyszłości → działa z ostrzeżeniem o zegarze', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord({ lockDate: teraz() + 600e3, serverDate: teraz() + 600e3 })]));
    oczekuj(w[3].length === 1 && /zegar komputera/.test(tekstLogu(w)), 'brak działania lub ostrzeżenia');
});
test('2.1 typy 77–83 (podwójna autoryzacja) odrzucane w konfiguracji', async () => {
    for (const t of [77, 80, 83]) {
        const s = srodowisko(); await wczytajConfig(s, { 'typyPrzyjscia: [8, 4, 7, 55]': `typyPrzyjscia: [8, ${t}]` });
        oczekuj(!s.flowCtx.get('config'), 'zaakceptowano typ ' + t);
    }
});
test('2.1 nieudane i alarmowe typy odrzucane w konfiguracji', async () => {
    for (const t of [50, 51, 58, 64, 65, 66, 68, 71, 88]) {
        const s = srodowisko(); await wczytajConfig(s, { 'typyPrzyjscia: [8, 4, 7, 55]': `typyPrzyjscia: [${t}]` });
        oczekuj(!s.flowCtx.get('config'), 'zaakceptowano typ ' + t);
    }
});
test('2.1 dozwolone typy (twarz, żyły dłoni, QR, karta hotelowa) akceptowane', async () => {
    const s = srodowisko(); await wczytajConfig(s, { 'typyPrzyjscia: [8, 4, 7, 55]': 'typyPrzyjscia: [8, 49, 57, 67, 84, 85]' });
    oczekuj(s.flowCtx.get('config'), 'odrzucono dozwolone typy');
});
test('2.1 rekord podwójnej autoryzacji (79) nie uruchamia automatyki', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord({ recordType: 79 })]));
    oczekuj(w[3].length === 0 && /czeka na 2\. osobę/.test(tekstLogu(w)), 'uruchomiono');
});
test('2.1 PIN maskowany także w typach 53 i 78', async () => {
    const s = await przygotuj();
    for (const t of [53, 78]) {
        const w = await uruchom(PARSE, s, callback([rekord({ recordType: t, keyboardPwd: '987654', lockDate: teraz() - t })]));
        oczekuj(!JSON.stringify(w[4]).includes('987654'), 'PIN widoczny w typie ' + t);
    }
});
test('2.1 recordTypeFromLock jest w logu', async () => {
    const s = await przygotuj();
    const w = await uruchom(PARSE, s, callback([rekord({ recordTypeFromLock: 20 })]));
    oczekuj(/\(zamek: 20\)/.test(tekstLogu(w)), 'brak recordTypeFromLock');
});
test('2.1 wszystkie 61 typów z dokumentacji mają opis', async () => {
    const m = kod(PARSE).match(/const TYPY = \{([\s\S]*?)\};/)[1];
    const klucze = [...m.matchAll(/(\d+):/g)].map(x => +x[1]);
    const oficjalne = [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 29, 30, 31, 32, 33, 34, 35, 36, 37, 42, 43, 44, 45, 46, 47, 48, 49,
        50, 51, 52, 53, 54, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 75, 76, 77, 78, 79, 80, 81, 82, 83,
        84, 85, 86, 88, 92];
    oczekuj(oficjalne.length === 61 && oficjalne.every(t => klucze.includes(t)) && klucze.length === 61, 'brakujące typy');
});

// ---------------- PORZĄDKI ----------------
test('status węzła poprawny także gdy nazwa zawiera " | "', async () => {
    const s = await przygotuj();
    await uruchom(PARSE, s, callback([rekord({ username: 'Anna | kciuk' })]));
    const st = s.statusy.pop();
    oczekuj(st && st.fill === 'green' && /"Anna \| kciuk": OSOBA 1/.test(st.text), 'status: ' + (st && st.text));
});
test('tekst na KNX pochodzi z oczyszczonej nazwy w KONFIGURACJI', async () => {
    const s = await przygotuj({ "nazwa: 'Anna',   scena: 1": "nazwa: 'Żaneta Świętokrzyska 😀', scena: 1" });
    const w = await uruchom(PARSE, s, callback([rekord()]));
    oczekuj(w[2][0].payload === 'Zaneta Swietok', 'tekst: ' + w[2][0].payload);
});
test('kod źródłowy nie zawiera niewidocznych znaków łączących', async () => {
    for (const n of flowJson.filter(n => n.type === 'function')) {
        oczekuj(!/[̀-ͯ]/.test(n.func), 'niewidoczne znaki w ' + n.name);
    }
});

// ---------------- SERWIS ----------------
function atrapaHttps(odpowiedzi, dataSerwera) {
    const wywolania = [];
    return {
        wywolania,
        request(url, opcje, cb) {
            const req = new EventEmitter();
            req.destroy = e => req.emit('error', e);
            req.end = () => {
                wywolania.push(url);
                const klucz = Object.keys(odpowiedzi).find(k => url.includes(k));
                const o = odpowiedzi[klucz];
                if (o instanceof Error) return setImmediate(() => req.emit('error', o));
                const res = new EventEmitter();
                res.statusCode = 200;
                res.headers = { date: (dataSerwera || new Date()).toUTCString() };
                res.setEncoding = () => {};
                cb(res);
                setImmediate(() => { res.emit('data', JSON.stringify(o)); res.emit('end'); });
            };
            return req;
        },
    };
}
async function srodowiskoSerwisu() {
    const s = await przygotuj();
    s.env = { TTLOCK_CLIENT_ID: 'id', TTLOCK_CLIENT_SECRET: 'sek', TTLOCK_USER: 'admin', TTLOCK_PASS: 'haslo' };
    return s;
}
const TOKEN_OK = { access_token: 'abc', expires_in: 7776000 };

test('serwis bez danych TTLock jest wyłączony', async () => {
    const s = await przygotuj();
    const w = await uruchom(SERWIS, s, {}, { https: atrapaHttps({}) });
    oczekuj(w === null && /wyłączony/.test(s.statusy.pop().text), 'nie wyłączony');
});
test('serwis OK: token + bramka → 1 na KNX', async () => {
    const s = await srodowiskoSerwisu();
    const h = atrapaHttps({ '/oauth2/token': TOKEN_OK, '/v3/gateway/listByLock': { list: [{ rssi: -60 }] } });
    const w = await uruchom(SERWIS, s, {}, { https: h });
    oczekuj(w[0].payload === true && /SERWIS OK/.test(w[1].payload), 'nie OK: ' + w[1].payload);
    oczekuj(h.wywolania.length === 2, 'liczba wywołań');
});
test('serwis wysyła hasło jako MD5, nie jawnie', async () => {
    const s = await srodowiskoSerwisu();
    let body = '';
    const h = atrapaHttps({ '/oauth2/token': TOKEN_OK, '/v3/gateway/listByLock': { list: [{ rssi: -60 }] } });
    const org = h.request;
    h.request = (u, o, cb) => { const r = org(u, o, cb); const e = r.end; r.end = d => { if (d) body += d; e(d); }; return r; };
    await uruchom(SERWIS, s, {}, { https: h });
    oczekuj(body.includes(crypto.createHash('md5').update('haslo').digest('hex')) && !body.includes('password=haslo'), 'hasło');
});
test('bramka offline: 1. kontrola jeszcze OK, 2. kontrola → 0 na KNX', async () => {
    const s = await srodowiskoSerwisu();
    const h = () => atrapaHttps({ '/oauth2/token': TOKEN_OK, '/v3/gateway/listByLock': { list: [] } });
    const w1 = await uruchom(SERWIS, s, {}, { https: h() });
    const w2 = await uruchom(SERWIS, s, {}, { https: h() });
    oczekuj(w1[0].payload === true && w2[0].payload === false, `histereza ${w1[0].payload} ${w2[0].payload}`);
    oczekuj(/żadna bramka/.test(w2[1].payload), 'opis');
});
test('po awarii jedna udana kontrola przywraca 1', async () => {
    const s = await srodowiskoSerwisu(); s.ctxMap.set('awarie', 5);
    const w = await uruchom(SERWIS, s, {}, { https: atrapaHttps({ '/oauth2/token': TOKEN_OK, '/v3/gateway/listByLock': { list: [{ rssi: -70 }] } }) });
    oczekuj(w[0].payload === true && s.ctxMap.get('awarie') === 0, 'brak powrotu');
});
test('złe hasło administratora → błąd krytyczny', async () => {
    const s = await srodowiskoSerwisu(); s.ctxMap.set('awarie', 1);
    const w = await uruchom(SERWIS, s, {}, { https: atrapaHttps({ '/oauth2/token': { errcode: 10003, errmsg: 'invalid account' } }) });
    oczekuj(w[0].payload === false && /logowanie TTLock nieudane/.test(w[1].payload), w[1].payload);
});
test('brak internetu → błąd, bez wyjątku', async () => {
    const s = await srodowiskoSerwisu();
    const w = await uruchom(SERWIS, s, {}, { https: atrapaHttps({ '/oauth2/token': new Error('getaddrinfo ENOTFOUND') }) });
    oczekuj(/brak połączenia/.test(w[1].payload), w[1].payload);
});
test('rozjechany zegar komputera → ostrzeżenie', async () => {
    const s = await srodowiskoSerwisu();
    const w = await uruchom(SERWIS, s, {}, { https: atrapaHttps(
        { '/oauth2/token': TOKEN_OK, '/v3/gateway/listByLock': { list: [{ rssi: -60 }] } }, new Date(Date.now() - 600e3)) });
    oczekuj(w[0].payload === true && /zegar komputera/.test(w[1].payload), w[1].payload);
});
test('słaby sygnał bramki → ostrzeżenie, ale OK', async () => {
    const s = await srodowiskoSerwisu();
    const w = await uruchom(SERWIS, s, {}, { https: atrapaHttps({ '/oauth2/token': TOKEN_OK, '/v3/gateway/listByLock': { list: [{ rssi: -92 }] } }) });
    oczekuj(w[0].payload === true && /słaby sygnał/.test(w[1].payload), w[1].payload);
});

// ---------------- FLOW ----------------
test('flow: wszystkie połączenia prowadzą do istniejących węzłów', async () => {
    const ids = new Set(flowJson.map(n => n.id));
    for (const n of flowJson) for (const o of n.wires || []) for (const c of o) oczekuj(ids.has(c), `${n.id} -> ${c}`);
});
test('flow: dane logowania są typu credential (nie jawne)', async () => {
    const tab = flowJson.find(n => n.type === 'tab');
    oczekuj(tab.env.length === 4 && tab.env.every(e => e.type === 'cred' && e.value === ''), 'env');
});
test('flow: kod węzłów funkcyjnych kompiluje się', async () => {
    for (const n of flowJson.filter(n => n.type === 'function')) new AsyncFunction('msg', n.func);
});

(async () => {
    let bledy = 0;
    for (const [nazwa, f] of testy) {
        try { await f(); console.log('  ✔ ' + nazwa); } catch (e) { bledy++; console.log('  ✘ ' + nazwa + '\n      ' + e.message); }
    }
    console.log(`\n${testy.length - bledy}/${testy.length} testów OK`);
    process.exit(bledy ? 1 : 0);
})();
