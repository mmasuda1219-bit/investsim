# 測定2（2026-10-22）の記録 — プロンプト v2

v1（`../baseline-2026-10-22-v1/`）と同じメモ・同じ採点基準・同じモデル。変えたのは `lib/lab/critique/prompt.ts` だけ
（(b) を主張に関わる数字だけ・最大3件、全体最大6件・空でもよい）。

- 発見率 23/36（64%）← v1 78%。公表値との食い違い3件は 9/9（同じ）
- **clean で空を返した回 3/3（100%）** ← v1 0/3。1回あたり 5〜6 件 ← v1 8〜12 件
- 禁止語 0/35・引用の実在 35/35・与えられていない数字 0・expectNot を踏んだ 0/15・3回同じ 10/12
- 落としたもの: cf-profit-unchecked 0/3・forecast-as-reason 0/3・net-eps-untouched 0/3・segment-impression 1/3・fame-as-safety 1/3 → 規則（カタログ）で拾う側
- 1回だけ 307 秒かかった回あり（decided-uncollected #2・API 側の遅延）
