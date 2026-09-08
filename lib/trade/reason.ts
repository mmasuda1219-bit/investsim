// 「なぜそう判断したか」の «型»。
//
// 背景（JOURNEY.md 断絶2）: これまで理由は自由記述のテキストエリア1つ・下限10文字だった。
// だが「判断の型を持っていない」ことが主ペルソナ(P1)の定義そのものなので、
// 白紙の欄を出されると書けずに離脱する。しかも10文字で通るため
// 「なんとなく上がりそう」が合格し、「振り返る」で見返す材料が残らなかった。
// ＝ ゲートは存在するのに、そのゲートが材料を生んでいない状態。
//
// そこで理由を «問いに分解» する。書く量を増やすのが目的ではなく、
// 白紙を無くして、あとで突き合わせられる形にするのが目的。
//
// 保存形式について（重要）: DBのスキーマは変えない。`trades.reason` は text のままで、
// ここで «人が読んでも自然な見出し付きテキスト» に組み立てて保存する。
//   【見立て】決算が良く、売上の伸びが続いている
//   【降りる条件】成長率が15%を割ったら売る
// こうする理由:
//  - マイグレーションを増やさない（0004 が既にオーナーの手作業待ちで、
//    未実行のまま列を増やすと出荷がさらに詰まる）
//  - 既存の理由（見出しの無い自由記述）がそのまま有効なままでいられる。
//    読む側は «見出しが無ければ旧形式» として扱えばよく、過去データを壊さない
//  - /review は今日のままでも意味が通る（見出し付きの文章として読める）
//
// このファイルは純関数のみ。I/O を持たない（lib/review/judgement.ts と同じ方針）。

export type TradeAction = 'buy' | 'sell'

export interface ReasonFieldSpec {
  /** 入力の識別子。UIの状態キーになる */
  key: string
  /** 保存テキストの見出し。【】に入る。**変更すると過去データが旧形式扱いになる** */
  label: string
  /** 画面に出す問い */
  question: string
  /** なぜこれを書くのかの1行。書けない人の手を動かすためのもの */
  help: string
  placeholder: string
  required: boolean
  /** 必須のときの最低文字数。任意項目は0 */
  min: number
  rows: number
}

/**
 * 理由の最低文字数（主となる1問）。従来の MIN_REASON と同じ値を保つ。
 * ここを動かすと API 側の下限（lib/portfolio.ts の MIN_REASON）と食い違うため、
 * 変えるときは両方を見ること。
 */
export const MIN_THESIS = 10
/** 「降りる条件」の最低文字数。主文より短くてよい（「-20%で売る」は十分に具体的） */
export const MIN_EXIT = 6

const BUY_FIELDS: ReasonFieldSpec[] = [
  {
    key: 'thesis',
    label: '見立て',
    question: 'なぜ買うのか',
    help: '見た事実（数字・出来事）と、そこからのあなたの解釈を続けて書く。',
    placeholder: '例: 直近の決算で売上が前年比+22%。ここ数日の下げは市場全体に連れられたもので、事業が悪くなったからではないと見ている。',
    required: true,
    min: MIN_THESIS,
    rows: 3,
  },
  {
    key: 'catalyst',
    label: '注目',
    question: 'これから何を見るか',
    help: '価格が動くきっかけになりそうな出来事。次の決算・新製品・金利など。',
    placeholder: '例: 次の四半期決算で成長率が20%を保てるか',
    required: false,
    min: 0,
    rows: 2,
  },
  {
    key: 'exit',
    label: '降りる条件',
    question: '何が起きたら「間違いだった」と認めるか',
    help: '先に決めておくと、あとで「なぜ持ち続けたのか」を振り返れる。',
    placeholder: '例: 成長率が15%を割ったら / 株価が-20%になったら売る',
    required: true,
    min: MIN_EXIT,
    rows: 2,
  },
]

const SELL_FIELDS: ReasonFieldSpec[] = [
  {
    key: 'thesis',
    label: '売る理由',
    question: 'なぜ売るのか',
    help: '買ったときに決めた条件に当たったのか、それとも別の理由か。',
    placeholder: '例: 買ったときに決めた「成長率15%割れ」に当たったので、想定どおり降りる。',
    required: true,
    min: MIN_THESIS,
    rows: 3,
  },
  {
    key: 'changed',
    label: '変化',
    question: '買ったときの見立てから何が変わったか',
    help: '読み違えていた点があれば、それがいちばん振り返る価値のある記録になる。',
    placeholder: '例: 成長は続いているが、想定より競合が強かった。そこを読み違えていた。',
    required: false,
    min: 0,
    rows: 2,
  },
]

/**
 * 過去にやった取引を «あとから» 記録するときの問い（JOURNEY.md 断絶3・案C）。
 *
 * 現在の売買と決定的に違うのは **「降りる条件」を必須にしない**こと。
 * 実際には決めていなかった人に必須で書かせると、その場ででっち上げた条件が
 * 記録に残り、振り返りの材料が嘘になる。むしろ「決めていなかった」と気づくことが
 * この人にとっていちばん価値のある発見なので、空欄のまま通す。
 */
const PAST_ENTRY_FIELDS: ReasonFieldSpec[] = [
  {
    key: 'thesis',
    label: '見立て',
    question: '買ったとき、何を考えていましたか',
    help: '思い出せる範囲でかまいません。「SNSで見たから」でも、正直に書けば材料になります。',
    placeholder: '例: 決算が良かったと聞いて、下げていたので買った。事業の中身はあまり見ていなかった。',
    required: true,
    min: MIN_THESIS,
    rows: 3,
  },
  {
    key: 'exit',
    label: '降りる条件',
    question: '降りる条件を決めていましたか',
    help: '決めていなければ空欄のままで大丈夫です。決めていなかったこと自体が、振り返る価値のある記録になります。',
    placeholder: '例: 決めていなかった / -10%で切るつもりだった',
    required: false,
    min: 0,
    rows: 2,
  },
]

const PAST_EXIT_FIELDS: ReasonFieldSpec[] = [
  {
    key: 'thesis',
    label: '売る理由',
    question: '売ったとき、何を考えていましたか',
    help: '思い出せる範囲で。「怖くなった」も立派な記録です。',
    placeholder: '例: 決算で急落して怖くなり、その日のうちに売った。',
    required: true,
    min: MIN_THESIS,
    rows: 3,
  },
  {
    key: 'changed',
    label: '変化',
    question: '買ったときの見立てから何が変わっていましたか',
    help: '読み違えていた点があれば、それがいちばん振り返る価値のある記録になります。',
    placeholder: '例: 事業は悪くなっていなかったのに、値動きだけを見て売っていた。',
    required: false,
    min: 0,
    rows: 2,
  },
]

/** 過去の取引を記録するときの問い。entry=買ったとき / exit=売ったとき。 */
export function pastFieldsFor(kind: 'entry' | 'exit'): ReasonFieldSpec[] {
  return kind === 'entry' ? PAST_ENTRY_FIELDS : PAST_EXIT_FIELDS
}

/** その売買で問う項目。買いと売りでは問うべきことが違う。 */
export function fieldsFor(action: TradeAction): ReasonFieldSpec[] {
  return action === 'buy' ? BUY_FIELDS : SELL_FIELDS
}

export type ReasonParts = Record<string, string>

/**
 * 問いの一覧と入力から、保存用の1本のテキストを組み立てる。
 * 空の任意項目は落とす（【注目】だけの空行を残さない）。
 */
export function composeFrom(specs: ReasonFieldSpec[], parts: ReasonParts): string {
  return specs
    .map(f => [f, (parts[f.key] ?? '').trim()] as const)
    .filter(([, v]) => v.length > 0)
    .map(([f, v]) => `【${f.label}】${v}`)
    .join('\n')
}

/** 現在の売買用。`composeFrom` の薄い包み。 */
export function composeReason(action: TradeAction, parts: ReasonParts): string {
  return composeFrom(fieldsFor(action), parts)
}

export interface ReasonErrors {
  /** key -> 表示するメッセージ。空なら合格 */
  byKey: Record<string, string>
  ok: boolean
}

/** 必須項目が最低文字数を満たすかだけを見る。内容の良し悪しは判定しない（点数化しない）。 */
export function validateFrom(specs: ReasonFieldSpec[], parts: ReasonParts): ReasonErrors {
  const byKey: Record<string, string> = {}
  for (const f of specs) {
    if (!f.required) continue
    const len = (parts[f.key] ?? '').trim().length
    if (len < f.min) byKey[f.key] = `あと${f.min - len}文字`
  }
  return { byKey, ok: Object.keys(byKey).length === 0 }
}

/** 現在の売買用。`validateFrom` の薄い包み。 */
export function validateParts(action: TradeAction, parts: ReasonParts): ReasonErrors {
  return validateFrom(fieldsFor(action), parts)
}

export interface ParsedSection {
  /** 見出し。旧形式（見出しの無い自由記述）では null */
  label: string | null
  value: string
}

/** 既知の見出しすべて。買い・売りの両方を受け付ける（読む側は action を知らないため） */
const KNOWN_LABELS = Array.from(
  new Set([...BUY_FIELDS, ...SELL_FIELDS, ...PAST_ENTRY_FIELDS, ...PAST_EXIT_FIELDS].map(f => f.label)),
)

/**
 * 保存テキストを見出しごとに分解する。「振り返る」で構造のまま出したいとき用。
 *
 * 見出しが1つも見つからなければ旧形式（自由記述）とみなし、全文を label:null の
 * 1区画として返す。**過去データを壊さないための分岐であり、消してはいけない。**
 */
export function parseReason(text: string): ParsedSection[] {
  const raw = (text ?? '').trim()
  if (!raw) return []

  const sections: ParsedSection[] = []
  for (const line of raw.split('\n')) {
    const m = /^【(.+?)】([\s\S]*)$/.exec(line.trim())
    if (m && KNOWN_LABELS.includes(m[1])) {
      sections.push({ label: m[1], value: m[2].trim() })
    } else if (sections.length > 0) {
      // 見出し行のあとの続き行は直前の区画にぶら下げる（利用者が改行を入れても壊さない）
      sections[sections.length - 1].value += `\n${line}`
    } else {
      // 見出しより前にある文字＝旧形式
      sections.push({ label: null, value: line })
    }
  }

  // 旧形式（見出しが1つも無い）は全文を1区画にまとめ直す
  if (sections.every(s => s.label === null)) {
    return [{ label: null, value: raw }]
  }
  return sections.map(s => ({ ...s, value: s.value.trim() })).filter(s => s.value.length > 0)
}

/** 見出し付きで保存されたものか（＝「型」に沿って書かれたか）。 */
export function isStructured(text: string): boolean {
  return parseReason(text).some(s => s.label !== null)
}
