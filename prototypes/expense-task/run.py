"""Dispatch the task to a private tmux pane and archive the independent audit."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from audit import grade

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


# Both demos use the same standalone supervisor and worker lifecycle.
sys.path.insert(0, str(HERE.parent / "agent-sessions"))
from pane import private_worker
from supervise import Delivery, observe_and_send


def follow_work(run: Path, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    print("作業者が明細を集計", flush=True)
    with (run / "work.log").open(encoding="utf-8") as log:
        while True:
            # The worker publishes report.csv only after closing its progress log.
            published = (run / "report.csv").is_file()
            for line in log:
                print(line, end="", flush=True)
            if published:
                return
            if time.monotonic() >= deadline:
                raise RuntimeError("納品期限を超えました")
            time.sleep(0.05)


def dispatch(run: Path, watch: bool) -> None:
    args = [str(run), "--watch"] if watch else [str(run)]
    with private_worker(HERE / "worker.py", *args) as pane:
        with (run / "delivery.log").open("w", encoding="utf-8") as log:
            def record(line: str) -> None:
                print(line, file=log, flush=True)
                print(line, flush=True)

            verdict = observe_and_send(pane, f"summarize {run.name}", record)
        if verdict is not Delivery.DELIVERED:
            raise RuntimeError("タスクの送達を確認できませんでした")
        follow_work(run, timeout=15 if watch else 5)


def main(watch):
    runs = ROOT / "runs"
    runs.mkdir(exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="expense-", dir=runs))
    for name in ("task.md", "expenses.csv"):
        shutil.copyfile(HERE / name, run / name)
    (run / "work.log").touch()
    print(f"依頼: 経費明細6件を部署別に精算し、report.csv を納品\n記録: {run}", flush=True)
    delivered = True
    try:
        dispatch(run, watch)
    except (OSError, subprocess.SubprocessError, RuntimeError) as error:
        delivered = False
        with (run / "delivery.log").open("a", encoding="utf-8") as log:
            print(error, file=log)
        print(error, file=sys.stderr)

    evidence = grade(run)
    (run / "audit.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    report = evidence["checks"][-1]
    if report["actual"] is not None:
        print("納品された精算表")
        for row in report["actual"]:
            print(",".join(row))
    print(f"成果物の監査: {evidence['verdict']}\n再監査: just audit runs/{run.name}")
    return 0 if delivered and evidence["verdict"] == "PASS" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--watch", action="store_true", help="pace the six entries for a live demo")
    sys.exit(main(parser.parse_args().watch))
