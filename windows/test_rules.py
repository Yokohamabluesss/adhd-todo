import json
import re
import sqlite3
import subprocess
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path

import rules
from store import Conflict, Store

ROOT = Path(__file__).resolve().parent.parent


def comparable(board):
    # Both engines mint independent UUIDs. Preserve all identity relationships.
    ids = {}
    def visit(v):
        if isinstance(v, str) and re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", v):
            return ids.setdefault(v, len(ids))
        if isinstance(v, list):
            return list(map(visit, v))
        if isinstance(v, dict):
            return {k: visit(v[k]) for k in sorted(v)}
        return v
    return visit(board)


class DesktopTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.check_output(["node", "--experimental-strip-types", "windows/parity.mjs"], cwd=ROOT)
        cls.cases = json.loads(out)

    def test_against_web_rules(self):
        for case in self.cases:
            b = deepcopy(case["initial"])
            for step in case["steps"]:
                a = step["action"]
                with self.subTest(board=b["name"], action=a, at=step["at"]):
                    class Fixed:
                        def random(self):
                            return a.get("random", 0.31)
                    def run():
                        if a["kind"] == "pick":
                            return rules.pick(b, Fixed())
                        rules.apply(b, a, at=step["at"], rng=Fixed())
                    if step["error"]:
                        with self.assertRaises(ValueError) as exc:
                            run()
                        self.assertEqual(str(exc.exception), step["error"])
                    else:
                        self.assertEqual(run(), step["result"])
                    self.assertEqual(comparable(b), comparable(step["state"]))

    def test_duplicate_requests_rollback_and_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "boards.sqlite"
            schema = (ROOT / "windows/.build/schema.sql").read_text()
            db = Store(path, schema)
            b = deepcopy(self.cases[0]["initial"])
            b["cells"][0] = b["daily"]["slots"][1]
            db.request("save", dict(state=dict(boards=[b], defaultId=b["id"]), revision=0))
            db.request("action", dict(board=b["id"], action=dict(kind="start"), revision=1))
            def complete(_):
                try:
                    db.request("action", dict(board=b["id"], action=dict(kind="complete", index=0), revision=2))
                    return True
                except Conflict:
                    return False
            with ThreadPoolExecutor(2) as pool:
                self.assertEqual(sorted(pool.map(complete, range(2))), [False, True])
            saved = db.request("state")
            result = saved["state"]["boards"][0]
            self.assertEqual((result["balance"], len(result["history"]), saved["revision"]), (2, 1, 3))
            with self.assertRaises(sqlite3.IntegrityError):
                invalid = deepcopy(saved)
                invalid["state"]["boards"][0]["rounds"] *= 2
                db.request("save", invalid)
            self.assertEqual(Store(path, schema).request("state"), saved)


if __name__ == "__main__":
    unittest.main()
