// Prompt assembly for the Opus report generation (generate step).
//
// Token economy: the full equity curve is NOT included — only metrics and a
// bounded trade summary. The future-outlook section is explicitly framed as
// "real data + AI reasoning, NOT a prophecy".

import type { FundamentalsData } from '@/types'
import type { BacktestCondition } from '@/lib/backtest/types'
import type { PreparedBundle, BacktestSummary } from './types'

const MAX_TRADES_IN_PROMPT = 12

function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

/** Human-readable rule description (also used by the /report UI). Pure. */
export function describeCondition(c: BacktestCondition): string {
  if (c.type !== 'technical') return 'ファンダメンタル条件（未対応）'
  switch (c.indicator) {
    case 'ma_cross':
      return `終値が${c.period}日移動平均を上抜けで買い・下抜けで売り`
    case 'rsi_reversal':
      return `RSI(${c.period})が30を上抜け回復で買い・70を下抜けで売り`
    case 'macd_cross':
      return 'MACD(12,26,9)がシグナル線を上抜けで買い・下抜けで売り'
    case 'bb_break':
      return `終値がボリンジャーバンド(${c.period}日,±2σ)の上限突破で買い・下限割れで売り`
    case 'ma_cross_dual':
      return `${c.shortPeriod}日MAが${c.longPeriod}日MAを上抜け（ゴールデンクロス）で買い・下抜け（デッドクロス）で売り`
    case 'hl_break':
      return `終値が直近${c.period}日高値（前日まで）の上抜けで買い・直近${c.period}日安値の下抜けで売り`
    case 'stoch_cross':
      return `ストキャスティクス(${c.period},3,3): %Kが%Dを上抜け かつ %K≤30 で買い・下抜け かつ %K≥70 で売り`
    case 'roc_signal':
      return `変化率ROC(${c.period})が0を上抜けで買い・下抜けで売り`
    default: {
      // Exhaustiveness guard: adding a TechnicalCondition member without a
      // case here is a COMPILE error (never assignment), not a silent hole.
      const never: never = c
      return `未対応の条件: ${JSON.stringify(never)}`
    }
  }
}

function fmtFundamentals(f: FundamentalsData): string {
  const n = (v: number | undefined, suffix = '', mul = 1, dec = 1) =>
    v != null ? `${(v * mul).toFixed(dec)}${suffix}` : 'N/A'
  const parts = [
    `PER=${n(f.pe, 'x')}`,
    `PBR=${n(f.pb, 'x')}`,
    `ROE=${n(f.roe, '%', 100)}`,
    `ROA=${n(f.roa, '%', 100)}`,
    `営業利益率=${n(f.operatingMargin, '%', 100)}`,
    `売上成長=${n(f.revenueGrowth, '%', 100)}`,
    `D/E=${n(f.debtToEquity, 'x', 1, 2)}`,
    f.marketCap != null ? `時価総額=${(f.marketCap / 1e9).toFixed(0)}B` : null,
    f.dividendYield != null ? `配当利回り=${(f.dividendYield * 100).toFixed(1)}%` : null,
    f.week52High != null ? `52週高値=${f.week52High.toFixed(1)}` : null,
    f.week52Low != null ? `52週安値=${f.week52Low.toFixed(1)}` : null,
  ].filter(Boolean)
  return parts.join(' | ')
}

function fmtTrades(bt: BacktestSummary): string {
  if (bt.trades.length === 0) return '（この期間・条件では売買シグナルが発生しませんでした）'
  const shown = bt.trades.slice(0, MAX_TRADES_IN_PROMPT)
  const lines = shown.map(t =>
    `${fmtDate(t.time)} ${t.action === 'buy' ? '買' : '売'} @${t.price.toFixed(2)} (約定額 ${t.value.toFixed(0)})`
  )
  const omitted = bt.trades.length - shown.length
  if (omitted > 0) lines.push(`…他${omitted}件（省略）`)
  return lines.join('\n')
}

/** Build the single Opus prompt from a prepared bundle. */
export function buildReportPrompt(bundle: PreparedBundle): string {
  const { request, interpreted, backtest: bt, current, learningContext, sources } = bundle
  const m = bt.metrics
  const q = current.quote

  return `あなたはプロの投資アナリストAIです。以下の実データに基づく分析レポートをMarkdownで作成してください。

【ユーザーの投資理論（原文）】
${request.theoryText}

【理論の機械解釈】
- 実行ルール: ${describeCondition(interpreted.condition)}
- 解釈メモ: ${interpreted.note}

【バックテスト結果（実データ・1年日足・仮想資金）】
- 対象: ${bt.symbol}（${bt.currency}） / 期間: ${fmtDate(bt.startDate)}〜${fmtDate(bt.endDate)}（${bt.barCount}営業日）
- 初期資金 ${bt.initialCapital.toFixed(0)} → 最終資産 ${bt.finalValue.toFixed(0)}
- 総リターン: ${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct.toFixed(2)}%
- 勝率: ${m.winRate.toFixed(1)}%（往復トレード基準） / 取引回数: ${m.tradeCount}回
- 最大ドローダウン: -${m.maxDrawdownPct.toFixed(2)}% / シャープレシオ: ${m.sharpeRatio.toFixed(2)}（年率換算・rf=0）
- トレード一覧:
${fmtTrades(bt)}

【現在の状況（リアルタイム実データ）】
- ${q.symbol} ${q.name}: 現在値 ${q.price.toFixed(2)} ${q.currency}（前日比 ${q.change >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%）
- テクニカル: ${current.technicals}
- ファンダメンタル: ${fmtFundamentals(current.fundamentals)}

【AIトレーダーの学習コンテキスト（過去の仮想売買から蓄積した教訓）】
${learningContext || '（学習データなし）'}

【データソース】
${sources.map(s => `- ${s}`).join('\n')}

---

以下の7セクションを、この見出し・この順序で必ず出力してください（見出しの文言を変えない）:

## 前提
このレポートの位置づけ。仮想資金によるシミュレーションであること、バックテストは過去1年の実市場データに基づくこと、手数料・スリッページ未考慮の簡略モデルであることを簡潔に。

## 使用理論
ユーザーの理論の要約と、それをどう機械的な売買ルールに解釈したか。解釈の限界（理論のニュアンスのうちルール化できなかった部分）にも触れる。

## バックテスト結果
数値の提示だけでなく解釈を。リターン・勝率・ドローダウン・シャープの意味、バイ&ホールドとの概算比較、この理論が過去1年のこの銘柄で機能したか/しなかったかの評価。

## 現状分析
現在の株価・テクニカル・ファンダメンタルから見た現時点の状態。理論のシグナルが今どの位置にあるか（発火に近いか遠いか）。

## 未来予想
実データとAI推論に基づく今後のシナリオ（強気・中立・弱気の3シナリオと各々の条件）。**これは実データに基づくAIの推論であり予言ではないこと、投資判断はユーザー自身の責任であることを冒頭に明記する。**

## 根拠チェーン
上記の予想に至った論理の連鎖を「事実→解釈→推論」の形で箇条書きにする。各ステップでどのデータ（バックテスト数値/現在テクニカル/ファンダ/学習コンテキスト）を根拠にしたかを明示。

## 引用元
使用したデータソースの一覧（上記【データソース】をそのまま列挙し、それぞれ何に使ったかを1行で）。

日本語で、簡潔かつ具体的に。数値は本文中の実データのみを使い、架空の数値を作らないこと。`
}
