import { parseRules } from "./game.mts";

export const examples = [
  {
    pattern: "claim", title: "灯台群",
    premise: "霧が深まる前に、各地の灯台へ補給船を送る。どの航路を得意とするかは船長だけが知っている。",
    hypothesis: "相手が繰り返し狙う航路を読み、得点を少し譲って先に取る。",
    labels: ["外洋航路", "近海航路", "湾内航路"], values: [3, 2, 1], rounds: 8, bonus: 2, variation: 0,
  },
  {
    pattern: "duel", title: "霧の決闘",
    premise: "限られた六枚の合図で、霧の向こうの相手と渡り合う。同じ合図を切れるのは二回まで。",
    hypothesis: "残り枚数から相手が出せる手を絞り、自分の切り札をいつ使うか決める。",
    labels: ["灯火", "鏡", "煙幕"], values: [3, 2, 2], rounds: 6, bonus: 0, variation: 0,
  },
  {
    pattern: "invest", title: "夜市の行商",
    premise: "屋台を育てるか、先に品を売り切るか。夜市の換金所は各ラウンド一人分だけ開く。",
    hypothesis: "常連を増やして得た資金を、他の行商に枠を取られる前に換金する。",
    labels: ["屋台を広げる", "仕入れを手伝う", "品物を売る"], values: [1, 1, 5], rounds: 8, bonus: 1, variation: 0,
  },
  {
    pattern: "auction", title: "遺物市の封印入札",
    premise: "巡回市場に小品と目玉が順に並ぶ。どの品に財布を開くか、相手の入札を読む。",
    hypothesis: "2点の品を見送り、相手の資金が少ないときに6点の品を取りにいく。",
    labels: ["見送る", "小口で入札", "大口で入札"], values: [8, 1, 3], rounds: 9, bonus: 6, variation: 0,
  },
  {
    pattern: "mine", title: "赤穴坑道",
    premise: "二つの採掘隊が同じ岩盤を掘る。鉱石を持ち帰るまで、落盤ひとつで手持ちが消える。",
    hypothesis: "相手が深掘りに賭けそうなときに帰還し、未回収の鉱石を守る。",
    labels: ["浅く掘る", "深く掘る", "地上へ戻る"], values: [2, 4, 5], rounds: 8, bonus: 0, variation: 0,
  },
  {
    pattern: "islands", title: "潮路諸島",
    premise: "二つの港が同じ工房と航路を使い、8ラウンドで発展を競う。潮が変わる前に、資材を揃えて船を出そう。",
    hypothesis: "設備を先に建てて後半の出荷を支えるか、近海便で先に点を取るか。相手も使いたい航路を先に押さえる。",
    labels: ["採取", "建設", "出荷"], values: [2, 3, 6], rounds: 8, bonus: 4, variation: 0,
  },
  {
    pattern: "resonance", title: "雷奏回廊",
    premise: "三つの入口から共有の回路へ送電する。二つの得点塔を一本の連鎖で鳴らすと、大きな得点になる。",
    hypothesis: "相手が満タンに近づけた回路を読み、2基を同時に放電させるところで増幅を使う。",
    labels: ["琥珀口", "蒼光口", "紫電口"], values: [4, 3, 5], rounds: 9, bonus: 2, variation: 0,
  },
].map(parseRules);
