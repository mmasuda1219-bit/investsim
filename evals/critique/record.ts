import fs from 'fs'
import path from 'path'
import type { ParseResult } from '../../lib/lab/critique/anthropic'
import type { GuardResult } from '../../lib/lab/critique/guard'
import type { CritiqueFinding } from '../../lib/lab/critique/prompt'
import type { NumberToken } from './figures'
import type { EvalMemo } from './memos'

/**
 * フェーズA（2026-10-18）: 添削の記録（runs/<memo>-<n>.json）と採点の記録（runs/<memo>-<n>.judge.json）の形と、
 * scripts/eval-critique.ts・scripts/eval-judge.ts が共有する小さな部品（.env.local の読み込み・引数・安全な書き込み）。
 * 2つのスクリプトが互いを import しないためのファイル（import すると main が走る）。
 */

export const ROOT = process.cwd()
export const RUNS_DIR = path.join(ROOT, 'evals', 'critique', 'runs')
export const REPORT_FILE = path.join(ROOT, 'evals', 'critique', 'report.md')

export const runFile = (memoId: string, n: number) => path.join(RUNS_DIR, `${memoId}-${n}.json`)
export const judgeFile = (memoId: string, n: number) => path.join(RUNS_DIR, `${memoId}-${n}.judge.json`)

/** .env.local を手動ロード（dotenv 非依存・既存の環境変数は上書きしない。scripts/seed-fundamentals.ts と同じ） */
export function loadEnvLocal(root = ROOT) {
  const envPath = path.join(root, '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = value
  }
}

export function arg(name: string): string | null {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
export const flag = (name: string) => process.argv.includes(`--${name}`)
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** 鍵らしき文字列が混ざっていないことを確かめてから書く */
export function writeJsonSafe(file: string, value: unknown, secrets: readonly string[]) {
  const text = JSON.stringify(value, null, 2)
  if (secrets.some(s => s.length > 0 && text.includes(s)) || /sk-ant-[A-Za-z0-9_-]{8,}/.test(text)) {
    throw new Error(`記録に鍵らしき文字列が混ざった。書き込みを中止: ${path.basename(file)}`)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text + '\n', 'utf8')
}

/** 添削1回分の記録 */
export interface RunRecord {
  memoId: string
  memoTitle: string
  source: EvalMemo['source']
  run: number
  model: string
  startedAt: string
  ms: number | null
  stopReason: string | null
  usage: { inputTokens: number | null; outputTokens: number | null } | null
  maxTokens: number | null
  temperature: number | null
  /** AI に渡した入力の全文（system は prompt.ts の CRITIQUE_SYSTEM_PROMPT） */
  input: string
  /** 門に渡した原文（メモの節だけ） */
  original: string
  raw: string | null
  parse: ParseResult | null
  /** 門を通す前（形の検証だけ済み） */
  findingsRaw: CritiqueFinding[]
  /** 門を通した後 */
  guard: GuardResult | null
  /** 規則版（catalogue）の当たり（比較用。AI には渡していない） */
  catalogueBaseline: string[]
  expect: EvalMemo['expect']
  expectNot: EvalMemo['expectNot']
  error: string | null
}

export interface JudgeA { expectId: string; found: boolean; byFinding?: number[]; note?: string }
export interface JudgeADropped { expectId: string; found: boolean; byDropped?: number[] }
export interface JudgeB { finding: number; field?: string; text?: string; reason?: string }
export interface JudgeD { finding: number; genuine: boolean; reason?: string }
export interface JudgeF { finding: number; number?: string; reason?: string }
export interface JudgeG { expectNotId: string; violated: boolean; byFinding?: number[]; text?: string }

/** 判定 AI の返答（A・B・D・G は判定 AI、A_dropped は落とされた中にだけあったか、F は確認だけ） */
export interface JudgeParsed {
  A: JudgeA[]
  A_dropped: JudgeADropped[]
  B: JudgeB[]
  D: JudgeD[]
  F: JudgeF[]
  G: JudgeG[]
}

/** 機械で数える部分（AI に聞かない） */
export interface JudgeMachine {
  shapeOk: boolean
  malformed: number
  /** C: 引用の実在 */
  C: { raw: number; quoteOk: number; nearMiss: number }
  /** B: 門が落とした禁止語 */
  B: { forbiddenFindings: number; words: string[] }
  /** D: 空を返したか（clean の見出しの数字） */
  D: { rawCount: number; keptCount: number; emptyRaw: boolean; emptyKept: boolean }
  /** F: 残った添削の title・why・how の数値の分類（unknown が違反） */
  F: { tokens: NumberToken[]; unknown: NumberToken[] }
}

export interface JudgeRecord {
  memoId: string
  run: number
  judgeModel: string | null
  startedAt: string
  ms: number | null
  usage: { inputTokens: number | null; outputTokens: number | null } | null
  stopReason: string | null
  raw: string | null
  parsed: JudgeParsed | null
  parseError: string | null
  machine: JudgeMachine
}

/** 添削の記録を全部読む（*.judge.json は除く）。メモの順は呼び手が決める */
export function readRuns(): RunRecord[] {
  if (!fs.existsSync(RUNS_DIR)) return []
  return fs.readdirSync(RUNS_DIR)
    .filter(f => f.endsWith('.json') && !f.endsWith('.judge.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')) as RunRecord)
    .sort((a, b) => a.memoId.localeCompare(b.memoId) || a.run - b.run)
}

export function readJudge(memoId: string, n: number): JudgeRecord | null {
  const f = judgeFile(memoId, n)
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as JudgeRecord) : null
}
