"""Grade a saved expense-task run against the original assignment and its oracle."""
import csv
import hashlib
import io
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
# Calculated from the assignment before running the worker.
EXPECTED = [
    ["department", "total_yen"],
    ["Design", "0"],
    ["Ops", "1250"],
    ["Sales", "1000"],
    ["TOTAL", "2250"],
]


def grade(run):
    checks = []
    for name in ("task.md", "expenses.csv"):
        expected = hashlib.sha256((HERE / name).read_bytes()).hexdigest()
        path = run / name
        actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
        checks.append(dict(file=name, expected_sha256=expected, actual_sha256=actual,
                           passed=actual == expected))

    report = run / "report.csv"
    result = dict(file=report.name, expected=EXPECTED, actual=None, passed=False)
    try:
        data = report.read_bytes()
        result["sha256"] = hashlib.sha256(data).hexdigest()
        rows = list(csv.reader(io.StringIO(data.decode("utf-8"), newline=""), strict=True))
        result.update(actual=rows, passed=rows == EXPECTED)
    except (OSError, UnicodeError, csv.Error) as error:
        result["error"] = str(error)
    checks.append(result)
    return dict(task="経費精算 v1", run=run.name,
                verdict="PASS" if all(check["passed"] for check in checks) else "FAIL",
                checks=checks)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: audit.py RUN_DIRECTORY")
    evidence = grade(Path(sys.argv[1]))
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    sys.exit(0 if evidence["verdict"] == "PASS" else 1)
