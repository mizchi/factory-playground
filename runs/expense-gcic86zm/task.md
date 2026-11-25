# 経費精算 v1

同封の `expenses.csv` を集計し、`report.csv` を納品する。
金額の単位は円。返金は負数として加え、合計が0円の部署も載せる。

納品形式は UTF-8 の CSV。ヘッダーを `department,total_yen` とし、
各部署を名前の昇順で1行ずつ載せ、最終行に `TOTAL` と全体の金額を書く。
