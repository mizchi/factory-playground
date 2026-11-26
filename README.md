# ソフトウェアファクトリーの実験場

選択した CLI エージェントが TypeScript のアルゴリズムを実装し、型検査・独立監査・セルフレビューをもとに納品まで進む小さなソフトウェアファクトリー。経費精算の実演では実装済みの Python 作業者を使い、依頼の送達と成果物の検査を観察できる。[元にした2実装の比較](reports/ソフトウェアファクトリー%20実装比較.md)

## ハッカソン用の雛形

会場の好みから新しい卓を作って遊ぶには `just trpg-demo-live`。ジャンルと好きな展開を答えると物語が始まり、参加者が最初の行動を入力できる。収録した月面図書館の卓は `just trpg-demo` で再演できる。[登壇・公開の手順](templates/trpg/hackathon.md)

- [汎用ファクトリー](templates/factory/README.md) は、依頼から生成・検査・独立レビュー・改稿までを回す。フォルダー単体で持ち出せる。`just factory-template` で参加案内のサンプルを動かせる。
- [TRPGの試遊卓](templates/trpg/README.md) は、遊びたい体験からシナリオを作り、30分または60分の卓をGM・NPC・2〜3人のPCで試遊する。PC同士の創発は発言順から追跡でき、GMの整合性は保存したログを `just trpg-audit <draft>` で再評価できる。端末で `just trpg` を実行すると、ジャンルや舞台を質問に沿って選べる。一言で依頼する例は `just trpg '雨宿りした喫茶店で、常連二人の小さな謎を解きたい'`。[試遊記録の見本](templates/trpg/example.md)

## 対戦ボードゲーム

`just boardgame '霧の街で通信帯域を奪い合う'` で、お題から複数形式の2人用ゲームを作り、LLM同士で試遊する。`just boardgame-web` で生成稿を開き、人間がCPU、LLM、Jevと対戦できる。[実行と試遊の手順](templates/boardgame/README.md)

## 自律実装を動かす

**ゴールは、依頼書から実装を作り、反例とセルフレビューの指摘を自分で修正し、受け入れ条件をすべて満たした版を納品すること。** 現在のお題は TypeScript の受注計画 CLI。認証済みの CLI（Codex、Claude Code、Pi のいずれか）、Node.js 24 以降、pnpm、just を使う。

```sh
pnpm --dir prototypes/schedule-task install --frozen-lockfile
just factory
```

1. 実装役に依頼書を渡す。各 CLI を非対話モードで呼び出し、実行ごとに新しい文脈を使う。モデルには仕様・検査結果・候補コードを渡す。ファイルの保存と納品はローカルの制御プログラムが行う。
2. 候補に strict 型検査をかけ、既存の独立監査で最大18問を実行する。最初の失敗で入力、期待する最適報酬、実際の出力を記録する。型検査と監査に合格した候補を「正しさ」と「計算量・実装品質」の2つの観点から個別にセルフレビューする。
3. 型エラー、監査失敗、レビュー指摘が一つでもあれば、前稿と指摘を実装役に渡す。修正版も型検査と監査から始める。すべて通った版だけを実行ディレクトリ直下の `solve.ts` に納品する。

既定の上限は3稿。`just factory 3 path/to/solve.ts` は手元の候補を初稿として検査する。終了コードは納品が0（`DELIVERED`）、上限到達が1（`EXHAUSTED`）、モデル呼び出し等の実行エラーが2（`ERROR`）。上限に達したときは、最終稿と未解決の指摘を残して終了する。

開始時に表示する `runs/schedule-factory-…/` に依頼書と `result.json` を保存する。各 `round-N/` の `solve.ts` がその回の候補、`types.json` と `audit.json` が検査結果、`review-*.json` がレビューの根拠、`feedback.json` が次稿に渡す指摘。各結果に候補の SHA-256 が入る。納品後は `just schedule runs/schedule-factory-…/solve.ts` で独立監査を再実行できる。[制御ループ](prototypes/schedule-task/factory-run.ts)・[モデル呼び出し](prototypes/schedule-task/model.ts)

### 異なるモデルを親子のパイプラインで動かす

```sh
MISE_NODE_VERSION=24.12.0 just factory-pipeline
```

同梱の[工程表](prototypes/schedule-task/pipeline.json)では、Codex の監督が全体に指示し、その子である Pi の設計担当が、さらに Codex のアルゴリズム担当と Pi の実装担当に指示する。次に境界ケースの検討、正しさレビュー、実装品質レビューが続く。型検査と18件の監査、両レビューを通った稿について、親の監督が最後に納品を判断する。

別の工程表は `just factory-pipeline path/to/plan.json` で指定する。各工程に一意な `id`、`agent`（`claude` / `codex` / `pi`）、`task` を持たせ、必要なら `model` を指定する。`children` を持つ工程が親。木に書いた順番で処理し、`job` のない葉は調査や設計のメモを返す。現在の納品対象は受注計画 CLI で、`implement`、`review-correctness`、`review-implementation` をこの順で各1回配置し、実装品質レビューを末尾に置く。途中にメモ担当や下位の親を追加できる。

- **共有メモ**は `runs/<実行ID>/team-board.json` に残る。各工程には直近6件の他担当のメモの抜粋を渡す。長い工程列で前半の結論を必ず参照したい場合、その工程に `"reads": ["algorithm"]` のように先行工程を指定する。2つのレビューには互いのレビュー結果を渡さない。
- **親の一斉指示**はその親の子孫の次のモデル呼び出しに含める。途中の親の指示は別の枝に配布しない。修正ラウンドでは監督の再開理由も全子孫へ渡す。誰のメモと指示をどのモデルに渡したかは `context.jsonl` に記録する。
- **運転中の追加指示**は別の端末から送れる。たとえば `just factory-broadcast runs/<実行ID> design "境界が接する入力例を共有メモに残す"` は設計担当の子孫向けの指示を更新する。送信時のモデル呼び出しは0回。実行中の応答はそのまま完了させ、次の呼び出しから親ごとに最新の追加指示を渡す。納品後は送信できない。
- **再開**は `just factory-resume runs/<実行ID>`。開始時の工程表を `supervisor.json` に保存し、完了した設計・調査メモを再利用する。親による追加指示もディスクに残る。

### Supervisor の heartbeat で完了まで回す

```sh
just factory-supervise                     # Codex の既定モデルで監督、30秒間隔
just factory-supervise gpt-6.2-sol 10      # 10秒はローカルの状態記録間隔
just factory-supervise "" 30 "" claude     # Claude Code
just factory-supervise "" 30 "" pi         # Pi
```

引数は順に監督モデル、heartbeat の間隔（秒）、任意の初期候補、CLI 名。実装・両レビュー・監督に同じ CLI を使う。モデル名の指定は監督だけに適用する。heartbeat は一定間隔で現在の工程を端末とファイルに記録する。作業中の監視にかかる監督 LLM の呼び出しは0回。機械検査で不合格になった時点、合格して両レビューが終了した時点、または工程が中断した時点で、作業者が監督に判断を1回依頼する。監督はその結果から修正・再開・納品を判断する。同じ稿でレビューが中断したときは、型検査と監査をやり直し、中断前に完了した観点のレビュー結果を再利用する。文脈上限エラーでは前稿を外し、仕様と短い指摘から再実装して検査し直す。

接続だけを有限回で試すには `just factory 1 prototypes/schedule-task/solve.ts claude` のように参考解を渡す。実際の CLI でレビューし、利用上限や認証エラーならエラーを返す。mise の shim が Pi の Node バージョンを特定できない場合は、Pi をインストールしたバージョンで実行する（例: `MISE_NODE_VERSION=24.12.0 just factory-supervise "" 30 "" pi`）。

このモードには回数上限がない。型検査・独立監査・両レビューが同じ稿で合格し、監督が `finish` を返すと納品する。監督の呼び出し失敗や判断保留、同じ工程の連続中断では、再試行まで1分、2分、4分と間隔を延ばす（最大15分）。Ctrl+C で手動停止できる。端末に観測中の工程と再開・終了判断が出る。`runs/schedule-factory-…/heartbeat.jsonl` の `heartbeat` はローカルの観測、`supervisor-call` は実際の監督呼び出し、`decision` はその判断と理由を表す。

実装・レビューには依頼書の仕様部分を渡す。修正時は現在の稿（16,000文字まで）と指摘の抜粋を使う。監督には課題名・工程・判定・指摘の抜粋を渡す。各回の `context.jsonl` で、役割ごとの呼び出し回数と、アプリが送った本文の UTF-8 バイト数（`inputBytes`）を確認できる。各 CLI 用のスキーマや CLI が付加する指示やモデル出力は、この数値の集計対象外。

**中断した実行の再開**　`just factory-supervise` は監督を子プロセスとして起動する。監督がクラッシュすると、親プロセスが同じ実行ディレクトリから再起動する。親はイベント待ちだけで、モデルは呼ばない。連続クラッシュ時の再起動間隔は1秒から最大60秒。Ctrl+C は意図した停止として親と子を終了する。端末を閉じた場合や手動停止の後は、開始時に表示されたパスで再開する。

```sh
just factory-resume runs/schedule-factory-<実行ID>
```

復帰時は保存した依頼、CLI 名、監督モデル、heartbeat 間隔、稿、修正指示を読み込む。型検査と独立監査を再実行し、同じ稿の保存済みレビューを再利用する。返答の保存前に中断した呼び出しは再試行する。同じ実行を2つの端末で再開すると、後から来た監督は終了コード2で終了する。納品済みなら SHA-256 を照合して終了する。チェックポイント導入前の未完了の実行は、保存した `round-N/solve.ts` を `factory-supervise` の初期候補に指定できる。

誤った実装の修正から観察するには次のコマンドを使う。

```sh
mkdir -p runs
seed=$(mktemp -d runs/supervisor-demo-XXXXXXXX)
echo 'console.log(JSON.stringify({reward:0,ids:[]}))' > "$seed/solve.ts"
just factory-supervise gpt-6.2-sol 10 "$seed/solve.ts"
```

`tj-loop` から、作業者の外で定期的に状態を読み、進行中の作業には重ねて指示を送らない設計を採った。この実装では前稿・反例・レビュー結果を次の実装呼び出しに渡す。判断待ちの間もローカルで heartbeat を記録し、作業者はその判断を受け取ってから次の稿に進む。[tj-loop の監督規則](https://github.com/laiso/tj-loop/blob/8bc68994165cd2834bbbf3048fe3dd917b35c290/tj-loop/SKILL.md)・[heartbeat の実装](prototypes/schedule-task/heartbeat.ts)

## 経費精算の実演を動かす

```sh
just watch
```

6件の経費明細を処理する様子が、今いる端末に1行ずつ出る。たとえば Design の印刷代で小計が700円になり、返金で0円に戻る。作業者が精算表を納品すると、監査役がファイルを読み直し、末尾に `成果物の監査: PASS` と再監査用のコマンドが出る。

| コマンド | 見られるもの |
| --- | --- |
| `just watch` / `just task` | 同じ経費精算を実行する。`watch` は実演用に明細ごとに0.8秒待ち、`task` は続けて処理する。tmux の起動と終了は自動。 |
| `just audit runs/<実行ID>` | 保存した依頼・原票・納品物を再採点し、期待値と実測値を JSON で表示する。実行IDを含むコマンドは実演の最終行からコピーできる。 |
| `just repro-sessions` / `just repro-factory` | 送達、テストの有効性について、それぞれ3ケースを検査する。`just repro` で全6ケースを実行できる。 |
| `just schedule-start` / `just schedule <提出ファイル>` | アルゴリズムの実装課題を配り、提出された TypeScript CLI を採点する。引数なしの `just schedule` では参考解の採点を実演できる。 |

## アルゴリズムを実装するお題

「開始・終了時刻と報酬が付いた依頼から、時間が重ならず報酬が最大になる組み合わせを返す CLI」を作る。午前と午後の依頼を各5円で受ければ計10円になり、1日を占める9円の依頼を上回る。提出するのは任意の入力を解く単一ファイルの `solve.ts`。同額の最適解はどれを返してもよい。[入出力仕様と具体例](prototypes/schedule-task/task.md)

参考解の計算をその場で見るには、次を実行する。4件の例では各依頼を採用した場合と見送った場合の報酬が出る。

```sh
just schedule-watch
```

Rex では実行元の右に「受注計画の実況」ペインが開く。同じ元ペインから再実行するとその実況ペインを再利用する。同じ提出なら監視を続け、別の提出を指定すれば進行中の採点が終わってから切り替わる。実況ペインを閉じた後は次回の実行で作り直す。通常の端末ではその場に実況が出る。監視を止めるには実況側で Ctrl+C を押す。

このチャットのシェルからも同じコマンドを使える。引き継いだペイン ID が古い場合は、同じ Rex セッションにあるこのプロジェクトの実況を探す。実況が1つなら、別タブを表示中でもその実況を制御する。初回で元ペインも特定できないときは、セッションのアクティブなタブを使う。

自分の提出で試すときは次の手順を使う。

1. `just schedule-start` で依頼書を用意し、表示された `just schedule-watch runs/schedule-work-…/solve.ts` を起動する。ファイルをこれから作る場合も待ち受けられる。
2. 同じディレクトリに `solve.ts` を書いて保存する。各回は保存時点のソースを使い、各問の開始・標準エラー・合否を端末に表示する。失敗時は最初の反例を記録し、小さな反例は入力もその場で表示する。採点中に変更した場合は終了後に最新の内容を採点する。監視の終了は Ctrl+C。
3. `runs/schedule-audit-…/` に提出時点のソース、依頼書、実行した各問の入力・期待値・結果が残る。`just schedule <提出ファイル>` は1回だけ採点して終了する。過去に保存した Python 提出の再採点には Python 3 を使う。

監査は小さな17問の最適値を組み合わせの列挙で求め、3,000件の問題には独立した1,000ブロックの最適値の合計10,000を使う。[採点](prototypes/schedule-task/audit.ts)・[問題と期待値](prototypes/schedule-task/cases.ts)

参考解は終了時刻順に依頼を並べ、二分探索で直前に選べる範囲を決め、動的計画法で最適報酬と採用 ID を復元する。計算量は時間 O(n log n)、空間 O(n)。[参考解](prototypes/schedule-task/solve.ts)

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
