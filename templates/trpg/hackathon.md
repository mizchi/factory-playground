# ハッカソンでTRPGファクトリーを実演する

## 本番の3分間

用意するのは Node.js 24 以降と `just`。リポジトリのルートで実行する。投影用の端末を一つ用意し、そのウィンドウだけを画面共有する。月面図書館の収録卓はオフラインで再演できる。

| 目安 | 投影用の端末 | 話すこと |
| --- | --- | --- |
| 0:00 | `just trpg-demo` | 「月面図書館の閉館前夜、二人で貸出票の謎を解き、最後に誰に本を貸すか決めたい」。これはそのお題から作った卓の試遊記録。最初の手がかりを一緒に読む。 |
| 0:40 | `just trpg-demo choice` | GMの問いで止める。「皆さんなら誰に、どうやって最後の一冊を届けますか？」。別案も一つ募る。 |
| 1:40 | `just trpg-demo ending` | 司書が選んだ借り手と、返却人が考えた届け方が、どう一つの結末になったかを見る。 |
| 2:30 | 結末を表示したまま | 編集者は二人の選択が結末に効いたと判定した。一方で「なぜ借り手を一人に絞るのか」の手がかりには改善の余地があった。参加者の別案でもこの結末に納得できるかを聞く。[この卓の講評](examples/moon/draft-1/assessment.json) |

### 会場のお題から新しく作る

事前に、配信していない端末でモデルCLIにログインしておく。既定は Codex。新しい卓はモデルの応答時間がかかるので、生成を始めたら上の収録卓を投影できる。

1. 進行役の端末で `just trpg` を実行する。人がPCを一席担当するなら `just trpg-play` を使う。
2. たとえば順に `2、5`（脱出ゲームとSCP的ホラー）、`出口の法則を見つけたい`、`夜勤中、エレベーターが存在しない階で止まる`、`30` と答える。回答は生成・試遊を担当するモデルに渡るので、会場で使う架空の設定だけを入力する。
3. 表示された実行先の `result.json` で判定を読む。`READY_FOR_HUMAN` は人間による試遊に回せる判定。`NEEDS_EDIT` や `CHECK_ASSESSMENT` のときは、その稿で指摘された箇所を紹介できる。
4. 新しい卓を会場に紹介するときは、進行役が `draft-1/session.json` の公開発言を先に読み、紹介する場面を選ぶ。人間のプレイ端末には本人の秘密の手札も表示される。GM冊子、個別手札、チェックポイント、モデルの入出力を含む `calls.jsonl` は進行役の端末に置く。認証切れやモデル待ちの間は `just trpg-demo` で続けられる。

## 主催者が公開する手順

1. 公開予定の変更をコミットし、`git status --short --branch` と `git ls-remote origin` で対象を確認する。履歴には過去に削除したファイル、コミットの本文、作者・コミッターのメールも残る。`git log --all --format=fuller` は非共有の端末で確認する。
2. 全履歴と、配布するファイルの実体を検査する。以下は Gitleaks 8 の例。いずれかの検査が失敗したら公開前に内容を調べる。秘密鍵やトークンが実在した場合は発行元で失効・再発行し、履歴の扱いも決めてから再検査する。

   ```sh
   gitleaks git --log-opts="--all --full-history" --ignore-gitleaks-allow --redact .
   demo_snapshot=$(mktemp -d)
   git archive HEAD -o "$demo_snapshot/source.tar"
   mkdir "$demo_snapshot/tree"
   tar -xf "$demo_snapshot/source.tar" -C "$demo_snapshot/tree"
   gitleaks dir --ignore-gitleaks-allow --redact "$demo_snapshot/tree"
   git ls-files runs
   ```

   このリポジトリで追跡する `runs/` の内容は、架空の経費明細を使う `expense-gcic86zm` の見本6ファイル。TRPGの各卓や自由回答はローカルに保存する。配布する月面図書館の見本は `templates/trpg/examples/moon/` にあり、GM用の真相と結末も公開する教材。

3. GitHubのブランチ・タグ、Issue・PRとコメント、Wiki、Release添付、Actions履歴・成果物も確認する。公開にすると既存のActionsログも閲覧できる。[GitHubの公開範囲変更について](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
4. `git push origin main` で検査済みのコミットを送り、`git rev-parse HEAD` と `git ls-remote origin refs/heads/main` のハッシュを照合する。既存リポジトリを公開する場合は GitHub の **Settings → General → Danger Zone → Change repository visibility → Public** を使う。
5. ログアウトしたブラウザでリポジトリとこのページが開くことを確かめる。新しいディレクトリに公開URLからcloneし、`just trpg-demo`、`just trpg-demo choice`、`just trpg-demo ending` を順に実行する。最後に `node --test templates/factory/*.test.mts templates/trpg/*.test.mts` で生成・試遊のテストを確認する。
