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

# 質問への回答または一言のお題からTRPGを生成し、自動で試遊・改稿
trpg wish="" table="" minutes="" context="":
    @node templates/trpg/run.mts {{quote(wish)}} {{quote(table)}} {{quote(minutes)}} {{quote(context)}}

# 保存済みの月面図書館の卓を投影する（opening / choice / ending）
trpg-demo scene="opening":
    @node templates/trpg/demo.mts {{quote(scene)}}

# 好きな展開を聞いて新しい卓を生成し、その場で会場が席1をプレイ
trpg-demo-live minutes="30":
    @node templates/trpg/run.mts --live-demo '' {{quote(minutes)}}

# 同じ港の設定からパターンを一つ選んで生成・試遊・改稿
trpg-pattern pattern minutes="30" previous="":
    @node templates/trpg/run.mts --pattern {{quote(pattern)}} {{quote(minutes)}} {{quote(previous)}}

# 5パターンを順番に試遊し、点検項目を次の新作へ引き継ぐ
trpg-series minutes="30":
    @node templates/trpg/run.mts --series {{quote(minutes)}}

# 評価基準を変えた後、モデルを呼ばずに保存済みの講評・席の感想を照合する
trpg-ratings draft:
    @node templates/trpg/run.mts --ratings {{quote(draft)}}

# 対照例で体験・創発を検査。setting 指定時は設定の適量・不足・過多を検査
trpg-calibrate suite="experience":
    @node templates/trpg/calibrate.mts {{quote(suite)}}

# 一言から新規生成し、自動レビューまで完了した卓の初稿と最終稿を比較
trpg-quality root="runs":
    @node templates/trpg/report.mts {{quote(root)}}

# 人間がPCを1席担当するTUI試遊
trpg-play seat="1" wish="" table="" minutes="" context="":
    @TRPG_HUMAN_SEAT={{quote(seat)}} node templates/trpg/run.mts {{quote(wish)}} {{quote(table)}} {{quote(minutes)}} {{quote(context)}}

# 同じシナリオと配役で揺らぎカードを替えて試遊
trpg-replay draft seed="0" context="":
    @node templates/trpg/run.mts --replay {{quote(draft)}} {{quote(seed)}} {{quote(context)}}

# 生成済みの稿を自動試遊し、根拠のある未達を直して再試遊
trpg-refine draft revisions="1":
    @node templates/trpg/run.mts --refine {{quote(draft)}} {{quote(revisions)}}

# 指定した場面のGM裁定直前から新しい卓へ分岐
trpg-resume draft scene context="":
    @node templates/trpg/run.mts --resume {{quote(draft)}} {{quote(scene)}} {{quote(context)}}

# 同じ場面から分岐した通常GMと演出台本付きGMを匿名で比較
trpg-gm-review first second:
    @node templates/trpg/gm-review.mts {{quote(first)}} {{quote(second)}}

# 保存した公開ログを同じ状態のまま整合性監査
trpg-audit draft:
    @node templates/trpg/run.mts --audit {{quote(draft)}}

# 汎用テンプレート。設定に従い生成・機械検査・独立レビュー・改稿
factory-template spec="templates/factory/factory.json" task="":
    @node templates/factory/run.mts {{quote(spec)}} {{quote(task)}}

# 自己増殖工場の開拓シミュレーターを起動
factory-factory:
    @pnpm --dir prototypes/factory-factory dev

factory-factory-test:
    @pnpm --dir prototypes/factory-factory test
