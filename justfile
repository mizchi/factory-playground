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
    echo "提出先: $work/solve.ts"
    echo "実況: just schedule-watch $work/solve.ts"
    echo "監査: just schedule $work/solve.ts"

# 提出されたアルゴリズムを監査する（省略時は参考解）
schedule submission="prototypes/schedule-task/solve.ts":
    @node prototypes/schedule-task/audit.ts {{quote(submission)}}

# 提出を監視する（Rex では実行元の右ペインに表示）
[positional-arguments]
schedule-watch submission="prototypes/schedule-task/solve.ts":
    #!/usr/bin/env bash
    set -eu
    mode=--watch
    if [[ -n "${REX_SESSION:-}" ]] && command -v rex >/dev/null; then
        mode=--rex-watch
    fi
    exec node prototypes/schedule-task/audit.ts "$mode" "$1"

# 仕様から実装・監査・セルフレビュー・修正を繰り返して納品する
factory rounds="3" seed="" agent="codex":
    @node prototypes/schedule-task/factory.ts {{quote(rounds)}} {{quote(seed)}} {{quote(agent)}}

# 指定モデルを監督にして、終了条件を満たすまで heartbeat で再開する
factory-supervise model="" heartbeat_seconds="30" seed="" agent="codex":
    @node prototypes/schedule-task/supervise.ts --supervise {{quote(model)}} {{quote(heartbeat_seconds)}} {{quote(seed)}} {{quote(agent)}}

# 保存済みの監督を同じ実行ディレクトリで再開する
factory-resume run:
    @node prototypes/schedule-task/supervise.ts --resume {{quote(run)}}

# 親子の工程表に沿って、メモと一斉指示を渡しながら監督付きで実行
factory-pipeline plan="prototypes/schedule-task/pipeline.json" heartbeat_seconds="30" seed="":
    @node prototypes/schedule-task/supervise.ts --pipeline {{quote(plan)}} {{quote(heartbeat_seconds)}} {{quote(seed)}}

# 実行中の親工程から子孫への継続指示を更新する
factory-broadcast run parent message:
    @node prototypes/schedule-task/pipeline.ts {{quote(run)}} {{quote(parent)}} {{quote(message)}}

# 一言の依頼からTRPGを生成し、GMと2〜3人のPCで試遊・改稿
trpg wish="" table="" minutes="" context="":
    @node templates/trpg/run.mts {{quote(wish)}} {{quote(table)}} {{quote(minutes)}} {{quote(context)}}

# 同じシナリオと配役で揺らぎカードを替えて試遊
trpg-replay draft seed="0":
    @node templates/trpg/run.mts --replay {{quote(draft)}} {{quote(seed)}}

# 指定した場面のGM裁定直前から新しい卓へ分岐
trpg-resume draft scene context="":
    @node templates/trpg/run.mts --resume {{quote(draft)}} {{quote(scene)}} {{quote(context)}}

# 保存した公開ログを同じ状態のまま整合性監査
trpg-audit draft:
    @node templates/trpg/run.mts --audit {{quote(draft)}}

# 汎用テンプレート。設定に従い生成・機械検査・独立レビュー・改稿
factory-template spec="templates/factory/factory.json" task="":
    @node templates/factory/run.mts {{quote(spec)}} {{quote(task)}}
