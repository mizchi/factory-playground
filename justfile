default:
    @just --list

# 両方の実演と、その期待結果の照合
repro: repro-sessions repro-factory

# 停止の観測、1回の送信、受け手の画面での送達確認
repro-sessions:
    @python3 prototypes/agent-sessions/repro.py

# 修正だけを取り消し、追加テストが元の不具合を検出できるか確認
repro-factory:
    @bash prototypes/factory/repro.sh

# 経費精算を依頼し、納品物と監査結果を runs/ に保存
task:
    @python3 -B prototypes/expense-task/run.py

# 明細をゆっくり1件ずつ処理し、その場で集計を観察する
watch:
    @python3 -B prototypes/expense-task/run.py --watch

# 保存した納品物を再採点し、期待値と実測値を表示
audit run:
    @python3 prototypes/expense-task/audit.py {{quote(run)}}

# アルゴリズム実装のお題を新しい作業ディレクトリに配る
schedule-start:
    #!/usr/bin/env bash
    set -eu
    mkdir -p runs
    work=$(mktemp -d runs/schedule-work-XXXXXXXX)
    cp prototypes/schedule-task/task.md "$work/task.md"
    echo "依頼書: $work/task.md"
    echo "提出先: $work/solve.py"
    echo "監査: just schedule $work/solve.py"

# 提出されたアルゴリズムを監査する（省略時は参考解）
schedule submission="prototypes/schedule-task/solve.py":
    @python3 -B prototypes/schedule-task/audit.py {{quote(submission)}}
