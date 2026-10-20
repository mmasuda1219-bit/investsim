import type { Comparison, Explanation, Forecast, FyKey, Headline, MetricItem, Segment, Series, SeriesPoint, SourceRef, Sourced } from './types'

/**
 * ファーストリテイリング（9983）— 画面に出す数値の**唯一の置き場**（/study・2026-10-09・S-A）。
 *
 * すべて手入力の実データ。researcher が会社 IR（決算短信・IR 財務情報・決算発表のお知らせ）と JPX・日経から集め、
 * MC が会社ページで要の数字を再確認したもの（scratchpad の fr-9983-verified.md）。**ここに無い数字は画面に出さない。**
 *
 *  - 数値は必ず `Sourced<number>`（値＋出典）。出典の無い number をこのファイルに置かない（scripts/check-lab-9983.ts (b)）
 *  - 出さないと決めたもの: 2026年8月期の ROA（会社未開示。計算値は出さない）／10/08 の終値（Yahoo 系しか出典が無い）／
 *    小売業の平均自己資本比率（裏が取れなかった）／各期末の株価と過去の PER（出典が無い）
 *  - 「営業利益」（IFRS）と「事業利益」（会社独自指標）は別物。混ぜない
 *  - 解説文（explain）は本文に数字を直書きせず `{var}` で埋める（lib/lab/display.ts の labVars / fill）。
 *    評価の語を使わず、事実の記述と2通りの読み方の併置にする（DECISIONS 2026-10-09 (5)）
 */

// ── 出典 ──────────────────────────────────────────────────────────────────────

const VIEWED = '2026-10-09 閲覧'

export const SOURCES = {
  tanshin: {
    label: '決算短信（2026年8月期・通期）',
    url: 'https://www.fastretailing.com/jp/ir/library/pdf/tanshin202608_4q.pdf',
    asOf: '2026-10-08',
  },
  past5: {
    label: 'IR 財務情報・過去5年の業績',
    url: 'https://www.fastretailing.com/jp/ir/financial/past_5yrs.html',
    asOf: VIEWED,
  },
  perShare: {
    label: 'IR 財務情報・1株当たり情報',
    url: 'https://www.fastretailing.com/jp/ir/financial/pershare.html',
    asOf: VIEWED,
  },
  roeRoa: {
    label: 'IR 財務情報・ROE／ROA・財政状態',
    url: 'https://www.fastretailing.com/jp/ir/financial/roeroa.html',
    asOf: VIEWED,
  },
  cashFlow: {
    label: 'IR 財務情報・キャッシュフロー',
    url: 'https://www.fastretailing.com/jp/ir/financial/cf_5yrs.html',
    asOf: VIEWED,
  },
  news: {
    label: '決算発表のお知らせ（2026年8月期）',
    url: 'https://www.fastretailing.com/jp/ir/news/2610081800.html',
    asOf: '2026-10-08',
  },
  nikkei: {
    label: '日経会社情報',
    url: 'https://www.nikkei.com/nkd/company/?scode=9983',
    asOf: '2026-10-09 大引け',
  },
  jpx: {
    label: 'JPX 規模別・業種別PER（プライム市場）',
    url: 'https://www.jpx.co.jp/markets/statistics-equities/misc/04.html',
    asOf: '2026年9月末',
  },
} as const satisfies Record<string, SourceRef>

const s = <T,>(value: T, source: SourceRef, note?: string): Sourced<T> => ({ value, source: note ? { ...source, note } : source })

// ── 会社・期 ─────────────────────────────────────────────────────────────────

export const FY_KEYS: readonly FyKey[] = ['FY2022', 'FY2023', 'FY2024', 'FY2025', 'FY2026']

/** 期のラベル。8月決算なので「2026年8月期」。狭いときは「26年8月期」 */
export function fyLabel(fy: FyKey, short = false): string {
  const y = fy.slice(2)
  return short ? `${y.slice(2)}年8月期` : `${y}年8月期`
}

export const COMPANY = {
  code: '9983',
  name: 'ファーストリテイリング',
  market: '東証プライム',
  /** 直近の決算（通期）の発表日 */
  latestAnnouncement: s('2026-10-08', SOURCES.tanshin),
  latestFy: 'FY2026' as FyKey,
  latestFyLabel: '2026年8月期（通期）',
  /** 来期 */
  nextFyLabel: '2027年8月期',
  /** 次回の決算発表。会社未公表なので日付を書かない（決まったらここを置き換える） */
  nextAnnouncement: '未定（例年1月上旬）',
  /** 株式分割の注記（1株当たりの数字はこの分割後にそろえてある） */
  splitNote: s('2023年3月の株式分割（1株→3株）後の株数にそろえた値', SOURCES.perShare),
} as const

// ── 損益（百万円・連結・IFRS） ─────────────────────────────────────────────────

const pl = (fy: FyKey, value: number): SeriesPoint => ({ fy, value: s(value, fy === 'FY2026' ? SOURCES.tanshin : SOURCES.past5) })

export const SALES: Series = {
  key: 'sales', label: '売上収益', unit: 'millionYen',
  points: [pl('FY2022', 2_301_122), pl('FY2023', 2_766_557), pl('FY2024', 3_103_836), pl('FY2025', 3_400_539), pl('FY2026', 3_963_389)],
  yoy: s(16.6, SOURCES.tanshin, '会社公表の前期比'),
}
export const BUSINESS_PROFIT: Series = {
  key: 'businessProfit', label: '事業利益（会社独自の指標）', unit: 'millionYen',
  definition: '会社が独自に定義する利益。営業利益とは別の数字',
  points: [pl('FY2022', 306_704), pl('FY2023', 381_992), pl('FY2024', 485_358), pl('FY2025', 551_156), pl('FY2026', 718_400)],
  yoy: s(30.4, SOURCES.tanshin, '会社公表の前期比'),
}
export const OPERATING_PROFIT: Series = {
  key: 'operatingProfit', label: '営業利益', unit: 'millionYen',
  definition: '売上収益から原価と販売費・一般管理費などを引いた本業の利益（IFRS）',
  points: [pl('FY2022', 297_325), pl('FY2023', 381_090), pl('FY2024', 500_904), pl('FY2025', 564_265), pl('FY2026', 743_128)],
  yoy: s(31.7, SOURCES.tanshin, '会社公表の前期比'),
}
export const PRETAX_PROFIT: Series = {
  key: 'pretaxProfit', label: '税引前利益', unit: 'millionYen',
  points: [pl('FY2022', 413_584), pl('FY2023', 437_918), pl('FY2024', 557_201), pl('FY2025', 650_574), pl('FY2026', 802_505)],
  yoy: s(23.4, SOURCES.tanshin, '会社公表の前期比'),
}
export const NET_PROFIT: Series = {
  key: 'netProfit', label: '純利益', unit: 'millionYen',
  definition: '親会社の所有者に帰属する当期利益',
  points: [pl('FY2022', 273_335), pl('FY2023', 296_229), pl('FY2024', 371_999), pl('FY2025', 433_009), pl('FY2026', 542_516)],
  yoy: s(25.3, SOURCES.tanshin, '会社公表の前期比'),
}

// ── 1株当たり（円・2023年3月の1→3分割を調整済み） ──────────────────────────────

const ps = (fy: FyKey, value: number): SeriesPoint => ({ fy, value: s(value, fy === 'FY2026' ? SOURCES.tanshin : SOURCES.perShare) })

export const EPS: Series = {
  key: 'eps', label: 'EPS（基本的1株当たり利益）', unit: 'yen',
  definition: '純利益 ÷ 発行済み株式数（自己株式を除く・期中平均）',
  points: [ps('FY2022', 891.8), ps('FY2023', 966.1), ps('FY2024', 1_212.9), ps('FY2025', 1_411.44), ps('FY2026', 1_768.08)],
  yoy: s(25.3, SOURCES.tanshin, '会社公表の前期比'),
}
export const BPS: Series = {
  key: 'bps', label: 'BPS（1株当たり純資産）', unit: 'yen',
  points: [ps('FY2022', 5_094.0), ps('FY2023', 5_939.3), ps('FY2024', 6_574.1), ps('FY2025', 7_408.65), ps('FY2026', 9_274.27)],
}
export const DIVIDEND: Series = {
  key: 'dividend', label: '年間配当', unit: 'yen',
  points: [ps('FY2022', 206.7), ps('FY2023', 290.0), ps('FY2024', 400.0), ps('FY2025', 500.0), ps('FY2026', 850.0)],
}

/** 配当性向（%）。開示があるのは2期分 */
export const PAYOUT_RATIO = {
  prev: s(35.4, SOURCES.perShare),
  curr: s(48.1, SOURCES.tanshin),
}
/** 2026-10-08 の配当予想の修正（年間）。640円 → 850円（期末 320円 → 530円） */
export const DIVIDEND_REVISION = {
  date: s('2026-10-08', SOURCES.tanshin),
  before: s(640, SOURCES.tanshin),
  after: s(850, SOURCES.tanshin),
  termEndBefore: s(320, SOURCES.tanshin),
  termEndAfter: s(530, SOURCES.tanshin),
}
/** 来期（2027年8月期）の配当予想 */
export const DIVIDEND_FORECAST: Headline = { label: '2027年8月期の年間配当（会社予想）', value: s(900, SOURCES.tanshin), unit: 'yen' }

// ── 財政状態（百万円） ────────────────────────────────────────────────────────

const bs = (fy: FyKey, value: number): SeriesPoint => ({ fy, value: s(value, fy === 'FY2026' ? SOURCES.tanshin : SOURCES.roeRoa) })

export const TOTAL_ASSETS: Series = {
  key: 'totalAssets', label: '総資産', unit: 'millionYen',
  points: [bs('FY2022', 3_183_762), bs('FY2023', 3_303_694), bs('FY2024', 3_587_565), bs('FY2025', 3_859_353), bs('FY2026', 4_549_464)],
}
export const EQUITY: Series = {
  key: 'equity', label: '親会社所有者帰属持分', unit: 'millionYen',
  points: [bs('FY2022', 1_561_652), bs('FY2023', 1_821_405), bs('FY2024', 2_016_536), bs('FY2025', 2_273_115), bs('FY2026', 2_845_897)],
}
export const EQUITY_RATIO: Series = {
  key: 'equityRatio', label: '自己資本比率', unit: 'percent',
  definition: '親会社所有者帰属持分 ÷ 資産合計（会社の開示では「親会社所有者帰属持分比率」）',
  points: [bs('FY2022', 49.1), bs('FY2023', 55.1), bs('FY2024', 56.2), bs('FY2025', 58.9), bs('FY2026', 62.6)],
}

// ── 収益性（定義を必ず併記） ──────────────────────────────────────────────────

const pr = (fy: FyKey, value: number): SeriesPoint => ({ fy, value: s(value, SOURCES.roeRoa) })

export const ROE: Series = {
  key: 'roe', label: 'ROE', unit: 'percent',
  definition: '親会社所有者帰属当期利益 ÷ 期中平均の親会社所有者帰属持分',
  points: [pr('FY2022', 20.4), pr('FY2023', 17.5), pr('FY2024', 19.4), pr('FY2025', 20.2), pr('FY2026', 21.2)],
}
export const ROA: Series = {
  key: 'roa', label: 'ROA', unit: 'percent',
  definition: '親会社所有者帰属当期利益 ÷ 期中平均の資産合計（会社の定義）',
  points: [pr('FY2022', 9.6), pr('FY2023', 9.1), pr('FY2024', 10.8), pr('FY2025', 11.6), { fy: 'FY2026', value: null, missing: '会社未開示' }],
}

// ── キャッシュフロー（百万円） ───────────────────────────────────────────────

const cf = (fy: FyKey, value: number): SeriesPoint => ({ fy, value: s(value, fy === 'FY2026' ? SOURCES.tanshin : SOURCES.cashFlow) })

export const OPERATING_CF: Series = {
  key: 'operatingCf', label: '営業CF', unit: 'millionYen',
  definition: '営業活動によるキャッシュフロー（本業で実際に入ってきた現金の増減）',
  points: [cf('FY2022', 430_817), cf('FY2023', 463_216), cf('FY2024', 651_521), cf('FY2025', 580_618), cf('FY2026', 788_587)],
}
export const CASH: Series = {
  key: 'cash', label: '手元資金', unit: 'millionYen',
  definition: '現金及び現金同等物の期末残高',
  points: [cf('FY2022', 1_358_292), cf('FY2023', 903_280), cf('FY2024', 1_193_560), cf('FY2025', 893_239), cf('FY2026', 1_007_586)],
}

// ── セグメント別 売上収益（2026年8月期・前年比） ───────────────────────────────

const APPROX = '2026年8月期は会社の億円表示からの概数'

export const SEGMENTS: Segment[] = [
  { key: 'domestic', label: '国内ユニクロ', prev: s(1_026_096, SOURCES.news), curr: s(1_084_800, SOURCES.news, APPROX), yoy: s(5.7, SOURCES.news) },
  { key: 'overseas', label: '海外ユニクロ', prev: s(1_910_289, SOURCES.news), curr: s(2_411_100, SOURCES.news, APPROX), yoy: s(26.2, SOURCES.news) },
  { key: 'gu', label: 'ジーユー', prev: s(330_701, SOURCES.news), curr: s(336_700, SOURCES.news, APPROX), yoy: s(1.8, SOURCES.news) },
  { key: 'globalBrands', label: 'グローバルブランド', prev: s(131_542, SOURCES.news), curr: s(128_500, SOURCES.news, APPROX), yoy: s(-2.3, SOURCES.news) },
]

// ── 株価・PER（2026-10-09 大引け・日経） ──────────────────────────────────────

export const PRICE = {
  /** 終値 */
  close: s(71_780, SOURCES.nikkei),
  closeDate: '2026-10-09',
  /** 前日比（円・%） */
  changeYen: s(-3_020, SOURCES.nikkei),
  changePct: s(-4.04, SOURCES.nikkei),
  /** 予想PER（2027年8月期の会社予想利益ベース） */
  forwardPer: s(39.3, SOURCES.nikkei, '2027年8月期の会社予想利益で計算'),
  /** 実績PER（終値 ÷ 2026年8月期の基本的EPS。日経の値と一次データからの再現が一致） */
  trailingPer: s(40.6, SOURCES.nikkei, '終値 ÷ 2026年8月期の基本的EPS'),
  pbr: s(7.73, SOURCES.nikkei),
  /** 配当利回り（予想） */
  dividendYield: s(1.25, SOURCES.nikkei, '会社予想の年間配当で計算'),
}

/** 業種別 PER（JPX・2026年9月末・プライム市場）。採用は加重平均（JPX の見出しの数字）。単純平均も併記する */
export const PER_AVERAGES = {
  retailWeighted: s(27.7, SOURCES.jpx, '小売業・加重平均'),
  retailSimple: s(22.5, SOURCES.jpx, '小売業・単純平均'),
  marketWeighted: s(20.6, SOURCES.jpx, 'プライム市場全体・加重平均'),
  marketSimple: s(18.9, SOURCES.jpx, 'プライム市場全体・単純平均'),
}

// ── 来期（2027年8月期）の会社予想 ────────────────────────────────────────────

export const FORECASTS: Forecast[] = [
  { key: 'sales', label: '売上収益', value: s(4_450_000, SOURCES.news), unit: 'millionYen', yoy: s(12.3, SOURCES.news) },
  { key: 'businessProfit', label: '事業利益', value: s(830_000, SOURCES.news), unit: 'millionYen', yoy: s(15.5, SOURCES.news) },
  { key: 'netProfit', label: '純利益', value: s(560_000, SOURCES.news), unit: 'millionYen', yoy: s(3.2, SOURCES.news) },
]

// ── 画面2の項目（固定の順。データに無い項目は作らない） ──────────────────────

const PER_COMPARISONS: Comparison[] = [
  { label: 'プライム市場・小売業の加重平均PER', value: PER_AVERAGES.retailWeighted, unit: 'times' },
  { label: 'プライム市場全体の加重平均PER', value: PER_AVERAGES.marketWeighted, unit: 'times' },
]

const EXPLAIN_PER: Explanation = {
  facts: [
    'PER は、株価を1株当たりの利益（EPS）で割った数字です。予想PER {per} は、{fyNext}の会社予想の利益で計算した値です（{priceAsOf}・{priceSource}）。実績PER {perTrailing} は、終値を{fy}の基本的EPSで割った値です。',
    'JPX が公表する{jpxAsOf}の加重平均PERは、プライム市場の小売業で {perRetail}、プライム市場全体で {perMarket} です（単純平均はそれぞれ {perRetailSimple}・{perMarketSimple}）。加重か単純かで数字が変わります。',
  ],
  readings: [
    'PER が平均より大きいことを「将来の利益の伸びを市場が先に織り込んでいる」と読む見方があります。',
    '同じ数字を「いまの利益の水準に比べて株価が先行している」と読む見方もあります。どちらかは、利益の伸び率（会社の来期予想は純利益 {nextNetYoy}）と合わせて見ます。',
  ],
}

const EXPLAIN_EPS: Explanation = {
  facts: [
    'EPS（1株当たり利益）は、純利益を発行済み株式数で割った数字です。{fy}は {eps}、前期比 {epsYoy}。純利益の伸び（{netYoy}）とほぼ同じ率です。',
    '上の5期の数字は、{splitNote}です（会社の開示値）。',
  ],
  readings: [
    'EPS が増えた理由を「純利益が増えたから」と読む見方があります（純利益と EPS が同じ率で伸びているので、株数はほぼ変わっていないと読めます）。',
    'EPS は株数でも変わります。自社株買いで株数が減れば純利益が同じでも EPS は増え、増資で株数が増えれば EPS は減ります。純利益と EPS の伸び率がずれたときは株数の変化を確かめる、という読み方もあります。',
  ],
}

const EXPLAIN_PROFIT: Explanation = {
  facts: [
    '営業利益は、売上収益から原価と販売費・一般管理費などを引いた、本業の利益です。{fy}は {op}（前期比 {opYoy}）。',
    '純利益（親会社の所有者に帰属する当期利益）は、そこから金利・税金・その他を引いた、最終的に株主に残る利益です。{fy}は {net}（前期比 {netYoy}）。',
    'この会社は「事業利益」という独自の指標も公表しています（{fy}は {biz}、前期比 {bizYoy}）。営業利益とは別の数字です。',
  ],
  readings: [
    '営業利益の伸び（{opYoy}）が純利益の伸び（{netYoy}）より大きいことを「本業の伸びが大きく、税金などの負担が相対的に増えた」と読む見方があります。',
    '同じ差を「前の期に本業以外の収益があった」と読む見方もあります。どちらかは、税引前利益（{pretax}・前期比 {pretaxYoy}）の内訳を決算短信で確かめます。',
  ],
}

const EXPLAIN_ROE_ROA: Explanation = {
  facts: [
    'ROE は、純利益を親会社所有者帰属持分（自己資本）の期中平均で割った数字です。{fy}は {roe}。',
    'ROA は、純利益を資産合計の期中平均で割った数字です（会社の定義）。{fyPrev}は {roaPrev}。{fy}の値は会社が開示していないので、この画面には出しません。',
    'ROE と ROA は分母が違うので、同じ純利益でも数字は違います。その差は、借入などの負債の大きさで変わります。',
  ],
  readings: [
    'ROE が ROA より大きいことを「自己資本に加えて負債も使って資産を増やしている」と読む見方があります。',
    '自己資本比率（{eq}）が大きくなると、ROE と ROA の差は縮む方向に働きます。その変化を「負債に頼る度合いが減った」と読む見方もあります。どちらの読み方も、5期の推移と合わせて見ます。',
  ],
}

const EXPLAIN_EQUITY: Explanation = {
  facts: [
    '自己資本比率（親会社所有者帰属持分比率）は、資産合計のうち自己資本が占める割合です。{fy}は {eq}。{fyFirst}の {eqFirst} から毎期大きくなっています。',
    '小売業の平均値は、この画面では出しません（裏付けの取れる出典がありませんでした）。代わりに自社の5期の推移を見ます。',
  ],
  readings: [
    '比率が大きくなっていることを「利益の蓄積で自己資本が増え、負債に頼る度合いが減った」と読む見方があります。',
    '同じ変化を「借入を使って投資を増やす余地を使っていない」と読む見方もあります。どちらかは、営業CF と手元資金の使い道（投資・配当・自社株買い）と合わせて見ます。',
  ],
}

const EXPLAIN_CASH: Explanation = {
  facts: [
    '営業CF（営業活動によるキャッシュフロー）は、本業で実際に入ってきた現金の増減です。{fy}は {ocf}。純利益（{net}）より大きい額です。',
    '手元資金（現金及び現金同等物の期末残高）は {cash}。{fyPrev}の {cashPrev} から増えています。',
  ],
  readings: [
    '営業CF が純利益より大きいことを「利益が現金として入ってきている」と読む見方があります（減価償却など、現金の出ていかない費用の分だけ大きくなります）。',
    '手元資金の増減は、営業CF だけでなく投資・配当・借入の返済で決まります。期末の残高が前の期より増えたことを「使い道の決まっていない現金が増えた」と読む見方もあります。どちらかは、投資CF・財務CF と合わせて見ます。',
  ],
}

const EXPLAIN_DIVIDEND: Explanation = {
  facts: [
    '年間配当は {div}（{fy}）。{fyPrev}の {divPrev} から増え、{fyNext}の会社予想は {divNext} です。{revisionDate}に、{fy}の年間配当予想を {divBefore} から {div} に修正しました。',
    '配当性向（純利益のうち配当に回した割合）は {payoutPrev} → {payout}。配当利回り（株価に対する年間配当の割合・予想）は {yield}（{priceAsOf}・{priceSource}）。',
  ],
  readings: [
    '配当性向が大きくなったことを「株主への還元を厚くする方針」と読む見方があります。',
    '同じ変化を「利益の使い道として投資より配当を選んだ」と読む見方もあります。どちらかは、会社の配当方針と投資計画の記述を決算短信で確かめます。',
  ],
}

const EXPLAIN_SEGMENTS: Explanation = {
  facts: [
    '売上収益 {sales} の内訳です。海外ユニクロが {segOverseasShare}、国内ユニクロが {segDomesticShare}、ジーユーが {segGuShare}、グローバルブランドが {segGlobalBrandsShare}（構成比は会社の概数から計算した目安）。',
    '前期比は、国内ユニクロ {segDomesticYoy}、海外ユニクロ {segOverseasYoy}、ジーユー {segGuYoy}、グローバルブランド {segGlobalBrandsYoy}。',
  ],
  readings: [
    '海外ユニクロの伸びが全体の伸び（{salesYoy}）を上回っていることを「成長の中心が海外に移っている」と読む見方があります。',
    '同じ数字を「為替と海外の景気に業績が左右されやすくなっている」と読む見方もあります。どちらかは、地域ごとの内訳（決算説明資料）と為替の前提を合わせて見ます。',
  ],
}

/** 画面2の8項目（固定の順） */
export const METRIC_ITEMS: MetricItem[] = [
  {
    key: 'per', label: 'PER',
    headlines: [
      { label: '予想PER', value: PRICE.forwardPer, unit: 'times' },
      { label: '実績PER', value: PRICE.trailingPer, unit: 'times' },
    ],
    series: [],
    trendNote: '5期の推移は出しません。各期末の株価に裏付けの取れる出典が無いためです。',
    comparisons: PER_COMPARISONS,
    explain: EXPLAIN_PER,
  },
  { key: 'eps', label: 'EPS', series: [EPS], explain: EXPLAIN_EPS },
  { key: 'profit', label: '営業利益と純利益', series: [OPERATING_PROFIT, NET_PROFIT], explain: EXPLAIN_PROFIT },
  { key: 'roeRoa', label: 'ROE と ROA', series: [ROE, ROA], explain: EXPLAIN_ROE_ROA },
  { key: 'equityRatio', label: '自己資本比率', series: [EQUITY_RATIO], explain: EXPLAIN_EQUITY },
  { key: 'cash', label: '営業CF と手元資金', series: [OPERATING_CF, CASH], explain: EXPLAIN_CASH },
  {
    key: 'dividend', label: '配当',
    headlines: [
      DIVIDEND_FORECAST,
      { label: '配当利回り（予想）', value: PRICE.dividendYield, unit: 'percent' },
    ],
    series: [DIVIDEND],
    explain: EXPLAIN_DIVIDEND,
  },
  {
    key: 'segments', label: 'セグメント別売上',
    series: [],
    trendNote: '5期の折れ線は出しません。会社の開示にある前期との比較（2期分）だけを出します。',
    explain: EXPLAIN_SEGMENTS,
  },
]

/** 画面3「つなげる」の図の下の読み方（事実の記述＋2通りの読み方） */
export const EXPLAIN_CHAIN: Explanation = {
  facts: [
    '{fy}は、売上収益（{salesYoy}）・営業利益（{opYoy}）・純利益（{netYoy}）・EPS（{epsYoy}）がすべて増えました。決算発表の翌日（{priceDate}）の株価は前日比 {priceChg}。会社の{fyNext}予想は純利益 {nextNetYoy}。予想PER は {per} です。',
  ],
  readings: [
    '数字が増えたのに株価が前日比マイナスだったことを「来期の利益予想の伸び（{nextNetYoy}）が、それまでの伸び（{netYoy}）より小さく、市場の期待に届かなかった」と読む見方があります。',
    '同じ値動きを「決算の前に株価が先に動いていて、発表で材料が出尽くした」と読む見方もあります。どちらかは、発表前の数週間の株価の推移と、同じ日の市場全体の値動きを合わせて見ます。',
  ],
}

/** 画面1の案内（「おすすめ」は使わない） */
export const HOW_TO_USE = '決算前に判断メモを書き、決算後に読み返す、という使い方ができます。'

/** 画面全体（検査と画面が同じものを読む） */
export const LAB_9983 = {
  company: COMPANY,
  sales: SALES,
  businessProfit: BUSINESS_PROFIT,
  operatingProfit: OPERATING_PROFIT,
  pretaxProfit: PRETAX_PROFIT,
  netProfit: NET_PROFIT,
  eps: EPS,
  bps: BPS,
  dividend: DIVIDEND,
  payoutRatio: PAYOUT_RATIO,
  dividendRevision: DIVIDEND_REVISION,
  dividendForecast: DIVIDEND_FORECAST,
  totalAssets: TOTAL_ASSETS,
  equity: EQUITY,
  equityRatio: EQUITY_RATIO,
  roe: ROE,
  roa: ROA,
  operatingCf: OPERATING_CF,
  cash: CASH,
  segments: SEGMENTS,
  price: PRICE,
  perAverages: PER_AVERAGES,
  forecasts: FORECASTS,
  metricItems: METRIC_ITEMS,
  explainChain: EXPLAIN_CHAIN,
  howToUse: HOW_TO_USE,
} as const

export type LabData = typeof LAB_9983
