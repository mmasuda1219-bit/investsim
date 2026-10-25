# 測定1（2026-10-22）の記録 — プロンプト v1

`scripts/eval-critique.ts`（claude-opus-5・max_tokens 16000）→ `scripts/eval-judge.ts`（claude-sonnet-5）の結果をそのまま保存したもの。
`runs/` は添削9回＋判定9回、`report.md` は判定が書いた報告。手で直していない。

- 仕込んだ誤りの発見率 28/36（78%）。公表値との食い違い3件は 9/9
- 禁止語 0/76・引用の実在 76/76・与えられていない数字 0・expectNot を踏んだ 0/15
- clean で空を返した回 0/3（毎回4〜5件）→ プロンプト v2 で (b) を狭める理由

プロンプト v1 は `lib/lab/critique/prompt.ts` の 2026-10-22 以前の版（git の `541cb32`）。
