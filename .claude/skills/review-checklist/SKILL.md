---
name: review-checklist
description: investsim固有のレビュー観点チェックリスト。モックデータ混入・実決済連携・重大度分類。reviewerが使う。
---

# review-checklist

diffをレビューする際、以下を critical / warning / suggestion に分類してチェックする。

## critical
- モックデータ・ハードコードされたデータが、恒久的なフォールバックとして本番経路に混入している
- 実際の銀行API・送金・決済処理につながるコードが追加されている（investsimは仮想資金のみ）
- APIキー・シークレットのハードコード/コミット

## warning
- 過去データ表示・バックテスト機能がホームページや中核導線に前面化している（`/ai-session` が主であるべき）
- エラー時に無言でモックデータへフォールバックし、ユーザーに実データでないことが伝わらない
- 学習メモリ（`lib/ai-trader/memory.ts`）を使わずに売買判断が完結している（学習ループの目的に反する）

## suggestion
- スコープ外のファイル変更
- 過度な抽象化・将来を見越した汎用化
- テスト不足
