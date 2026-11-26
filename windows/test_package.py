"""Exercise the built Windows executable twice with its own disposable Edge profile."""
import functools
import argparse
import ctypes
from ctypes import wintypes
import json
import os
import re
import socket
import sqlite3
import subprocess
import tempfile
import time
from contextlib import closing, contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent


@contextmanager
def app_window(directory, port, exe):
    proc = subprocess.Popen([str(exe), "--data-dir", str(directory), "--port", str(port)])
    url = f"http://127.0.0.1:{port}/"
    try:
        for _ in range(120):
            if proc.poll() is not None:
                raise RuntimeError("Executable exited before opening its window")
            try:
                with urlopen(url + "desktop-info", timeout=1) as response:
                    if json.load(response)["app"] == "ADHD Todo":
                        break
            except OSError:
                time.sleep(0.25)
        else:
            raise RuntimeError("Executable did not start")
        yield url
    finally:
        # Close only the app window in this test's newly created dedicated profile.
        script = """
            Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
                $_.CommandLine -and $_.CommandLine.Contains($env:ADHD_QA_PROFILE) -and $_.CommandLine.Contains('--app=')
            } | Select-Object -ExpandProperty ProcessId
        """
        env = {**os.environ, "ADHD_QA_PROFILE": str(directory / "window")}
        saw_board = False
        for _ in range(20):
            owners = set(subprocess.check_output(["powershell", "-NoProfile", "-Command", script],
                                                 env=env, text=True).split())
            user32 = ctypes.windll.user32
            @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
            def close(hwnd, _):
                nonlocal saw_board
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if str(pid.value) in owners and user32.IsWindowVisible(hwnd):
                    title = ctypes.create_unicode_buffer(256)
                    user32.GetWindowTextW(hwnd, title, 256)
                    saw_board |= "ADHD Todo" in title.value
                    if saw_board and user32.IsWindowEnabled(hwnd):
                        user32.PostMessageW(hwnd, 0x10, 0, 0)  # WM_CLOSE, including any Edge first-run popup
                return True
            user32.EnumWindows(close, 0)
            if proc.poll() is not None:
                break
            time.sleep(0.5)
        if not saw_board:
            raise RuntimeError("Expected the packaged app's visible ADHD Todo window")
        if proc.wait(timeout=25) != 0:
            raise RuntimeError("Executable did not close cleanly")


class QuietFiles(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, default=ROOT / "windows/out/ADHD Todo.exe")
    exe = parser.parse_args().exe.resolve()
    handler = functools.partial(QuietFiles, directory=str(ROOT / "windows/.build/ui"))
    with tempfile.TemporaryDirectory() as tmp, ThreadingHTTPServer(("127.0.0.1", 0), handler) as web:
        Thread(target=web.serve_forever, daemon=True).start()
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        directory = Path(tmp)
        try:
            with app_window(directory, port, exe) as url:
                subprocess.run(["node", "--experimental-strip-types", "windows/test_transfer.mjs",
                                f"http://127.0.0.1:{web.server_port}/", url], cwd=ROOT, check=True)
            with closing(sqlite3.connect(directory / "boards.sqlite")) as db:
                assert db.execute("SELECT balance FROM boards").fetchall() == [(4,)]
                assert db.execute("SELECT count(*) FROM completion_metrics").fetchone()[0] == 2
            with app_window(directory, port, exe) as url:
                with urlopen(url) as response:
                    token = re.search(rb'name="desktop-session" content="([0-9a-f]+)"', response.read())[1].decode()
                with urlopen(Request(url + "api/state", headers={"X-Desktop-Session": token})) as response:
                    board = json.load(response)["state"]["boards"][0]
                    assert board["balance"] == 4 and board["rounds"][-1]["end"] is None and len(board["history"]) == 2
            print("Packaged native window launched, closed and reopened with persisted SQLite data.")
        finally:
            web.shutdown()
