// ログイン後の «戻り先の土台»（base ＝ https://ホスト名 の部分）を決める。
//
// /auth/callback は Supabase から戻ってきた直後に「元のページへ」リダイレクトを発行する。
// その土台を req.url の origin から取ると、プロキシ（Vercel）の後ろでは内部の住所や
// localhost になりうる（2026-09-20 本番で「住所が localhost に変わる」症状）。
// プロキシは本来の住所を x-forwarded-host / x-forwarded-proto ヘッダに載せて渡してくるので、
// 本番ではそちらを優先する（Supabase 公式の Next.js SSR の例と同じ流儀）。
//
// ただしヘッダは外から細工できる可能性があるため、«ホスト名として妥当な文字だけ» を通し、
// スキームやパス・改行が混ざった値は捨てて origin に戻す（オープンリダイレクトにしない）。
//
// 通信も環境も触らない純関数。テストは scripts/check-auth-callback.ts。

export interface CallbackBaseInput {
  /** new URL(req.url).origin */
  origin: string
  /** req.headers.get('x-forwarded-host') */
  forwardedHost: string | null | undefined
  /** req.headers.get('x-forwarded-proto') */
  forwardedProto: string | null | undefined
  /** process.env.NODE_ENV */
  nodeEnv: string | undefined
  /** process.env.NEXT_PUBLIC_SITE_URL（任意。本番で base が localhost に落ちたときの保険） */
  siteUrl: string | undefined
  /** 警告の出口。既定は console.warn（テストでは差し替える） */
  warn?: (message: string) => void
}

// ホスト名（英数字・ドット・ハイフン）＋任意のポート。先頭/末尾はドットやハイフン不可。
// これ以外（/ ? # @ 空白 改行 スキーム など）が1文字でも混ざれば不採用。
const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/

// 本番で戻り先にしてはいけないホスト。ここに落ちたら NEXT_PUBLIC_SITE_URL を使う。
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** カンマ区切りヘッダ（複数プロキシを経由すると連なる）の最初の1つ。 */
function firstValue(raw: string | null | undefined): string | null {
  if (!raw) return null
  const first = raw.split(',')[0].trim()
  return first === '' ? null : first
}

/** x-forwarded-host の値がホスト名として妥当ならそのまま、そうでなければ null。 */
export function sanitizeForwardedHost(raw: string | null | undefined): string | null {
  const host = firstValue(raw)
  if (!host) return null
  return HOST_PATTERN.test(host) ? host : null
}

/** x-forwarded-proto は http / https だけ受け付ける。それ以外・無しは https。 */
function resolveProto(raw: string | null | undefined): 'http' | 'https' {
  const proto = firstValue(raw)?.toLowerCase()
  return proto === 'http' ? 'http' : 'https'
}

function hostnameOf(base: string): string | null {
  try {
    return new URL(base).hostname
  } catch {
    return null
  }
}

/** NEXT_PUBLIC_SITE_URL を origin（https://ホスト）に正規化。不正なら null。 */
function normalizeSiteUrl(raw: string | undefined): string | null {
  if (!raw || raw.trim() === '') return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.origin
  } catch {
    return null
  }
}

/**
 * 戻り先の土台（origin 形式・末尾スラッシュなし）を決める。
 *
 * 優先順:
 *   1. development → origin をそのまま（ローカル開発はプロキシを挟まない）
 *   2. x-forwarded-host が妥当 → `${x-forwarded-proto ?? https}://${host}`
 *   3. それ以外 → origin
 *   4. 1 以外で結果のホストが localhost/127.0.0.1 なら
 *      NEXT_PUBLIC_SITE_URL があればそれを使い、無ければそのまま（warn を1行）
 */
export function resolveCallbackBase(input: CallbackBaseInput): string {
  const warn = input.warn ?? ((m: string) => console.warn(m))

  if (input.nodeEnv === 'development') return input.origin

  const host = sanitizeForwardedHost(input.forwardedHost)
  let base = host ? `${resolveProto(input.forwardedProto)}://${host}` : input.origin

  const hostname = hostnameOf(base)
  if (hostname !== null && LOOPBACK_HOSTS.has(hostname)) {
    const siteUrl = normalizeSiteUrl(input.siteUrl)
    if (siteUrl) {
      base = siteUrl
    } else {
      warn(
        `[auth/callback] 本番なのに戻り先の土台が ${base} になっています。` +
          'Vercel の環境変数に NEXT_PUBLIC_SITE_URL（例: https://investsim-nine.vercel.app）を設定してください。',
      )
    }
  }

  return base
}
