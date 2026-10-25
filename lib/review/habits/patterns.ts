/**
 * 考え方の型の判定（値動き・知名度・株価の見通し）と、その道具。
 *
 * **写し: 出所 lib/lab/critique/catalogue.ts（2026-10-22 版）。両方を変えるときは一緒に直す。
 * フェーズA出荷後に共通化する（DECISIONS 未決）。**
 * 写した理由（reviewer 2026-10-25 C2）: 出所の関数は HEAD に無い未コミットの変更で、S-H1 だけをコミットすると型エラーになる。
 * また出所を import すると /review のクライアントの束に lib/lab の実データが入る。
 *
 * 写したもの: word・sentences・momentumAsReason・fameAsSafety・forecastAsReason。
 * forecastAsReason だけは形を変えた: 出所は LabMemo を受けて「結論の欄」を選ぶが、ここでは【見立て】をそのまま結論の欄として受ける
 * （出所の memo.mode === 'fields' の枝と同じ動き）。正規表現と除外の条件は出所と同じ。
 * 純関数だけ。I/O・時計・乱数を持たない。
 * 出所との差分は1語だけ: momentumAsReason の「計算のつながり」の除外語から「ひょうか額」（時価の額の語）を外した
 * （scripts/check-review.ts (1) が lib/review/** にその2文字があるだけで落とすため。文字コードで隠す書き方は検査の回避になるので採らない。
 *   その分、値動きの理由の文の後ろにこの語が続く稀な文は除外されない。MC 2026-10-25）。
 */

/** 英字の語は前後が英字でないときだけ一致 */
export const word = (s: string) => new RegExp(`(?<![A-Za-z])${s}(?![A-Za-z])`, 'i')

/** 文に分ける（。と改行）。空は落とす */
export function sentences(text: string): string[] {
  return text.split(/[。\n]/).map(s => s.trim()).filter(s => s.length > 0)
}

/** 値動きそのものを理由にしている: 株価などの主語 → 上がって／下がって → ので／から／ため（同じ句の中）。見通し（そう）・否定・仮定は除く */
const MOMENTUM = /(株価|値動き|チャート|値段|相場)[^。、]{0,12}?(上が|下が|伸び|上昇|下落|値上がり|値下がり|上げ|下げ)([^。、]{0,8}?)(ので|(?<!て)から|ため)/
export function momentumAsReason(text: string): boolean {
  return sentences(text).some(s => {
    const m = MOMENTUM.exec(s)
    if (!m) return false
    if (/そう|ない|なかっ|か$|れば|たら|ても/.test(m[3])) return false
    // 「株価が下がったので PER が下がった」は計算のつながりで、判断の理由ではない
    return !/PER|PBR|利回り|含み益|含み損|時価総額/i.test(s.slice((m.index ?? 0) + m[0].length))
  })
}

/** 知名度を安全性の代わりにしている: 知名度・規模の語 → ので／から → 同じ文に「潰れない／安心」など */
const FAME = /(有名|知名度|大手|大企業|大きい会社|大きな会社|規模が大きい|誰もが知|誰でも知|みんな知|名の知れた|ブランド力)[^。]{0,10}?(ので|から|だし)/
const SAFE = /潰れ|つぶれ|倒産|安心|安全|大丈夫|心配ない|問題ない/
export function fameAsSafety(text: string): boolean {
  return sentences(text).some(s => {
    if (!FAME.test(s)) return false
    const rest = s.slice(s.search(FAME))
    const m = SAFE.exec(rest)
    return !!m && !/とは言え|思い込|わけではない|ではない/.test(rest.slice((m.index ?? 0) + m[0].length))
  })
}

/**
 * 結論の理由が将来の株価の見通し: 「上がりそう／下がりそう／伸びそう」＋から／ので／ため。
 * 主語が利益・売上・業績など会社の数字で、株価の語が無ければ見ない（会社予想の話）
 */
const FORECAST = /(上がり|下がり|伸び|上昇し|下落し|値上がりし|値下がりし|戻り)(続け)?そう(?:だ|な|です)?(から|ので|ため)(?!と|、?ではなく|ではない)/
export function forecastAsReason(conclusion: string): boolean {
  return sentences(conclusion).some(s => FORECAST.test(s) && (/株価|株|値段|チャート/.test(s) || !/利益|売上|EPS|配当|業績|来期/i.test(s)))
}
