"""Run a submitted single-file CLI and check both its chosen plan and its value."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from cases import cases

HERE = Path(__file__).resolve().parent
RUNS = HERE.parents[1] / "runs"


def check_plan(jobs, answer, optimum):
    if not isinstance(answer, dict) or type(answer.get("reward")) is not int:
        return "reward は整数で指定してください"
    ids = answer.get("ids")
    if not isinstance(ids, list) or not all(isinstance(key, str) for key in ids):
        return "ids は文字列の配列で指定してください"
    by_id = {job["id"]: job for job in jobs}
    if len(set(ids)) != len(ids) or any(key not in by_id for key in ids):
        return "重複または未定義の ID があります"
    plan = sorted((by_id[key] for key in ids), key=lambda item: item["start"])
    for first, second in zip(plan, plan[1:]):
        if first["end"] > second["start"]:
            return f"{first['id']} と {second['id']} の時間帯が重なっています"
    if sum(job["reward"] for job in plan) != answer["reward"]:
        return "選んだ依頼の報酬合計が出力値と一致しません"
    if answer["reward"] != optimum:
        return f"得られた報酬 {answer['reward']}、最適値 {optimum}"
    return None


def evaluate(source, jobs, optimum):
    with tempfile.TemporaryDirectory(prefix="schedule-case-") as work:
        shutil.copyfile(source, Path(work) / "solve.py")
        try:
            process = subprocess.run(
                [sys.executable, "-I", "solve.py"], cwd=work, input=json.dumps(jobs).encode(),
                capture_output=True, timeout=5,
            )
        except subprocess.TimeoutExpired:
            return {"error": "5秒でタイムアウト"}
    result = {"exit": process.returncode}
    if process.stderr:
        result["stderr"] = process.stderr.decode(errors="replace")
    if process.returncode:
        result["error"] = f"終了コード {process.returncode}"
        return result
    try:
        result["answer"] = json.loads(process.stdout.decode("utf-8"))
    except (ValueError, UnicodeError):
        return {**result, "error": "出力が UTF-8 の JSON ではありません",
                "stdout": process.stdout.decode(errors="replace")}
    error = check_plan(jobs, result["answer"], optimum)
    if error:
        result["error"] = error
    return result


def audit(submission):
    RUNS.mkdir(exist_ok=True)
    run = Path(tempfile.mkdtemp(dir=RUNS, prefix="schedule-audit-"))
    source = run / "solve.py"
    shutil.copyfile(submission, source)
    shutil.copyfile(HERE / "task.md", run / "task.md")
    checks = []
    print(f"記録: {run}", flush=True)
    for name, jobs, optimum in cases():
        result = evaluate(source, jobs, optimum)
        checks.append(dict(case=name, jobs=jobs, optimum=optimum, **result))
        if "error" in result:
            print(f"FAIL {name}: {result['error']}", flush=True)
            break
        print(f"PASS {name}: {len(jobs)}件、最適報酬 {optimum}", flush=True)
    passed = "error" not in checks[-1]
    record = dict(verdict="PASS" if passed else "FAIL",
                  submission_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                  checks=checks)
    (run / "audit.json").write_text(json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"監査: {record['verdict']}  再実行: just schedule {source.relative_to(RUNS.parent)}")
    return 0 if passed else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("submission", type=Path)
    args = parser.parse_args()
    if not args.submission.is_file():
        parser.error(f"提出ファイルが見つかりません: {args.submission}")
    sys.exit(audit(args.submission))
