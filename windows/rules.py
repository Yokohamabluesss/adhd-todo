"""State transitions for one board. Storage commits the result as one transaction."""
import random
import time
from copy import deepcopy
from datetime import datetime, timedelta
from uuid import uuid4


def require(condition, message):
    if not condition:
        raise ValueError(message)


def task(cell):
    return isinstance(cell, dict) and "source" in cell


def done(cell):
    return isinstance(cell, dict) and cell.get("done") is True


def active(board):
    return next((r for r in board["rounds"] if r["end"] is None), None)


def day(at, boundary):
    now = datetime.fromtimestamp(at / 1000)
    hour, minute = map(int, boundary.split(":"))
    start = now.replace(hour=hour, minute=minute, second=0, microsecond=0, fold=0)
    return (now.date() - timedelta(days=at / 1000 < start.timestamp())).isoformat()


def axes(size):
    for i in range(size):
        yield [i * size + j for j in range(size)]
        yield [j * size + i for j in range(size)]
    yield [i * (size + 1) for i in range(size)]
    yield [(i + 1) * (size - 1) for i in range(size)]


def lines(board):
    return [axis for axis in axes(board["size"]) if all(done(board["cells"][i]) for i in axis)]


def line_names(board):
    return "|".join(",".join(map(str, axis)) for axis in lines(board))


def candidates(board):
    tasks = [i for i, c in enumerate(board["cells"]) if task(c)]
    return [i for i in tasks if board["cells"][i]["priority"] == "X"] or tasks


def pick(board, rng=random):
    require(active(board), "Start a round first.")
    pool = candidates(board)
    require(pool, "There are no tasks left to draw.")
    weights = [board["weights"].get(board["cells"][i]["priority"], 1) for i in pool]
    ticket = int(rng.random() * sum(weights))
    for i, weight in zip(pool, weights):
        ticket -= weight
        if ticket < 0:
            return i
    raise ValueError("Invalid random draw.")


def evaluate(board, just_completed=False):
    r = active(board)
    if r and not r["success"]:
        tasks = [c for c in board["cells"] if task(c)]
        if (just_completed and not tasks) or (lines(board) and all(c["priority"] != "X" for c in tasks)):
            r["success"] = True


def distance(board):
    if active(board)["success"]:
        return 0
    cells = board["cells"]
    tasks = {i for i, c in enumerate(cells) if task(c)}
    if not tasks:
        return None
    must = {i for i in tasks if cells[i]["priority"] == "X"}
    best = len(tasks)
    for axis in axes(board["size"]):
        if all(cells[i] is not None for i in axis):
            best = min(best, len(must | tasks.intersection(axis)))
    return best


def record(board, kind, at, data):
    r = active(board)
    board["events"].append(dict(kind=kind, at=at, round=r["id"] if r else None,
                                day=r["day"] if r else day(at, board["dayStart"]), data=data))


def attributes(t, square):
    return {**{key: t.get(key) for key in ("source", "placement", "library", "category", "priority")},
            "square": square}


def finish(board, at):
    r = active(board)
    require(r, "Start a round first.")
    record(board, "ended", at, dict(size=board["size"], remaining=distance(board),
                                    completed=sum(map(done, board["cells"]))))
    r["end"] = at
    board["cells"] = [None if done(c) else c for c in board["cells"]]


def key(cell):
    if task(cell):
        return {k: v for k, v in cell.items() if k != "placement"}
    return "done" if done(cell) else None


def randomize(items, rng):
    for i in range(len(items) - 1, 0, -1):
        j = int(rng.random() * (i + 1))
        items[i], items[j] = items[j], items[i]


def shuffle(board, at, rng):
    r = active(board)
    require(r, "Start a round first.")
    cells = board["cells"]
    cost = sum(map(done, cells))
    require(board["balance"] >= cost, "There are not enough points to shuffle.")
    width = board["size"] if board["grouped"] else len(cells)
    groups = [cells[i:i + width] for i in range(0, len(cells), width)]
    movable = next((g for g in groups if any(key(c) != key(g[0]) for c in g)), None)
    require(movable, "There is no different arrangement to shuffle into.")
    for group in groups:
        randomize(group, rng)
    if [key(c) for g in groups for c in g] == list(map(key, cells)):
        j = next(i for i, c in enumerate(movable) if key(c) != key(movable[0]))
        movable[0], movable[j] = movable[j], movable[0]
    board["cells"] = [c for g in groups for c in g]
    board["balance"] -= cost
    if cost:
        spending = board.setdefault("shuffleSpending", {})
        spending[r["day"]] = spending.get(r["day"], 0) + cost
    evaluate(board)
    record(board, "shuffled", at, dict(completed=cost, size=board["size"], lines=line_names(board)))


def reset(board, scope, at, expected_day):
    r = active(board)
    if scope == "grid":
        for i, c in enumerate(board["cells"]):
            if task(c):
                record(board, "removed", at, attributes(c, i))
        if r:
            finish(board, at)
        board["cells"] = [None] * len(board["cells"])
        return
    require(scope in ("all", "today"), "Invalid reset.")
    today = day(at, board["dayStart"])
    require(scope == "all" or expected_day == today, "A new board day has begun. Open Reset again to review the date.")
    removed = {item["id"] for item in board["rounds"] if scope == "all" or item["day"] == today}
    if r and r["id"] in removed:
        entries = [item for item in board["history"] if item["round"] == r["id"]]
        used = {c["entry"] for c in board["cells"] if done(c) and "entry" in c}
        unused = iter(i for i in range(len(entries)) if i not in used)
        for i, cell in enumerate(board["cells"]):
            if done(cell):
                j = cell["entry"] if "entry" in cell else next(unused, -1)
                require(0 <= j < len(entries), "A completed square has no matching task in this save.")
                board["cells"][i] = {k: v for k, v in entries[j].items()
                                     if k not in ("round", "at", "points", "activityDay")}
    earned = sum(e["points"] for e in board["history"] if e["round"] in removed)
    spent = board.get("shuffleSpending", {}).pop(today, 0)
    board["balance"] = 0 if scope == "all" else max(0, board["balance"] - earned + spent)
    if scope == "all":
        board.pop("shuffleSpending", None)
    board["history"] = [e for e in board["history"] if e["round"] not in removed]
    board["rounds"] = [item for item in board["rounds"] if item["id"] not in removed]
    board["events"] = [e for e in board["events"] if scope != "all" and e["day"] != today]
    for c in board["cells"]:
        if task(c):
            for step in c.get("steps", {}).get("slots", []):
                if step and step.get("done") and (scope == "all" or step.get("doneDay") == today):
                    step["done"] = False
                    step.pop("doneDay", None)


def index_of(slots, index):
    require(type(index) is int and 0 <= index < len(slots), "Choose a valid square.")
    return index


def empty_library_slot(board, library, slot=None):
    slots = board[library]["slots"]
    label = "everyday" if library == "daily" else "one-off"
    if slot is None:
        require(None in slots, f"Make room in the {label} library first.")
        return slots.index(None)
    require(slots[index_of(slots, slot)] is None, f"Choose an empty slot in the {label} library.")
    return slot


def library_action(board, action, at):
    source = action["from"]
    copying = action["kind"] == "copy"
    require(source in ("daily", "temporary") or (copying and source == "board"), "Invalid library.")
    slots = board["cells"] if source == "board" else board[source]["slots"]
    index = index_of(slots, action["index"])
    original = slots[index]
    require(task(original), "Select an unfinished task.")
    if copying:
        target = empty_library_slot(board, original["library"])
        item = dict(deepcopy(original), source=str(uuid4()))
        item.pop("placement", None)
        board[item["library"]]["slots"][target] = item
        record(board, "created", at, {k: item[k] for k in ("source", "library", "category", "priority")})
    else:
        library = "temporary" if source == "daily" else "daily"
        target = empty_library_slot(board, library, action.get("slot"))
        board[library]["slots"][target] = dict(original, library=library)
        slots[index] = None


def transfer(board, action, at):
    cells = board["cells"]
    kind = action["kind"]
    if kind in ("place", "move"):
        to = index_of(cells, action["to"])
        if kind == "move":
            require(not active(board), "Use Shuffle to rearrange an active round.")
            i = index_of(cells, action["from"])
            require(task(cells[i]), "Select a task to move.")
            cells[to], cells[i] = cells[i], cells[to]
        else:
            library = action["library"]
            require(library in ("daily", "temporary"), "Invalid library.")
            slots = board[library]["slots"]
            i = index_of(slots, action["from"])
            require(task(slots[i]) and cells[to] is None, "Choose an empty board square.")
            cells[to] = dict(deepcopy(slots[i]), placement=str(uuid4()))
            record(board, "placed", at, dict(attributes(cells[to], to), size=board["size"]))
            if library == "temporary":
                slots[i] = None
        return
    i = index_of(cells, action["index"])
    t = cells[i]
    require(task(t), "Select an unfinished task.")
    if kind == "return":
        dest = action.get("destination")
        library = t["library"]
        label = "everyday" if library == "daily" else "one-off"
        require(not dest or dest["library"] == library, f"Return this task to the {label} library.")
        slots = board[library]["slots"]
        if library == "temporary" or (dest and not any(c and c["source"] == t["source"] for c in slots)):
            free = empty_library_slot(board, library, (dest or {}).get("slot"))
            slots[free] = {k: v for k, v in t.items() if k != "placement"}
    cells[i] = None
    record(board, "removed", at, attributes(t, i))
    evaluate(board)


def random_fill(board, daily, at, rng):
    empty = [i for i, cell in enumerate(board["cells"]) if cell is None]
    require(type(daily) is int and 0 <= daily <= len(empty), "Choose a count within the empty squares.")
    randomize(empty, rng)
    targets = iter(empty)
    for library, quota in (("daily", daily), ("temporary", len(empty) - daily)):
        slots = board[library]["slots"]
        candidates = [i for i, item in enumerate(slots) if item is not None]
        randomize(candidates, rng)
        candidates.sort(key=lambda i: slots[i]["priority"] != "X")
        for index in candidates[:quota]:
            transfer(board, {"kind": "place", "library": library, "from": index, "to": next(targets)}, at)


def apply(board, action, at=None, rng=random):
    at = time.time_ns() // 1_000_000 if at is None else at
    kind = action["kind"]
    cells = board["cells"]
    r = active(board)
    if kind == "start":
        require(not r, "A round is already open.")
        require(any(map(task, cells)), "Place at least one task before starting.")
        board["rounds"].append(dict(id=str(uuid4()), day=day(at, board["dayStart"]),
                                    start=at, end=None, success=False))
    elif kind in ("complete", "recordDraw"):
        i = index_of(cells, action["index"])
        t = cells[i]
        if kind == "recordDraw":
            pool = candidates(board)
            require(r and i in pool, "The draw changed. Please draw again.")
        else:
            require(r and task(t), "Select an unfinished task in an active round.")
        if not t.get("placement"):
            t["placement"] = str(uuid4())
        cost = sum(map(done, cells))
        data = dict(attributes(t, i), size=board["size"])
        if kind == "complete":
            points = max(1, t["minutes"] // 30)
            board["history"].append(dict(t, points=points, at=at, round=r["id"], activityDay=day(at, board["dayStart"])))
            cells[i] = dict(done=True, entry=cost)
            board["balance"] += points
            record(board, "completed", at, dict(data, lines=line_names(board)))
            evaluate(board, just_completed=True)
        else:
            record(board, "drawn", at, dict(data, eligible=len(pool), completed=cost, mustDo=int(t["priority"] == "X")))
    elif kind == "finish":
        finish(board, at)
    elif kind == "shuffle":
        shuffle(board, at, rng)
    elif kind == "reset":
        reset(board, action["scope"], at, action.get("day"))
    elif kind in ("place", "move", "return", "discard"):
        transfer(board, action, at)
    elif kind in ("copy", "convert"):
        library_action(board, action, at)
    elif kind == "fill":
        random_fill(board, action["daily"], at, rng)
    else:
        raise ValueError("Unknown board action.")
    if "noteImages" in board:
        items = board["cells"] + board["daily"]["slots"] + board["temporary"]["slots"] + board["history"]
        used = {t.get("note", {}).get("image") for t in items if task(t)}
        board["noteImages"] = {k: v for k, v in board["noteImages"].items() if k in used}
        if not board["noteImages"]:
            del board["noteImages"]
