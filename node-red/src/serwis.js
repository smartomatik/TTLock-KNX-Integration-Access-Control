// SERWIS – uruchamiany przy starcie i co 6 godzin.
//  1. Loguje się do TTLock kontem administratora zamka. Odświeża to token dla
//     naszego clientId, dzięki czemu callbacki nie przestają przychodzić
//     (TTLock wysyła je do aplikacji z najdłużej ważnym tokenem administratora).
//  2. Sprawdza, czy bramka widzi czytnik (gateway/listByLock, ostatnie 30 min).
//  3. Porównuje zegar komputera z zegarem serwera TTLock.
// Wyjścia: 1 = KNX "Integracja OK" (DPT 1.001), 2 = log
// Dane logowania: zmienne zakładki (typ "credential") – patrz instrukcja, krok 10a.
const API = 'https://euapi.ttlock.com';
const PROG_AWARII = 2;            // ile kolejnych nieudanych kontroli, zanim wyślemy 0 na KNX
const ZEGAR_TOLERANCJA_S = 120;

const clientId = env.get('TTLOCK_CLIENT_ID');
const clientSecret = env.get('TTLOCK_CLIENT_SECRET');
const uzytkownik = env.get('TTLOCK_USER');
const haslo = env.get('TTLOCK_PASS');

if (!clientId || !clientSecret || !uzytkownik || !haslo) {
    node.status({ fill: 'yellow', shape: 'ring', text: 'wyłączony – brak danych TTLock (krok 10a)' });
    return null;
}

function zapytanie(metoda, sciezka, parametry) {
    return new Promise((ok, blad) => {
        const dane = new URLSearchParams(parametry).toString();
        const url = API + sciezka + (metoda === 'GET' ? '?' + dane : '');
        const naglowki = metoda === 'GET' ? {} : {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(dane),
        };
        const req = https.request(url, { method: metoda, timeout: 20000, headers: naglowki }, res => {
            let tekst = '', przerwane = false;
            res.setEncoding('utf8');
            res.on('data', c => {
                if (przerwane) return;
                tekst += c;
                if (tekst.length > 1e6) { przerwane = true; req.destroy(new Error('odpowiedź za duża')); }
            });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(tekst); } catch (e) { /* obsłużone niżej */ }
                if (!json || typeof json !== 'object') return blad(new Error(`nieczytelna odpowiedź HTTP ${res.statusCode}`));
                ok({ status: res.statusCode, data: res.headers.date, json });
            });
        });
        req.on('timeout', () => req.destroy(new Error('brak odpowiedzi serwera TTLock (timeout)')));
        req.on('error', blad);
        req.end(metoda === 'GET' ? undefined : dane);
    });
}

const cfg = flow.get('config');
const krytyczne = [], ostrzezenia = [], info = [];

try {
    const t = await zapytanie('POST', '/oauth2/token', {
        clientId, clientSecret, username: uzytkownik,
        password: crypto.createHash('md5').update(String(haslo)).digest('hex'),
    });
    if (t.data) {
        const roznica = Math.round((Date.now() - Date.parse(t.data)) / 1000);
        if (Math.abs(roznica) > ZEGAR_TOLERANCJA_S) ostrzezenia.push(`zegar komputera różni się o ${roznica} s – sprawdź NTP`);
    }
    if (!t.json.access_token) {
        krytyczne.push(`logowanie TTLock nieudane: ${t.json.errcode} ${t.json.errmsg || ''} – sprawdź clientId, clientSecret i hasło administratora`);
    } else {
        info.push(`token ważny ${Math.round((t.json.expires_in || 0) / 86400)} dni`);
        if (!cfg || !cfg.lockId) {
            ostrzezenia.push('lockId nieustawiony – pominięto kontrolę bramki');
        } else {
            const g = await zapytanie('GET', '/v3/gateway/listByLock', {
                clientId, accessToken: t.json.access_token, lockId: cfg.lockId, date: Date.now(),
            });
            if (g.json.errcode) {
                krytyczne.push(`kontrola bramki: ${g.json.errcode} ${g.json.errmsg || ''}`);
            } else {
                const lista = Array.isArray(g.json.list) ? g.json.list : [];
                if (!lista.length) {
                    krytyczne.push('żadna bramka nie widzi czytnika (bramka offline, bez zasilania lub poza zasięgiem)');
                } else {
                    const rssi = Math.max(...lista.map(b => Number(b.rssi)).filter(Number.isFinite), -999);
                    info.push(`bramka ${rssi > -999 ? rssi + ' dBm' : 'OK'}`);
                    if (rssi > -999 && rssi < -85) ostrzezenia.push(`słaby sygnał bramki (${rssi} dBm) – przybliż bramkę do czytnika`);
                }
            }
        }
    }
} catch (e) {
    krytyczne.push('brak połączenia z TTLock: ' + e.message);
}

const ostatni = flow.get('ostatniCallback');
if (ostatni) info.push(`ostatnie zdarzenie ${Math.round((Date.now() - ostatni) / 3600000)} h temu`);

const awarie = krytyczne.length ? (context.get('awarie') || 0) + 1 : 0;
context.set('awarie', awarie);
const ok = awarie < PROG_AWARII;   // pojedyncza przerwa internetu nie alarmuje

const opis = [...krytyczne, ...ostrzezenia, ...info].join(' | ');
node.status({ fill: krytyczne.length ? 'red' : (ostrzezenia.length ? 'yellow' : 'green'), shape: 'dot',
    text: (krytyczne.length ? `BŁĄD (${awarie}x): ` : 'OK: ') + opis.substring(0, 70) });
if (krytyczne.length) node.warn('SERWIS: ' + opis);

return [{ payload: ok }, { payload: `SERWIS ${krytyczne.length ? 'BŁĄD' : 'OK'} | ${opis}` }];
