"""Independent optimal values for small instances and a block-structured large one."""
from itertools import combinations
import random


def job(name, start, end, reward):
    return dict(id=name, start=start, end=end, reward=reward)


def exhaustive_reward(jobs):
    by_start = sorted(jobs, key=lambda item: item["start"])
    best = 0
    for size in range(1, len(jobs) + 1):
        for selection in combinations(by_start, size):
            if all(a["end"] <= b["start"] for a, b in zip(selection, selection[1:])):
                best = max(best, sum(item["reward"] for item in selection))
    return best


def cases():
    examples = {
        "empty": [],
        "greedy-trap": [job("long", 0, 4, 9), job("am", 0, 2, 5),
                        job("pm", 2, 4, 5), job("quick", 0, 1, 1)],
        "equal-optima": [job("both", 0, 4, 10), job("b", 2, 4, 5), job("a", 0, 2, 5)],
        "negative-only": [job("loss", 0, 1, -5)],
        "large-rewards": [job(str(i), i, i + 1, 10**9) for i in range(4)],
    }
    rng = random.Random(413858)
    for case in range(12):
        jobs = []
        for i in range(10):
            start = rng.randrange(12)
            jobs.append(job(str(i), start, start + rng.randint(1, 6), rng.randint(-4, 12)))
        examples[f"random-{case:02}"] = jobs
    for name, jobs in examples.items():
        yield name, jobs, exhaustive_reward(jobs)

    # Independent blocks. Taking the two half slots earns 10 vs. 9 for the whole.
    jobs = []
    for i in range(1000):
        start = i * 2
        jobs.extend([job(f"whole-{i}", start, start + 2, 9),
                     job(f"left-{i}", start, start + 1, 5),
                     job(f"right-{i}", start + 1, start + 2, 5)])
    rng.shuffle(jobs)
    yield "3000-jobs", jobs, 10_000
