// /watch S1: 旧 `AIDecision.fundamentals` 文字列のパーサ（lib/ai-trader/fundamentals-parse.ts）
// のスモーク。
// - 正常系（fmtFundamentals の全13キー）を数値に戻せる
// - N/A は undefined（0にしない）
// - 先頭にAIの文が付いていても壊れない／AIの文は prose として取り出せる
// - 未知キー・書式違い・空文字・`-` は黙って捨てる
//
// 実行: npx tsx scripts/check-fundamentals-parse.ts

import { parseFundamentals, parseFundamentalsWithMeta, fundamentalsProse, PARSEABLE_FIELDS } from '../lib/ai-trader/fundamentals-parse'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  PASS ${name}`)
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const near = (a: number | undefined, b: number, eps = 1e-9) => a != null && Math.abs(a - b) < eps

console.log('正常系（fmtFundamentals の全13キー）')
{
  const s = 'PER=28.4x | PBR=5.1x | ROE=31.2% | ROA=8.5% | 営業利益率=24.0% | 粗利益率=45.3% | 売上成長=7.0% | D/E=0.67x | FCF=$1.2B | 時価総額=$226B | 配当利回り=1.5% | 52週高値=123 | 安値=98'
  const f = parseFundamentals(s)
  check('PER 28.4x → 28.4', near(f.pe, 28.4))
  check('PBR 5.1x → 5.1', near(f.pb, 5.1))
  check('ROE 31.2% → 0.312', near(f.roe, 0.312))
  check('ROA 8.5% → 0.085', near(f.roa, 0.085))
  check('営業利益率 24.0% → 0.24', near(f.operatingMargin, 0.24))
  check('粗利益率 45.3% → 0.453', near(f.grossMargin, 0.453))
  check('売上成長 7.0% → 0.07', near(f.revenueGrowth, 0.07))
  check('D/E 0.67x → 0.67', near(f.debtToEquity, 0.67))
  check('FCF $1.2B → 1.2e9', near(f.freeCashflow, 1.2e9, 1))
  check('時価総額 $226B → 226e9', near(f.marketCap, 226e9, 1))
  check('配当利回り 1.5% → 0.015', near(f.dividendYield, 0.015))
  check('52週高値 123 → 123', near(f.week52High, 123))
  check('安値 98 → 98', near(f.week52Low, 98))
  check('13項目すべて採用', Object.keys(f).length === 13, `actual=${Object.keys(f).length}`)
  check('PARSEABLE_FIELDS は13項目', PARSEABLE_FIELDS.length === 13)
  check('AIの文は無い（prose は空）', fundamentalsProse(s) === '')
}

console.log('N/A と欠損')
{
  const s = 'PER=14.8x | PBR=N/A | ROE=35.0% | ROA=N/A | 営業利益率=N/A | 粗利益率=N/A | 売上成長=7.0% | D/E=0.67x | 時価総額=$226B'
  const f = parseFundamentals(s)
  check('N/A は undefined（0にしない）', f.pb === undefined && f.roa === undefined && f.operatingMargin === undefined)
  check('N/A のキーはオブジェクトに入らない', !('pb' in f) && !('roa' in f))
  check('トークンが無い項目も undefined', f.freeCashflow === undefined && f.week52High === undefined && f.dividendYield === undefined)
  check('採用できた項目だけ数える', Object.keys(f).length === 5, `actual=${Object.keys(f).length}`)
  check('FCF の負値 $-1.2B → -1.2e9', near(parseFundamentals('FCF=$-1.2B').freeCashflow, -1.2e9, 1))
}

console.log('先頭にAIの文')
{
  const s = 'ROE35%・PER14.8x・D/E0.67xはバフェット基準を満たし、医薬品セクターとして財務健全性が高い。 | PER=14.8x | PBR=5.1x | ROE=35.0% | ROA=N/A | 営業利益率=N/A | 粗利益率=N/A | 売上成長=7.0% | D/E=0.67x | 時価総額=$226B'
  const f = parseFundamentals(s)
  check('AIの文は捨てて数値だけ読む', near(f.pe, 14.8) && near(f.roe, 0.35) && near(f.marketCap, 226e9, 1))
  check('AIの文中の「PER14.8x」は誤採用しない（キー完全一致）', Object.keys(f).length === 6, `actual=${Object.keys(f).length}`)
  check('prose にAIの文だけが残る',
    fundamentalsProse(s) === 'ROE35%・PER14.8x・D/E0.67xはバフェット基準を満たし、医薬品セクターとして財務健全性が高い。',
    fundamentalsProse(s))

  // AIの文に「=」が含まれる例（実データ: "D/E=2.81xは投資基準超過…"）
  const s2 = 'D/E=2.81xは投資基準超過の財務リスク、ROE=11%は優良企業基準の15%未達。 | PER=14.2x | D/E=2.81x'
  const f2 = parseFundamentals(s2)
  check('「D/E=2.81xは…」は値の書式違いなので捨て、後ろの D/E=2.81x を採る', near(f2.debtToEquity, 2.81) && Object.keys(f2).length === 2)
  check('「=」を含むAIの文も prose として残る', fundamentalsProse(s2).startsWith('D/E=2.81xは投資基準超過'))

  // AIの文が「 | 」を含んでも先頭側だけ prose
  const s3 = '一文目 | 二文目 | PER=10.0x | 追記=無視'
  check('書式トークン前の複数トークンは prose に連結', fundamentalsProse(s3) === '一文目 | 二文目', fundamentalsProse(s3))
}

console.log('未知キー・書式違い')
{
  const f = parseFundamentals('EPS=3.2 | PER=10.0x | PER=abc | ROE=0.31 | 時価総額=226B | 52週高値=1,234 | pe=10x')
  check('未知キー EPS は無視', f.eps === undefined)
  check('小文字 pe は無視（大文字小文字を区別）', Object.keys(f).length === 1, JSON.stringify(f))
  check('PER=10.0x は採用', near(f.pe, 10))
  check('ROE に % が無ければ捨てる', f.roe === undefined)
  check('時価総額に $ が無ければ捨てる', f.marketCap === undefined)
  check('桁区切り付きの整数は捨てる', f.week52High === undefined)
}

console.log('空・ダッシュ・null')
{
  check('空文字 → {}', Object.keys(parseFundamentals('')).length === 0)
  check('"-"（ファンダ未取得）→ {}', Object.keys(parseFundamentals('-')).length === 0)
  check('undefined → {}', Object.keys(parseFundamentals(undefined)).length === 0)
  check('null → {}', Object.keys(parseFundamentals(null)).length === 0)
  check('"-" の prose は空', fundamentalsProse('-') === '')
  check('AIの文 + " | -" は prose だけ', fundamentalsProse('文だけ。 | -') === '文だけ。')
  check('空文字の prose は空', fundamentalsProse('') === '')
}

console.log('書式 v2（fmt=2・D/E は%・通貨記号つき）')
{
  // engine.ts fmtFundamentals() v2 の実出力（2026-09-11 AAPL）
  const s = 'PER=36.1x | PBR=44.4x | ROE=148.8% | ROA=27.1% | 営業利益率=32.6% | 粗利益率=48.7% | 売上成長=16.4% | D/E=78.4% | FCF=$107.7B | 時価総額=$4766B | 配当利回り=0.3% | 52週高値=$345 | 安値=$227 | fmt=2'
  const r = parseFundamentalsWithMeta(s)
  check('v2 と判定', r.format === 2)
  check('v2 の D/E=78.4% → 78.4（正準%のまま・/100 しない）', near(r.data.debtToEquity, 78.4))
  check('v2 は legacy なし', r.legacy === undefined)
  check('v2 の $ は剥がして数値だけ（FCF）', near(r.data.freeCashflow, 107.7e9, 1))
  check('v2 の 52週高値=$345 → 345', near(r.data.week52High, 345) && near(r.data.week52Low, 227))
  check('v2 でも 13項目すべて採用', Object.keys(r.data).length === 13, `actual=${Object.keys(r.data).length}`)
  check('parseFundamentals() は data と同じ', near(parseFundamentals(s).debtToEquity, 78.4) && Object.keys(parseFundamentals(s)).length === 13)
  check('fmt=2 は prose に混ざらない', fundamentalsProse(s) === '')
  check('AIの文 + v2 でも prose はAIの文だけ', fundamentalsProse('負債は自己資本の0.78倍で健全。 | PER=36.1x | D/E=78.4% | fmt=2') === '負債は自己資本の0.78倍で健全。')

  // 円建て（7203.T 実出力）: ¥ と負の FCF
  const jp = 'PER=8.6x | PBR=N/A | ROE=12.4% | ROA=2.3% | 営業利益率=7.9% | 粗利益率=16.8% | 売上成長=10.4% | D/E=115.0% | FCF=¥-3600.0B | 時価総額=¥35893B | 配当利回り=3.3% | 52週高値=¥4000 | 安値=¥2686 | fmt=2'
  const j = parseFundamentalsWithMeta(jp)
  check('v2 の ¥ は剥がして数値だけ（時価総額）', near(j.data.marketCap, 35893e9, 1))
  check('v2 の負の FCF ¥-3600.0B → -3600e9', near(j.data.freeCashflow, -3600e9, 1))
  check('v2 の 52週高値=¥4000 → 4000', near(j.data.week52High, 4000))
  check('v2 の D/E=115.0% → 115', near(j.data.debtToEquity, 115))
  check('v2 の PBR=N/A は undefined', j.data.pb === undefined)

  // その他通貨（ISOコード＋空白）
  const eu = 'PER=10.0x | FCF=EUR 12.3B | 時価総額=EUR 200B | 52週高値=EUR 55 | fmt=2'
  const e = parseFundamentalsWithMeta(eu)
  check('v2 の "EUR 12.3B" → 12.3e9', near(e.data.freeCashflow, 12.3e9, 1) && near(e.data.marketCap, 200e9, 1))
  check('v2 の "EUR 55" → 55', near(e.data.week52High, 55))

  // 書式の取り違えは捨てる（v2 に x の D/E は無い・v1 に % の D/E は無い）
  check('v2 で D/E=0.67x は書式違いとして捨てる', parseFundamentalsWithMeta('D/E=0.67x | fmt=2').data.debtToEquity === undefined)
  check('v1 で D/E=78.4% は書式違いとして捨てる', parseFundamentalsWithMeta('D/E=78.4%').data.debtToEquity === undefined)
  check('v1 で ¥ 付きは書式違いとして捨てる', parseFundamentalsWithMeta('時価総額=¥35893B').data.marketCap === undefined)
}

console.log('書式 v1 の D/E は単位不明（数値そのまま＋legacy フラグ）')
{
  // Yahoo 由来（%スケール）と mock 由来（倍率）が同じ書式で混在する。どちらも数値のまま。
  const y = parseFundamentalsWithMeta('PER=14.2x | D/E=49.00x | 時価総額=$35892B')
  check('v1 と判定', y.format === 1)
  check('v1 の D/E=49.00x → 49（/100 しない）', near(y.data.debtToEquity, 49))
  check('v1 は legacy.debtToEquityUnitUnknown', y.legacy?.debtToEquityUnitUnknown === true)
  check('v1 の .T 銘柄に付いた $ は無視して数値だけ', near(y.data.marketCap, 35892e9, 1))

  const m = parseFundamentalsWithMeta('PER=14.8x | D/E=0.67x')
  check('v1 の D/E=0.67x → 0.67（×100 しない）', near(m.data.debtToEquity, 0.67))
  check('v1 の 0.67x にも同じ legacy フラグ', m.legacy?.debtToEquityUnitUnknown === true)

  check('v1 でも D/E が N/A なら legacy は付かない', parseFundamentalsWithMeta('PER=14.8x | D/E=N/A').legacy === undefined)
  check('v1 でも D/E トークンが無ければ legacy は付かない', parseFundamentalsWithMeta('PER=14.8x').legacy === undefined)
  check('空文字は v1・legacy なし', parseFundamentalsWithMeta('').format === 1 && parseFundamentalsWithMeta('').legacy === undefined)
  check('"-" は v1・data 空', Object.keys(parseFundamentalsWithMeta('-').data).length === 0)
}

if (failures > 0) {
  console.error(`\n${failures} 件 FAIL`)
  process.exit(1)
}
console.log('\nすべてPASS')
