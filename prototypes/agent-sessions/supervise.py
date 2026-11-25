"""Observe one tmux pane, send at most once, and verify a correlated receipt."""
import argparse
from enum import Enum
import sys
import time
import uuid
from typing import Callable, Optional

from pane import Pane


class Delivery(Enum):
    OBSERVED_ONLY = "OBSERVED_ONLY"
    DELIVERED = "DELIVERED"
    UNCONFIRMED = "UNCONFIRMED"


def observe_and_send(
    pane: Pane, message: Optional[str] = None, emit: Callable[[str], None] = print
) -> Delivery:
    previous = pane.last_line()
    time.sleep(0.1)
    current = pane.last_line()
    emit(f"観測: {previous!r} → {current!r}")
    if previous != "WAITING" or current != previous:
        emit(Delivery.OBSERVED_ONLY.value)
        return Delivery.OBSERVED_ONLY

    if message is None:
        message = "continue " + uuid.uuid4().hex[:12]
    pane.send_line(message)
    emit(f"送信: {message} + Enter")

    deadline = time.monotonic() + 1
    while True:
        line = pane.last_line()
        if line == f"ACCEPTED {message}":
            emit(f"{Delivery.DELIVERED.value}: {line}")
            return Delivery.DELIVERED
        if time.monotonic() >= deadline:
            emit(f"{Delivery.UNCONFIRMED.value}: {line!r}")
            return Delivery.UNCONFIRMED
        time.sleep(0.05)


def supervise(socket, pane, message=None):
    verdict = observe_and_send(Pane(socket, pane), message)
    return 6 if verdict is Delivery.UNCONFIRMED else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("socket")
    parser.add_argument("pane", help="pane ID, e.g. %%0")
    parser.add_argument("--message", help="single-line task with its unique run ID")
    args = parser.parse_args()
    sys.exit(supervise(args.socket, args.pane, args.message))
