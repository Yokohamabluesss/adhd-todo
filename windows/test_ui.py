"""Run the existing browser regression suite against disposable native databases."""
import argparse
import os
import subprocess
import sys
import tempfile
from contextlib import ExitStack
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def serve(stack, directory):
    process = subprocess.Popen([sys.executable, str(ROOT / "windows/app.py"), "--serve-only",
                                "--port", "0", "--data-dir", str(directory)], stdout=subprocess.PIPE, text=True)
    def stop():
        process.terminate()
        process.wait(timeout=15)
        process.stdout.close()
    stack.callback(stop)
    url = process.stdout.readline().strip()
    if not url.startswith("http://127.0.0.1:"):
        raise RuntimeError("Could not open the test app")
    return url


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docs", action="store_true", help="Replay both illustrated guides and save their screenshots.")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as temp, ExitStack() as stack:
        env = os.environ.copy()
        for name in ("DESKTOP_QA_URL", "LANGUAGE_QA_URL", "TOUCH_QA_URL"):
            env[name] = serve(stack, Path(temp) / name)
        docs = ROOT / "windows" / "docs"
        env["QA_SCREENSHOTS"] = str(docs if args.docs else Path(temp) / "screenshots")
        subprocess.run(["node", "tests/browser.mjs"], env=env, cwd=ROOT, check=True)
        if args.docs:
            env["QA_DOCS_ROOT"] = str(docs)
            for script, targets in [
                ("walkthrough", ("DESKTOP_QA_URL", "TOUCH_QA_URL")),
                ("detailed-walkthrough", ("DESKTOP_QA_URL", "IMPORT_QA_URL")),
            ]:
                for name in targets:
                    env[name] = serve(stack, Path(temp) / script / name)
                subprocess.run(["node", f"tests/{script}.mjs"], env=env, cwd=ROOT, check=True)
