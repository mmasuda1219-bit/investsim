// Prompt assembly for the Opus report generation (generate step) — R1.
//
// Owner priority: INFORMATION DENSITY AND ACCURACY over looks. The prompt
// carries every real number we have (full metrics, up to 20 dated trades with
// round-trip P/L, all fetched fundamentals with the gate verdicts, the AI
// trader's own track record on the symbol, current technical values) and hard
// instructions: every claim needs a numeric basis; the fundamental gate is a
// CURRENT-value static filter (not retroactive over 5y); the future outlook is
// real data + AI reasoning, not prophecy. The full equity curve stays out
// (token economy) — chartData is client-side only.

import type { FundamentalsData } from '@/types'
import type { BacktestCondition, CompositeCondition } from '@/lib/backtest/types'
import type { FundamentalGateResult, DerivedGateResult } from '@/lib/backtest/fundamental'
import {
  describeFundamentalFilter, formatMetricValue, METRIC_INFO,
  describeDerivedFilter, formatDerivedValue, DERIVED_METRIC_INFO, DERIVED_METRICS,
} from '@/lib/backtest/fundamental'
import type { StatementsData, DerivedFundamentals } from '@/lib/statements/types'
import type { PreparedBundle, BacktestSummary, AiTraderEvidence, NewsItem, MacroContext, SourceRef, LearningUsage } from './types'

const MAX_TRADES_IN_PROMPT = 20

function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

/** Human-readable technical rule description (also used by the /report UI). Pure. */
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

/**
 * Human-readable description of the R1 composite condition:
 * technical trigger + fundamental AND-filters (current-value static gate).
 */
export function describeCompositeCondition(c: CompositeCondition): string {
  const parts = [describeCondition(c.technical)]
  if (c.fundamentalFilters.length > 0) {
    parts.push(`ファンダ条件（現在値・静的）: ${c.fundamentalFilters.map(describeFundamentalFilter).join(' AND ')}`)
  }
  if (c.derivedFilters && c.derivedFilters.length > 0) {
    parts.push(`決算トレンド条件（年次実績）: ${c.derivedFilters.map(describeDerivedFilter).join(' AND ')}`)
  }
  return parts.join(' ＋ ')
}

// ── Financial-statement formatting (/report R2) ─────────────────────────────
function bn(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  return v.toFixed(0)
}
function marginPct(a: number | undefined, b: number | undefined): string {
  return a != null && b != null && b > 0 ? `${((a / b) * 100).toFixed(1)}%` : 'N/A'
}

/** Compact multi-period table (latest 5 years). Summary columns only (tokens). */
function fmtStatementsTable(st: StatementsData): string {
  const rows = st.periods.slice(-5).map((p) =>
    `${p.endDate} | 売上 ${bn(p.totalRevenue)} | 営業利益率 ${marginPct(p.operatingIncome, p.totalRevenue)}` +
    ` | 純利益率 ${marginPct(p.netIncome, p.totalRevenue)} | EPS ${p.dilutedEps != null ? p.dilutedEps.toFixed(2) : 'N/A'}` +
    ` | FCF ${bn(p.freeCashFlow)} | FCFマージン ${marginPct(p.freeCashFlow, p.totalRevenue)}`,
  )
  return `（通貨: ${st.currency}・出典: ${st.source}・年次${st.periods.length}期）\n年度末 | 売上 | 営業利益率 | 純利益率 | EPS | FCF | FCFマージン\n${rows.join('\n')}`
}

/** All derived metrics with values, undefined shown as 判定不能 (transparency). */
function fmtDerivedBlock(derived: DerivedFundamentals): string {
  return DERIVED_METRICS.map((k) => {
    const v = derived[k]
    const label = DERIVED_METRIC_INFO[k].label
    return v != null && Number.isFinite(v)
      ? `- ${label}: ${formatDerivedValue(k, v)}`
      : `- ${label}: 判定不能（データ不足）`
  }).join('\n')
}

/** Derived (earnings-trend) gate verdicts. */
function fmtDerivedGate(gate: DerivedGateResult): string {
  const lines = gate.evaluations.map((e) => {
    const cond = describeDerivedFilter(e.filter)
    if (e.result === 'no_data') return `✗ ${cond} → 判定不能（決算データ不足・fail-closed）`
    const actual = e.actual != null ? formatDerivedValue(e.filter.metric, e.actual) : 'N/A'
    return `${e.result === 'pass' ? '✓' : '✗'} ${cond} → 実測 ${actual}（${e.result === 'pass' ? '成立' : '不成立'}）`
  })
  lines.push(`総合判定（AND）: ${gate.passed ? '成立' : '不成立'}`)
  return lines.join('\n')
}

/** All fetched fundamentals with real values — nothing hidden from the model. */
function fmtFundamentals(f: FundamentalsData): string {
  const n = (v: number | undefined, suffix = '', mul = 1, dec = 2) =>
    v != null ? `${(v * mul).toFixed(dec)}${suffix}` : 'N/A（データなし）'
  const lines = [
    `PER=${n(f.pe, 'x')} | PBR=${n(f.pb, 'x')} | PEG=${n(f.pegRatio, 'x')} | EV/EBITDA=${n(f.evToEbitda, 'x')}`,
    `ROE=${n(f.roe, '%', 100)} | ROA=${n(f.roa, '%', 100)} | 営業利益率=${n(f.operatingMargin, '%', 100)} | 粗利率=${n(f.grossMargin, '%', 100)} | 純利益率=${n(f.profitMargin, '%', 100)}`,
    `売上成長=${n(f.revenueGrowth, '%', 100)} | 利益成長=${n(f.earningsGrowth, '%', 100)} | EPS=${n(f.eps)}`,
    `D/E=${n(f.debtToEquity, 'x')} | 流動比率=${n(f.currentRatio, 'x')} | FCF=${f.freeCashflow != null ? `${(f.freeCashflow / 1e9).toFixed(2)}B` : 'N/A（データなし）'}`,
    `時価総額=${f.marketCap != null ? `${(f.marketCap / 1e9).toFixed(1)}B` : 'N/A（データなし）'} | 配当利回り=${n(f.dividendYield, '%', 100)} | 52週高値=${n(f.week52High)} | 52週安値=${n(f.week52Low)}`,
  ]
  return lines.join('\n')
}

/** Fundamental gate verdicts: each filter with actual vs threshold. */
function fmtGate(gate: FundamentalGateResult): string {
  if (gate.evaluations.length === 0) {
    return '（ファンダメンタル条件なし — テクニカル条件のみ）'
  }
  const lines = gate.evaluations.map((e) => {
    const cond = describeFundamentalFilter(e.filter)
    if (e.result === 'no_data') {
      return `✗ ${cond} → 判定不能（実データ取得不可のため不成立扱い・fail-closed）`
    }
    const actual = e.actual != null ? formatMetricValue(e.filter.metric, e.actual) : 'N/A'
    const label = METRIC_INFO[e.filter.metric].label
    return `${e.result === 'pass' ? '✓' : '✗'} ${cond} → 実測 ${label}=${actual}（${e.result === 'pass' ? '成立' : '不成立'}）`
  })
  lines.push(`総合判定（AND）: ${gate.passed ? '成立' : '不成立'}`)
  return lines.join('\n')
}

/** Round-trip aware trade list: buys plain, sells annotated with P/L vs entry. */
function fmtTrades(bt: BacktestSummary): string {
  if (bt.trades.length === 0) return '（この期間・条件では売買シグナルが発生しませんでした）'
  let lastBuyPrice: number | null = null
  const all = bt.trades.map((t) => {
    if (t.action === 'buy') {
      lastBuyPrice = t.price
      return `${fmtDate(t.time)} 買 @${t.price.toFixed(2)}（約定額 ${t.value.toFixed(0)}）`
    }
    const pnlPct = lastBuyPrice != null && lastBuyPrice > 0
      ? ((t.price - lastBuyPrice) / lastBuyPrice) * 100
      : null
    const pnlStr = pnlPct != null ? `・往復損益 ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%` : ''
    return `${fmtDate(t.time)} 売 @${t.price.toFixed(2)}（約定額 ${t.value.toFixed(0)}${pnlStr}）`
  })
  const shown = all.slice(0, MAX_TRADES_IN_PROMPT)
  const omitted = all.length - shown.length
  if (omitted > 0) shown.push(`…他${omitted}件（省略）`)
  return shown.join('\n')
}

function fmtBacktest(bt: BacktestSummary): string {
  const m = bt.metrics
  const sign = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  return `- 対象: ${bt.symbol}（通貨: ${bt.currency}） / 期間: ${fmtDate(bt.startDate)}〜${fmtDate(bt.endDate)}（5年・日足${bt.barCount}本）
- 初期資金 ${bt.initialCapital.toFixed(0)} → 最終資産 ${bt.finalValue.toFixed(0)}（すべて仮想資金）
- 戦略の総リターン: ${sign(m.totalReturnPct)}
- 同期間のバイ&ホールド: ${sign(bt.buyHoldReturnPct)}（同じ実データの始値終値から算出 — 戦略との差 ${sign(m.totalReturnPct - bt.buyHoldReturnPct)}）
- 勝率: ${m.winRate.toFixed(1)}%（往復トレード基準） / 取引執行回数: ${m.tradeCount}回
- 最大ドローダウン: -${m.maxDrawdownPct.toFixed(2)}% / シャープレシオ: ${m.sharpeRatio.toFixed(2)}（日次リターン年率換算・rf=0）
- トレード一覧（最大${MAX_TRADES_IN_PROMPT}件・日付/価格/往復損益%）:
${fmtTrades(bt)}`
}

function fmtAiEvidence(ev: AiTraderEvidence, symbol: string): string {
  if (!ev.hasData) {
    return `（AIトレーダーはこの銘柄 ${symbol} をまだ売買・判断したことがありません — 実績データなし）`
  }
  const parts: string[] = []
  if (ev.tradeCount > 0) {
    parts.push(
      `- この銘柄のクローズ済み仮想売買: ${ev.tradeCount}回 / 勝率 ${ev.winRate.toFixed(1)}% / 平均損益 ${ev.avgPnlPct >= 0 ? '+' : ''}${ev.avgPnlPct.toFixed(2)}%`,
    )
  }
  if (ev.recentTrades.length > 0) {
    const lines = ev.recentTrades.map((t) =>
      `  ${t.outcome === 'profit' ? '✓' : '✗'} ${(t.entryAt ?? '').slice(0, 10)}買@${t.entryPrice.toFixed(2)} → ${(t.exitAt ?? '').slice(0, 10)}売@${t.exitPrice.toFixed(2)}（${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%・保有${t.holdingHours}h）\n    買い理由: ${t.entryReasoning} / 売り理由: ${t.exitReasoning}`,
    )
    parts.push(`- 直近の売買（entry/exit・理由つき）:\n${lines.join('\n')}`)
  }
  if (ev.relevantLessons.length > 0) {
    parts.push(`- この銘柄に関する蓄積教訓:\n${ev.relevantLessons.map((l) => `  • ${l}`).join('\n')}`)
  }
  if (ev.decisionsSummary) {
    parts.push(`- 直近のAI判断記録:\n${ev.decisionsSummary.split('\n').map((l) => `  ${l}`).join('\n')}`)
  }
  return parts.join('\n')
}

// ── Learning-usage honest disclosure (/report R4 slice 1) ──────────────────
// Mirrors bundle.learningUsage verbatim so the report can never claim lessons
// that were not in the prompt (原則9). `undefined` tolerated for bundles
// prepared before this field existed (mid-deploy) — treated as "unknown".
function fmtLearningUsage(usage: LearningUsage | undefined): string {
  if (!usage) return '（教訓の使用状況データなし — 教訓の使用について本文で言及しない）'
  const head = `- 集計範囲: ${usage.scope}\n- 注記: ${usage.note}`
  if (!usage.hasData || usage.usedLessons.length === 0) {
    return `${head}\n- 使用した教訓: なし（0件）`
  }
  return `${head}\n- 使用した教訓（プロンプトに実際に渡した全${usage.usedLessons.length}件）:\n${usage.usedLessons.map((l) => `  • ${l}`).join('\n')}`
}

// ── News / macro / citations formatting (/report R3) ───────────────────────
function fmtNews(news: NewsItem[]): string {
  if (news.length === 0) {
    return '（この銘柄の直近ニュースは取得できませんでした）'
  }
  return news.map((nw) => {
    const when = nw.publishedAt > 0 ? new Date(nw.publishedAt * 1000).toISOString().slice(0, 10) : '日付不明'
    return `- [${when}] ${nw.title}（${nw.publisher || '出所不明'}）`
  }).join('\n')
}

function fmtMacro(macro: MacroContext | null): string {
  if (!macro) return '（マクロ・市場指標を取得できませんでした）'
  const lines = macro.items.map((m) => {
    if (m.current == null) return `- ${m.label}: データなし`
    const cur = `${m.current.toFixed(2)}${m.unit}`
    const then = m.periodStartValue != null
      ? `（5年前 ${m.periodStartValue.toFixed(2)}${m.unit} → 現在 ${m.current.toFixed(2)}${m.unit}・${m.periodStartValue > 0 ? `${(((m.current - m.periodStartValue) / m.periodStartValue) * 100).toFixed(1)}%` : '—'}）`
      : ''
    return `- ${m.label}: 現在 ${cur} ${then}`
  })
  return lines.join('\n')
}

/** Numbered citation list for the prompt (URLs are shown but Opus must NOT reproduce them). */
function fmtSources(sources: SourceRef[]): string {
  return sources.map((s) => `[${s.id}] ${s.label} — ${s.usedFor}`).join('\n')
}

/** Build the single Opus prompt from a prepared bundle. */
export function buildReportPrompt(bundle: PreparedBundle): string {
  const { request, backtest: bt, current, fundamentalGate, aiEvidence, learningContext, sources,
    statements, derived, derivedGate, news, macro } = bundle
  const q = current.quote

  const statementsBlock = statements
    ? `${fmtStatementsTable(statements)}\n\n【決算から算出した派生指標（トレンド・質）】\n${fmtDerivedBlock(derived ?? {})}` +
      (derivedGate.evaluations.length > 0 ? `\n\n【決算トレンド条件の判定（実測 vs 閾値）】\n${fmtDerivedGate(derivedGate)}` : '')
    : '（この銘柄の決算書データを取得できませんでした — 決算書分析は不可）'

  const backtestBlock = bt
    ? fmtBacktest(bt)
    : `【ファンダメンタル条件が不成立のためバックテストは実行されませんでした】
- 理由: ${bundle.gateFailReason ?? 'ファンダメンタル条件が現在値で不成立'}
- レポートでは「なぜ条件が成立しなかったか」「成立に何が必要か」を上記ゲート判定の実測値に基づいて分析すること。`

  return `あなたはプロの投資アナリストAIです。ただし本レポートの目的は投資助言を与えることではなく、
プロの投資アナリストが実データをもとにどう分析プロセスを組み立てるかを、実データに基づき再現することです。
以下の実データに基づく分析レポートをMarkdownで作成してください。

【ユーザーが設定した売買条件（構造化・自由記述なし）】
- ${describeCompositeCondition(request.condition)}
※ ファンダメンタル条件は「現在値」による静的フィルタであり、過去5年のバックテスト期間には遡及しない（過去の各時点のファンダは取得不可）。この限界をレポートに必ず明記すること。

【ファンダメンタル・ゲート判定（現在の実測値 vs 閾値）】
${fmtGate(fundamentalGate)}

【バックテスト結果（実データ・過去5年日足・仮想資金・手数料/スリッページ未考慮）】
${backtestBlock}

【現在の状況（リアルタイム実データ）】
- ${q.symbol} ${q.name}: 現在値 ${q.price.toFixed(2)} ${q.currency}（前日比 ${q.change >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%・出来高 ${q.volume.toLocaleString()}）
- テクニカル（直近3ヶ月日足から算出した実数値）: ${current.technicals}
- ファンダメンタル（取得できた全指標・現在値スナップショット）:
${fmtFundamentals(current.fundamentals)}

【決算書（年次・複数期の実数値／損益計算書・貸借対照表・キャッシュフロー由来）】
${statementsBlock}

【AIトレーダーのこの銘柄での実績（InvestSim AIセッションの実記録）】
${fmtAiEvidence(aiEvidence, q.symbol)}

【AIトレーダーの学習コンテキスト（全銘柄横断・過去の仮想売買から蓄積した教訓）】
${learningContext || '（学習データなし）'}

【教訓の使用状況（正直表示 — 本文はこの内容と矛盾してはならない）】
${fmtLearningUsage(bundle.learningUsage)}

【直近の関連ニュース（現在・実データ／過去時点の個別ニュースは取得不可）】
${fmtNews(news)}

【マクロ・市場環境（米国市場指標／現在値と過去5年の推移）】
${fmtMacro(macro)}

【引用元（参照番号つき — 本文ではこの番号[n]で引用する）】
${fmtSources(sources)}

---

以下の9セクションを、この見出し・この順序で必ず出力してください（見出しの文言を変えない）:

## 前提
このレポートの位置づけ。仮想資金によるシミュレーションであること、バックテストは過去5年の実市場データに基づくこと、手数料・スリッページ未考慮の簡略モデルであること、ファンダメンタル条件は現在値の静的評価であり過去5年に遡及しないことを明記。

## 使用理論
ユーザーが設定した売買条件（テクニカルルール＋ファンダメンタル・フィルタ）の説明。ゲート判定の結果（各フィルタの実測値vs閾値）を数値つきで示す。判定不能（データなし）のフィルタがあればその旨も明示。さらに、**このレポート全体を貫く投資理論・判断の枠組み（例: トレンドフォロー、モメンタム、割安成長の複合など、この条件が依拠する考え方）を1段落で明示**し、以降の全セクションはこの枠組みと一貫した論理で書くこと。

## バックテスト結果
数値の提示だけでなく解釈を。リターン・勝率・ドローダウン・シャープの意味、バイ&ホールド（上記の実測値）との比較、この条件が過去5年のこの銘柄で機能したか/しなかったかの評価。**過去5年のマクロ環境の推移（上記の指数・VIX・金利の「5年前→現在」）を「当時の市場環境」として踏まえ**、この戦略の成績がその環境とどう関係したかにも触れる（※過去の特定日付の個別ニュースは取得できないため創作しない）。バックテスト未実行の場合は、条件不成立の理由と成立に必要な変化を実測値に基づき分析する。

## 現状分析
現在の株価・テクニカル実数値・ファンダメンタル実測値から見た現時点の状態。設定した条件のシグナルが今どの位置にあるか（発火に近いか遠いか）を具体的な数値で。**直近の関連ニュースと足元のマクロ・市場環境（VIX・米金利・指数・ドル指数・原油の現在水準）を加味**し、その根拠に引用元番号[n]を付す。

## 決算書分析（複数期推移）
上記の決算書（複数期の実数値）と派生指標を根拠に、**単期の絶対値ではなく複数期の傾きと一貫性**を評価する。売上・営業利益率・純利益率・EPS・FCFの方向性（成長しているか鈍化か、利益率は改善か悪化か）、利益の質（営業CF÷純利益）、財務健全性（自己資本比率・純有利子負債/EBITDA）を数値根拠付きで論じる。決算トレンド条件を設定している場合はその判定結果にも触れる。判定不能（データ不足）の指標は判定不能と明記し、決算データが取得できなかった場合はその旨を書く。

## AIトレーダーの実績
InvestSim AIトレーダーのこの銘柄での実際の売買実績（回数・勝率・平均損益・直近取引の理由・教訓）の要約と、それが本条件の評価にどう関係するか。実績データが無い場合は「実績なし」と明記し、全銘柄横断の学習コンテキストから言える範囲のみ述べる。**教訓の使用について**: 上記【教訓の使用状況】に使用した教訓がある場合は、どの教訓を本レポートの分析・予想にどう反映したかを具体的に述べる。0件（未使用）の場合は「蓄積された教訓はまだ無く、本レポートでは教訓を使用していない」と正直に明記する。【教訓の使用状況】に無い教訓を使ったと書くことは絶対に禁止。

## 未来予想
**足元の状況（直近ニュース・現在のマクロ/市場環境＝金利・VIX・指数・ドル指数・原油の現在水準）を加味した上で**、実データとAI推論に基づく今後のシナリオ（強気・中立・弱気の3シナリオと各々の条件・目安となる価格/指標水準）。各シナリオの根拠に引用元番号[n]を付す。**これは実データに基づくAIの推論であり予言ではないこと、投資判断はユーザー自身の責任であることを冒頭に明記する。**

## 根拠チェーン
上記の予想に至った論理の連鎖を「事実→解釈→推論」の形で箇条書きにする。各ステップでどのデータ（バックテスト数値/ゲート実測値/現在テクニカル/ファンダ/決算/ニュース/マクロ/AIトレーダー実績/学習コンテキスト）を根拠にしたかを数値・引用元番号[n]つきで明示。事実に無いステップを挟まない。最後に**「一貫性チェック」**の小見出しを置き、「使用理論」で明示した投資理論・枠組みに対して各セクションの結論が一貫しているかを自己点検する。セクション間で矛盾・緊張関係がある場合（例: バックテストは有効だが現状のシグナルは弱い、テクニカルは強気だがファンダは弱い等）は、隠さずその矛盾を明示し、どちらをどの理由で重く見たかを述べる。矛盾が無い場合も「矛盾なし」と根拠つきで書く。

## 引用元
上記【引用元】の番号付きリストを「[n] ラベル — 用途」の形でそのまま列挙する（本文で使った番号を中心に）。**URLは書かない**（アプリが番号[n]から実際のリンクを表示する）。

厳守事項:
- **すべての主張に数値根拠を付けること**。本文中の実データのみを使い、架空の数値を作らない。データに無いことを断定しない（不明なものは不明と書く）。
- **根拠チェーンの必須化**: 各セクションの冒頭に置く結論・判断には、必ず「事実（実数値または引用元番号[n]）→解釈→推論」の連鎖を本文中で明示的に添える。根拠を示さない断定は禁止（結論だけを先に書く場合も、直後にその連鎖を必ず示す）。
- **教訓の正直表示**: 教訓への言及は上記【教訓の使用状況】と完全に一致させる。使用0件なら「教訓は未使用」と書き、リストに無い教訓を使用したかのように書かない。
- **理論一貫性**: 「使用理論」で明示した枠組みをレポート全体で維持し、セクション間の矛盾は隠さず「根拠チェーン」末尾の一貫性チェックで明示・裁定する。
- **引用**: ニュース・マクロ・決算・バックテスト・現在指標などデータ由来の主張には、対応する引用元番号「[n]」を文末に付す。**URLは絶対に自分で書かない**（幻覚防止・リンクはアプリが番号から表示）。
- **ニュース・マクロの扱い**: 直近ニュースと現在のマクロ環境は現状分析・未来予想に加味する。過去分析では「当時のマクロ推移」を根拠にし、**過去の特定日付の個別ニュースは取得できないため創作しない**。
- ファンダメンタル条件は現在値の静的評価であり過去5年に遡及しない旨を必ず明記する。
- 未来予想は実データ＋AI推論であり予言ではない旨を明記する。
- **断定・助言表現の回避**: 「買うべき」「必ず上がる」「今が買い時」等の断定・助言的な表現は使わない。代わりに客観的事実データ（数値・決算・引用元）を根拠に、強みとリスクの両面をロジカルに提示する。
- **投資助言でない旨の明記**: 本レポートはプロの投資アナリストの分析プロセスを実データに基づき再現したものであり、投資助言ではないこと、投資判断はユーザー自身の責任であることを「前提」セクションで明記する。
- 上記の助言表現回避は情報密度を下げることを意味しない。数値と根拠の密度は引き続き最大化し、断定的な言い切りだけを避けること。
- 日本語で、具体的かつ情報量を最大に。見た目の装飾より数値と根拠の密度を優先する。`
}
