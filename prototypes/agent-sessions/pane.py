"""Lifetime and I/O of one worker on a private tmux server."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from typing import Iterator


@dataclass(frozen=True)
class Pane:
    socket: str
    pane_id: str

    def screen(self) -> list[str]:
        return subprocess.check_output(
            ["tmux", "-S", self.socket, "capture-pane", "-p", "-t", self.pane_id],
            text=True, timeout=5,
        ).rstrip().splitlines()

    def last_line(self) -> str:
        lines = self.screen()
        return lines[-1] if lines else ""

    def send_line(self, message: str) -> None:
        keys = ["tmux", "-S", self.socket, "send-keys", "-t", self.pane_id]
        subprocess.run([*keys, "-l", message], check=True, timeout=5)
        subprocess.run([*keys, "Enter"], check=True, timeout=5)


@contextmanager
def private_worker(script: Path, *args: str, ready: str = "WAITING") -> Iterator[Pane]:
    with tempfile.TemporaryDirectory(prefix="pane-", dir="/tmp") as directory:
        socket = str(Path(directory) / "tmux.sock")
        tmux = ["tmux", "-f", "/dev/null", "-S", socket]
        pane_id = subprocess.check_output(
            [*tmux, "new-session", "-d", "-P", "-F", "#{pane_id}",
             sys.executable, str(script), *args], text=True,
        ).strip()
        pane = Pane(socket, pane_id)
        try:
            deadline = time.monotonic() + 5
            while ready not in pane.screen():
                if time.monotonic() >= deadline:
                    raise RuntimeError(f"{script.name} did not display {ready!r}")
                time.sleep(0.05)
            yield pane
        finally:
            subprocess.run([*tmux, "kill-server"], stderr=subprocess.DEVNULL)
