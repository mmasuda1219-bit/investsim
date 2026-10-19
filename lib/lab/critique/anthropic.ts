import Anthropic from '@anthropic-ai/sdk'
import { CRITIQUE_SYSTEM_PROMPT, type CritiqueFinding } from './prompt'

/**
 * 添削の AI 呼び出し（フェーズA・2026-10-18）。**Anthropic SDK を直接呼ぶ。**
 *
 *  - lib/report/claude.ts を import しない（鍵が無いとローカルの `claude` CLI に落ちる経路がある）
 *  - ANTHROPIC_API_KEY が無ければ**例外を投げて止まる**。フォールバックを持たない
 *  - 鍵を印字しない・返り値に入れない・ログに出さない
 *  - 返ってきた文字列から JSON 配列を取り出し、CritiqueFinding[] の形に検証する。形が違えば捨てて「返答の形が違う」として記録する
 *  - lib/lab/** で process.env を読んでよいのはこのファイルだけ（scripts/check-lab-9983.ts (f)）。画面（app/**）からはまだ呼ばない（フェーズAは手元で測る道具）
 */

export const DEFAULT_CRITIQUE_MODEL = 'claude-opus-5'

/** 鍵。無ければ投げる（値は返すが、呼び手は印字しない） */
export function requireApiKey(env: Record<string, string | undefined> = process.env): string {
  const k = (env.ANTHROPIC_API_KEY ?? '').trim()
  if (k.length === 0) throw new Error('ANTHROPIC_API_KEY が設定されていません（.env.local に入れる）。この道具はフォールバックを持たず、ここで止まります')
  return k
}

export interface MessageCall {
  model: string
  ms: number
  /** 返答の文字（text ブロックをつなげたもの） */
  raw: string
  stopReason: string | null
  usage: { inputTokens: number | null; outputTokens: number | null }
  maxTokens: number
  /** 渡していなければ null（SDK の既定） */
  temperature: number | null
}

export interface CallOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  apiKey?: string
  timeoutMs?: number
}

/** 1往復（system＋user → text）。添削も採点もこれを通る */
export async function callMessages(params: { system: string; user: string } & CallOptions): Promise<MessageCall> {
  const apiKey = params.apiKey ?? requireApiKey()
  const model = params.model ?? DEFAULT_CRITIQUE_MODEL
  const maxTokens = params.maxTokens ?? 2000
  const client = new Anthropic({ apiKey, timeout: params.timeoutMs ?? 180_000, maxRetries: 2 })
  const t0 = performance.now()
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: params.system,
    messages: [{ role: 'user', content: params.user }],
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
  })
  const raw = res.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('')
  return {
    model: res.model ?? model,
    ms: performance.now() - t0,
    raw,
    stopReason: res.stop_reason ?? null,
    usage: { inputTokens: res.usage?.input_tokens ?? null, outputTokens: res.usage?.output_tokens ?? null },
    maxTokens,
    temperature: params.temperature ?? null,
  }
}

// ── 返答の解析（純関数） ───────────────────────────────────────────────────────

/**
 * ```json … ``` の囲いを外し、最初の open から対応する close までを返す（文字列の中の括弧は数えない）。
 * open が無ければ null。閉じが足りない（途中で切れた）ときは open から末尾までを返す（JSON.parse が失敗して「解析エラー」として記録される）
 */
export function extractJson(raw: string, open: '[' | '{' = '['): string | null {
  const close = open === '[' ? ']' : '}'
  const text = raw.replace(/```(?:json)?/gi, '')
  const start = text.indexOf(open)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  const last = text.lastIndexOf(close)
  return last > start ? text.slice(start, last + 1) : text.slice(start)
}

export type ParseResult =
  | { ok: true; findings: CritiqueFinding[]; malformed: number }
  | { ok: false; reason: 'no-json-array' | 'json-parse-error' | 'not-an-array'; detail: string }

const isStr = (v: unknown): v is string => typeof v === 'string'

/** 1要素の形の検証。kind は文字列なら通す（calc／missing 以外は門 guard.ts が落として数える） */
export function toFinding(v: unknown): CritiqueFinding | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (!isStr(o.kind) || !isStr(o.title) || !isStr(o.quote) || !isStr(o.why) || !isStr(o.how)) return null
  const catalogueId = o.catalogueId == null ? null : isStr(o.catalogueId) ? o.catalogueId : null
  return { kind: o.kind as CritiqueFinding['kind'], title: o.title, quote: o.quote, why: o.why, how: o.how, catalogueId }
}

/** 返答の文字 → CritiqueFinding[]。配列でなければ ok: false。要素の形が違うものは落として malformed に数える */
export function parseFindings(raw: string): ParseResult {
  const json = extractJson(raw, '[')
  if (json == null) return { ok: false, reason: 'no-json-array', detail: raw.slice(0, 200) }
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch (e) { return { ok: false, reason: 'json-parse-error', detail: (e as Error).message } }
  if (!Array.isArray(parsed)) return { ok: false, reason: 'not-an-array', detail: typeof parsed }
  const findings: CritiqueFinding[] = []
  let malformed = 0
  for (const item of parsed) {
    const f = toFinding(item)
    if (f) findings.push(f)
    else malformed++
  }
  return { ok: true, findings, malformed }
}

export interface CritiqueCall extends MessageCall {
  parsed: ParseResult
}

/** 添削1回。system は prompt.ts の CRITIQUE_SYSTEM_PROMPT（変えない）、user は buildCritiqueInput の出力 */
export async function callCritique(input: string, opts: CallOptions = {}): Promise<CritiqueCall> {
  const call = await callMessages({ system: CRITIQUE_SYSTEM_PROMPT, user: input, ...opts, model: opts.model ?? DEFAULT_CRITIQUE_MODEL })
  return { ...call, parsed: parseFindings(call.raw) }
}
