# ソフトウェアファクトリーの実験場

「作業者に依頼が届いた」「納品物が仕様に合った」「テストが元の不具合を検出できた」。この3つの判定を手元で観察するために、経費精算の実演と、送達・テストの失敗を再現するスクリプトを作った。作業者は実装済みの Python プログラムで、tmux の入出力、CSV の生成、Git からの取り出し、テスト実行をローカルで行う。必要なものは Python 3、tmux、Git、Bash、just。[元にした2実装の比較](reports/ソフトウェアファクトリー%20実装比較.md)

## まず動かす

```sh
just watch
```

6件の経費明細を処理する様子が、今いる端末に1行ずつ出る。たとえば Design の印刷代で小計が700円になり、返金で0円に戻る。作業者が精算表を納品すると、監査役がファイルを読み直し、末尾に `成果物の監査: PASS` と再監査用のコマンドが出る。

| コマンド | 見られるもの |
| --- | --- |
| `just watch` / `just task` | 同じ経費精算を実行する。`watch` は実演用に明細ごとに0.8秒待ち、`task` は続けて処理する。tmux の起動と終了は自動。 |
| `just audit runs/<実行ID>` | 保存した依頼・原票・納品物を再採点し、期待値と実測値を JSON で表示する。実行IDを含むコマンドは実演の最終行からコピーできる。 |
| `just repro-sessions` / `just repro-factory` | 送達、テストの有効性について、それぞれ3ケースを検査する。`just repro` で全6ケースを実行できる。 |
| `just schedule-start` / `just schedule <提出ファイル>` | アルゴリズムの実装課題を配り、提出された Python CLI を採点する。引数なしの `just schedule` では参考解の採点を実演できる。 |

## アルゴリズムを実装するお題

「開始・終了時刻と報酬が付いた依頼から、時間が重ならず報酬が最大になる組み合わせを返す CLI」を作る。午前と午後の依頼を各5円で受ければ計10円になり、1日を占める9円の依頼を上回る。提出するのは任意の入力を解く `solve.py`。同額の最適解はどれを返してもよい。[入出力仕様と具体例](prototypes/schedule-task/task.md)

1. `just schedule-start` を実行する。表示された作業ディレクトリの `task.md` を読み、人またはコーディングエージェントが隣に `solve.py` を実装する。
2. 表示された `just schedule runs/schedule-work-…/solve.py` を実行する。監査役は各問で新しく CLI を起動し、選択した ID の存在・重複・時間帯・報酬合計・最適性を確認する。小さな17問は全組み合わせを列挙して採点する。3,000件の問題は独立した1,000ブロックから構成し、既知の最適値10,000を使う。[採点](prototypes/schedule-task/audit.py)・[問題と期待値](prototypes/schedule-task/cases.py)
3. `runs/schedule-audit-…/` に提出時点のソース、依頼書、実行した各問の入力・期待値・結果を保存する。不合格時は最初の反例で止まり終了コード1。表示されたコマンドで同じ提出物を再採点できる。

参考解は終了時刻順に依頼を並べ、二分探索で直前に選べる範囲を決め、動的計画法で最適報酬と採用 ID を復元する。計算量は時間 O(n log n)、空間 O(n)。[参考解](prototypes/schedule-task/solve.py)

## 1件の依頼が完了するまで

1. **依頼を作る。** 実行ごとに `runs/expense-…/` を作り、依頼書と原票をコピーする。仕様は「部署名順の CSV、返金は負数、0円の部署も残し、最終行に総額」。[依頼書](prototypes/expense-task/task.md)・[原票](prototypes/expense-task/expenses.csv)
2. **相手が受け取ったことを確かめる。** 専用 tmux の同じペインで `WAITING` を2回観測したら、監督役が `summarize <実行ID>` を一度送る。同じIDを含む `ACCEPTED` が画面に現れると `DELIVERED` を返す。ペインの起動・読み書き・終了は両方の実演で共有し、経費精算側は監督役の返す判定値で次に進む。[ペイン管理](prototypes/agent-sessions/pane.py)・[送達判定](prototypes/agent-sessions/supervise.py)
3. **集計して納品する。** 作業者は原票を1行ずつ読み、金額と部署小計をログに書く。精算表は一時ファイルに書き切ってから `report.csv` に置き換える。これで監査役が書きかけの表を読むのを防ぐ。[作業者](prototypes/expense-task/worker.py)・[実行と進捗表示](prototypes/expense-task/run.py)
4. **納品物を採点する。** 監査役は依頼書と原票の SHA-256 を配布元と照合し、CSV のヘッダー・行順・金額を、このお題であらかじめ決めた期待値と比較する。Design 0円、Ops 1,250円、Sales 1,000円、総額 2,250円で全行が一致すれば合格。期待値は作業者の集計コードから独立している。[監査役](prototypes/expense-task/audit.py)

各実行に `task.md`、`expenses.csv`、`delivery.log`（送受信）、`work.log`（明細ごとの小計）、`report.csv`（納品物）、`audit.json`（初回の監査記録）が残る。再監査はその時点のファイルを読んで標準出力に結果を返す。合格の終了コードは0、不合格は1。

## 二つの参考実装から借りた技法

**laiso/agent-sessions からは、送信後に相手の画面を読み直す手順を取り出した。** `just repro-sessions` は受け手の挙動を変え、監督役の判定と作業者側の受信回数を別々に検査する。下書きのケースでは、Enter が1回届いても受理を確認できない。そのときの動作は終了コード6で停止、再送0回。[再現スクリプト](prototypes/agent-sessions/repro.py)・[元実装の送達テスト](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/test_delivery_regressions.py#L164-L174)

**addyosmani/factory からは、追加テストを残して修正を外す検証を取り出した。** `just repro-factory` は一時 Git リポジトリに「負数の符号を失う2倍算 CLI」の旧版と修正版を用意する。検証役は同じテストを候補と旧版で実行する。テストが候補で通り、旧版で期待値の不一致を検出したら `PROVEN`。この実演は経費精算とは単独で動かせる。[再現スクリプト](prototypes/factory/repro.sh)・[検証役](prototypes/factory/verify.py)・[元実装のテスト](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/tests/test-proof.sh#L12-L37)

| 再現する条件 | 観測できる結果 |
| --- | --- |
| 作業者が同じIDの指示を受理 | `DELIVERED`、受信1回 |
| 入力が下書きに残る | `UNCONFIRMED`、受信1回 |
| 作業者が作業中 | `OBSERVED_ONLY`、受信0回 |
| 負数のテストで修正前後を区別できる | `PROVEN` |
| 正数のテストだけで旧版でも通る | `REJECTED: test-passed-without-fix` |
| 候補自体が負数のテストに落ちる | `REJECTED: candidate-fails` |

## 実際に確かめたこと

リファクタリング後に `just watch` で6件の小計が表示され、最初の1行は納品前に読めた。`just task` の総額も2,250円で、どちらも監査を通った。以前の2回分を再監査すると、初回に保存した JSON と一致した。納品物のコピーで「合計を1円変える」「精算表を取り除く」「原票に明細を足す」を個別に試すと、いずれも終了コード1で不合格になった。[実際の集計ログ](runs/expense-gcic86zm/work.log)・[その回の監査記録](runs/expense-gcic86zm/audit.json)
