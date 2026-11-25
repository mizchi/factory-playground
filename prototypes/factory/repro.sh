#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(mktemp -d)
trap 'rm -rf "$repo"' EXIT
cd "$repo"
git init -q
git config user.name "Prototype"
git config user.email "prototype@example.invalid"
git config commit.gpgsign false
git config core.hooksPath /dev/null

# 要求: 負数も符号を保ったまま2倍にする。元の実装は絶対値を取ってしまう。
cat > double.py <<'PY'
import sys
print(2 * abs(int(sys.argv[1])))
PY
git add double.py
git commit -qm baseline
base=$(git rev-parse HEAD)

write_test() {
    printf 'input=%s\nexpected=%s\n' "$1" "$2" > check.sh
    cat >> check.sh <<'SH'
set -u
actual=$(python3 double.py "$input") || exit 2
printf 'input=%s expected=%s actual=%s\n' "$input" "$expected" "$actual"
[[ "$actual" == "$expected" ]]
SH
}

verify_case() {
    local label=$1 expected_code=$2 expected_verdict=$3 code=0 output
    git add double.py check.sh
    git commit -qm "$label"
    printf '\n[%s]\n' "$label"
    output=$(python3 "$here/verify.py" "$repo" "$base" 2>&1) || code=$?
    printf '%s\nexit=%d\n' "$output" "$code"
    [[ "$code" == "$expected_code" ]]
    [[ "$output" == *"$expected_verdict"* ]]
    [[ -z "$(git status --porcelain)" ]]
}

cat > double.py <<'PY'
import sys
print(2 * int(sys.argv[1]))
PY
write_test -3 -6
verify_case regression 0 PROVEN
write_test 3 6
verify_case weak-test 1 test-passed-without-fix
git show "$base:double.py" > double.py
write_test -3 -6
verify_case broken-candidate 1 candidate-fails
