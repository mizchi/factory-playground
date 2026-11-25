"""Reference implementation for weighted interval scheduling."""
from bisect import bisect_right
import json
import sys


def solve(jobs):
    jobs = sorted(jobs, key=lambda job: job["end"])
    ends = [job["end"] for job in jobs]
    # best[i] is the maximum reward for the first i jobs in finish order.
    best = [0]
    previous = []
    for i, job in enumerate(jobs):
        compatible = bisect_right(ends, job["start"], hi=i)
        previous.append(compatible)
        best.append(max(best[i], job["reward"] + best[compatible]))

    selected = []
    i = len(jobs)
    while i > 0:
        if best[i] == best[i - 1]:
            i -= 1
        else:
            selected.append(jobs[i - 1]["id"])
            i = previous[i - 1]
    return {"reward": best[-1], "ids": selected[::-1]}


if __name__ == "__main__":
    print(json.dumps(solve(json.load(sys.stdin))))
