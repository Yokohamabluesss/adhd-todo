"""Serve the shared, bundled UI on loopback and open it in an Edge app window."""
import argparse
import ctypes
import hashlib
import hmac
import json
import os
import secrets
import socket
import sqlite3
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
from urllib.request import urlopen

from store import Conflict, Store, encode

PRODUCT = "ADHD Todo"
DEFAULT_PORT = 4176
RESOURCES = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent / ".build"))


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body, mime="application/json"):
        data = body if isinstance(body, bytes) else encode(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(data)

    def allowed(self, api=False):
        host = self.server.authority
        valid = self.headers.get("Host") == host
        if api:
            valid = (valid and self.headers.get("Origin", "http://" + host) == "http://" + host
                     and hmac.compare_digest(self.headers.get("X-Desktop-Session", ""), self.server.token))
        if not valid:
            self.reply(403, {"error": "Local session required."})
        return valid

    def do_GET(self):
        path = urlsplit(self.path).path
        if not self.allowed(api=path == "/api/state"):
            return
        if path == "/api/state":
            self.operate("state")
        elif path == "/desktop-info":
            self.reply(200, {"app": PRODUCT, "instance": self.server.instance})
        elif path in ("/", "/index.html"):
            self.reply(200, self.server.html, "text/html; charset=utf-8")
        elif path.startswith("/assets/"):
            file = (RESOURCES / "ui" / path[1:]).resolve()
            types = {".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm"}
            if file.is_relative_to((RESOURCES / "ui/assets").resolve()) and file.suffix in types and file.is_file():
                self.reply(200, file.read_bytes(), types[file.suffix])
            else:
                self.reply(404, {"error": "Unknown asset."})
        else:
            self.reply(404, {"error": "Unknown path."})

    def do_POST(self):
        if not self.allowed(api=True):
            return
        if self.path not in ("/api/save", "/api/action", "/api/pick"):
            self.reply(404, {"error": "Unknown path."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 192 * 1024**2 or self.headers.get_content_type() != "application/json":
                raise ValueError()
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError()
        except (ValueError, UnicodeError):
            self.reply(400, {"error": "Invalid request."})
            return
        self.operate(self.path[5:], payload)

    def operate(self, route, payload=None):
        try:
            self.reply(200, self.server.store.request(route, payload))
        except Conflict as exc:
            self.reply(409, {"error": str(exc)})
        except ValueError as exc:
            self.reply(400, {"error": str(exc)})
        except (KeyError, TypeError, IndexError, sqlite3.IntegrityError):
            self.reply(400, {"error": "Invalid board data."})
        except sqlite3.Error:
            self.reply(500, {"error": "Could not save on this device."})


def edge_window(url, data_dir):
    for variable in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        edge = Path(os.environ.get(variable, "")) / "Microsoft/Edge/Application/msedge.exe"
        if edge.is_file():
            return subprocess.Popen([str(edge), "--app=" + url, "--user-data-dir=" + str(data_dir / "window"),
                                     "--no-first-run", "--disable-background-mode",
                                     "--disable-features=Translate,msEdgeStartupBoost"])
    raise RuntimeError("Install Microsoft Edge to open the Windows app window.")


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("LOCALAPPDATA", Path.home())) / PRODUCT)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--serve-only", action="store_true", help="Serve the app locally without opening a window")
    args = parser.parse_args()
    data_dir = args.data_dir.resolve()
    # Use a path fingerprint to distinguish an existing app from a different local service.
    instance = hashlib.sha256(os.fsencode(os.path.normcase(data_dir))).hexdigest()
    url = f"http://127.0.0.1:{args.port}/"
    try:
        server = LocalServer(("127.0.0.1", args.port), Handler)
    except OSError:
        try:
            with urlopen(url + "desktop-info", timeout=2) as response:
                existing = json.load(response)
        except (OSError, ValueError):
            existing = None
        if not args.serve_only and existing == {"app": PRODUCT, "instance": instance}:
            edge_window(url, data_dir)
            return
        raise RuntimeError(f"Local port {args.port} is already in use. Close the other service or choose --port.")
    with server:
        server.authority = f"127.0.0.1:{server.server_port}"
        server.instance = instance
        server.token = secrets.token_hex(32)
        page = (RESOURCES / "ui/index.html").read_text(encoding="utf-8")
        server.html = page.replace("<head>", f'<head><meta name="desktop-session" content="{server.token}">').encode()
        server.store = Store(data_dir / "boards.sqlite", (RESOURCES / "schema.sql").read_text(encoding="utf-8"))
        if args.serve_only:
            if sys.stdout is not None:
                print("http://" + server.authority + "/", flush=True)
            server.serve_forever()
        else:
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                edge_window("http://" + server.authority + "/", data_dir).wait()
            finally:
                server.shutdown()
                thread.join()


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:
        if getattr(sys, "frozen", False) and sys.stderr is None:
            ctypes.windll.user32.MessageBoxW(None, str(exc), PRODUCT, 0x10)
        else:
            raise
