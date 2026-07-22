// 投資家モデル定義（/analyze S3）— 単一の真実源。
//
// 【オーナー要望・最重要】各モデルは、その投資家の言語化された投資理論・信念
// （philosophy）を土台とし、そこから導かれる形でテクニカル/ファンダ/決算の傾向を
// 組む。単なる閾値の寄せ集めにしない。各条件には「なぜその指標を選んだか」の
// rationale（信念からの導出根拠）を紐づけ、信念と実装のギャップ（例: 「一生保有」は
// エンジンに評価器が無い）は approximationNotes に正直に注記する
// （COMPANY.md 原則9 — 実データ・実在指標のみ、捏造・偽装トリガー禁止）。
//
// 使う部品は既存の実在するものだけ:
//   - テクニカル: lib/backtest/rules.ts に実装済みの8種 indicator のみ
//   - ファンダ: lib/backtest/fundamental.ts の FundamentalMetric のみ
//   - 決算派生: lib/statements/types.ts の DerivedMetric のみ
// 新しい指標・複合指標（PEGレシオ、グレアムナンバー等）は一切発明しない。
// 複合基準が必要な箇所は、実在する個別指標のAND条件で近似し、その旨を明記する。
//
// NeedsPreset（lib/backtest/presets.ts）と構造は似ているが、共通の基底型への
// 抽象化はしない（COMPANY.md 原則8 — 早すぎる汎用化の禁止）。
//
// このファイルは純データ＋純関数のみ（I/Oなし）。クライアント（表示）と
// サーバー（条件導出）の両方から import される。

import type { CompositeCondition, InvestorModelId } from './types'

export interface InvestorPreset {
  id: InvestorModelId
  /** 投資家名・モデル名（UI表示用）。 */
  label: string
  /**
   * 投資家の言語化された信念・投資理論（土台）。事実として広く知られた内容のみを
   * 日本語で要約する（本人の未公開の意図や心理を創作しない）。
   */
  philosophy: string
  /**
   * 各条件（技術トリガー・ファンダ条件・決算派生条件）が、上記 philosophy から
   * なぜ導かれるかの根拠。UIの「条件の根拠」表示・レポート非注入の説明に使う。
   */
  rationale: string[]
  /** サーバーが導出する実条件（既存 CompositeCondition にそのまま写像）。 */
  condition: CompositeCondition
  /** バックテスト期間。長期MA等の warm-up を確保するため5年固定。 */
  period: '5y'
  /** 条件の正確な説明（結果表示用・NeedsPreset.conditionNotesと同じ用途）。 */
  conditionNotes: string[]
  /**
   * 信念と実装のギャップの正直な注記（COMPANY.md 原則9）。
   * 「本人の実際の投資判断ではない・近似スクリーニングである」ことを含める。
   */
  approximationNotes: string[]
}

export const INVESTOR_PRESETS: Record<InvestorModelId, InvestorPreset> = {
  buffett: {
    id: 'buffett',
    label: 'バフェット型（優良ビジネス長期保有）',
    philosophy:
      '優れたビジネスを適正価格で買い、原則として長期・半永久的に保有する。市場の短期的な変動は好機と捉える。' +
      '堅牢な競争優位性（堀）と経営の質、安定したキャッシュ創出力を重視する。',
    rationale: [
      'この信念に基づき、自己資本を効率よく収益に変えられる「優れたビジネス」の近似としてROE（自己資本利益率）を高水準で要求する',
      'この信念に基づき、過度な借入に依存しない財務の健全性の近似としてD/E（負債資本比率）に上限を設ける',
      '「適正価格」の近似として、PER（株価収益率）が過熱していない水準に収まっていることを求める',
      'この信念に基づき、安定したキャッシュ創出力の近似として、直近実績のFCF（フリーキャッシュフロー）黒字継続年数を要求する',
      'この信念に基づき、持続的な利益成長の近似としてEPS成長率CAGR(3年)を要求する',
    ],
    condition: {
      technical: { type: 'technical', indicator: 'ma_cross', period: 200 },
      fundamentalFilters: [
        { metric: 'roe', operator: 'gte', value: 0.10 },
        { metric: 'debtToEquity', operator: 'lte', value: 200 },
        { metric: 'pe', operator: 'lte', value: 35 },
      ],
      derivedFilters: [
        { metric: 'fcfPositiveYears', operator: 'gte', value: 3 },
        { metric: 'epsCagr3y', operator: 'gte', value: 0.03 },
      ],
    },
    period: '5y',
    conditionNotes: [
      '参加条件（現在値で判定）: ROE ≥ 10% ・ D/E ≤ 200 ・ PER ≤ 35倍',
      '参加条件（決算派生・年次実績で判定）: FCF黒字の期数 ≥ 3期 ・ EPS成長率CAGR(3年) ≥ 3%',
      '評価用の売買トリガー: 終値が200日移動平均を上抜けたら買い、下抜けたら売り（長期トレンド維持＝保有継続の代理指標）',
      '検証期間: 過去5年の実データ日足',
    ],
    approximationNotes: [
      '「一生保有する」という信念はバックテストエンジンに評価器が存在しないため表現できません。ここでは長期トレンド維持（終値が200日移動平均線を上回っている状態）を、保有継続の代理トリガーとして用いています。実際に長期保有するかどうかの判断とは異なります',
      '「堀（競争優位性）」「経営の質」は定性的な概念であり、実在する単一の定量指標には対応しません。ROE・D/E・PER・FCF継続性などの実在指標の組み合わせによる近似的なスクリーニングにすぎません',
      '本モデルはバフェット氏本人の実際の投資判断ではなく、公知の投資理論を実在指標に近似したスクリーニング・評価用トリガーです',
    ],
  },
  graham: {
    id: 'graham',
    label: 'グレアム型（ディープバリュー・ディフェンシブ）',
    philosophy:
      '内在価値に対して十分な安全マージンを持つ、統計的に割安な銘柄を選ぶ。財務の安全性（流動性・負債の低さ）を重視し、' +
      '投機ではなく防御的な分析に基づいて投資する。',
    rationale: [
      'この信念に基づき、割安性の近似としてPER（株価収益率）に上限を設ける',
      'この信念に基づき、純資産に対する割安性の近似としてPBR（株価純資産倍率）に上限を設ける',
      '財務の安全性（短期支払い能力）の近似として流動比率に下限を設ける',
      '負債への依存度の低さの近似として自己資本比率に下限を設ける（決算派生）',
      '安定した資金創出力の近似としてFCF黒字継続年数を求める（決算派生）',
    ],
    condition: {
      technical: { type: 'technical', indicator: 'ma_cross', period: 200 },
      fundamentalFilters: [
        { metric: 'pe', operator: 'lte', value: 20 },
        { metric: 'pb', operator: 'lte', value: 3 },
        { metric: 'currentRatio', operator: 'gte', value: 1.2 },
      ],
      derivedFilters: [
        { metric: 'equityRatio', operator: 'gte', value: 0.3 },
        { metric: 'fcfPositiveYears', operator: 'gte', value: 3 },
      ],
    },
    period: '5y',
    conditionNotes: [
      '参加条件（現在値で判定）: PER ≤ 20倍 ・ PBR ≤ 3倍 ・ 流動比率 ≥ 1.2倍',
      '参加条件（決算派生・年次実績で判定）: 自己資本比率 ≥ 30% ・ FCF黒字の期数 ≥ 3期',
      '評価用の売買トリガー: 終値が200日移動平均を上抜けたら買い、下抜けたら売り（防御的投資家は本来売買タイミングを重視しないが、technical必須制約のため長期トレンド維持を代理トリガーとして使用）',
      '検証期間: 過去5年の実データ日足',
    ],
    approximationNotes: [
      'グレアムの複合基準「PER×PBR ≤ 22.5」はエンジンに複合指標の評価器が存在しないため、そのままでは実装していません。PERとPBRのそれぞれに個別の上限を設けることで近似しており、本来の複合基準そのものではありません',
      '「安全マージン」は概念的な尺度であり、単一の実在指標には対応しません。PER・PBR・流動比率・自己資本比率・FCF継続性の組み合わせによる近似的なスクリーニングにすぎません',
      '本モデルはグレアム氏本人の実際の投資判断ではなく、公知の投資理論を実在指標に近似したスクリーニング・評価用トリガーです',
    ],
  },
  lynch: {
    id: 'lynch',
    label: 'リンチ型（GARP・成長株を適正価格で）',
    philosophy:
      '身近な製品やサービスから成長企業を見つけ、利益成長率に見合った適正な株価（PEGレシオ）で買う' +
      '「GARP（Growth At a Reasonable Price）」投資。急成長中でも過大評価されていない企業を好む。',
    rationale: [
      '「成長企業」の近似として利益成長率に下限を設ける',
      '成長の裏付けとして売上成長率にも下限を設ける',
      'PEGレシオ（株価が成長率に見合っているか）はエンジンに複合指標の評価器が存在しないため、PER（株価収益率）に上限を設けることで過大評価でないことを近似する',
      '持続的な利益成長の近似としてEPS成長率CAGR(3年)を求める（決算派生）',
      '持続的な売上成長の近似として売上高CAGR(3年)を求める（決算派生）',
      '成長トレンドの継続の近似として、短期・長期移動平均のゴールデンクロス/デッドクロス（ma_cross_dual）を評価用トリガーに用いる',
    ],
    condition: {
      technical: { type: 'technical', indicator: 'ma_cross_dual', shortPeriod: 50, longPeriod: 200 },
      fundamentalFilters: [
        { metric: 'earningsGrowth', operator: 'gte', value: 0.10 },
        { metric: 'revenueGrowth', operator: 'gte', value: 0.05 },
        { metric: 'pe', operator: 'lte', value: 40 },
      ],
      derivedFilters: [
        { metric: 'epsCagr3y', operator: 'gte', value: 0.08 },
        { metric: 'revenueCagr3y', operator: 'gte', value: 0.05 },
      ],
    },
    period: '5y',
    conditionNotes: [
      '参加条件（現在値で判定）: 利益成長率 ≥ 10% ・ 売上成長率 ≥ 5% ・ PER ≤ 40倍（PEGレシオの代替近似）',
      '参加条件（決算派生・年次実績で判定）: EPS成長率CAGR(3年) ≥ 8% ・ 売上高CAGR(3年) ≥ 5%',
      '評価用の売買トリガー: 50日移動平均が200日移動平均を上抜けたら買い、下抜けたら売り（ゴールデンクロス/デッドクロス）',
      '検証期間: 過去5年の実データ日足',
    ],
    approximationNotes: [
      'リンチの「PEGレシオ（PER ÷ 利益成長率）」はエンジンに複合指標の評価器が存在しないため実装していません。代わりに「高い利益成長率」と「PERの上限」を別々の条件として組み合わせることで、過大評価でない成長株を近似しています',
      '「身近な製品・サービスから見つける」という着眼点は定性的なものであり、定量指標には対応しません。本モデルは定量スクリーニングのみを近似したものです',
      '本モデルはリンチ氏本人の実際の投資判断ではなく、公知の投資理論を実在指標に近似したスクリーニング・評価用トリガーです',
    ],
  },
}

export const INVESTOR_PRESET_IDS = Object.keys(INVESTOR_PRESETS) as InvestorModelId[]

export function isInvestorModelId(v: unknown): v is InvestorModelId {
  return typeof v === 'string' && v in INVESTOR_PRESETS
}

// ── /analyze S3: 投資家モデル → /api/report/prepare 用 CompositeCondition ──────
// INVESTOR_PRESETS[id].condition は既に CompositeCondition 型そのものなので変換
// ロジックは無い（新しい投資条件を発明しない・COMPANY.md 原則9）。getNeedsPresetCondition
// と同じ単一の取り出し口パターン。
export function getInvestorPresetCondition(id: InvestorModelId): CompositeCondition {
  return INVESTOR_PRESETS[id].condition
}
