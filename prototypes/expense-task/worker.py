"""Receive one expense task on stdin and deliver the CSV to its run directory."""
import csv
from collections import Counter
from pathlib import Path
import sys
import time


def summarize(run, delay):
    totals = Counter()
    with (run / "expenses.csv").open(encoding="utf-8", newline="") as source, (
        run / "work.log"
    ).open("w", encoding="utf-8") as log:
        for entry in csv.DictReader(source):
            department = entry["department"]
            yen = int(entry["yen"])
            totals[department] += yen
            print(f"{department:<6} {entry['description']:<10} {yen:+6,d} 円"
                  f"   部署小計 {totals[department]:,} 円", file=log, flush=True)
            if delay:
                time.sleep(delay)
    draft = run / "report.tmp"
    with draft.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["department", "total_yen"])
        writer.writerows(sorted(totals.items()))
        writer.writerow(["TOTAL", sum(totals.values())])
    draft.replace(run / "report.csv")


if __name__ == "__main__":
    directory = Path(sys.argv[1])
    print("WAITING", flush=True)
    command = input()
    if command != f"summarize {directory.name}":
        sys.exit("unexpected assignment")
    print(f"ACCEPTED {command}", flush=True)
    summarize(directory, 0.8 if "--watch" in sys.argv[2:] else 0)
    # Keep the receipt visible until the supervisor finishes reading the pane.
    sys.stdin.readline()
