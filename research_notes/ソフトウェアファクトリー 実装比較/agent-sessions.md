# laiso/agent-sessions の監督と独立評価

## 何を実装し、何を利用者に託すか

### Takeaway

Herdr・tmux の端末ペインと Orca の bot を、すでに動いている作業者として扱う。Python CLI は宛先の発見・読み取り・送信の確認を提供し、同梱の Markdown スキルが監督や反復レビューの手順を定める。[公開コマンド](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/cli.py#L128-L165)、[監督ループ](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/skills/agent-sessions-supervisor/SKILL.md#L6-L24)

### Cited Findings

- CLI は `Session` の共通フィールドを list と send の結果で共有し、tmux の送信時に必要な識別子などは内部の派生型に保持する。read の共通 JSON は `structured` を持つ。Orca はメッセージ ID・種別・宛先、端末は生の本文と取得時刻を返す。[Session 型](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/model.py#L8-L29)、[読み取りレコード](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/read.py#L15-L19)、[端末の読み取り](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/read.py#L95-L99)
- Herdr の `agent_status` は snapshot 由来。tmux は対象エージェントの画面とフォーカスを利用し、許可待ち・作業中・入力待ち・完了を推定する。作業中の表示と入力欄が共存しうるため、待ちプロンプトの一文字で分類すると誤る。[Herdr の状態](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/herdr.py#L60-L67)、[tmux の判定順と候補](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/observe.py#L48-L85)、[画面10種類の分類テスト](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/test_collection_regressions.py#L250-L261)
- supervisor は一覧→固定対象を読む→前回と比較→判断→同じ対象で再観測。観測だけの依頼では報告する。対象範囲内の停止を同じ待機状態2回などで確認した場合のみ、短い促しを preview して1回送り、変化を読む。拒否・1回促した後も停止・担当/権限の判断は人に返す。画面や受信メッセージに新しい操作を許可する権限はない。この部分は自然言語の運用手順。[観測・判断](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/skills/agent-sessions-supervisor/SKILL.md#L8-L49)、[一度だけ促して再観測](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/skills/agent-sessions-supervisor/SKILL.md#L51-L70)
- CLI の `send` 自体に preview の強制はなく、端末は通常 Enter も送る。Orca は `question` が既定で Enter は使わない。未確認は exit 6。[send の分岐](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/cli.py#L40-L96)
- `review-fix-loop` では、査読者が自分の発見を直して検査し、役割を交換する。停止条件例は異なる査読者が2回連続で High ゼロ。ラウンド上限も設定し、重大度の不一致や2回繰り返す争点を人に返す。監督ツールは審査中の変更とは別の安定したコピーを使う。[ラウンドと打ち切り](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/skills/review-fix-loop/SKILL.md#L14-L45)
- 11月25日のコミットにある `blind-test-coder` は、独立テスト作者が別ブランチで既存テストを読まずに除去し、仕様・CLI help・ブラックボックス実行を材料に別のテスト群を作る手順。結果を実装の不具合か仕様の曖昧さに分類する。ファイルアクセス制限を提供するという主張ではなく、依頼を受けた作者への手順。[独立テストの条件と報告物](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/skills/blind-test-coder/SKILL.md#L7-L40)

### Inferences

- イベントの「生成中の人のレビュー・修正指示禁止」には監視だけを使える。レビューの合否・ラウンド上限・保留条件を事前に与え、人の判断が要る run は結果を記録して終える使い方が考えられる。人が途中で修正を返す運用はイベント条件と相いれない。監視と審査の独立性は別々に設計できる。[監督の分岐](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/skills/agent-sessions-supervisor/SKILL.md#L38-L49)、[査読の事前条件](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/skills/review-fix-loop/SKILL.md#L10-L22)

### Gaps

- 完成品の品質・生産性・所要時間の改善率および無人で生成を完走した割合は、上記のコードや観測からは求められない。

## 借りられる具体的なテクニックは何か

### Takeaway

担当者名、送信 API の成功、作業完了の表示を別の情報として扱う。メッセージ送信と読み取りの再試行を分ければ、遅い画面再描画で同じ作業を二重発注する危険を減らせる。[送信前後の比較](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/send.py#L115-L126)、[観測だけを反復](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/observe.py#L9-L33)

### Cited Findings

- ペイン番号に tmux サーバー PID・起動時刻・pane PID を合わせて宛先を検証する。貼り付け直前に同じサーバーで同一性・生存・入力可能を確認し、同期ペインに伝播しないよう固有バッファから対象ペインに貼る。本文と Enter の間に消えた場合は「本文済み、Enter 未送信」まで言える。[識別子](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/tmux.py#L10-L15)、[貼り付け先の検証](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/send.py#L32-L47)、[部分送信の区別](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/send.py#L76-L95)
- 送信前に画面を取得できなければ何も送らない。書き込み後は画面を観測し直す。端末のフッターが変わっただけ、過去ログに同じ文があっただけでは送信の証拠にしない。Orca は受信箱の ID・本文・件名・宛先等を照合する。ポーリングは約4秒を目安にした読み取りだけで、各読み取り自体が時間を要しうる。[初期画面と送信確認](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/send.py#L115-L126)、[下書きと新しい発話の区別](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/observe.py#L109-L136)、[受信記録との照合](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/orca_sender.py#L113-L135)、[再試行条件](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/observe.py#L9-L33)
- Orca の新規到着は ID で、端末は同一ペインの本文で比べる。端末 timestamp は読み取るたびに変わる。Orca は直近1000件の受信箱から所属を復元するため、古い dispatch が窓の外では run の宛先から bot を推定できない場合がある。[2種類の差分](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/skills/agent-sessions-supervisor/SKILL.md#L29-L38)、[履歴上限](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/README.md#L119-L128)

### Inferences

- 自然言語で「レビューして」と指定する層の下に、宛先・確認・再試行をコードで置く。障害対応の切り口は「届いたか」「作業が始まったか」「成果物は合格か」の3段階。ここで端末の `done` は別工程のテスト合格を保証しない。[状態推定](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/observe.py#L48-L68)、[終了時に成果を読む手順](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/skills/agent-sessions-supervisor/SKILL.md#L42-L49)

### Gaps

- 画面判定は特定のエージェント UI 文言に依存する。未知画面の状態や、終了したプロセスが意図通りの成果を生成したかはこの信号単独では確定できない。[未知画面の扱い](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/README.md#L32-L38)、[終了と成果の確認](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/skills/agent-sessions-supervisor/SKILL.md#L42-L49)

## 何を動かし、どこまで確かめたか

### Takeaway

調査版は GitHub default branch の `10c08c25bde8230af2823836e4b2e060e939e042`（2026-11-25）。macOS、Python 3.11.14 で、付属の隔離 fixture と実際の CLI を組み合わせて確認した。[版](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/skills/blind-test-coder/SKILL.md)、[CLI起動と環境の分離](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/helpers.py#L69-L88)、[fixtureの作り方](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/helpers.py#L123-L143)

### Cited Findings

- **実測**。非フォーカスの偽 Codex ペインに `› Build / • Tests passed / ›`（区切りは改行）を与えた。list の `status=done` に対して read は `type=terminal-output, structured=false` を返した。同じ宛先の `send --dry-run --format json tmux:%1 'build status?'` は `sent=false, enter=true` で、target 内の `status=running`。list のみが画面による状態推定を追加する。preview はターゲットの ID・入力予定の本文・Enter を確認する用途。[同型の画面 fixture](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/test_collection_regressions.py#L250-L261)、[一覧でのみ状態を更新](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/cli.py#L148-L165)、[send での対象解決と結果](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/cli.py#L78-L97)
- **実測**。`python3.11 -m unittest -v tests.test_send_spec.SendCommandSpecTests.test_dry_run_text_and_json_with_and_without_enter tests.test_delivery_regressions.DeliveryTests.test_enter_ack_without_submission_is_unconfirmed tests.test_delivery_regressions.DeliveryTests.test_missing_initial_capture_prevents_delivery` は3件とも成功。Enter の成功応答だけを返して画面を更新しないバックエンドでは exit 6、再送なし。初回読み取りに失敗すると書き込み0回。[dry-run の契約](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/test_send_spec.py#L68-L102)、[擬似 ACK に対する出力・送信回数](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/test_delivery_regressions.py#L164-L174)、[初回キャプチャ失敗](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/test_delivery_regressions.py#L191-L195)
- **再測定**。同じコミットを `git archive HEAD` でネットワーク無効の Linux arm64 コンテナ（公式 `python:3.14-slim`、Python 3.14.10）へ展開し、上流コードを変えず `python3 -m unittest discover -s tests` を実行。93件すべて成功（29.785秒）。スイートが使う fake Orca shim と AppImage は Linux 向けのディレクトリに置かれ、macOS の探索先とは異なる。macOS の Herdr 入力ケースは Python を3.14.2にして単独で再実行すると成功した。[標準テスト経路](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/README.md#L185-L192)、[fixture の設置先](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/helpers.py#L171-L179)、[OS別の探索](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/src/agent_sessions/orca.py#L19-L33)
- **再測定**。同じ git archive とテストコマンドを Linux amd64・Python 3.11.2 で動かすと92/93件成功、残る1件は `test_herdr_delivery_stages`（`message is empty`）。macOS・3.11.14 でこのケースの入力を一つずつ dry-run すると、本文が文字列 `--` だけのときに exit 2 だった。[対象入力](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/test_delivery_regressions.py#L60-L74)
- **実測**。`python3.11 -m unittest discover -s tests` 全体は93件中79成功、11 failure・3 error。Orca の複数の失敗には `env: bash: No such file or directory`、Herdr の引数処理の1失敗には `message is empty` が出た。この checkout と環境の組み合わせの実測であり、全実装の不具合数とは扱わない。[Orcaのテスト用環境](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/helpers.py#L123-L143)、[Herdr入力テスト](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/test_delivery_regressions.py#L60-L77)

### Inferences

- イベント当日は「送信したはずなのに入力欄に残る」という故障を1つ見せると、受け手側で新しい証拠を読む理由を説明できる。上記2つ目のテストは実アカウントや外部宛先を必要としない。[回帰テスト](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/tests/test_delivery_regressions.py#L164-L174)

### Gaps

- 実サービスへの配信、ライブバックエンド、独立テスト作者がスキルに従う度合いは測定していない。ライブ試験は環境・明示的な宛先によるオプトインを別途想定している。[テスト範囲の説明](https://github.com/laiso/agent-sessions/blob/10c08c25bde8230af2823836e4b2e060e939e042/README.md#L185-L199)
