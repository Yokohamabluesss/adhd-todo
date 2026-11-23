"""The on-disk tables match the portable web archive; a local revision guards edits."""
import json
import sqlite3
from contextlib import closing, contextmanager

import rules

CONFLICT = "This board changed in another tab. Please try again."


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


class Conflict(ValueError):
    pass


def read_board(db, row):
    bid, name, balance, layout = row
    board = dict(json.loads(layout), id=bid, name=name, balance=balance)
    board["rounds"] = [dict(id=i, day=d, start=s, end=e, success=bool(ok)) for i, d, s, e, ok in
                       db.execute("SELECT id,day,start,end,success FROM rounds WHERE board=? ORDER BY rowid", (bid,))]
    board["history"] = [dict(json.loads(attrs), round=r, source=s, title=t, minutes=m, at=a, points=p)
                        for r, s, t, m, a, p, attrs in db.execute(
                            "SELECT round,source,title,minutes,at,points,attributes FROM completions WHERE board=? ORDER BY rowid", (bid,))]
    board["events"] = [dict(kind=k, at=a, day=d, round=r, data=json.loads(data)) for k, a, d, r, data in
                       db.execute("SELECT kind,at,day,round,data FROM board_events WHERE board=? ORDER BY rowid", (bid,))]
    return board


def write_board(db, b, offsets=(0, 0, 0)):
    bid = b["id"]
    layout = {k: v for k, v in b.items() if k not in ("id", "name", "balance", "rounds", "history", "events")}
    db.execute("""INSERT INTO boards VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                  name=excluded.name,balance=excluded.balance,layout=excluded.layout""",
               (bid, b["name"], b["balance"], encode(layout)))
    db.executemany("INSERT INTO rounds VALUES(?,?,?,?,?,?)",
                   ((r["id"], bid, r["day"], r["start"], r["end"], r["success"]) for r in b["rounds"][offsets[0]:]))
    fields = ("round", "source", "title", "minutes", "at", "points")
    db.executemany("INSERT INTO completions VALUES(?,?,?,?,?,?,?,?)",
                   ((bid, *(e[k] for k in fields), encode({k: v for k, v in e.items() if k not in fields}))
                    for e in b["history"][offsets[1]:]))
    db.executemany("INSERT INTO board_events VALUES(?,?,?,?,?,?)",
                   ((bid, e["kind"], e["at"], e["day"], e["round"], encode(e["data"])) for e in b["events"][offsets[2]:]))


class Store:
    def __init__(self, path, schema):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as db:
            if not db.execute("SELECT 1 FROM sqlite_schema WHERE type='table'").fetchone():
                db.executescript("BEGIN IMMEDIATE;\n" + schema + "\nPRAGMA user_version=3; COMMIT;")
            if db.execute("PRAGMA user_version").fetchone()[0] != 3:
                raise ValueError("Open this save through Saves → Import a save in the app.")
            db.execute("CREATE TABLE IF NOT EXISTS desktop_revision (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)")
            db.execute("INSERT OR IGNORE INTO desktop_revision VALUES(1,0)")
            db.commit()

    @contextmanager
    def transaction(self, write=False):
        with closing(sqlite3.connect(self.path, timeout=12)) as db, db:
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db

    def snapshot(self, db):
        default = db.execute("SELECT default_board FROM settings").fetchone()
        boards = [read_board(db, row) for row in db.execute("SELECT id,name,balance,layout FROM boards ORDER BY rowid")]
        return {"revision": db.execute("SELECT version FROM desktop_revision").fetchone()[0],
                "state": {"boards": boards, "defaultId": default[0]} if default else None}

    def request(self, route, payload=None):
        writing = route in ("action", "save")
        with self.transaction(write=writing) as db:
            if route == "state":
                return self.snapshot(db)
            current = db.execute("SELECT version FROM desktop_revision").fetchone()[0]
            if payload["revision"] != current:
                raise Conflict(CONFLICT)
            if route == "save":
                # Forms, sample seeding and validated imports use the shared UI's workspace model.
                state = payload["state"]
                rules.require(state["defaultId"] in [b["id"] for b in state["boards"]], "Missing default board.")
                for table in ("settings", "rounds", "completions", "board_events", "boards"):
                    db.execute(f"DELETE FROM {table}")
                db.execute("INSERT INTO settings VALUES(?)", (state["defaultId"],))
                for board in state["boards"]:
                    write_board(db, board)
            else:
                row = db.execute("SELECT id,name,balance,layout FROM boards WHERE id=?", (payload["board"],)).fetchone()
                rules.require(row, "This board is no longer available.")
                board = read_board(db, row)
                if route == "pick":
                    return rules.pick(board)
                rules.require(route == "action", "Unknown board action.")
                action = payload["action"]
                offsets = tuple(len(board[key]) for key in ("rounds", "history", "events"))
                # Only the open round can change in place during ordinary play.
                open_round = rules.active(board)
                rules.apply(board, action)
                if action["kind"] == "reset":
                    offsets = (0, 0, 0)
                    for table in ("rounds", "completions", "board_events"):
                        db.execute(f"DELETE FROM {table} WHERE board=?", (board["id"],))
                elif open_round:
                    db.execute("UPDATE rounds SET end=?,success=? WHERE id=? AND board=?",
                               (open_round["end"], open_round["success"], open_round["id"], board["id"]))
                write_board(db, board, offsets)
            db.execute("UPDATE desktop_revision SET version=version+1")
            result = self.snapshot(db)
            if any(b.get("noteImages") for b in result["state"]["boards"]):
                pages = db.execute("PRAGMA page_count").fetchone()[0] - db.execute("PRAGMA freelist_count").fetchone()[0]
                rules.require(pages * db.execute("PRAGMA page_size").fetchone()[0] <= 64 * 1024**2,
                              "This save exceeds 64 MB. Remove an attached image and try again.")
            return result
