// S2(知識配線) スモーク: lib/knowledge/select.ts の純関数（選抜アルゴリズム・注入ブロック
// 整形・knowledgeRefs検証）を検証する。Claude APIは一切呼ばない。Supabase/ネットワークにも
// 一切繋がない（check-screen-cache.tsと同じ確立パターンに合わせ、念のため明示的に未設定化する）。
// ここで使う KnowledgeItem[] はすべて合成のテスト専用データであり、本番経路（KNOWLEDGE.md→
// scripts/sync-knowledge.ts→knowledge_items）には一切入らない（COMPANY.md原則9の範囲内）。
//
// 実行: npx tsx scripts/check-knowledge-inject.ts
delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY

import {
  selectKnowledgeForDecision,
  formatKnowledgeBlock,
  filterKnowledgeRefs,
  MAX_ITEMS,
  MAX_CHARS,
} from '../lib/knowledge/select'
import type { KnowledgeSelectContext } from '../lib/knowledge/select'
import type { KnowledgeItem, KnowledgeKind } from '../lib/knowledge/types'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

let seq = 0
function makeItem(overrides: Partial<KnowledgeItem> & { id: string; kind?: KnowledgeKind }): KnowledgeItem {
  seq++
  return {
    scope: 'global',
    sessionId: null,
    kind: 'theory',
    title: `テスト項目${seq}`,
    summary: 'テスト用の合成要約（本番経路には入らない）。',
    detail: null,
    source: 'test',
    tags: [],
    useCount: 0,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const OTHER_INVESTOR_TAGS = ['graham', 'lynch', 'soros', 'dalio', 'fisher']

async function main() {
  // ── (1) 24件相当プール・persona=buffett・US銘柄のみ ──────────────────────
  console.log('(1) 24件相当プール・persona=buffett・US銘柄のみ')
  {
    const pool: KnowledgeItem[] = [
      // theory: buffett1件＋他投資家5件（neutral filler無し＝quotaの2枠目が他投資家に
      // 押し出されるシチュエーションを作る＝他投資家タグの上限が実際に効くかを確認する）
      makeItem({ id: 'km_th_buffett', kind: 'theory', tags: ['buffett'] }),
      makeItem({ id: 'km_th_graham', kind: 'theory', tags: ['graham'] }),
      makeItem({ id: 'km_th_lynch', kind: 'theory', tags: ['lynch'] }),
      makeItem({ id: 'km_th_soros', kind: 'theory', tags: ['soros'] }),
      makeItem({ id: 'km_th_dalio', kind: 'theory', tags: ['dalio'] }),
      makeItem({ id: 'km_th_fisher', kind: 'theory', tags: ['fisher'] }),
      // 除外されるべきノイズ（rule1）: meta / summary空 / session scope不一致
      makeItem({ id: 'km_th_meta', kind: 'theory', tags: ['meta', 'buffett'] }),
      makeItem({ id: 'km_th_empty', kind: 'theory', tags: ['buffett'], summary: '' }),
      makeItem({ id: 'km_th_session', kind: 'theory', tags: ['buffett'], scope: 'session', sessionId: 'sess_other' }),
      // market: neutral1件＋他投資家4件＋japan1件（japanは-1で沈むはず）
      makeItem({ id: 'km_mk_neutral', kind: 'market', tags: [] }),
      makeItem({ id: 'km_mk_fillA', kind: 'market', tags: [] }),
      makeItem({ id: 'km_mk_japan', kind: 'market', tags: ['japan'] }),
      makeItem({ id: 'km_mk_graham', kind: 'market', tags: ['graham'] }),
      makeItem({ id: 'km_mk_dalio', kind: 'market', tags: ['dalio'] }),
      // strategy: 他投資家タグのみ3件（neutral無し＝quota1枠が他投資家しか埋められない
      // シチュエーション。theory側で既に他投資家1件を使い切っていれば、ここは上限で弾かれるはず）
      makeItem({ id: 'km_st_lynch', kind: 'strategy', tags: ['lynch'] }),
      makeItem({ id: 'km_st_soros', kind: 'strategy', tags: ['soros'] }),
      makeItem({ id: 'km_st_dalio', kind: 'strategy', tags: ['dalio'] }),
      // bias: neutral1件＋他投資家1件
      makeItem({ id: 'km_bi_neutral', kind: 'bias', tags: [] }),
      makeItem({ id: 'km_bi_fillB', kind: 'bias', tags: [] }),
      makeItem({ id: 'km_bi_soros', kind: 'bias', tags: ['soros'] }),
      // 残りの穴埋め（実データの24件相当に近づける・スコアに影響しないneutral）
      makeItem({ id: 'km_th_extra1', kind: 'theory', tags: ['technical'] }),
      makeItem({ id: 'km_th_extra2', kind: 'theory', tags: ['fundamental'] }),
      makeItem({ id: 'km_mk_extra1', kind: 'market', tags: ['macro'] }),
      makeItem({ id: 'km_st_extra1', kind: 'strategy', tags: ['risk'] }),
    ]
    const ctx: KnowledgeSelectContext = { persona: 'buffett', symbols: ['AAPL', 'MSFT', 'NVDA'] }
    const result = selectKnowledgeForDecision(pool, ctx)
    const ids = result.map(i => i.id)
    const otherInvestorCount = result.filter(i => i.tags.some(t => OTHER_INVESTOR_TAGS.includes(t))).length
    const totalChars = result.reduce((s, i) => s + i.title.length + i.summary.length, 0)

    check('6件以内', result.length <= MAX_ITEMS, `got ${result.length}`)
    check('合計1000字以内', totalChars <= MAX_CHARS, `got ${totalChars}`)
    check('metaタグは除外される', !ids.includes('km_th_meta'))
    check('summary空は除外される', !ids.includes('km_th_empty'))
    check('scope=sessionかつsessionId不一致は除外される', !ids.includes('km_th_session'))
    check('buffettタグ1件以上', result.some(i => i.tags.includes('buffett')), ids.join(','))
    check('他投資家タグは合計1件以下', otherInvestorCount <= 1, `got ${otherInvestorCount}: ${ids.join(',')}`)
    check('japanタグは選ばれない（US銘柄のみ）', !result.some(i => i.tags.includes('japan')), ids.join(','))
  }

  // ── (2) 決定的（同じ入力→同じ並び） ────────────────────────────────────
  console.log('(2) 決定的な選抜（同一入力を2回）')
  {
    const pool: KnowledgeItem[] = [
      makeItem({ id: 'km_d1', kind: 'theory', tags: ['buffett'] }),
      makeItem({ id: 'km_d2', kind: 'theory', tags: [] }),
      makeItem({ id: 'km_d3', kind: 'market', tags: [] }),
      makeItem({ id: 'km_d4', kind: 'strategy', tags: [] }),
      makeItem({ id: 'km_d5', kind: 'bias', tags: [] }),
      makeItem({ id: 'km_d6', kind: 'theory', tags: ['technical'] }),
      makeItem({ id: 'km_d7', kind: 'theory', tags: ['fundamental'] }),
    ]
    const ctx: KnowledgeSelectContext = { persona: 'buffett', symbols: ['AAPL'] }
    const r1 = selectKnowledgeForDecision(pool, ctx).map(i => i.id)
    const r2 = selectKnowledgeForDecision(pool, ctx).map(i => i.id)
    check('2回呼んでも完全に同じ並び', JSON.stringify(r1) === JSON.stringify(r2), `${r1.join(',')} vs ${r2.join(',')}`)
  }

  // ── (3) useCountを上げると次回順位が下がる ────────────────────────────
  // theory(quota2)に3件・market(quota1)に2件・strategy(quota1)に1件・bias(quota1)に1件の
  // 計7件を用意し、MAX_ITEMS(6)に対して必ず1件は漏れる状況を作る（プールが6件以下だと
  // 自由枠が全件を拾ってしまいuseCountの影響が見えないため）。
  console.log('(3) useCountを上げると次回順位が下がる')
  {
    const basePool: KnowledgeItem[] = [
      makeItem({ id: 'km_u1', kind: 'theory', tags: [], useCount: 5 }),
      makeItem({ id: 'km_u2', kind: 'theory', tags: [], useCount: 1 }),
      makeItem({ id: 'km_u3', kind: 'theory', tags: [], useCount: 1 }),
      makeItem({ id: 'km_mk_a', kind: 'market', tags: [], useCount: 0 }),
      makeItem({ id: 'km_mk_b', kind: 'market', tags: [], useCount: 0 }),
      makeItem({ id: 'km_st1', kind: 'strategy', tags: [], useCount: 0 }),
      makeItem({ id: 'km_bi1', kind: 'bias', tags: [], useCount: 0 }),
    ]
    const ctx: KnowledgeSelectContext = { persona: undefined, symbols: [] }
    const before = selectKnowledgeForDecision(basePool, ctx).map(i => i.id)
    check(
      '初回はuseCountが少ないu2/u3が優先され、最もuseCountが多いu1は漏れる',
      before.includes('km_u2') && before.includes('km_u3') && !before.includes('km_u1'),
      before.join(','),
    )

    const bumpedPool = basePool.map(i => i.id === 'km_u2' ? { ...i, useCount: 20 } : i)
    const after = selectKnowledgeForDecision(bumpedPool, ctx).map(i => i.id)
    check('useCountを上げたu2は次回落選し、代わりにu1が浮上する', !after.includes('km_u2') && after.includes('km_u1'), after.join(','))
  }

  // ── (4) kindが空ならクォータ枠を捨てて残りで埋める（架空アイテムを作らない） ─
  console.log('(4) kindが空ならクォータ枠を捨てて残りの高スコア順で埋める')
  {
    // market/strategy/biasは意図的にゼロ件（プールに存在しない）。theoryだけ5件用意する。
    const pool: KnowledgeItem[] = [
      makeItem({ id: 'km_e1', kind: 'theory', tags: [] }),
      makeItem({ id: 'km_e2', kind: 'theory', tags: [] }),
      makeItem({ id: 'km_e3', kind: 'theory', tags: [] }),
      makeItem({ id: 'km_e4', kind: 'theory', tags: [] }),
      makeItem({ id: 'km_e5', kind: 'theory', tags: [] }),
    ]
    const ctx: KnowledgeSelectContext = { persona: undefined, symbols: [] }
    const result = selectKnowledgeForDecision(pool, ctx)
    const poolIds = new Set(pool.map(i => i.id))
    check('market/strategy/biasが無くてもtickは落ちず結果を返す', Array.isArray(result))
    check('存在しないkindの項目は含まれない', result.every(i => i.kind === 'theory'))
    check('架空のIDは含まれない（全て元プール由来）', result.every(i => poolIds.has(i.id)))
    check('不足枠は同じプール内の他項目で埋まる（5件全部）', result.length === 5, `got ${result.length}`)
  }

  // ── (5) MAX_CHARS超過時に下位から落ち、summaryが途中で切れない ───────────
  console.log('(5) MAX_CHARS超過時に下位から落ち、summaryが途中で切れない')
  {
    const longSummary = 'あ'.repeat(180)
    // 6件が選ばれる想定のクォータを満たしつつ、1件あたり約190字×6件=約1140字でMAX_CHARS(1000)を超える。
    const pool: KnowledgeItem[] = [
      makeItem({ id: 'km_c1', kind: 'theory', tags: ['buffett'], title: 'T'.repeat(10), summary: longSummary }),
      makeItem({ id: 'km_c2', kind: 'theory', tags: [], title: 'T'.repeat(10), summary: longSummary }),
      makeItem({ id: 'km_c3', kind: 'market', tags: [], title: 'T'.repeat(10), summary: longSummary }),
      makeItem({ id: 'km_c4', kind: 'strategy', tags: [], title: 'T'.repeat(10), summary: longSummary }),
      makeItem({ id: 'km_c5', kind: 'bias', tags: [], title: 'T'.repeat(10), summary: longSummary }),
      makeItem({ id: 'km_c6', kind: 'theory', tags: [], title: 'T'.repeat(10), summary: longSummary }),
    ]
    const ctx: KnowledgeSelectContext = { persona: 'buffett', symbols: [] }
    const result = selectKnowledgeForDecision(pool, ctx)
    const totalChars = result.reduce((s, i) => s + i.title.length + i.summary.length, 0)
    check('超過時は件数が減る（6件全部は入らない）', result.length < 6, `got ${result.length}`)
    check('トリム後は合計1000字以内', totalChars <= MAX_CHARS, `got ${totalChars}`)
    check('残った項目のsummaryは途中で切られていない（元の長さのまま）', result.every(i => i.summary === longSummary))
    check('残った項目のtitleも途中で切られていない', result.every(i => i.title === 'T'.repeat(10)))
  }

  // ── (6) formatKnowledgeBlock([]) は空文字 ────────────────────────────
  console.log('(6) formatKnowledgeBlock([]) は空文字')
  {
    check('0件なら空文字を返す（プレースホルダを書かない）', formatKnowledgeBlock([]) === '')
    const nonEmpty = formatKnowledgeBlock([makeItem({ id: 'km_f1', kind: 'theory' })])
    check('1件以上なら見出しを含む', nonEmpty.includes('【投資の原則（知識ベース）】') && nonEmpty.includes('km_f1'))
  }

  // ── (7) '.T'銘柄を含むとjapanタグが浮上する ───────────────────────────
  console.log("(7) '.T'銘柄を含むとjapanタグが浮上する")
  {
    const pool: KnowledgeItem[] = [
      makeItem({ id: 'km_j_japan', kind: 'theory', tags: ['japan'] }),
      makeItem({ id: 'km_j_neutralA', kind: 'theory', tags: [] }),
      makeItem({ id: 'km_j_neutralB', kind: 'theory', tags: [] }),
    ]
    const ctx: KnowledgeSelectContext = { persona: undefined, symbols: ['7203.T', 'AAPL'] }
    const result = selectKnowledgeForDecision(pool, ctx).map(i => i.id)
    check('.T銘柄ありでjapanタグが上位2枠(quota)に入る', result.includes('km_j_japan'), result.join(','))
  }

  // ── (8) filterKnowledgeRefs の検証 ───────────────────────────────────
  console.log('(8) filterKnowledgeRefs — 不正値・重複・注入集合外を全て除去')
  {
    const allowed = new Set(['km_ok1', 'km_ok2'])
    check('非配列(文字列)は[]', JSON.stringify(filterKnowledgeRefs('km_ok1', allowed)) === '[]')
    check('非配列(null)は[]', JSON.stringify(filterKnowledgeRefs(null, allowed)) === '[]')
    check('非配列(object)は[]', JSON.stringify(filterKnowledgeRefs({}, allowed)) === '[]')
    const r = filterKnowledgeRefs(
      ['km_ok1', 'km_ok1', 123, null, undefined, '', '   ', 'km_unknown', 'km_ok2'],
      allowed,
    )
    check(
      '非文字列/空文字/重複/注入集合外を除去し、正当なIDのみ残す',
      JSON.stringify(r) === JSON.stringify(['km_ok1', 'km_ok2']),
      JSON.stringify(r),
    )
  }

  // ── (9) scope='session'でsessionId不一致は除外される ─────────────────
  console.log("(9) scope='session'でsessionId不一致は除外される")
  {
    const pool: KnowledgeItem[] = [
      makeItem({ id: 'km_s_session', kind: 'theory', tags: ['buffett'], scope: 'session', sessionId: 'sess_abc' }),
      makeItem({ id: 'km_s_global', kind: 'theory', tags: [] }),
    ]
    const ctx: KnowledgeSelectContext = { persona: 'buffett', symbols: [] }
    const result = selectKnowledgeForDecision(pool, ctx).map(i => i.id)
    check('sessionスコープの項目はpersona一致でも選ばれない', !result.includes('km_s_session'), result.join(','))
    check('globalスコープの項目は選ばれる', result.includes('km_s_global'), result.join(','))
  }

  console.log(failures === 0 ? '\n全PASS' : `\n${failures}件FAIL`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
