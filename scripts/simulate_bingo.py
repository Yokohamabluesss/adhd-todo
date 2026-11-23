"""Compare exact and simulated probabilities after 3–7 completions on a 3x3 board."""

import argparse
from dataclasses import dataclass
from fractions import Fraction
from functools import cache
from math import comb, sqrt
from random import Random


LINES = (
    (0, 1, 2), (3, 4, 5), (6, 7, 8),
    (0, 3, 6), (1, 4, 7), (2, 5, 8),
    (0, 4, 8), (2, 4, 6),
)
COMPLETION_COUNTS = range(3, 8)


@dataclass(frozen=True)
class Scenario:
    name: str
    layout: str  # Row-major: S = Standard, L = Low, X = Must-do, . = empty.
    manual: Fraction = Fraction(0)


SCENARIOS = (
    Scenario("Uniform", "SSSSSSSSS"),
    Scenario("Empty centre", "SSSS.SSSS"),
    Scenario("Weighted row", "SSSLLLLLL"),
    Scenario("Must-do centre", "SSSSXSSSS"),
    Scenario("Must-do corner", "SSSSSSSSX"),
    Scenario("Corner + 50% manual", "SSSSSSSSX", Fraction(1, 2)),
)


@cache
def draw_tickets(layout, done):
    remaining = [i for i, priority in enumerate(layout) if priority != "." and i not in done]
    must_do = [i for i in remaining if layout[i] == "X"]
    if must_do:
        return tuple(must_do)
    return tuple(i for i in remaining for _ in range(2 if layout[i] == "S" else 1))


def manual_pick(done):
    return next((i for i in (0, 1, 2) if i not in done), None)


@cache
def outcome(layout, done):
    bingo = any(all(i in done for i in line) for line in LINES)
    remaining = [priority for i, priority in enumerate(layout) if priority != "." and i not in done]
    success = not remaining or (bingo and "X" not in remaining)
    return bingo, success


def exact(scenario):
    # Propagate probability mass over sets of completed squares, aggregating all draw orders.
    states = {frozenset(): Fraction(1)}
    results = {}
    for count in range(1, COMPLETION_COUNTS.stop):
        next_states = {}
        for done, mass in states.items():
            tickets = draw_tickets(scenario.layout, done)
            pick = manual_pick(done) if scenario.manual else None
            manual_rate = scenario.manual if pick is not None else Fraction(0)
            choices = {i: (1 - manual_rate) * Fraction(tickets.count(i), len(tickets))
                       for i in set(tickets)}
            if pick is not None:
                choices[pick] = choices.get(pick, 0) + manual_rate
            for i, probability in choices.items():
                if probability:
                    new = done.union((i,))
                    next_states[new] = next_states.get(new, 0) + mass * probability
        states = next_states
        assert sum(states.values()) == 1
        if count in COMPLETION_COUNTS:
            bingo = sum(m for done, m in states.items() if outcome(scenario.layout, done)[0])
            success = sum(m for done, m in states.items() if outcome(scenario.layout, done)[1])
            results[count] = bingo, success
    return results


def simulate(scenario, trials, seed):
    rng = Random(seed)
    manual = float(scenario.manual)
    bingos = [0] * COMPLETION_COUNTS.stop
    successes = bingos.copy()
    for _ in range(trials):
        done = frozenset()
        for count in range(1, COMPLETION_COUNTS.stop):
            pick = manual_pick(done) if manual else None
            if pick is None or rng.random() >= manual:
                pick = rng.choice(draw_tickets(scenario.layout, done))
            done = done.union((pick,))
            if count in COMPLETION_COUNTS:
                bingo, success = outcome(scenario.layout, done)
                bingos[count] += bingo
                successes[count] += success
    return {count: (bingos[count], successes[count]) for count in COMPLETION_COUNTS}


def interval(count, trials):
    # 95% Wilson interval for a simulated proportion.
    p, z = count / trials, 1.959963984540054
    divisor = 1 + z*z/trials
    centre = (p + z*z/(2*trials)) / divisor
    radius = z * sqrt(p*(1-p)/trials + z*z/(4*trials**2)) / divisor
    return f"{max(0,centre-radius):.2%}–{min(1,centre+radius):.2%}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trials", type=int, default=100_000, help="rounds per scenario")
    parser.add_argument("--seed", type=int, default=20261121, help="seed for the first scenario")
    args = parser.parse_args()
    if args.trials < 1:
        parser.error("--trials must be positive")
    assert exact(SCENARIOS[0])[3] == (Fraction(8, comb(9, 3)),) * 2
    print(f"{args.trials:,} trials per scenario; initial seed {args.seed}")
    print("Scenario | Completed | Bingo exact | Bingo MC (95% interval) | Success exact | Success MC (95% interval)")
    for i, scenario in enumerate(SCENARIOS):
        probabilities = exact(scenario)
        counts = simulate(scenario, args.trials, args.seed + i)
        for completed, (bingo, success) in probabilities.items():
            b, s = counts[completed]
            print(f"{scenario.name} | {completed} | {float(bingo):.2%} | {b/args.trials:.2%} ({interval(b,args.trials)}) "
                  f"| {float(success):.2%} | {s/args.trials:.2%} ({interval(s,args.trials)})")


if __name__ == "__main__":
    main()
