/**
 * 一次情報の **許可リスト**（S3c・2026-10-01・DECISIONS 2026-09-30 3本目の追記）。
 *
 * 「表示用」と「取得用」のホストを **別の配列** に分ける。
 *   - 表示用 ... 画面の <a href> に入れてよいホスト。利用者がそのまま開く公式ページ。
 *   - 取得用 ... サーバーが JSON を取りに行くホスト。EDINET は鍵（Subscription-Key）が載るので **画面に出さない**。
 * `isRenderableSourceUrl` は https かつ表示用ホストに **完全一致** する URL だけを通す（サブドメインや前方一致は通さない）。
 *
 * SEC の様式は完全一致の固定リスト（`startsWith` で広げない。'10-K405' のような旧様式や 'S-8' は出さない）。
 * EDINET の書類種別コードは仕様書の固定リスト（下の注釈に出典と確認日）。
 *
 * このファイルは純粋な定数と純関数だけ。ブラウザ（components/review/PrimarySources.tsx）からも読む。
 */

/** 画面に出してよいホスト（完全一致） */
export const DISPLAY_HOSTS: readonly string[] = [
  'www.sec.gov',
  'disclosure2dl.edinet-fsa.go.jp',
  'disclosure2.edinet-fsa.go.jp',
]

/** サーバーが取りに行くホスト（完全一致）。api.edinet-fsa.go.jp は鍵が載るので表示用には入れない */
export const FETCH_HOSTS: readonly string[] = [
  'data.sec.gov',
  'www.sec.gov',
  'api.edinet-fsa.go.jp',
]

/**
 * SEC の様式（完全一致）。年次 10-K／四半期 10-Q／臨時 8-K とその訂正（/A）、外国発行体の 20-F／6-K／40-F。
 * 大量保有（SC 13D/G）や内部者取引（Form 4）は「発行会社が出した書類」ではないので入れない。
 */
export const SEC_FORMS: readonly string[] = ['10-K', '10-Q', '8-K', '10-K/A', '10-Q/A', '8-K/A', '20-F', '6-K', '40-F']

/**
 * EDINET の書類種別コード（docTypeCode）→ コード名称。
 * 出典: 金融庁「EDINET API 仕様書（Version 2）」ESE140206.pdf 4章 4-1 参考資料「書類種別コード」（p.88）
 *       https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/download/ESE140206.pdf
 * 確認日: 2026-10-01（PDF の該当ページから機械的に文字を取り出して照合）。
 * 入れるのは 有価証券報告書・半期報告書・四半期報告書・臨時報告書 とそれぞれの訂正報告書だけ。
 * 有価証券届出書（030）・確認書（135）・内部統制報告書（235）・大量保有報告書（350）などは入れない。
 */
export const EDINET_DOC_TYPES: Readonly<Record<string, string>> = {
  '120': '有価証券報告書',
  '130': '訂正有価証券報告書',
  '140': '四半期報告書',
  '150': '訂正四半期報告書',
  '160': '半期報告書',
  '170': '訂正半期報告書',
  '180': '臨時報告書',
  '190': '訂正臨時報告書',
}

function hostOf(url: string): { protocol: string; host: string } | null {
  try {
    const u = new URL(url)
    return { protocol: u.protocol, host: u.hostname }
  } catch {
    return null
  }
}

/** https で、表示用ホストに完全一致する URL だけ true。相対 URL・http・取得用ホスト・サブドメインは false */
export function isRenderableSourceUrl(url: string): boolean {
  const h = hostOf(url)
  return h !== null && h.protocol === 'https:' && DISPLAY_HOSTS.includes(h.host)
}

/** https で、取得用ホストに完全一致する URL だけ true（サーバーの取得口が自分の行き先を確かめるため） */
export function isFetchSourceUrl(url: string): boolean {
  const h = hostOf(url)
  return h !== null && h.protocol === 'https:' && FETCH_HOSTS.includes(h.host)
}

/** SEC の様式が許可リストに完全一致するか */
export function isAllowedSecForm(form: string): boolean {
  return SEC_FORMS.includes(form)
}

/** EDINET の書類種別コードが固定リストにあればコード名称、無ければ null */
export function edinetDocTypeName(code: string): string | null {
  return Object.prototype.hasOwnProperty.call(EDINET_DOC_TYPES, code) ? EDINET_DOC_TYPES[code] : null
}
