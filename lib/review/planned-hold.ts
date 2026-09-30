/**
 * 書いた文から「予定していた期間（どれくらい持つつもりだったか）」を保守的に読む純関数（S3a・2026-09-30）。
 *
 * `lib/review/exit-rule.ts` の `parseExitLevel` と同じ流儀＝**曖昧なら必ず null**。読めないのは損だが、
 * 本人が書いていない期間を「あなたの予定」として図に描くのは嘘になる（原則9）。
 *
 * 受けるのは「◯年」「◯か月」「◯週間」「◯日」「半年」が **持つ／保有／様子を見る** の語と結びついた形だけ:
 *   「3年は持つ」「半年様子を見る」「1年ほど持つつもり」「保有期間は3年」「最低でも2週間は持つ」
 * 期間でない数字は null:
 *   「3日連続で下げたら」「2週間前に」「決算は3か月ごと」「成長率が15%」「2026年まで」「1年以内に売る」
 * 期間の候補が2つ以上あって値が違うなら null（どれが予定か決められない）。
 *
 * 入力に持たないもの: 現在時刻・乱数・ユーザー。同じ文には常に同じ答え。
 * 検査: scripts/check-review-record.ts。
 */

export interface PlannedHold {
  /** 暦日に直した長さ（年=365・か月=30・週=7）。図の横軸に使う */
  days: number
  /** 画面に出す表記。例 "3年" / "半年" / "2週間" */
  label: string
}

/** 持つ／保有／様子を見る（この語と結びつかない期間は読まない）。単位＋橋渡しの直後に来る形 */
// 否定形（持てない・持っていられない・保有しない）は「予定」ではないので弾く（S3a レビュー W2）。
// 弾かないと「3年は持てない」が 3年の予定として図に描かれる＝本人が書いていない予定を作る（原則9）。
const HOLD_WORD_AT_START = /^(?:持つ|持ち|持っ|持て|保有|様子を見|様子見)(?!ない|なかっ|ず|られない|ていられない|しない|しなかっ)/

/** 単位の直後に来たら「期間の長さ」ではない印 */
const NOT_A_SPAN_AFTER = /^(?:前|後|連続|ごと|毎|目|以内|ぶり|おき|に1回|に一度|遅れ|ぶん|分)/

/** 単位と「持つ」のあいだに挟まってよい語 */
const BRIDGE_AFTER = /^(?:は|を|も|が|の|ほど|くらい|ぐらい|程度|以上|間|、|,|\s|くらいは|ほどは|程度は|以上は|間は){0,6}/
/** 「保有期間は3年」のように、持つ語が数字の前に来る形で許す橋渡し */
const BRIDGE_BEFORE = /(?:持つ|持ち|保有|様子見|様子を見る)(?:期間|の期間|予定|の予定|目安|の目安)?(?:は|を|が|も|:|：)?\s*(?:およそ|約|だいたい|最低|最低でも|少なくとも)?\s*$/

const UNIT_DAYS: Record<string, number> = { 年: 365, か月: 30, 週間: 7, 週: 7, 日: 1 }

function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.')
    .replace(/[ヶヵカケ箇]月/g, 'か月')
}

export function parsePlannedHold(text: string | null | undefined): PlannedHold | null {
  const raw = (text ?? '').trim()
  if (!raw) return null
  const t = normalize(raw)

  const found: PlannedHold[] = []
  const re = /半年|(\d+(?:\.\d+)?)\s*(年半|年|か月|週間|週|日)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    const after = t.slice(m.index + m[0].length)
    const before = t.slice(0, m.index)
    if (NOT_A_SPAN_AFTER.test(after)) continue

    // 数字の直前が数字・小数点・%（「15%」「1.5」の続き）なら期間ではない
    if (/[\d.%％]$/.test(before)) continue

    let days: number
    let label: string
    if (m[0] === '半年') {
      days = 182
      label = '半年'
    } else {
      const n = Number(m[1])
      const unit = m[2]
      if (!(n > 0) || !Number.isFinite(n)) continue
      if (unit === '年半') {
        days = n * 365 + 182
        label = `${m[1]}年半`
      } else {
        days = n * UNIT_DAYS[unit]
        label = `${m[1]}${unit === '週' ? '週間' : unit}`
      }
      // 常識の外（100年超・10年ぶんを超える日数）は年号や別の数字とみなす
      if (days > 100 * 365) continue
    }

    const bridge = BRIDGE_AFTER.exec(after)?.[0] ?? ''
    const boundAfter = HOLD_WORD_AT_START.test(after.slice(bridge.length))
    const boundBefore = BRIDGE_BEFORE.test(before)
    if (!boundAfter && !boundBefore) continue

    found.push({ days: Math.round(days), label })
  }

  if (found.length === 0) return null
  const distinct = new Set(found.map(f => f.days))
  if (distinct.size !== 1) return null
  return found[0]
}
