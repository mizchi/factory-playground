"""Demo worker. The supervisor can only see its terminal output."""
import sys
from pathlib import Path

mode, log = sys.argv[1:]
print("WORKING" if mode == "busy" else "WAITING", flush=True)
for line in sys.stdin:
    message = line.rstrip("\n")
    with Path(log).open("a") as stream:
        print(message, file=stream)
    state = "DRAFT" if mode == "draft" else "ACCEPTED"
    print(f"{state} {message}", flush=True)
