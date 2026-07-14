// Claude calls for the /report feature — SEPARATE from lib/ai-trader/engine.ts.
// The tick path (engine.ts callClaude / AI_MODEL=Haiku) is intentionally untouched.
//
// Channel selection follows the established hybrid pattern (DECISIONS 2026-07-11(2)):
// ANTHROPIC_API_KEY set => Anthropic API (Vercel/production, streaming supported),
// no key => local `claude` CLI fallback (local dev only, non-streaming).

import { spawn } from 'child_process'

/** Report generation model. Override with REPORT_AI_MODEL. */
export function reportModel(): string {
  return process.env.REPORT_AI_MODEL || 'claude-opus-4-8'
}

/** Cheap interpreter model for the prepare step (fixed — tick model untouched). */
export const INTERPRET_MODEL = 'claude-haiku-4-5'

// ── Non-streaming call (used by interpret.ts / CLI fallback) ───────────────
export async function callReportClaude(
  prompt: string,
  opts: { model: string; maxTokens?: number },
): Promise<string> {
  return process.env.ANTHROPIC_API_KEY
    ? callApi(prompt, opts.model, opts.maxTokens ?? 1500)
    : callCli(prompt, opts.model)
}

async function callApi(prompt: string, model: string, maxTokens: number): Promise<string> {
  // Dynamic import: don't load the SDK in keyless local environments.
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })
  return res.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

function callCli(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--print', '--model', model], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('error', (e) => reject(e))
    proc.on('close', (code: number) => {
      if (code === 0) resolve(out)
      else reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 200)}`))
    })
    proc.stdin.write(prompt)
    proc.stdin.end()
  })
}

// ── Streaming call (generate step / Opus) ──────────────────────────────────
// API: SDK messages.stream bridged into a web ReadableStream of UTF-8 bytes.
// CLI fallback: non-streaming — the full text arrives as a single chunk.
export async function streamReportClaude(
  prompt: string,
  opts: { maxTokens?: number } = {},
): Promise<ReadableStream<Uint8Array>> {
  const model = reportModel()
  const maxTokens = opts.maxTokens ?? 3500
  const encoder = new TextEncoder()

  if (process.env.ANTHROPIC_API_KEY) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic()
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })

    return new ReadableStream<Uint8Array>({
      start(controller) {
        let settled = false
        stream.on('text', (textDelta: string) => {
          if (!settled) controller.enqueue(encoder.encode(textDelta))
        })
        stream.on('end', () => {
          if (!settled) { settled = true; controller.close() }
        })
        stream.on('error', (e: unknown) => {
          if (!settled) {
            settled = true
            controller.error(e instanceof Error ? e : new Error(String(e)))
          }
        })
        stream.on('abort', (e: unknown) => {
          if (!settled) {
            settled = true
            controller.error(e instanceof Error ? e : new Error('stream aborted'))
          }
        })
      },
      cancel() {
        stream.abort()
      },
    })
  }

  // Local dev without API key: CLI is print-only, so emit everything at once.
  const text = await callCli(prompt, model)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}
