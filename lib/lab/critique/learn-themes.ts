/**
 * §6「次に学ぶとよいテーマ」の固定リスト（/study・2026-10-09・S-A）と、1つを選ぶ規則。
 *
 * テーマは文章ではなく、画面2・3の部品の再掲（LearnPanel.tsx）で学ぶ。`parts` がどの部品を出すかを決める。
 * 架空の数字で「減益のシナリオ」などを作らない（原則9・DECISIONS 2026-10-09 却下案）。実データにある変化だけを見せる。
 *
 * 選ぶ規則（compose.ts）: §4「確認が抜けている項目」に挙がった項目のうち、下の `forMissing` の順で最初に当たるもの。
 * 全部に触れていたら `chain`（売上→株価のつながり）。AI は選ばない（固定の規則）。
 */

export type ThemeKey = 'perGrowth' | 'roeRoa' | 'epsDrivers' | 'segments' | 'cash' | 'equity' | 'dividend' | 'chain'

export interface LearnTheme {
  key: ThemeKey
  title: string
  /** 何を見るか（1〜2文・数字は書かない） */
  lead: string
  /** 再掲する部品。metricKeys は画面2の項目の key、chain は画面3 */
  parts: { metricKeys?: string[]; chain?: boolean }
}

export const LEARN_THEMES: readonly LearnTheme[] = [
  {
    key: 'perGrowth',
    title: 'PER と利益の伸びを合わせて読む',
    lead: '同じ PER でも、利益の伸び率が違えば意味が変わります。予想PER・業種の平均・来期の会社予想を、画面2と画面3の部品で並べて見ます。',
    parts: { metricKeys: ['per'], chain: true },
  },
  {
    key: 'roeRoa',
    title: 'ROE と ROA の分母の違い',
    lead: 'ROE は自己資本、ROA は資産合計で割ります。2つの差と自己資本比率の推移を、画面2の部品で並べて見ます。',
    parts: { metricKeys: ['roeRoa', 'equityRatio'] },
  },
  {
    key: 'epsDrivers',
    title: 'EPS を動かす要素',
    lead: 'EPS は純利益と株数で決まります。純利益の伸びと EPS の伸びが同じ率かどうかを、画面2の部品で並べて見ます。',
    parts: { metricKeys: ['profit', 'eps'] },
  },
  {
    key: 'segments',
    title: '売上の内訳（セグメント）',
    lead: '全体の伸びは、どのセグメントの伸びでできているか。構成比と前期比を、画面2の部品で見ます。',
    parts: { metricKeys: ['segments'] },
  },
  {
    key: 'cash',
    title: '利益と現金の違い',
    lead: '純利益と営業CF は同じではありません。2つの差と手元資金の推移を、画面2の部品で見ます。',
    parts: { metricKeys: ['profit', 'cash'] },
  },
  {
    key: 'equity',
    title: '自己資本比率の推移',
    lead: '比率が動く理由は、利益の蓄積・借入・配当・自社株買いです。5期の推移を、画面2の部品で見ます。',
    parts: { metricKeys: ['equityRatio'] },
  },
  {
    key: 'dividend',
    title: '配当と配当性向',
    lead: '配当の額だけでなく、純利益のうちどれだけを配当に回したか（配当性向）を、画面2の部品で見ます。',
    parts: { metricKeys: ['dividend'] },
  },
  {
    key: 'chain',
    title: '売上から株価までのつながり',
    lead: '売上収益 → 営業利益 → 純利益 → EPS → 株価の順に、どこで伸び率が変わったかを、画面3の部品で見ます。',
    parts: { chain: true },
  },
]

/** §4 の「抜けている項目」の key → テーマ。上から順に最初に当たったものを選ぶ */
export const THEME_FOR_MISSING: readonly { metricKey: string; theme: ThemeKey }[] = [
  { metricKey: 'per', theme: 'perGrowth' },
  { metricKey: 'roeRoa', theme: 'roeRoa' },
  { metricKey: 'eps', theme: 'epsDrivers' },
  { metricKey: 'profit', theme: 'epsDrivers' },
  { metricKey: 'segments', theme: 'segments' },
  { metricKey: 'cash', theme: 'cash' },
  { metricKey: 'equityRatio', theme: 'equity' },
  { metricKey: 'dividend', theme: 'dividend' },
]

export const DEFAULT_THEME: ThemeKey = 'chain'

export function themeByKey(key: ThemeKey): LearnTheme {
  const t = LEARN_THEMES.find(x => x.key === key)
  if (!t) throw new Error(`learn-themes: 未定義のテーマ ${key}`)
  return t
}

/** 固定の規則で1つ選ぶ */
export function pickTheme(missingMetricKeys: readonly string[]): LearnTheme {
  for (const rule of THEME_FOR_MISSING) {
    if (missingMetricKeys.includes(rule.metricKey)) return themeByKey(rule.theme)
  }
  return themeByKey(DEFAULT_THEME)
}
