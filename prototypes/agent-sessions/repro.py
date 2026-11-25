"""Check supervisor decisions against input actually received by a demo worker."""
from pathlib import Path
import subprocess
import sys
import tempfile

from pane import private_worker

HERE = Path(__file__).resolve().parent


def reproduce(mode, expected_status, expected_count, expected_verdict):
    with tempfile.TemporaryDirectory(prefix="pane-", dir="/tmp") as directory:
        log = Path(directory) / "messages"
        initial = "WORKING" if mode == "busy" else "WAITING"
        with private_worker(HERE / "worker.py", mode, str(log), ready=initial) as pane:
            run = subprocess.run(
                [sys.executable, str(HERE / "supervise.py"), pane.socket, pane.pane_id],
                capture_output=True, text=True, timeout=10,
            )
            received = log.read_text().splitlines() if log.exists() else []
            print(f"\n[{mode}]\n{run.stdout}workerの受信回数={len(received)} exit={run.returncode}")
            verdict = run.stdout.rstrip().rpartition("\n")[2].partition(":")[0]
            if (run.returncode, len(received), verdict) != (
                expected_status, expected_count, expected_verdict
            ):
                raise RuntimeError(f"unexpected result in {mode}: {run.stderr}")


if __name__ == "__main__":
    help_text = subprocess.check_output(
        [sys.executable, str(HERE / "supervise.py"), "--help"], text=True
    )
    if "%0" not in help_text:
        raise RuntimeError("missing tmux pane ID example in --help")
    reproduce("accepted", 0, 1, "DELIVERED")
    reproduce("draft", 6, 1, "UNCONFIRMED")
    reproduce("busy", 0, 0, "OBSERVED_ONLY")
