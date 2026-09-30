/**
 * 「降りる条件」の文から、株価の水準（線を引ける1つの値）を取り出す純関数（S2b「振り返りの作り直し」・2026-09-30）。
 *
 * 受けるのは2つだけ:
 *  (a) **株価に係ると明示された**パーセント … 「株価が-20%になったら」「−20%になったら売る」「買値から10%下がったら」
 *      → entryPrice × (1 ∓ x/100)
 *  (b) 価格そのもの … 「$150を割ったら」「150ドル」「1,200円を割ったら」「株価が150を割ったら」
 *
 * **曖昧なら必ず null に倒す**（原則9）。線を引かないのは損だが、別物を「あなたの条件」として描くのは嘘になる。
 *  - 数字が2つ以上ある文（「-10% か $150」「15%を割ったら / 株価が-20%」）→ null
 *  - 株価以外のものに係る数字（成長率・売上・利益・金利・シェア・配当・PER・時価総額・出来高 …）→ null
 *    ⚠ lib/trade/reason.ts のプレースホルダ「成長率が15%を割ったら」は株価の条件ではない。% があるだけで線を引くと
 *      まったく別の水平線を「あなたの条件」として描くことになる（designer 2026-09-29 の落とし穴）
 *  - 符号も価格の語も無いパーセント（「20%下がったら」だけ）→ 何が 20% 下がるのか読めないので null
 *  - 単位の無い裸の数字（「150を割ったら」）→ 価格の語（株価・買値 …）が前に無ければ null
 *  - 買値の 1/10 未満・10 倍超の値 → この銘柄の株価ではない可能性が高いので null
 *
 * 入力に持たないもの: 現在時刻・乱数・ユーザー。同じ文と同じ買値には常に同じ答え。
 * 検査: scripts/check-review.ts（5）。
 */

export interface ExitLevel {
  /** 線を引く株価 */
  price: number
  /** 図と文に出す表記。例 "$142.56（買値から−20%）" / "¥1,200" */
  label: string
}

/** 株価以外のものに係る語。1つでもあれば「株価の条件」と読めないので null（保守的に全文で見る） */
const NON_PRICE_WORDS = [
  '目標株価', '成長率', '売上', '売り上げ', '利益', 'マージン', '金利', 'シェア', '配当', '利回り',
  'ROE', 'ROA', 'ROIC', 'PER', 'PBR', 'PSR', 'EPS', 'EBITDA', '時価総額', '出来高', '為替', '失業率',
  'インフレ', 'CPI', 'GDP', '増収', '増益', '減収', '減益', '前年比', '前年同期比', '伸び率', '成長',
  '粗利', '営業', '純利', '経常', '会員', 'ユーザー', '契約', '販売台数', '出荷', '在庫', '負債', '自己資本',
  'RSI', '移動平均', 'MACD', '乖離', '騰落レシオ', '指数', 'S&P', 'ナスダック', '日経', 'VIX',
]

/** 株価そのものに係る語。裸の数字や符号無しのパーセントを「株価の条件」と読む根拠になる */
const PRICE_WORDS = ['株価', '買値', '買った値段', '買った価格', '取得単価', '取得価格', '購入価格', '購入単価', '平均取得', '約定', '値段', '価格', '単価']

/** 下がる向きの語 */
const DOWN_WORDS = /下が|下げ|下落|割っ|割れ|割り|下回|落ち|安く|マイナス|失っ|減っ/
/** 上がる向きの語 */
const UP_WORDS = /上が|上げ|上昇|超え|上回|到達|達し|高く|プラス|伸び|増え/

/** マイナスの符号（ASCII・U+2212・全角・▲＝日本の値下がり表記）。プラスは + と ＋ */
const MINUS = /^[-−－▲]$/
const PLUS = /^[+＋]$/

/** 文の中の「数」を数える。3桁区切りの , は数の一部。小数点を含む */
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g

function toNumber(s: string): number {
  return Number(s.replace(/,/g, ''))
}

function fmtPrice(price: number, yen: boolean): string {
  return yen
    ? `¥${Math.round(price).toLocaleString('en-US')}`
    : `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(x: number, down: boolean): string {
  return `${down ? '−' : '+'}${x % 1 === 0 ? String(x) : x.toFixed(1)}%`
}

/**
 * @param exitRuleText 【降りる条件】の本文（空なら null）
 * @param entryPrice   買値。パーセントの基準と、値の妥当性の判定に使う
 * @param opts.yen     円建て銘柄（.T）のとき true。表記だけに影響し、判定は変えない
 */
/**
 * 「条件を決めていなかった」と書いた記録を、条件が空のときと同じに扱うための判定（S2b レビュー W2）。
 *
 * `lib/trade/reason.ts` の過去取引の記入例が「例: 決めていなかった / -10%で切るつもりだった」なので、
 * 過去の売買を入れた人（オーナーが最初の入口として勧めている経路）はここに「決めていなかった」と書く。
 * それを条件として扱うと「書いた条件『決めていなかった』は株価の値ではないので…」という妙な文になる。
 */
export function isNoRule(text: string | null | undefined): boolean {
  const t = (text ?? '').trim()
  if (!t) return true
  return /^(?:決めて(?:い)?(?:なかった|ない|いません(?:でした)?)|決めずに買った|なし|無し|特になし|特に無し|とくになし|ありません|無い|ない)[。.\s]*$/.test(t)
}

export function parseExitLevel(
  exitRuleText: string,
  entryPrice: number,
  opts: { yen?: boolean } = {},
): ExitLevel | null {
  const text = (exitRuleText ?? '').trim()
  if (!text || !(entryPrice > 0) || !Number.isFinite(entryPrice)) return null

  // 全角の数字と記号を半角に寄せる（「１５％」「＄１５０」も同じ扱い）
  const t = text
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/％/g, '%')
    .replace(/＄/g, '$')
    .replace(/．/g, '.')

  // 数字が2つ以上 → どれが条件か決められないので null
  const numbers = t.match(NUMBER_RE) ?? []
  if (numbers.length !== 1) return null

  // 株価以外のものに係る語があれば、その数字は株価ではない可能性が高い → null
  if (NON_PRICE_WORDS.some(w => t.includes(w))) return null

  const hasPriceWord = PRICE_WORDS.some(w => t.includes(w))
  const yen = opts.yen === true

  // ── (a) パーセント ─────────────────────────────────────────
  const pct = /([-−－▲+＋]?)\s*(\d[\d,]*(?:\.\d+)?)\s*%/.exec(t)
  if (pct) {
    // 「買値の90%以下」は «買値からの増減» ではなく «買値に対する割合»。どちらの意味かは書き手次第なので null
    if (/の\s*\d[\d,]*(?:\.\d+)?\s*%/.test(t)) return null
    const sign = pct[1]
    const x = toNumber(pct[2])
    if (!(x > 0) || x >= 100) return null
    const minus = MINUS.test(sign)
    const plus = PLUS.test(sign)
    const downWord = DOWN_WORDS.test(t)
    const upWord = UP_WORDS.test(t)
    // 符号も価格の語も無い → 何が x% なのか読めない
    if (!minus && !plus && !hasPriceWord) return null
    // 向きを決める。符号と語が矛盾する（「-20%上がったら」）なら null
    let down: boolean
    if (minus) { if (upWord && !downWord) return null; down = true }
    else if (plus) { if (downWord && !upWord) return null; down = false }
    else if (downWord && !upWord) down = true
    else if (upWord && !downWord) down = false
    else return null
    const price = entryPrice * (down ? 1 - x / 100 : 1 + x / 100)
    return { price, label: `${fmtPrice(price, yen)}（買値から${fmtPct(x, down)}）` }
  }

  // ── (b) 価格そのもの ───────────────────────────────────────
  // 通貨の単位が付いた数字、または価格の語が前にある裸の数字だけを受ける
  // 裸の数字は、直後に単位・助数詞が続くなら株価ではない（S2b レビュー C1）。
  // これが無いと「株価が2倍になったら」が $2.00、「株価が下がったら100株売る」が $100.00 の線になり、
  // 本人が書いていない条件を「あなたの条件」として図に引いてしまう（原則9違反）。
  // 買値の 1/10〜10倍のガードは、値が偶然その範囲に入ると通るので単独では足りない。
  const NOT_PRICE_UNIT = /^\s*(?:倍|割|分|日|週|か月|ヶ月|カ月|箇月|月|年|回|株|本|時|営業|件|％|%)/
  const bareNumber = (s: string): RegExpExecArray | null => {
    const re = /(\d[\d,]*(?:\.\d+)?)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s)) !== null) {
      if (!NOT_PRICE_UNIT.test(s.slice(m.index + m[0].length))) return m
    }
    return null
  }
  const priced =
    /\$\s*(\d[\d,]*(?:\.\d+)?)/.exec(t) ??
    /(\d[\d,]*(?:\.\d+)?)\s*(?:ドル|円|USD|JPY)/.exec(t) ??
    (hasPriceWord ? bareNumber(t) : null)
  if (!priced) return null
  const price = toNumber(priced[1])
  if (!(price > 0) || !Number.isFinite(price)) return null
  // 買値の 1/10 未満・10 倍超は、この銘柄の株価の条件とは考えにくい
  if (price < entryPrice / 10 || price > entryPrice * 10) return null
  return { price, label: fmtPrice(price, yen) }
}
