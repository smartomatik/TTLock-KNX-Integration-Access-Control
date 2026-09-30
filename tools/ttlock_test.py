#!/usr/bin/env python3
"""Test: czy chmura TTLock zwraca informację, KTO otworzył drzwi.

Tylko biblioteka standardowa (Python 3.8+). Dwa tryby:

  records   Logowanie kontem administratora zamka (konto z aplikacji SX),
            lista zamków, odcisków, kart, kodów i ostatnich otwarć z nazwą osoby.
  listen    Lokalny odbiornik callbacków TTLock "Lock Records Notify".
            Wypisuje każde zdarzenie i odpowiada "success". Udostępnij go tunelem:
                cloudflared tunnel --url http://localhost:8080
            i wklej adres https://....trycloudflare.com jako Callback URL
            aplikacji w euopen.ttlock.com/manager.

Dane logowania podaj w zmiennych środowiskowych (nie jako argumenty):
  TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET   z zatwierdzonej aplikacji deweloperskiej
  TTLOCK_USER                              login administratora z aplikacji SX
  TTLOCK_PASS                              opcjonalnie; w przeciwnym razie pytanie o hasło

Przykłady:
  python3 ttlock_test.py records                # lista zamków
  python3 ttlock_test.py records 1234567        # odciski/karty/kody + rekordy z 24 h
  python3 ttlock_test.py records 1234567 --hours 2
  python3 ttlock_test.py listen --port 8080
"""

import argparse
import getpass
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

API = "https://euapi.ttlock.com"

# Typy rekordów z chmury (dokumentacja TTLock "Record type of cloud").
RECORD_TYPES = {
    1: "otwarcie z aplikacji (eKey)", 4: "otwarcie kodem PIN",
    5: "podniesienie (parking)", 6: "opuszczenie (parking)",
    7: "otwarcie kartą/brelokiem", 8: "otwarcie odciskiem palca", 9: "otwarcie opaską",
    10: "otwarcie kluczem mechanicznym", 11: "zamknięcie z aplikacji",
    12: "otwarcie zdalne przez bramkę", 29: "otwarcie siłowe",
    30: "czujnik drzwi: zamknięte", 31: "czujnik drzwi: otwarte", 32: "otwarcie od środka",
    33: "zamknięcie odciskiem", 34: "zamknięcie kodem", 35: "zamknięcie kartą",
    36: "zamknięcie kluczem", 37: "sterowanie przyciskiem w aplikacji",
    42: "nowa poczta lokalna", 43: "nowa poczta z innego miasta", 44: "alarm sabotażowy",
    45: "autozamykanie", 46: "przycisk otwierania", 47: "przycisk zamykania",
    48: "blokada po błędnych próbach", 49: "otwarcie kartą hotelową",
    50: "otwarcie z powodu wysokiej temperatury", 51: "próba usuniętą kartą",
    52: "blokada (dead lock) z aplikacji", 53: "blokada (dead lock) kodem",
    54: "samochód wyjechał (parking)", 55: "otwarcie pilotem", 57: "otwarcie kodem QR",
    58: "kod QR wygasły – nieudane", 59: "podwójne zamknięcie",
    60: "anulowanie podwójnego zamknięcia", 61: "zamknięcie kodem QR",
    62: "kod QR – zamek podwójnie zamknięty", 63: "autootwarcie (tryb przejścia)",
    64: "alarm: drzwi niezamknięte", 65: "nieudane otwarcie", 66: "nieudane zamknięcie",
    67: "otwarcie twarzą", 68: "twarz – zamknięte od środka", 69: "zamknięcie twarzą",
    71: "twarz – nieważna", 75: "otwarcie przez udzielenie z aplikacji",
    76: "otwarcie przez zdalne udzielenie",
    77: "podw. autoryzacja: Bluetooth – czeka na 2. osobę",
    78: "podw. autoryzacja: kod – czeka na 2. osobę",
    79: "podw. autoryzacja: odcisk – czeka na 2. osobę",
    80: "podw. autoryzacja: karta – czeka na 2. osobę",
    81: "podw. autoryzacja: twarz – czeka na 2. osobę",
    82: "podw. autoryzacja: pilot – czeka na 2. osobę",
    83: "podw. autoryzacja: żyły dłoni – czeka na 2. osobę",
    84: "otwarcie żyłami dłoni", 85: "otwarcie żyłami dłoni", 86: "zamknięcie żyłami dłoni",
    88: "żyły dłoni – nieważne", 92: "otwarcie kodem administratora",
}
PASSCODE_TYPES = {4, 34, 53, 78, 92}  # w tych rekordach keyboardPwd może zawierać prawdziwy PIN


def now_ms():
    return int(time.time() * 1000)


def fmt_ms(ms):
    return datetime.fromtimestamp(int(ms) / 1000).strftime("%Y-%m-%d %H:%M:%S")


def call(path, params, method="GET"):
    data = urllib.parse.urlencode(params)
    if method == "GET":
        req = urllib.request.Request(f"{API}{path}?{data}")
    else:
        req = urllib.request.Request(
            f"{API}{path}",
            data=data.encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        tresc = e.read()[:200].decode("utf-8", errors="replace")
        sys.exit(f"Błąd HTTP {e.code} z {path}: {tresc}")
    except urllib.error.URLError as e:
        sys.exit(f"Nie można połączyć się z {API}: {e.reason} – sprawdź internet.")
    except TimeoutError:
        sys.exit(f"Brak odpowiedzi z {API} (limit czasu) – sprawdź internet.")
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(f"API zwróciło odpowiedź, która nie jest JSON, dla {path}: {raw[:200]}")
    if isinstance(body, dict) and body.get("errcode", 0) not in (0, None):
        if body.get("errcode") == 10004:
            sys.exit("Token wygasł (błąd 10004). Uruchom skrypt ponownie – zaloguje się od nowa.")
        sys.exit(f"Błąd API {path}: {body.get('errcode')} {body.get('errmsg')}")
    return body


def env(name):
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Najpierw ustaw zmienną środowiskową {name}.")
    return value


def login():
    client_id = env("TTLOCK_CLIENT_ID")
    password = os.environ.get("TTLOCK_PASS") or getpass.getpass("Hasło do aplikacji SX: ")
    token = call(
        "/oauth2/token",
        {
            "clientId": client_id,
            "clientSecret": env("TTLOCK_CLIENT_SECRET"),
            "username": env("TTLOCK_USER"),
            "password": hashlib.md5(password.encode()).hexdigest(),
        },
        method="POST",
    )
    if "access_token" not in token:
        sys.exit(f"Logowanie nieudane: {token}")
    days = token.get("expires_in", 0) // 86400
    print(f"Zalogowano: uid={token.get('uid')}, token ważny {days} dni")
    print("  (to logowanie kieruje też callbacki zamka do tej aplikacji / clientId)\n")
    return {"clientId": client_id, "accessToken": token["access_token"]}


def paged(path, auth, extra, page_size=100):
    items, page = [], 1
    while True:
        body = call(path, {**auth, **extra, "pageNo": page, "pageSize": page_size, "date": now_ms()})
        items += body.get("list", [])
        if page >= body.get("pages", 1):
            return items
        page += 1


def cmd_records(args):
    auth = login()

    if not args.lock_id:
        locks = paged("/v3/lock/list", auth, {})
        if not locks:
            print("Brak zamków, w których to konto jest głównym administratorem.")
        for lock in locks:
            print(f"lockId={lock['lockId']:<10} lockMac={lock.get('lockMac')!s:<18} "
                  f"nazwa={lock.get('lockAlias')!r:<30} bramka={'tak' if lock.get('hasGateway') else 'NIE'}")
        print("\nWpisz lockId i lockMac w węźle ⚙ KONFIGURACJA w Node-RED.")
        print("Uruchom ponownie z lockId, aby zobaczyć odciski, karty, kody i rekordy.")
        return

    lock = {"lockId": args.lock_id}

    print("Odciski palców (numer -> nazwa):")
    for fp in paged("/v3/fingerprint/list", auth, lock):
        print(f"  {fp.get('fingerprintNumber'):<20} {fp.get('fingerprintName')}")
    print("Karty / breloki (numer -> nazwa):")
    for card in paged("/v3/identityCard/list", auth, lock):
        print(f"  {card.get('cardNumber'):<20} {card.get('cardName')}")
    print("Kody PIN (tylko nazwa, kod ukryty):")
    for pwd in paged("/v3/lock/listKeyboardPwd", auth, lock):
        print(f"  id={pwd.get('keyboardPwdId'):<12} {pwd.get('keyboardPwdName')}")

    end = now_ms()
    start = end - args.hours * 3600 * 1000
    records = paged("/v3/lockRecord/list", auth, {**lock, "startDate": start, "endDate": end})
    print(f"\nRekordy z ostatnich {args.hours} h ({len(records)}):")
    print(f"  {'czas na zamku':<19}  {'wysył. +s':>9}  ok  {'typ':<34} nazwa (username) / nr")
    for r in sorted(records, key=lambda r: r["lockDate"]):
        print("  " + describe(r))


def describe(r):
    rtype = int(r.get("recordType", 0))
    name = RECORD_TYPES.get(rtype, f"typ {rtype}")
    delay = (int(r.get("serverDate", r["lockDate"])) - int(r["lockDate"])) / 1000
    credential = r.get("keyboardPwd") or ""
    if rtype in PASSCODE_TYPES and credential:
        credential = "****"
    ok = "ok" if int(r.get("success", 0)) == 1 else "--"
    return (f"{fmt_ms(r['lockDate'])}  {delay:>9.1f}  {ok}  {rtype:>3} {name:<30} "
            f"{r.get('username')!r} {credential}")


class CallbackHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        form = urllib.parse.parse_qs(self.rfile.read(length).decode())
        received = now_ms()
        print(f"\n[{fmt_ms(received)}] callback ścieżka={self.path} "
              f"notifyType={form.get('notifyType', ['-'])[0]} lockId={form.get('lockId', ['-'])[0]}",
              flush=True)
        for raw in form.get("records", []):
            for r in json.loads(raw):
                lag = (received - int(r["lockDate"])) / 1000
                print(f"  {describe(r)}   (drzwi -> callback {lag:.1f} s)", flush=True)
        other = {k: v for k, v in form.items() if k not in ("records", "lockId", "notifyType")}
        if other:
            print(f"  pozostałe pola: {other}", flush=True)
        body = b"success"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def cmd_listen(args):
    print(f"Nasłuch na http://localhost:{args.port} (dowolna ścieżka). Ctrl+C kończy.")
    print(f"Udostępnij tunelem:  cloudflared tunnel --url http://localhost:{args.port}", flush=True)
    HTTPServer(("127.0.0.1", args.port), CallbackHandler).serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    rec = sub.add_parser("records", help="zamki, odciski/karty/kody i rekordy otwarć")
    rec.add_argument("lock_id", nargs="?", type=int)
    rec.add_argument("--hours", type=int, default=24)
    rec.set_defaults(func=cmd_records)
    lis = sub.add_parser("listen", help="wypisuj przychodzące callbacki")
    lis.add_argument("--port", type=int, default=8080)
    lis.set_defaults(func=cmd_listen)
    args = parser.parse_args()
    try:
        args.func(args)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
