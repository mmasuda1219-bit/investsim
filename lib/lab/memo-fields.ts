import type { ReasonFieldSpec, ReasonParts } from '@/lib/trade/reason'

/**
 * 画面4「書く」の6つの問い（/lab/9983・2026-10-09・S-A）。
 *
 * `lib/trade/reason.ts` の `ReasonFieldSpec` をそのまま使い、入力部品も `components/ReasonFields.tsx` を無変更で再利用する。
 * `reason.ts` に欄は足さない（KNOWN_LABELS が増えると parseReason が過去の記録を別の形に読み、/review が変わる。DECISIONS 2026-10-09 却下案）。
 * ここの label は /trade の保存形式には流れない（この画面は保存しない。ブラウザの中だけ）。
 *
 *  - 全欄 required: false・min 0。書かない欄があっても添削（画面5）は組める
 *  - placeholder（記入例）は薄い字で出る。「私は」「上がる」「下がる」「べき」「割安」などの禁止語を使わない
 *  - 結論は「買う／買わない／保留」の選択（DECISION_OPTIONS）＋理由の欄（conclusion）
 */

export const MEMO_FIELDS: ReasonFieldSpec[] = [
  {
    key: 'market',
    label: '相場全体',
    question: '相場全体をどう見ていますか',
    help: '日経平均や為替、金利など、この銘柄の外側の状況。見ていなければ空欄でかまいません。',
    placeholder: '例: 日経平均は決算シーズンで動きが大きい。為替は円安が続いている。',
    required: false,
    min: 0,
    rows: 2,
  },
  {
    key: 'sector',
    label: 'セクター',
    question: 'この会社が属する業種（小売・アパレル）をどう見ていますか',
    help: '同じ業種の他社や、業種全体に効く出来事（原材料・物流費・海外の景気など）。',
    placeholder: '例: 国内のアパレルは人口減で伸びにくい一方、海外に店を出している会社は海外の景気次第。',
    required: false,
    min: 0,
    rows: 2,
  },
  {
    key: 'pick',
    label: 'この銘柄を選んだ理由',
    question: 'なぜこの銘柄を見ているのですか',
    help: 'きっかけで構いません。ニュース・店に行った経験・決算の数字など。',
    placeholder: '例: 海外ユニクロの売上の伸びが大きいと聞いて、決算の数字を見てみたくなった。',
    required: false,
    min: 0,
    rows: 2,
  },
  {
    key: 'metrics',
    label: '見た指標と読み取ったこと',
    question: '画面2・3のどの数字を見て、何を読み取りましたか',
    help: '指標の名前（PER・EPS・営業利益・ROE など）と、その数字から考えたことを続けて書く。',
    placeholder: '例: 純利益は前期比で増えていて、EPS も同じ率で伸びている。予想PER は小売業の加重平均より大きい。',
    required: false,
    min: 0,
    rows: 4,
  },
  {
    key: 'concerns',
    label: '懸念点',
    question: '気になる点・確かめていない点は何ですか',
    help: 'まだ調べていないこと、数字の意味が分からなかったことも、そのまま書いておくと読み返す材料になります。',
    placeholder: '例: 来期の利益予想の伸びが今期より小さい理由を、決算短信でまだ確かめていない。',
    required: false,
    min: 0,
    rows: 3,
  },
  {
    key: 'conclusion',
    label: '結論の理由',
    question: 'その結論にした理由は何ですか',
    help: '上で選んだ「買う／買わない／保留」の理由。見た事実と、そこからのあなたの解釈を続けて書く。',
    placeholder: '例: 利益は増えているが、来期予想の伸びが小さいので、次の四半期決算を見てから決めたい。',
    required: false,
    min: 0,
    rows: 3,
  },
]

export type Decision = 'buy' | 'pass' | 'hold'

export const DECISION_OPTIONS: readonly { value: Decision; label: string }[] = [
  { value: 'buy', label: '買う' },
  { value: 'pass', label: '買わない' },
  { value: 'hold', label: '保留' },
]

export const decisionLabel = (d: Decision | null): string | null => DECISION_OPTIONS.find(o => o.value === d)?.label ?? null

/** 書き方 */
export type MemoMode = 'fields' | 'free'

/** 画面4の入力（保存しない。ブラウザの中だけ） */
export interface LabMemo {
  mode: MemoMode
  decision: Decision | null
  /** 6欄（key → 文）。自由記述に切り替えても消さない */
  parts: ReasonParts
  /** 自由記述 */
  free: string
}

export const EMPTY_MEMO: LabMemo = { mode: 'fields', decision: null, parts: {}, free: '' }

/** メモの本文をすべてつなげた文字列（添削の検出用。原文は書き換えない） */
export function memoText(memo: LabMemo): string {
  if (memo.mode === 'free') return memo.free
  return MEMO_FIELDS.map(f => memo.parts[f.key] ?? '').join('\n')
}

/** 記入のあった欄 */
export function filledFields(memo: LabMemo): ReasonFieldSpec[] {
  if (memo.mode === 'free') return []
  return MEMO_FIELDS.filter(f => (memo.parts[f.key] ?? '').trim().length > 0)
}
