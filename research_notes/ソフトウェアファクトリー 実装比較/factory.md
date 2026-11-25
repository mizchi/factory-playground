# addyosmani/factory の工程と受け入れ条件

## 一つの要求をどう引き渡すか

### Takeaway

GitHub の issue を作業単位とし、作業状態、着手してよい範囲、完了条件を別々に記録する。判断が要る要求は人に戻し、機械で判定できる要求だけが無人の実装に進む。[共通契約](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/CONTRACT.md#L6-L33)

### Cited Findings

- 調査版は 2026-08-18 の `8af116567166a0a16588b7ab1b9934ece0b775bc`。ホストするサービスは配布していない。既存 repo に入れるテンプレートで、Claude Code と Codex は共通の契約を読む。Codex の実装スキル自体は、Claude 側の実装手順を参照して独立コンテキストで検証する短いアダプター。[設計](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/ARCHITECTURE.md#L64-L78) [Codex アダプター](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.agents/skills/factory-implement/SKILL.md#L6-L11)
- 人が `CHARTER.md` に自動化してよい作業、変更に人の判断を要するファイル、停止条件を記す。triage は一意の状態ラベルを選ぶ。曖昧なら `needs-info`、設計判断があれば `ready-to-spec`、自動化可能で判定条件があれば `ready-to-implement` にする。[分類](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/skills/factory-triage/SKILL.md#L42-L56) [charter](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/CONTRACT.md#L6-L16)
- 設計待ちには、Product → Architecture → Program design → Slices の4段を置き、人の承認を各段でファイルに残す。Slice 0 はモック中心でも全経路を通し、以後の各 slice で一つのモックを実物に替える。それぞれの issue に独自の完了条件が付く。明確な小修正はこの分岐を経由する必要がない。[設計と承認](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/skills/factory-spec/SKILL.md#L17-L82)
- 着手可能な issue には `factory-handoff:v1` コメントを一つ保つ。内容は `done_when`、`files_expected`、`load_bearing`、`gate_level`、`confidence` 等。再分類時は元のコメントを更新する。状態は GitHub ラベルが正本、`QUEUE.md` は監査用スナップショット。コメントが欠損・重複・契約と矛盾すれば実装者は人に戻す。[引き継ぎの形式](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/CONTRACT.md#L35-L81) [着手前の確認](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/skills/factory-implement/SKILL.md#L12-L31)
- 実装するのは1回に1件。ゲートの結果を出してから、実装者の説明を渡さず issue、branch、base SHA を別コンテキストの検証者に渡す。検証者は diff を読み、ゲートを再実行し、`done_when` を確かめる。PR 作成後の別検証ルーチンは PR に結果ラベルを付け、マージは人が行う。[実装から検証へ](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/skills/factory-implement/SKILL.md#L93-L115) [検証者の入力](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/agents/factory-verifier.md#L16-L45) [PR 上の検証](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/skills/factory-verify/SKILL.md#L14-L29) [結果ラベルと人のマージ](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/skills/factory-verify/SKILL.md#L58-L69)
- monitor は作業の滞留とベースラインの劣化も見る。CI の再実行で通る flake を区別し、発見を issue に戻す。また「調べて問題がなかった項目」を記録する。2時間更新がない claim は人の回収対象、7日を超えたレビュー待ちはレビュー能力が詰まった印とする。run は共有ログに追記せず、時刻・工程・issue ID を含む別々の Markdown にして書き込み競合を避ける。[監視対象](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/skills/factory-monitor/SKILL.md#L18-L49) [正常も記録](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/skills/factory-monitor/SKILL.md#L80-L92) [run record](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/runs/README.md#L1-L35)

### Inferences

- 運用を移植するなら、状態だけのラベルに完了条件が埋もれない形が有用。利用者の「終わったら何が観測できるか」を上流で決めて検証者まで残せる。[handoff](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/CONTRACT.md#L53-L68) [検証時の照合](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/agents/factory-verifier.md#L75-L103)

### Gaps

- 本調査の実行は下記のローカル fixture に限る。GitHub Issue から PR・人のマージまでをモデルで一周する運用成績、コストやリードタイムは計測していない。run records に残す項目は公開されている。[run record の仕様](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/runs/README.md#L12-L35)

## 何をコードで保証し、何を運用に委ねるか

### Takeaway

競合の裁定は Git、ゲートの成否は shell の終了コード、マージ権限はリポジトリ側の設定が担う。分類、初見の検証者を本当に呼ぶこと、レビュー待ち件数での停止はエージェントが実行する手順である。[claim と人への返却](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/CONTRACT.md#L70-L95) [GitHub 側の設定](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/GITHUB.md#L18-L43)

### Cited Findings

- **ラベル更新の競合を Git で裁く。** 同じ issue を見た2実行が同じ名前 `claude/fq-<issue>` の ref を取りに行く。run ID を入れた空コミットで SHA を異ならせ、通常の push が通った側だけが `in-progress` に変更する。2個目の非 fast-forward push は Git が拒む。プロトコルは Markdown、Git による衝突はローカル bare リポジトリで試験される。途中で絶えた claim は monitor が人に知らせ、自動で横取りしない。[claim 手順](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/skills/factory-implement/SKILL.md#L33-L50) [競合テスト](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/tests/test-claim.sh#L7-L34) [回収手順](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/GITHUB.md#L35-L43)
- **成功・検査失敗・必須検査の欠落を分ける。** `full` の初期設定は types、lint、test が必須。ゲートは一つ失敗しても他を調べ、最後の `FACTORY_GATES` 行に passed、failed、skipped、misconfigured を並べる。必須 gate が skip 処理を通ると exit 2、検査が失敗すると exit 1、成功は 0。任意 build の skip は表示したまま成功できる。deep の architecture gate には独自規則を追加する場所があり、初期状態のサンプル規則はコメントアウトされている。[既定値](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.factory/gates.conf#L1-L9) [集計](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/scripts/gates.sh#L71-L91) [判定と architecture の初期値](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/scripts/gates.sh#L201-L242)
- **テストを残して変更を一時的に取り消す。** `prove-test.sh` は基準コミットの存在と追跡対象の未コミット差分を確認し、指定テスト以外の変更を binary patch として逆適用、対象テストを実行後に復元する。修正を取り消してもテストが通るなら `FAILED`。失敗理由の判定は検証者に残る。スクリプトは渡したコマンドの終了コードを見ている。[前提](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.factory/scripts/prove-test.sh#L33-L61) [逆適用・テスト・復元](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.factory/scripts/prove-test.sh#L63-L107)
- **人のレビュー能力を着手条件に含める。** charter はレビュー待ちの上限、同一 item のゲート連続失敗、差分行数等を可変の停止条件として示す。実装スキルはレビューが詰まったら claim 前に止まるよう指示する。数字の境界はサンプル charter の「3より多い」とスキルの「上限に達した時」で表現に差があるため、「必ず3で機械停止する」という解釈は避ける。[charter の停止例](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/CHARTER.md#L145-L156) [着手前の指示](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/skills/factory-implement/SKILL.md#L21-L31)
- **GitHub ruleset とツールフックの責務。** `block-merge.sh` はシェル呼び出しの一部を止める。全経路に適用するには GitHub 側で PR を要求し、agent に bypass を与えず、適切な CI や必要承認を設定する。運用上の人マージと required human approval の実際の設定は別で、後者は tier に合わせるよう書かれる。ルーチンの時刻・トリガー・権限なども別途設定が必要。[hook](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/hooks/block-merge.sh#L2-L10) [ruleset](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/GITHUB.md#L18-L33) [クラウド固有の設定](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/ARCHITECTURE.md#L22-L29)

### Inferences

- 二種類の失敗を分けると、テストコードの修正が必要な場面とテスト自体を配線する必要がある場面を運用者が見分けられる。独立検証と組み合わせて、判定に使ったコマンドに意味があることまで確認したい。[判定コード](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/scripts/gates.sh#L216-L242) [検証者の判断](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/.claude/agents/factory-verifier.md#L47-L61)

### Gaps

- 同時 claim fixture は同じ base から二者が競う正常系の排他を確認する。push 成功とラベル更新は別操作で、実行の途中停止や stale claim の回収は運用上の境界。[契約](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/CONTRACT.md#L70-L95) [回収](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/template/docs/factory/GITHUB.md#L35-L43)

## 手元で何が再現できたか

### Takeaway

2026-11-25 に対象 SHA を取得した一時ディレクトリで、同梱の claim、gates、proof の3試験を実行した。検証用 Git remote はローカルの bare repo。外部 AI や GitHub への書き込みは用いていない。[claim](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/tests/test-claim.sh#L4-L34) [gates](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/tests/test-gates.sh#L7-L54) [proof](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/tests/test-proof.sh#L7-L37)

### Cited Findings

| 実行 | 確認した出力・挙動 |
| --- | --- |
| `bash tests/test-claim.sh` | `claim: ok`。最初の push は成功。同じ issue の2番目は exit 1。[fixture](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/tests/test-claim.sh#L17-L34) |
| `bash tests/test-gates.sh` | `full` のテストあり・正常は `GREEN passed=3`。テスト失敗は `RED failed=1 failing=test`、exit 1。テスト設定なしは `MISCONFIGURED passed=2 failed=0 ... misconfigured=test`、exit 2。3例とも任意 build は skip。[fixture](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/tests/test-gates.sh#L13-L54) |
| `bash tests/test-proof.sh` | 修正後の値を検査するテストで `PROOF: status=PROVEN test_exit=1`。常に通るコマンドで `PROOF: status=FAILED reason=test-passed-without-fix`。同梱テストは両ケースで対象ファイルが元の内容に復元され、Git に差分が残らないことも確認した。[fixture](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/tests/test-proof.sh#L12-L37) |

### Inferences

- 登壇時に一つ実演するなら proof fixture が短い。検証者が「テストを追加した」と受け取るよりも、そのテストが変更前後を区別できることを実物で見せられる。[fixture](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/tests/test-proof.sh#L12-L37)

### Gaps

- これらはテンプレートの機械的な部品の再現であり、人が適切な仕様を書けるか、独立検証者の判断精度、生産性への寄与は今回の観測対象外。[実装と責務の配置](https://github.com/addyosmani/factory/blob/8af116567166a0a16588b7ab1b9934ece0b775bc/ARCHITECTURE.md#L33-L50)
