// フェーズA（2026-10-18）: 添削の AI を実際に呼び、メモごとに N 回の結果を evals/critique/runs/<memo-id>-<n>.json に保存する。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/eval-critique.ts [--memo=clean] [--runs=3] [--model=claude-opus-5] [--wait=2000] [--resume]
//
//  - API を叩く（ANTHROPIC_API_KEY が .env.local に要る。無ければ最初に止まる。フォールバック無し）
//  - 鍵を印字しない・記録に入れない（書く前に鍵らしき文字列が無いことを確かめる）
//  - 門（lib/lab/critique/guard.ts）を通す前と後の両方を保存する（何が落ちたかを見るため）
//  - 規則版（lib/lab/critique/catalogue.ts の detectAll）の結果も同じ記録に入れる（AI と規則の比較用。AI には渡さない）
//  - --resume: 既に記録があり error の無い回は飛ばす（途中で止まったときの続き）
//  - 採点は scripts/eval-judge.ts（別のモデル）。このスクリプトは採点しない

import fs from 'fs'
import path from 'path'
import { EVAL_MEMOS } from '../evals/critique/memos'
import { buildEvalInput } from '../evals/critique/figures'
import { ROOT, RUNS_DIR, arg, flag, loadEnvLocal, runFile, sleep, writeJsonSafe, type RunRecord } from '../evals/critique/record'
import { callCritique, DEFAULT_CRITIQUE_MODEL, requireApiKey } from '../lib/lab/critique/anthropic'
import { guardFindings } from '../lib/lab/critique/guard'
import { detectAll } from '../lib/lab/critique/catalogue'
import { LAB_9983 } from '../lib/lab/9983'
import type { LabMemo } from '../lib/lab/memo-fields'

async function main() {
  loadEnvLocal()
  const apiKey = requireApiKey()
  const model = arg('model') ?? DEFAULT_CRITIQUE_MODEL
  const runs = Number.parseInt(arg('runs') ?? '3', 10)
  const wait = Number.parseInt(arg('wait') ?? '2000', 10)
  const only = arg('memo')
  const resume = flag('resume')
  const memos = only ? EVAL_MEMOS.filter(m => m.id === only) : [...EVAL_MEMOS]
  if (memos.length === 0) throw new Error(`--memo=${only} に当たるメモが無い（${EVAL_MEMOS.map(m => m.id).join('・')}）`)
  fs.mkdirSync(RUNS_DIR, { recursive: true })

  console.log(`添削モデル ${model}／${memos.length} 件 × ${runs} 回／間隔 ${wait}ms／保存先 ${path.relative(ROOT, RUNS_DIR)}`)
  let calls = 0
  let totalMs = 0
  for (const memo of memos) {
    const { input, original } = buildEvalInput(memo.text)
    const labMemo: LabMemo = { mode: 'free', decision: null, parts: {}, free: memo.text }
    const baseline = detectAll({ text: memo.text, memo: labMemo, data: LAB_9983 }).map(e => e.id)
    console.log(`\n■ ${memo.id}（${memo.title}）— expect ${memo.expect.length} 件・expectNot ${memo.expectNot.length} 件・規則版の当たり: ${baseline.length ? baseline.join('・') : '無し'}`)
    for (let n = 1; n <= runs; n++) {
      const file = runFile(memo.id, n)
      if (resume && fs.existsSync(file)) {
        const prev = JSON.parse(fs.readFileSync(file, 'utf8')) as RunRecord
        if (!prev.error) { console.log(`  #${n}: 既にある（--resume）→ 飛ばす`); continue }
      }
      const record: RunRecord = {
        memoId: memo.id, memoTitle: memo.title, source: memo.source, run: n, model,
        startedAt: new Date().toISOString(), ms: null, stopReason: null, usage: null, maxTokens: null, temperature: null,
        input, original, raw: null, parse: null, findingsRaw: [], guard: null,
        catalogueBaseline: baseline, expect: memo.expect, expectNot: memo.expectNot, error: null,
      }
      try {
        const call = await callCritique(input, { model, apiKey, maxTokens: 2500 })
        calls++
        totalMs += call.ms
        record.model = call.model
        record.ms = Math.round(call.ms)
        record.stopReason = call.stopReason
        record.usage = call.usage
        record.maxTokens = call.maxTokens
        record.temperature = call.temperature
        record.raw = call.raw
        record.parse = call.parsed
        record.findingsRaw = call.parsed.ok ? call.parsed.findings : []
        record.guard = guardFindings(record.findingsRaw, original)
        const g = record.guard
        const shape = call.parsed.ok ? (call.parsed.malformed ? `OK（形の違う要素 ${call.parsed.malformed}）` : 'OK') : `形が違う（${call.parsed.reason}）`
        console.log(`  #${n}: 返答の形=${shape} 生=${record.findingsRaw.length} 件 → 残=${g.kept.length} 落=${g.dropped.length}（引用 ${g.counts['quote-not-in-original']}／禁止語 ${g.counts['forbidden-word']}／kind ${g.counts['bad-kind']}） ${record.ms}ms stop=${call.stopReason} tokens=${call.usage.inputTokens}/${call.usage.outputTokens}`)
        for (const d of g.dropped) console.log(`      落: 「${d.finding.title}」— ${d.detail}`)
      } catch (e) {
        const msg = (e as Error).message.split(apiKey).join('[redacted]')
        record.error = msg
        writeJsonSafe(file, record, [apiKey])
        console.error(`  #${n}: 失敗 — ${msg}`)
        console.error('  ここで止める（モデル名・鍵・レート制限を確かめて、--resume で続きから）')
        // process.exit() を直接呼ばない: Windows の Node で SDK の接続が残ったまま exit すると libuv の assertion（async.c）が出る。
        // 終了コードだけ立てて、自然に終わらせる
        process.exitCode = 1
        return
      }
      writeJsonSafe(file, record, [apiKey])
      if (!(memo === memos[memos.length - 1] && n === runs)) await sleep(wait)
    }
  }
  console.log(`\n完了: API 呼び出し ${calls} 回・合計 ${Math.round(totalMs / 1000)} 秒。次は npx tsx scripts/eval-judge.ts`)
}

main().catch(e => {
  console.error((e as Error).message)
  process.exitCode = 1
})
