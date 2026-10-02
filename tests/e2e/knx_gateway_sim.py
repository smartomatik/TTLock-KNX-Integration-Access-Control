#!/usr/bin/env python3
"""Minimalny emulator interfejsu KNX IP (KNXnet/IP tunneling, UDP) do testów end-to-end.

Przyjmuje połączenie tunelowe z Node-RED (knx-ultimate), potwierdza telegramy i zapisuje
je do pamięci. Sterowanie przez HTTP na porcie --http:
    GET /log                     -> lista odebranych telegramów (JSON)
    GET /clear                   -> czyści listę
    GET /send?ga=7/4/0&val=0     -> wysyła GroupValueWrite (DPT 1) z "magistrali" do Node-RED
    GET /state                   -> czy tunel jest połączony
Tylko biblioteka standardowa. Nie jest to pełna implementacja KNXnet/IP – wyłącznie do testów.
"""
import argparse
import json
import socket
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

HDR = b"\x06\x10"
CHANNEL = 7
TUNNEL_IA = (1 << 12) | (1 << 8) | 250      # 1.1.250

state = {"client": None, "seq_out": 0, "telegrams": [], "connected": False}
lock = threading.Lock()
sock = None


def frame(service, body):
    return HDR + struct.pack(">HH", service, 6 + len(body)) + body


def ga_str(raw):
    return f"{raw >> 11}/{(raw >> 8) & 7}/{raw & 0xFF}"


def ga_raw(text):
    a, b, c = (int(x) for x in text.split("/"))
    return (a << 11) | (b << 8) | c


def parse_cemi(cemi):
    msg = cemi[0]
    add_len = cemi[1]
    p = 2 + add_len
    src, dst, length = struct.unpack(">HHB", cemi[p + 2:p + 7])
    apdu = cemi[p + 7:p + 7 + length + 1]
    apci = ((apdu[0] & 0x03) << 8 | apdu[1]) & 0x3C0
    kind = {0x000: "read", 0x040: "response", 0x080: "write"}.get(apci, hex(apci))
    data = [apdu[1] & 0x3F] if length == 1 else list(apdu[2:])
    return {"msg": msg, "ga": ga_str(dst), "typ": kind, "dane": data, "hex": bytes(data).hex()}


def send_to_client(cemi):
    with lock:
        client = state["client"]
        seq = state["seq_out"]
        state["seq_out"] = (seq + 1) & 0xFF
    if client:
        sock.sendto(frame(0x0420, bytes([4, CHANNEL, seq, 0]) + cemi), client)


def udp_loop(port):
    global sock
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port))
    hpai = bytes([8, 1, 127, 0, 0, 1]) + struct.pack(">H", port)
    while True:
        data, addr = sock.recvfrom(2048)
        if len(data) < 6 or data[:2] != HDR:
            continue
        service = struct.unpack(">H", data[2:4])[0]
        body = data[6:]
        if service == 0x0205:                                   # CONNECT_REQUEST
            with lock:
                state.update(client=addr, seq_out=0, connected=True)
            sock.sendto(frame(0x0206, bytes([CHANNEL, 0]) + hpai + bytes([4, 4]) + struct.pack(">H", TUNNEL_IA)), addr)
        elif service == 0x0207:                                 # CONNECTIONSTATE_REQUEST
            sock.sendto(frame(0x0208, bytes([body[0], 0])), addr)
        elif service == 0x0209:                                 # DISCONNECT_REQUEST
            sock.sendto(frame(0x020A, bytes([body[0], 0])), addr)
            with lock:
                state["connected"] = False
        elif service == 0x0420:                                 # TUNNELING_REQUEST
            seq = body[2]
            sock.sendto(frame(0x0421, bytes([4, body[1], seq, 0])), addr)
            cemi = body[4:]
            try:
                t = parse_cemi(cemi)
            except Exception as e:                              # noqa: BLE001 - emulator testowy
                t = {"blad": str(e), "hex": cemi.hex()}
            t["czas"] = time.time()
            with lock:
                state["telegrams"].append(t)
            if cemi and cemi[0] == 0x11:                        # L_Data.req -> L_Data.con
                send_to_client(bytes([0x2E]) + cemi[1:])
        # 0x0421 (ACK od klienta) – ignorujemy


class Control(BaseHTTPRequestHandler):
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        out = {"ok": True}
        if u.path == "/log":
            with lock:
                out = list(state["telegrams"])
        elif u.path == "/clear":
            with lock:
                state["telegrams"].clear()
        elif u.path == "/state":
            with lock:
                out = {"connected": state["connected"]}
        elif u.path == "/send":
            val = int(q["val"][0]) & 1
            cemi = bytes([0x29, 0x00, 0xBC, 0xE0]) + struct.pack(">HH", (1 << 12) | (1 << 8) | 5, ga_raw(q["ga"][0])) \
                + bytes([1, 0x00, 0x80 | val])
            send_to_client(cemi)
        body = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--knx", type=int, default=13671)
    ap.add_argument("--http", type=int, default=13672)
    a = ap.parse_args()
    threading.Thread(target=udp_loop, args=(a.knx,), daemon=True).start()
    print(f"Emulator KNX IP: udp 127.0.0.1:{a.knx}, sterowanie http 127.0.0.1:{a.http}", flush=True)
    HTTPServer(("127.0.0.1", a.http), Control).serve_forever()
