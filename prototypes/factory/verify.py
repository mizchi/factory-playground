"""Check double.py against the candidate's check.sh, with and without its fix."""
from pathlib import Path
import subprocess
import sys
import tempfile


def verify(repo, base):
    def git_file(revision, name):
        return subprocess.check_output(["git", "-C", repo, "show", f"{revision}:{name}"])

    head = subprocess.check_output(
        ["git", "-C", repo, "rev-parse", "HEAD"], text=True
    ).strip()
    test = git_file(head, "check.sh")
    with tempfile.TemporaryDirectory(prefix="factory-proof-") as directory:
        root = Path(directory)

        def check(revision, phase):
            # Give each run a fresh directory and exactly the same candidate test.
            work = root / phase
            work.mkdir()
            (work / "double.py").write_bytes(git_file(revision, "double.py"))
            (work / "check.sh").write_bytes(test)
            print(f"{phase} ({revision[:8]})", flush=True)
            return subprocess.run(["bash", "check.sh"], cwd=work, timeout=10).returncode

        fixed = check(head, "修正あり")
        if fixed == 1:
            print("REJECTED: candidate-fails")
            return 1
        if fixed != 0:
            raise RuntimeError(f"candidate check exited {fixed}")

        original = check(base, "修正なし")
        if original == 0:
            print("REJECTED: test-passed-without-fix")
            return 1
        if original != 1:
            raise RuntimeError(f"baseline check exited {original}")
        print("PROVEN: 元の不具合を追加テストで検出")
        return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: verify.py REPO BASE_COMMIT")
    try:
        status = verify(*sys.argv[1:])
    except (OSError, subprocess.SubprocessError, RuntimeError) as exc:
        print(f"CHECK_ERROR: {exc}", file=sys.stderr)
        status = 2
    sys.exit(status)
