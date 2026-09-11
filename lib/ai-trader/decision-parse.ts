// S4-0: AI の判断 JSON を「打ち切り耐性つき」で取り出す純関数（I/O なし・engine.ts から呼ぶ）。
//
// 背景: askClaude は返事の中の ```json … ``` を正規表現で切り出していたが、出力が max_tokens で
// 打ち切られて閉じフェンスが無いと無マッチになり、12銘柄ぶん書けていても全部捨てて 0 件を
// 返していた（呼び出し側は「判断なし」として黙って進む）。本番で「最新 tick の判断が 8銘柄中
// 4件しか無い」現象があり、これが原因の可能性が高い（strategist 2026-09-10 の指摘）。
//
// 方針（原則8: 完璧な JSON パーサは書かない）:
//   1. フェンスがあればその中身。閉じフェンスが無ければ開きフェンスの後ろ全部。
//   2. まず全体を JSON.parse。通ればそれが答え。
//   3. 通らなければ「配列が途中で切れている」とみなし、先頭の [ 以降で { … } の対応が
//      取れた要素を 1 つずつ JSON.parse し、失敗した時点で打ち切る。
//      文字列の中の { } " は数えない（エスケープ \" も考慮）。
//   4. 救出した件数の警告は呼び出し側（銘柄数を知っているのは engine）が出す。
export function extractDecisionArray(text: string): unknown[] {
  if (!text) return []

  const FENCE = '```json'
  const open = text.indexOf(FENCE)
  let body: string
  if (open >= 0) {
    const start = open + FENCE.length
    const close = text.indexOf('```', start)
    body = close >= 0 ? text.slice(start, close) : text.slice(start)
  } else {
    body = text
  }
  const trimmed = body.trim()
  if (!trimmed) return []

  // 2. 素直に全体をパース
  try {
    const v = JSON.parse(trimmed)
    return Array.isArray(v) ? v : []
  } catch {
    /* 途中で切れている可能性 → 3 へ */
  }

  // 3. 完成している要素だけ救出
  const lb = trimmed.indexOf('[')
  if (lb < 0) return []
  const out: unknown[] = []
  let i = lb + 1
  while (i < trimmed.length) {
    const ob = trimmed.indexOf('{', i)
    if (ob < 0) break
    const end = matchingBrace(trimmed, ob)
    if (end < 0) break // 最後の要素が途中で切れている
    try {
      out.push(JSON.parse(trimmed.slice(ob, end + 1)))
    } catch {
      break // 対応は取れたが中身が壊れている → ここで打ち切り（推測で埋めない）
    }
    i = end + 1
  }
  return out
}

/** s[open] が '{' のとき、文字列リテラルを飛ばしながら対応する '}' の位置を返す。無ければ -1。 */
function matchingBrace(s: string, open: number): number {
  let depth = 0
  let inStr = false
  let esc = false
  for (let j = open; j < s.length; j++) {
    const c = s[j]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}
