// S1: KNOWLEDGE.md（scoutが育てる編集層）を knowledge_items（runtime層）へ同期する。
//
// なぜ必要か: Vercelの実行環境はファイルシステムが読み取り専用のため、本番から
// KNOWLEDGE.md へは書き込めない。KNOWLEDGE.md は人間がレビューでき git で差分が追える
// 資産として維持し、ここで要約＋ID付与して runtime 層へ取り込むことで、
// 自動蓄積された知識と同じ土俵に並べ、帰属表示（どの知識を使ったか）の対象にする。
//
// 実行方法（オーナーがローカルで実行する。seed-fundamentals.ts と同じ運用）:
//   npx tsx scripts/sync-knowledge.ts
// 前提: .env.local に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY があること。
//       未設定なら data/knowledge.json へ書き出す（ローカル開発フォールバック）。
//
// 冪等: IDはタイトルのハッシュなので、同じ見出しなら何度実行しても同じ行を更新する。
// タイトルを書き換えた場合は別IDの新規エントリになる（古い方は残るのでS5の圧縮で整理する）。
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { listKnowledge, upsertKnowledge } from '../lib/knowledge/store'
import type { KnowledgeItem, KnowledgeKind } from '../lib/knowledge/types'

const SRC = path.join(process.cwd(), 'KNOWLEDGE.md')
/** プロンプト注入用の要約の上限。ここを緩めると判断プロンプトが膨らむので短く保つ。 */
const SUMMARY_MAX = 180

interface ParsedEntry {
  date: string
  title: string
  summary: string
  detail: string
  source: string | null
}

/** 見出しからの安定ID。タイトルが変わらない限り同じIDになる。 */
function idForTitle(title: string): string {
  return 'km_' + crypto.createHash('sha256').update(title).digest('hex').slice(0, 10)
}

/** タイトルから知識の種類を推定する（外れても実害が小さい軽い分類）。 */
function inferKind(title: string): KnowledgeKind {
  if (/マクロ|相場|指数|レジーム|セクター別|環境/.test(title)) return 'market'
  if (/バイアス|アンチパターン|負けさせる/.test(title)) return 'bias'
  if (/リスク管理|ポジションサイジング|スクリーニング|手順|型/.test(title)) return 'strategy'
  return 'theory'
}

// サイト制作のための知識（初心者への伝え方・パーソナライズUI・レポート構成の"型"・AI自体の
// 能力の線引き）であり、AIの売買判断そのものの原則ではないもの。行は削除せず（レポート側で
// 今後使えるため）タグ付けのみ行い、判断用選抜(lib/knowledge/select.ts)側で除外する。
const META_RE = /納得感|パーソナライズの3軸|一流の銘柄分析|AIで定性ファンダ分析/

function inferTags(title: string): string[] {
  const table: Array<[RegExp, string]> = [
    [/バフェット/, 'buffett'],
    [/グレアム/, 'graham'],
    [/リンチ/, 'lynch'],
    [/ソロス/, 'soros'],
    [/ダリオ/, 'dalio'],
    [/フィッシャー/, 'fisher'],
    [/テクニカル/, 'technical'],
    [/ファンダ/, 'fundamental'],
    [/マクロ|指数|相場/, 'macro'],
    [/リスク|ドローダウン/, 'risk'],
    [/日本株|NISA/, 'japan'],
    [/セクター/, 'sector'],
  ]
  const tags = table.filter(([re]) => re.test(title)).map(([, tag]) => tag)
  if (META_RE.test(title)) tags.push('meta')
  return tags
}

/**
 * 「- 要点:」配下のネストした箇条書きを拾う。無ければ本文の先頭行で代用する。
 * 見出しは `- 要点（失敗を"型"に蒸留）:` のように要点とコロンの間に括弧書きが入る
 * 揺れがあるため、コロンまでを緩く許容する（直結だけを見ると実際に3件取りこぼした）。
 */
const POINTS_RE = /^-\s*要点[^:：]*[:：]/

function buildSummary(body: string): string {
  const lines = body.split('\n')
  const start = lines.findIndex(l => POINTS_RE.test(l.trim()))
  const bullets: string[] = []
  if (start >= 0) {
    // インライン形式（「- 要点: ...」の後ろに直接本文）も拾う。
    const inline = lines[start].replace(POINTS_RE, '').trim()
    if (inline) bullets.push(inline)
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i]
      if (/^-\s/.test(l.trim()) && !/^\s+-/.test(l)) break // 次のトップレベル項目で終了
      const m = l.match(/^\s+-\s+(.*)$/)
      if (m) bullets.push(m[1].trim())
    }
  }
  const picked = bullets.length > 0
    ? bullets.slice(0, 2).join(' ')
    : (lines.find(l => l.trim() && !l.trim().startsWith('-')) ?? '').trim()
  const flat = picked.replace(/\s+/g, ' ').trim()
  return flat.length > SUMMARY_MAX ? flat.slice(0, SUMMARY_MAX - 1) + '…' : flat
}

function parse(md: string): ParsedEntry[] {
  // 先頭のテンプレート例（<!-- ... -->）を取り除く。取り込むと架空の知識が混入する。
  const cleaned = md.replace(/<!--[\s\S]*?-->/g, '')
  const chunks = cleaned.split(/^## /m).slice(1)
  const entries: ParsedEntry[] = []
  for (const chunk of chunks) {
    const nl = chunk.indexOf('\n')
    const heading = (nl === -1 ? chunk : chunk.slice(0, nl)).trim()
    const body = nl === -1 ? '' : chunk.slice(nl + 1).trim()
    const m = heading.match(/^(\d{4}-\d{2}-\d{2})[:：]\s*(.+)$/)
    if (!m) continue // 日付付き見出し以外は知識エントリではない
    const [, date, title] = m
    const summary = buildSummary(body)
    if (!summary) continue // 要点が取れないものは入れない（空の知識を作らない）
    const srcLine = body.split('\n').find(l => /^-\s*出典[:：]/.test(l.trim()))
    const source = srcLine ? srcLine.replace(/^-\s*出典[:：]\s*/, '').trim() : null
    entries.push({ date, title, summary, detail: body, source })
  }
  return entries
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`KNOWLEDGE.md が見つかりません: ${SRC}`)
    process.exit(1)
  }
  const entries = parse(fs.readFileSync(SRC, 'utf8'))
  if (entries.length === 0) {
    console.error('取り込めるエントリがありませんでした（見出し形式を確認してください）')
    process.exit(1)
  }

  // 既存行の帰属統計(createdAt/useCount/lastUsedAt)を引き継ぐための下読み。
  // 修正前は毎回useCount:0/lastUsedAt:null/createdAt:nowで上書きしており、KNOWLEDGE.mdを
  // 更新して再同期するたびにAIの利用実績が消えていた（IDはタイトルのハッシュで安定なので、
  // 見出しを変えていない限り既存行を引ける）。
  const existing = await listKnowledge({ scope: 'global', limit: 500 })
  const existingById = new Map(existing.map(i => [i.id, i]))

  const nowISO = new Date().toISOString()
  const items: KnowledgeItem[] = entries.map(e => {
    const id = idForTitle(e.title)
    const prev = existingById.get(id)
    const item: KnowledgeItem = {
      id,
      scope:     'global',
      sessionId: null,
      kind:      inferKind(e.title),
      title:     e.title,
      summary:   e.summary,
      detail:    e.detail,
      source:    e.source ? `KNOWLEDGE.md (${e.date}) ${e.source}` : `KNOWLEDGE.md (${e.date})`,
      tags:      inferTags(e.title),
      useCount:  0,
      createdAt: nowISO,
      updatedAt: nowISO,
    }
    if (prev) {
      item.useCount   = prev.useCount
      item.lastUsedAt = prev.lastUsedAt
      item.createdAt  = prev.createdAt
    }
    return item
  })

  // 同一タイトルが重複していると後勝ちで消えるため、気付けるように警告する。
  const seen = new Map<string, string>()
  for (const i of items) {
    if (seen.has(i.id)) console.warn(`⚠ 同一IDの重複: "${i.title}" と "${seen.get(i.id)}"`)
    seen.set(i.id, i.title)
  }

  await upsertKnowledge(items)

  const byKind = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.kind] = (acc[i.kind] ?? 0) + 1
    return acc
  }, {})
  const carriedOver = items.filter(i => existingById.has(i.id)).length
  const nonMetaCount = items.filter(i => !i.tags.includes('meta')).length
  console.log(`✅ ${items.length}件を同期しました`)
  console.log('   種類別:', byKind)
  console.log('   既存行から帰属統計(useCount/lastUsedAt/createdAt)を引き継いだ件数:', carriedOver)
  console.log('   meta除外後の判断用プール件数:', nonMetaCount)
  console.log('   要約の平均文字数:', Math.round(items.reduce((s, i) => s + i.summary.length, 0) / items.length))
  console.log('   例:', items[0].id, '|', items[0].title)
  console.log('        ', items[0].summary)
}

main().catch(e => {
  console.error('同期に失敗しました:', e)
  process.exit(1)
})
