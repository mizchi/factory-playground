# 汎用ファクトリーを作る雛形

まず「何を作るか」と「受け手がどこを見れば使えると判断できるか」を決める。同梱の題材は読書会の参加案内。作者と編集者は別の文脈で動く。手元のプロジェクトへはこのフォルダーだけをコピーすればよい。

## 起動

Node.js 24以降と、認証済みの `codex`、`claude`、`pi` のいずれかを PATH に用意する。同梱設定は Codex を使う。npm パッケージのインストールは不要。

```sh
# コピーしたフォルダー内から
node run.mts
node --test run.test.mts  # モデル呼び出しなし
```

このリポジトリのルートでは `just factory-template`。依頼を変えるなら `just factory-template templates/factory/factory.json '初参加の人向けに、読書会の当日の進め方を書いて'`。

## 自分の題材に変える

1. [factory.json](factory.json) の `task` を依頼に、`criteria` を編集者が確認する品質条件にする。`requiredHeadings` は必須のレベル2見出し。作者・編集者の `agent` と任意の `model` は別々に選べる。
2. 機械で判定できる条件を [checks.mts](checks.mts) の `checkArtifact` に書く。Markdownなら見出し、CSVなら列や総計など。戻り値は直すべき点の配列で、空なら合格。
3. [run.mts](run.mts) が「生成 → 機械検査 → 独立レビュー」を実行する。機械検査に落ちた稿はレビューを省く。編集者は成果物から引用し、その引用が実在するかをコードで確かめる。引用の妥当性や文章の良し悪しは人が読み返せる。

`runs/factory-template-*/` に依頼、各稿、検査、講評が残る。合格は `ACCEPTED`（終了コード0、`delivery.md` を作成）。`maxRevisions` 回直しても未達なら `NEEDS_EDIT`、講評の根拠を照合できなければ `CHECK_ASSESSMENT`（ともに1）。CLIの認証エラー等は `ERROR`。ワークショップではまず改稿上限を1にして、モデルが指摘した差分を人が一つ読むとよい。

この雛形は Markdown 1点を納品する最小例。GMやゲームの採点項目への依存はない。役ごとに秘密や公開情報を分ける応用例が [TRPG版](../trpg/README.md)。再起動後の自動復帰や親子への一斉指示が必要な長時間ジョブには、リポジトリの `just factory-pipeline` がある。
