/**
 * 「あなたが書いていないことの、出どころ」（/review/[recordId]・S3c・2026-10-01・DECISIONS 2026-09-30 3本目の追記）の型。
 *
 * 発行会社が **公式に出した書類** の一覧を、見出し・日付・URL だけで持つ。要約・選別・評価の欄は作らない。
 * 米国株は SEC EDGAR の提出書類、日本株は金融庁 EDINET の法定開示。決算短信は出さない（TDnet は採らない＝追記の決定）。
 *
 * 並びと中身は取得側（./index.ts の finalizeSources）で確定し、画面側（components/review/PrimarySources.tsx）は並べ替えも
 * 絞り込みも切り詰めもしない。
 */

export type PrimarySourceItem = {
  source: 'sec' | 'edinet'
  publisher: 'SEC EDGAR' | '金融庁 EDINET'
  /** 発行会社名（取得元の表記のまま） */
  filerName: string
  /** 書類の種類。SEC は様式（10-K 等）、EDINET は仕様書の「書類種別コード」のコード名称（有価証券報告書 等） */
  docType: string
  /** 見出し。取得元の表記のまま（切らない・訳さない・要約しない） */
  title: string
  /** 公開日 YYYY-MM-DD（SEC は filingDate、EDINET は submitDateTime の日付部分） */
  publishedAt: string
  /** 表示用ホスト（./allowlist.ts の DISPLAY_HOSTS）に限る。鍵つきの取得用 URL は絶対に入れない */
  url: string
  /** 同日の並びを決める鍵。SEC は accessionNumber、EDINET は docID */
  uid: string
}

export type PrimarySourceStatus = 'ok' | 'empty' | 'failed'

export type PrimarySourceResult = {
  /** ok＝1件以上ある／empty＝該当なし（取得はできた）／failed＝取得できなかった（empty に化けさせない） */
  status: PrimarySourceStatus
  /** 公開日昇順・同日は uid 昇順。上限 20 件 */
  items: PrimarySourceItem[]
  /** 上限で切った件数（切っていなければ 0） */
  truncated: number
  /** 取得時刻（ISO 8601） */
  fetchedAt: string
  /** 窓の始まり YYYY-MM-DD（買った日の 30 暦日前） */
  windowFrom: string
  /** 窓の終わり YYYY-MM-DD（買った日の 30 暦日後。未来側は今日で打ち切り） */
  windowTo: string
  /** 全件を一覧できる公式ページ（表示用ホスト）。無ければ null */
  browseAllUrl: string | null
}
