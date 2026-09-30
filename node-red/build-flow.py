#!/usr/bin/env python3
"""Buduje node-red/flow-ttlock-knx.json z plików node-red/src/*.js.

Kod funkcji edytuj w src/, potem uruchom:
    python3 node-red/build-flow.py
    node tests/test-flow.js
Identyfikatory węzłów są stałe, więc ponowny import zastępuje istniejący flow.
"""
import json
import pathlib

WERSJA = "2.1.2"
KATALOG = pathlib.Path(__file__).resolve().parent
src = lambda nazwa: (KATALOG / "src" / nazwa).read_text(encoding="utf-8")

TAB = "ttknx_tab0000001"
CFG = "ttknx_knxcfg0001"
LIBS_SERWIS = [{"var": "crypto", "module": "crypto"}, {"var": "https", "module": "https"}]


def knx(id_, name, ga, dpt, x, y, wires=None, listen=False):
    return {
        "id": id_, "type": "knxUltimate", "z": TAB, "server": CFG,
        "topic": ga, "setTopicType": "str", "outputtopic": "", "dpt": dpt,
        "initialread": 1 if listen else 0,
        "notifyreadrequest": False, "notifyresponse": listen, "notifywrite": listen,
        "notifyreadrequestalsorespondtobus": False,
        "notifyreadrequestalsorespondtobusdefaultvalueifnotinitialized": "0",
        "name": name, "outputtype": "write", "outputRBE": "false", "inputRBE": "false",
        "formatmultiplyvalue": 1, "formatnegativevalue": "leave", "formatdecimalsvalue": 999,
        "passthrough": "no", "sendMsgToKNXCode": "", "receiveMsgFromKNXCode": "",
        "listenallga": "", "gaSecure": False, "buttonEnabled": False, "buttonMode": "toggle",
        "buttonStaticValue": "", "buttonToggleInitial": "false", "periodicSend": False,
        "periodicSendInterval": 60, "x": x, "y": y, "wires": wires or [[]],
    }


def func(id_, name, code, outputs, x, y, wires, outlabels=None, libs=None):
    return {"id": id_, "type": "function", "z": TAB, "name": name, "func": code,
            "outputs": outputs, "timeout": 0, "noerr": 0, "initialize": "", "finalize": "",
            "libs": libs or [], "outputLabels": outlabels or [], "x": x, "y": y, "wires": wires}


def comment(id_, name, info, x, y):
    return {"id": id_, "type": "comment", "z": TAB, "name": name, "info": info, "x": x, "y": y, "wires": []}


def inject(id_, name, topic, x, y, wires, once=False, repeat="", delay=0.5):
    return {"id": id_, "type": "inject", "z": TAB, "name": name,
            "props": [{"p": "topic", "vt": "str"}], "repeat": repeat, "crontab": "",
            "once": once, "onceDelay": delay, "topic": topic, "x": x, "y": y, "wires": wires}


def debug(id_, name, x, y):
    return {"id": id_, "type": "debug", "z": TAB, "name": name,
            "active": True, "tosidebar": True, "console": True, "tostatus": False,
            "complete": "payload", "targetType": "msg", "statusVal": "", "statusType": "auto",
            "x": x, "y": y, "wires": []}


flow = [
    {"id": TAB, "type": "tab", "label": "TTLock → KNX", "disabled": False,
     "info": f"TTLock → KNX, wersja {WERSJA}\n"
             "Automatyka KNX zależna od osoby, która otworzyła drzwi (callback TTLock).\n"
             "Instrukcja: docs/INSTRUKCJA-NODE-RED.md\n\n"
             "Zmienne zakładki (typ credential) dla SERWISU – krok 10a instrukcji:\n"
             "TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_USER, TTLOCK_PASS",
     "env": [{"name": n, "value": "", "type": "cred"} for n in
             ("TTLOCK_CLIENT_ID", "TTLOCK_CLIENT_SECRET", "TTLOCK_USER", "TTLOCK_PASS")]},

    comment("ttknx_cmt0000001", "① KONFIGURACJA – edytuj węzeł „⚙ KONFIGURACJA” (osoby, sceny, lockId)",
            "Kliknij dwukrotnie węzeł ⚙ KONFIGURACJA i zmień listę osób.\nPo zmianie kliknij Deploy.\n"
            "Błędna konfiguracja jest odrzucana (czerwony status), działa wtedy poprzednia.", 330, 40),
    inject("ttknx_inj_cfg001", "Wczytaj konfigurację", "", 150, 80, [["ttknx_fn_config01"]], once=True, delay=0.1),
    func("ttknx_fn_config01", "⚙ KONFIGURACJA", src("config.js"), 1, 380, 80, [[]]),

    comment("ttknx_cmt0000002", "② CALLBACK Z CHMURY TTLOCK – zmień adres URL na własny sekret",
            "Adres musi być taki sam jak callback URL w euopen.ttlock.com (np. https://drzwi.twojadomena.pl/ttlock/SEKRET).", 320, 140),
    {"id": "ttknx_httpin0001", "type": "http in", "z": TAB, "name": "Callback TTLock (POST)",
     "url": "/ttlock/zmien-ten-sekret", "method": "post", "upload": False, "swaggerDoc": "",
     "x": 160, "y": 200, "wires": [["ttknx_fn_parse001"]]},
    func("ttknx_fn_parse001", "Kto otworzył? → automatyka", src("parse.js"), 5, 440, 260,
         [["ttknx_httpres001"], ["ttknx_knx_scene01"], ["ttknx_knx_text001"], ["ttknx_switch0001"], ["ttknx_debug00001"]],
         ["odpowiedź HTTP", "scena KNX", "tekst KNX", "wyzwalacz osoby 1–10", "log"]),
    {"id": "ttknx_httpres001", "type": "http response", "z": TAB, "name": "odpowiedź: success",
     "statusCode": "", "headers": {}, "x": 730, "y": 180, "wires": []},

    comment("ttknx_cmt0000003", "③ WYJŚCIA KNX – ustaw adresy grup (GA) takie jak w ETS", "", 800, 140),
    knx("ttknx_knx_scene01", "Scena przyjścia (7/1/0)", "7/1/0", "18.001", 760, 220),
    knx("ttknx_knx_text001", "Ostatnio otworzył (7/2/0)", "7/2/0", "16.001", 760, 260),
    debug("ttknx_debug00001", "Log zdarzeń", 730, 340),
    {"id": "ttknx_switch0001", "type": "switch", "z": TAB, "name": "Która osoba (1–10)?",
     "property": "miejsce", "propertyType": "msg",
     "rules": [{"t": "eq", "v": str(i), "vt": "num"} for i in range(1, 11)],
     "checkall": "false", "repair": False, "outputs": 10,
     "outputLabels": [f"osoba {i}" for i in range(1, 11)],
     "x": 760, "y": 520, "wires": [[f"ttknx_knx_os{i:02d}_01"] for i in range(1, 11)]},

    comment("ttknx_cmt0000004", "④ WŁĄCZ / WYŁĄCZ automatykę z KNX (np. urlop, goście, sprzątanie)", "", 330, 360),
    knx("ttknx_knx_enabl01", "Automatyka wł/wył (7/4/0)", "7/4/0", "1.001", 190, 400,
        [["ttknx_fn_enable01"]], listen=True),
    func("ttknx_fn_enable01", "Zapamiętaj stan", src("enable.js"), 1, 440, 400, [[]]),

    comment("ttknx_cmt0000005", "⑤ TESTY – kliknij przycisk po lewej, wynik w zakładce Debug (🐞)", "", 330, 460),
    inject("ttknx_inj_test01", "TEST: odcisk palca „Anna”", "palec", 180, 500, [["ttknx_fn_sim00001"]]),
    inject("ttknx_inj_test02", "TEST: kod PIN „Piotr”", "pin", 170, 540, [["ttknx_fn_sim00001"]]),
    inject("ttknx_inj_test03", "TEST: otwarcie od środka", "srodek", 170, 580, [["ttknx_fn_sim00001"]]),
    inject("ttknx_inj_test04", "TEST: nieznany brelok", "nieznany", 160, 620, [["ttknx_fn_sim00001"]]),
    func("ttknx_fn_sim00001", "Symulacja callbacku", src("sim.js"), 1, 440, 560, [["ttknx_fn_parse001"]]),

    comment("ttknx_cmt0000006", "⑥ WYZWALACZE OSÓB – 1 na GA osoby, gdy ta osoba otworzy drzwi (DPT 1.001)",
            "Połącz w ETS z logiką / sceną / modułem czasowym. Wysyłane jest 1 przy każdym otwarciu.", 1060, 380),
    *[knx(f"ttknx_knx_os{i:02d}_01", f"Osoba {i} otworzyła (7/3/{i})", f"7/3/{i}", "1.001", 1040, 380 + i * 40)
      for i in range(1, 11)],

    comment("ttknx_cmt0000007", "⑦ SERWIS – co 6 h: odświeżenie tokenu TTLock, kontrola bramki i zegara → 7/4/1",
            "Wymaga danych TTLock w zmiennych zakładki (krok 10a). Bez nich serwis jest wyłączony (żółty status).\n"
            "7/4/1 = 1: integracja sprawna, 0: dwie kolejne kontrole nieudane (np. bramka offline 12 h).", 360, 700),
    inject("ttknx_inj_serw01", "Start + co 6 h", "", 140, 740, [["ttknx_fn_serwis01"]],
           once=True, repeat="21600", delay=60),
    func("ttknx_fn_serwis01", "Serwis TTLock", src("serwis.js"), 2, 380, 740,
         [["ttknx_knx_stat001"], ["ttknx_debug00001"]], ["integracja OK (KNX)", "log"], libs=LIBS_SERWIS),
    knx("ttknx_knx_stat001", "Integracja OK (7/4/1)", "7/4/1", "1.001", 640, 740),

    {"id": "ttknx_catch00001", "type": "catch", "z": TAB, "name": "Błędy w zakładce",
     "scope": None, "uncaught": False, "x": 150, "y": 800, "wires": [["ttknx_debug00002"]]},
    {"id": "ttknx_debug00002", "type": "debug", "z": TAB, "name": "Log błędów",
     "active": True, "tosidebar": True, "console": True, "tostatus": False,
     "complete": "error", "targetType": "msg", "statusVal": "", "statusType": "auto",
     "x": 380, "y": 800, "wires": []},

    {"id": CFG, "type": "knxUltimate-config", "host": "192.168.1.50", "port": "3671",
     "physAddr": "15.15.22", "hostProtocol": "TunnelUDP", "suppressACKRequest": False,
     "csv": "", "KNXEthInterface": "Auto", "KNXEthInterfaceManuallyInput": "",
     "stopETSImportIfNoDatapoint": "fake", "loglevel": "error", "name": "Interfejs KNX IP",
     "delaybetweentelegrams": 25, "ignoreTelegramsWithRepeatedFlag": False,
     "keyringFileXML": "", "knxSecureSelected": False, "secureCredentialsMode": "keyring",
     "tunnelIASelection": "Auto", "tunnelIA": "", "tunnelInterfaceIndividualAddress": "",
     "tunnelUserPassword": "", "tunnelUserId": "", "autoReconnect": "yes"},
]

ids = {n["id"] for n in flow}
assert len(ids) == len(flow), "powtórzone id węzłów"
for n in flow:
    for wyjscie in n.get("wires", []):
        for cel in wyjscie:
            assert cel in ids, f"{n['id']} -> nieistniejący węzeł {cel}"

cel = KATALOG / "flow-ttlock-knx.json"
cel.write_text(json.dumps(flow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"{cel.name}: {len(flow)} węzłów, wersja {WERSJA}")
