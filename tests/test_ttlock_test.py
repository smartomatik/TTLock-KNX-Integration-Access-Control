#!/usr/bin/env python3
"""Testy skryptu tools/ttlock_test.py bez sieci (tylko biblioteka standardowa).

    python3 tests/test_ttlock_test.py
"""
import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import ttlock_test as t  # noqa: E402


class Odpowiedz(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def urlopen_zwraca(tresc):
    return mock.patch("urllib.request.urlopen", return_value=Odpowiedz(tresc.encode()))


def urlopen_rzuca(wyjatek):
    return mock.patch("urllib.request.urlopen", side_effect=wyjatek)


class TestCall(unittest.TestCase):
    def test_poprawna_odpowiedz(self):
        with urlopen_zwraca('{"list": [], "pages": 1}'):
            self.assertEqual(t.call("/v3/lock/list", {}), {"list": [], "pages": 1})

    def test_http_404_html_czytelny_blad(self):
        blad = urllib.error.HTTPError("u", 404, "Not Found", {}, io.BytesIO(b"<!doctype html>404"))
        with urlopen_rzuca(blad), self.assertRaises(SystemExit) as e:
            t.call("/v3/lock/get", {})
        self.assertIn("Błąd HTTP 404", str(e.exception.code))

    def test_brak_internetu_czytelny_blad(self):
        with urlopen_rzuca(urllib.error.URLError("nodename nor servname provided")), self.assertRaises(SystemExit) as e:
            t.call("/oauth2/token", {}, method="POST")
        self.assertIn("Nie można połączyć", str(e.exception.code))

    def test_timeout_czytelny_blad(self):
        with urlopen_rzuca(TimeoutError()), self.assertRaises(SystemExit) as e:
            t.call("/v3/lock/list", {})
        self.assertIn("limit czasu", str(e.exception.code))

    def test_odpowiedz_nie_json(self):
        with urlopen_zwraca("<html>blad</html>"), self.assertRaises(SystemExit) as e:
            t.call("/v3/lock/list", {})
        self.assertIn("nie jest JSON", str(e.exception.code))

    def test_blad_api(self):
        with urlopen_zwraca('{"errcode": 10000, "errmsg": "invalid client_id"}'), self.assertRaises(SystemExit) as e:
            t.call("/v3/lock/list", {})
        self.assertIn("10000", str(e.exception.code))

    def test_token_wygasl_10004(self):
        with urlopen_zwraca('{"errcode": 10004, "errmsg": "invalid grant"}'), self.assertRaises(SystemExit) as e:
            t.call("/v3/lock/list", {})
        self.assertIn("Token wygasł", str(e.exception.code))

    def test_errcode_0_to_sukces(self):
        with urlopen_zwraca('{"errcode": 0, "errmsg": "none error message"}'):
            self.assertEqual(t.call("/x", {})["errcode"], 0)


class TestOpis(unittest.TestCase):
    def rekord(self, **k):
        r = {"recordType": 8, "success": 1, "username": "Anna", "lockDate": 1_700_000_000_000,
             "serverDate": 1_700_000_001_000, "keyboardPwd": "123456"}
        r.update(k)
        return r

    def test_pin_maskowany(self):
        for typ in (4, 34, 53, 78, 92):
            self.assertNotIn("123456", t.describe(self.rekord(recordType=typ)), typ)

    def test_numer_odcisku_widoczny(self):
        self.assertIn("123456", t.describe(self.rekord(recordType=8)))

    def test_61_typow(self):
        self.assertEqual(len(t.RECORD_TYPES), 61)

    def test_nieznany_typ(self):
        self.assertIn("typ 999", t.describe(self.rekord(recordType=999)))


class TestOdbiornik(unittest.TestCase):
    def test_callback_odpowiada_success(self):
        import threading
        import urllib.parse
        import urllib.request
        from http.server import HTTPServer
        serwer = HTTPServer(("127.0.0.1", 0), t.CallbackHandler)
        watek = threading.Thread(target=serwer.handle_request, daemon=True)
        watek.start()
        dane = urllib.parse.urlencode({"lockId": "1", "notifyType": "1", "records": json.dumps([
            {"recordType": 4, "success": 1, "username": "Piotr", "keyboardPwd": "654321",
             "lockDate": 1_700_000_000_000, "serverDate": 1_700_000_000_500}])}).encode()
        wyjscie = io.StringIO()
        with mock.patch("sys.stdout", wyjscie):
            odp = urllib.request.urlopen(f"http://127.0.0.1:{serwer.server_port}/cb", data=dane, timeout=5).read()
        watek.join(5)
        serwer.server_close()
        self.assertEqual(odp, b"success")
        self.assertNotIn("654321", wyjscie.getvalue())
        self.assertIn("Piotr", wyjscie.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)
