#!/usr/bin/env python3
"""Test end-to-end: prawdziwy Node-RED + knx-ultimate + flow z repozytorium + emulator KNX IP.

Wysyła callbacki HTTP w formacie TTLock i sprawdza telegramy, które faktycznie
trafiają na (emulowaną) magistralę KNX. Tylko biblioteka standardowa.

Przygotowanie (jednorazowo, w dowolnym katalogu roboczym):
    npm install node-red@5.0.7
    mkdir userdir && cd userdir && npm init -y && npm install node-red-contrib-knx-ultimate@8.0.6

Uruchomienie:
    python3 tests/e2e/run_e2e.py --node-red <katalog>/node_modules/.bin/node-red --userdir <katalog>/userdir

Opcjonalnie prawdziwe dane aplikacji TTLock dla testu serwisu (bez nich używane są fikcyjne):
    TTLOCK_CLIENT_ID=... TTLOCK_CLIENT_SECRET=... python3 tests/e2e/run_e2e.py ...
"""
import argparse
import json
import os
import pathlib
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
NR_PORT, KNX_PORT, SIM_PORT = 18811, 13671, 13672
NR = f"http://127.0.0.1:{NR_PORT}"
SIM = f"http://127.0.0.1:{SIM_PORT}"
SEKRET = "/ttlock/e2e-sekret-0123456789abcdef"
LOCK_ID, LOCK_MAC = "7252408", "16:72:4C:CC:01:C4"
PIN = "918273"
TAB, CONFIG_NODE, SERWIS_INJECT = "ttknx_tab0000001", "ttknx_fn_config01", "ttknx_inj_serw01"

wyniki = []
procesy = {}


def http(url, data=None, headers=None, method=None, timeout=10):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def sim(path):
    return json.loads(http(SIM + path)[1])


def teraz():
    return int(time.time() * 1000)


def rekord(**k):
    r = {"lockId": int(LOCK_ID), "recordType": 8, "recordTypeFromLock": 20, "success": 1,
         "username": "Anna - kciuk", "keyboardPwd": "44668054142981",
         "lockDate": teraz() - 1500, "serverDate": teraz() - 500, "electricQuantity": 93}
    r.update(k)
    return r


def callback(rekordy, sciezka=SEKRET, **pola):
    """POST dokładnie jak chmura TTLock: application/x-www-form-urlencoded, records = tekst JSON."""
    form = {"lockId": LOCK_ID, "notifyType": "1", "lockMac": LOCK_MAC, "admin": "admin@example.com",
            "records": rekordy if isinstance(rekordy, str) else json.dumps(rekordy)}
    form.update(pola)
    return http(NR + sciezka, urllib.parse.urlencode(form).encode(),
                {"Content-Type": "application/x-www-form-urlencoded"})


def telegramy(czekaj=1.2, limit=8.0):
    """Zapisy (write) z Node-RED na magistralę; czeka, aż lista przestanie rosnąć."""
    koniec, ostatnio, n = time.time() + limit, time.time(), -1
    while time.time() < koniec:
        log = sim("/log")
        if len(log) != n:
            n, ostatnio = len(log), time.time()
        elif time.time() - ostatnio >= czekaj:
            break
        time.sleep(0.2)
    return [(t["ga"], t["dane"]) for t in sim("/log") if t.get("typ") == "write"]


def tekst(dane):
    return bytes(dane).split(b"\x00")[0].decode("latin-1")


def test(nazwa, warunek, szczegoly=""):
    wyniki.append((nazwa, bool(warunek)))
    print(f"  {'✔' if warunek else '✘'} {nazwa}" + ("" if warunek else f"\n      {szczegoly}"), flush=True)


def scenariusz(nazwa, rekordy, oczekiwane, **kw):
    """Wysyła callback i porównuje zapisy KNX z oczekiwanymi (kolejność bez znaczenia)."""
    sim("/clear")
    kod, body = callback(rekordy, **kw)
    zapisy = telegramy()
    uproszczone = sorted((ga, tekst(d) if ga == "7/2/0" else d[0]) for ga, d in zapisy)
    test(nazwa, kod == 200 and body == "success" and uproszczone == sorted(oczekiwane),
         f"HTTP {kod} {body!r}; KNX {uproszczone}; oczekiwano {sorted(oczekiwane)}")


def start_sim():
    procesy["sim"] = subprocess.Popen([sys.executable, "-u", str(REPO / "tests/e2e/knx_gateway_sim.py"),
                                       "--knx", str(KNX_PORT), "--http", str(SIM_PORT)],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    czekaj_na(lambda: http(SIM + "/state")[0] == 200, "emulator KNX")


def start_nr(args, log):
    procesy["nr"] = subprocess.Popen([args.node_red, "-u", args.userdir, "-p", str(NR_PORT), "flows.json"],
                                     stdout=log, stderr=subprocess.STDOUT, cwd=args.userdir)
    czekaj_na(lambda: http(NR + "/flows")[0] == 200, "Node-RED", 60)


def stop(nazwa):
    p = procesy.pop(nazwa, None)
    if p:
        p.send_signal(signal.SIGTERM)
        try:
            p.wait(15)
        except subprocess.TimeoutExpired:
            p.kill()


def czekaj_na(warunek, opis, limit=30):
    koniec = time.time() + limit
    while time.time() < koniec:
        try:
            if warunek():
                return True
        except Exception:  # noqa: BLE001 - usługa jeszcze nie wstała
            pass
        time.sleep(0.5)
    raise SystemExit(f"Nie doczekano się: {opis}")


def czekaj_na_tunel(limit=60):
    return czekaj_na(lambda: sim("/state")["connected"], "tunel KNX", limit)


def wdroz(zmien_config=None, credentials=None):
    """Zmienia kod węzła KONFIGURACJA i/lub dane zakładki przez API administracyjne (jak Deploy)."""
    _, raw = http(NR + "/flows", headers={"Node-RED-API-Version": "v2"})
    stan = json.loads(raw)
    for n in stan["flows"]:
        if n["id"] == CONFIG_NODE and zmien_config:
            for a, b in zmien_config:
                assert a in n["func"], a
                n["func"] = n["func"].replace(a, b)
        if n["id"] == TAB and credentials:
            n["credentials"] = credentials
    kod, body = http(NR + "/flows", json.dumps({"flows": stan["flows"], "rev": stan["rev"]}).encode(),
                     {"Content-Type": "application/json", "Node-RED-API-Version": "v2",
                      "Node-RED-Deployment-Type": "full"})
    assert kod == 200, body
    sim("/clear")
    time.sleep(1)
    czekaj_na_tunel()
    # po pełnym Deploy knx-ultimate odczytuje 7/4/0 – wtedy tunel jest gotowy do pracy
    czekaj_na(lambda: any(t.get("typ") == "read" for t in sim("/log")), "odczyt 7/4/0 po Deploy", 40)
    time.sleep(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--node-red", required=True)
    ap.add_argument("--userdir", required=True)
    args = ap.parse_args()
    args.userdir = str(pathlib.Path(args.userdir).resolve())
    args.node_red = str(pathlib.Path(args.node_red).resolve())

    # flow z repozytorium; zmieniamy tylko adres interfejsu KNX (emulator), sekret i opóźnienie serwisu
    flow = json.loads((REPO / "node-red/flow-ttlock-knx.json").read_text(encoding="utf-8"))
    for n in flow:
        if n["type"] == "knxUltimate-config":
            n.update(host="127.0.0.1", port=str(KNX_PORT), hostProtocol="TunnelUDP")
        if n["type"] == "http in":
            n["url"] = SEKRET
        if n["id"] == SERWIS_INJECT:
            n.update(once=False, repeat="")          # serwis wyzwalamy ręcznie w teście
    ud = pathlib.Path(args.userdir)
    (ud / "flows.json").write_text(json.dumps(flow), encoding="utf-8")
    for stary in ("flows_cred.json", ".flows.json.backup", ".flows_cred.json.backup"):
        (ud / stary).unlink(missing_ok=True)
    logpath = ud / "e2e-node-red.log"
    log = open(logpath, "w")

    try:
        start_sim()
        start_nr(args, log)
        czekaj_na_tunel()
        czekaj_na(lambda: any(t.get("typ") == "read" and t["ga"] == "7/4/0" for t in sim("/log")), "odczyt 7/4/0", 40)

        print("\n1. Start i tryb nauki (konfiguracja domyślna, bez lockId)")
        test("po starcie flow odczytuje stan 7/4/0 z magistrali", True)
        scenariusz("tryb nauki: callback z chmury → success, nic na KNX", [rekord()], [])
        _, raw = http(NR + "/flows")
        test("węzeł Serwis bez danych TTLock nie wysyła nic na 7/4/1",
             not any(ga == "7/4/1" for ga, _ in telegramy(0.5, 2)))

        print("\n2. Konfiguracja: lockId + lockMac (Deploy przez API)")
        wdroz([("lockId: '',", f"lockId: '{LOCK_ID}',"), ("lockMac: '',", f"lockMac: '{LOCK_MAC}',")])
        scenariusz("odcisk Anny → 7/3/1=1, scena 1 (wartość 0), tekst „Anna”", [rekord()],
                   [("7/3/1", 1), ("7/1/0", 0), ("7/2/0", "Anna")])
        scenariusz("PIN Piotra → 7/3/2=1, scena 2, tekst „Piotr”",
                   [rekord(recordType=4, recordTypeFromLock=5, username="Piotr kod", keyboardPwd=PIN)],
                   [("7/3/2", 1), ("7/1/0", 1), ("7/2/0", "Piotr")])
        scenariusz("brelok „Łukasz – brelok” (polskie znaki) → 7/3/3=1, scena 3, tekst „Lukasz”",
                   [rekord(recordType=7, username="Łukasz – brelok", keyboardPwd="0012345678")],
                   [("7/3/3", 1), ("7/1/0", 2), ("7/2/0", "Lukasz")])
        dwa = [rekord(lockDate=teraz() - 3000), rekord(recordType=4, username="Piotr kod", keyboardPwd=PIN)]
        scenariusz("dwie osoby w jednym callbacku → oba wyzwalacze", dwa,
                   [("7/3/1", 1), ("7/1/0", 0), ("7/2/0", "Anna"), ("7/3/2", 1), ("7/1/0", 1), ("7/2/0", "Piotr")])
        scenariusz("ten sam callback ponownie (duplikat z chmury) → nic", dwa, [])

        print("\n3. Zdarzenia, które NIE mogą uruchomić automatyki")
        scenariusz("otwarcie od środka (32)", [rekord(recordType=32, username="")], [])
        scenariusz("nieudana próba (success=0)", [rekord(success=0)], [])
        scenariusz("klucz mechaniczny (10)", [rekord(recordType=10, username="")], [])
        scenariusz("podwójna autoryzacja, 1. osoba (79)", [rekord(recordType=79)], [])
        scenariusz("stary rekord (1 h)", [rekord(lockDate=teraz() - 3600_000, serverDate=teraz() - 3600_000)], [])
        scenariusz("czas 3 h w przyszłości", [rekord(lockDate=teraz() + 3 * 3600_000, serverDate=teraz() + 3 * 3600_000)], [])
        scenariusz("rekord bez czasu", [{"recordType": 8, "success": 1, "username": "Anna"}], [])
        scenariusz("nieznana osoba", [rekord(recordType=7, username="Gosc brelok")], [])
        scenariusz("obcy lockId (fałszywy callback)", [rekord()], [], lockId="999999")
        scenariusz("obcy lockMac (fałszywy callback)", [rekord()], [], lockMac="AA:BB:CC:DD:EE:FF")
        scenariusz("notifyType=3 (np. bramka offline)", [rekord()], [], notifyType="3")
        scenariusz("uszkodzony JSON w records", "[{zepsute", [])
        scenariusz("puste records", "[]", [])

        print("\n4. Protokół HTTP")
        kod, _ = http(NR + SEKRET)
        test("GET na adres callbacku → 404", kod == 404, f"HTTP {kod}")
        kod, _ = callback([rekord()], sciezka="/ttlock/zly-sekret")
        test("POST na zły sekret → 404, nic na KNX", kod == 404 and not telegramy(0.5, 2), f"HTTP {kod}")
        sim("/clear")
        kod, body = http(NR + SEKRET, json.dumps({"lockId": LOCK_ID, "notifyType": 1, "lockMac": LOCK_MAC,
                                                    "records": [rekord()]}).encode(), {"Content-Type": "application/json"})
        test("callback jako JSON (gdyby TTLock zmienił format) → działa",
             kod == 200 and body == "success" and ("7/3/1", [1]) in telegramy(), f"HTTP {kod} {body}")
        kod, _ = http(NR + SEKRET, b"records=" + b"A" * 7_000_000, {"Content-Type": "application/x-www-form-urlencoded"})
        test("za duże zapytanie (7 MB) → odrzucone (413), Node-RED działa dalej", kod == 413, f"HTTP {kod}")
        scenariusz("po odrzuconym zapytaniu kolejny callback działa", [rekord()],
                   [("7/3/1", 1), ("7/1/0", 0), ("7/2/0", "Anna")])

        print("\n5. Włączanie i wyłączanie automatyki z KNX (7/4/0)")
        http(SIM + "/send?ga=7/4/0&val=0")
        time.sleep(1)
        scenariusz("7/4/0 = 0 → automatyka zablokowana", [rekord()], [])
        http(SIM + "/send?ga=7/4/0&val=1")
        time.sleep(1)
        scenariusz("7/4/0 = 1 → automatyka działa", [rekord()], [("7/3/1", 1), ("7/1/0", 0), ("7/2/0", "Anna")])

        print("\n6. Obciążenie: 40 callbacków naraz")
        sim("/clear")
        baza = teraz()
        ok = sum(1 for i in range(40) if callback([rekord(lockDate=baza - 60_000 + i)]) == (200, "success"))
        zapisy = telegramy(2.5, 40)
        test("40/40 odpowiedzi success", ok == 40, f"{ok}/40")
        test("40 wyzwalaczy, 40 scen i 40 tekstów dotarło na KNX (nic nie zgubiono)",
             [sum(1 for ga, _ in zapisy if ga == g) for g in ("7/3/1", "7/1/0", "7/2/0")] == [40, 40, 40],
             str({g: sum(1 for ga, _ in zapisy if ga == g) for g in ("7/3/1", "7/1/0", "7/2/0")}))

        print("\n7. Serwis: prawdziwy serwer TTLock, błędne logowanie administratora")
        prawdziwe = bool(os.environ.get("TTLOCK_CLIENT_ID"))
        wdroz(credentials={"TTLOCK_CLIENT_ID": os.environ.get("TTLOCK_CLIENT_ID", "fikcyjny"),
                           "TTLOCK_CLIENT_SECRET": os.environ.get("TTLOCK_CLIENT_SECRET", "fikcyjny"),
                           "TTLOCK_USER": "e2e-nieistniejacy-uzytkownik-000", "TTLOCK_PASS": "nieprawdziwe"})
        sim("/clear")
        http(NR + "/inject/" + SERWIS_INJECT, b"", method="POST")
        z1 = [d[0] for ga, d in telegramy(1.5, 30) if ga == "7/4/1"]
        test("1. nieudana kontrola → 7/4/1 = 1 (jeszcze bez alarmu)", z1 == [1], str(z1))
        sim("/clear")
        http(NR + "/inject/" + SERWIS_INJECT, b"", method="POST")
        z2 = [d[0] for ga, d in telegramy(1.5, 30) if ga == "7/4/1"]
        test("2. nieudana kontrola z rzędu → 7/4/1 = 0 (alarm na KNX)", z2 == [0], str(z2))
        log.flush()
        logtxt = logpath.read_text(errors="replace")
        oczek = "10007" if prawdziwe else "10000"
        test(f"serwis zgłasza w logu błąd logowania TTLock ({oczek})"
             + (" – clientId i secret przyjęte przez serwer" if prawdziwe else ""),
             f"logowanie TTLock nieudane: {oczek}" in logtxt)
        scenariusz("awaria serwisu nie blokuje automatyki", [rekord()], [("7/3/1", 1), ("7/1/0", 0), ("7/2/0", "Anna")])

        print("\n8. Odporność: restart interfejsu KNX i restart Node-RED")
        stop("sim")
        kod, body = callback([rekord()])
        test("KNX niedostępny → callback nadal dostaje success", (kod, body) == (200, "success"), f"{kod} {body}")
        time.sleep(3)
        start_sim()
        czekaj_na_tunel(120)
        time.sleep(3)
        scenariusz("po powrocie interfejsu KNX tunel wraca sam i automatyka działa", [rekord()],
                   [("7/3/1", 1), ("7/1/0", 0), ("7/2/0", "Anna")])
        stop("nr")
        sim("/clear")
        start_nr(args, log)
        czekaj_na_tunel(60)
        czekaj_na(lambda: any(t.get("typ") == "read" for t in sim("/log")), "odczyt 7/4/0 po restarcie", 40)
        time.sleep(1)
        scenariusz("po restarcie Node-RED konfiguracja wraca sama i automatyka działa", [rekord()],
                   [("7/3/1", 1), ("7/1/0", 0), ("7/2/0", "Anna")])

        print("\n9. Poufność i błędy w logu")
        log.flush()
        logtxt = logpath.read_text(errors="replace")
        test("kod PIN nie występuje w logu Node-RED", PIN not in logtxt)
        test("hasło i secret nie występują w logu ani w flows.json",
             "nieprawdziwe" not in logtxt and "nieprawdziwe" not in (ud / "flows.json").read_text()
             and os.environ.get("TTLOCK_CLIENT_SECRET", "fikcyjny-sekret-brak") not in logtxt)
        bledy = [l for l in logtxt.splitlines() if "[error]" in l and "function:" in l]
        test("brak błędów węzłów funkcyjnych w logu", not bledy, "\n      ".join(bledy[:3]))
        test("brak nieobsłużonych wyjątków (uncaughtException / TypeError)",
             "uncaughtException" not in logtxt and "TypeError" not in logtxt)
    finally:
        stop("nr")
        stop("sim")
        log.close()

    zle = [n for n, ok in wyniki if not ok]
    print(f"\n{len(wyniki) - len(zle)}/{len(wyniki)} testów end-to-end OK   (log Node-RED: {logpath})")
    sys.exit(1 if zle else 0)


if __name__ == "__main__":
    main()
