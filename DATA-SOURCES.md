# データ源台帳（銘柄ユニバース拡大 × ファンダメンタル材料）

> 目的: `lib/market/us-universe.ts` の**ハードコード104銘柄**から先へ進むための、実在ソースの在庫表。
> 調査日: 2026-09-03。**「実測」列に○が付いた行は、当日実際にHTTPを叩いて応答を確認したもの**。
> 原則9（過去データは必ず実データ）に従い、ここには「取れるはず」の推測は書かない。取れなかったものは✕で残す。
> これは調査結果であり決定ではない。採用は人間ゲート①（オーナーの計画承認）を通す。

---

## 0. 要約（先に結論）

1. **銘柄リストは無料で全部取れる。** SECの `company_tickers_exchange.json` で米国上場 **10,412件**（Nasdaq 4,372 / NYSE 3,300 / OTC 2,497 / CBOE 35）がキー不要・1リクエスト。
2. **ファンダも無料で全市場ぶん取れる。** SECのXBRL frames APIは「1指標 × 全提出者」が1リクエスト。実測で純利益 **5,633社**・総資産 **6,131社**・営業CF **5,731社** が各1回で返る。
3. **今のボトルネックは「リクエスト数」ではなくなる。** Yahooの `quote()` は配列を受けるので、実測で **1,500銘柄を1リクエスト・1.4秒**。現行実装は1銘柄ずつ（`REFRESH_BATCH=6` ／日54件／104銘柄で約2日かけて一巡）。
4. **`FundamentalsData` の19項目中18項目は、追加課金ゼロで全市場スケールに載せられる**（§4の対応表）。載らないのは `pegRatio` だけ（将来EPS予想が要るため無料源が無い）。
5. **投資家シミュレーターの核に直撃する材料がある。** SEC 13F-HRでバフェットの**実際の保有**が無料で取れる（バークシャー 2026-06-30基準・2026-08-14提出・89行を実測取得）。

---

## 1. 銘柄リスト（ユニバース名簿）の入手先

| ソース | URL | キー | 中身（実測値） | 実測 |
|---|---|---|---|---|
| **SEC ticker↔exchange** | `https://www.sec.gov/files/company_tickers_exchange.json` | 不要 | **10,412行** `cik,name,ticker,exchange`。Nasdaq 4,372 / NYSE 3,300 / OTC 2,497 / CBOE 35 / null 208。522KB | ○ 200 |
| **Nasdaq Trader（Nasdaq上場）** | `https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt` | 不要 | **5,594件**。`Symbol｜Security Name｜Market Category｜Test Issue｜Financial Status｜Round Lot｜ETF｜NextShares`。末尾に `File Creation Time: 09/03/2026 12:11` | ○ 200 |
| **Nasdaq Trader（その他取引所）** | `https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt` | 不要 | **7,593件**。NYSE(N) 2,933 / NYSE Arca(P) 2,728 / Cboe BZX(Z) 1,616 / NYSE American(A) 312 / IEX(V) 3 / (M) 1。うち ETF=Y **4,397件** | ○ 200 |
| **Nasdaq screener API（非公式）** | `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true` | 不要 | **7,102行**を1リクエスト（2.2MB）。`symbol,name,lastsale,marketCap,country,ipoyear,volume,sector,industry`。時価総額>0が **5,805件** | ○ 200 |
| **Yahoo `quote()` バッチ** | 導入済み `yahoo-finance2@3.14.2` | 不要 | **1,500銘柄を1リクエスト／1,365ms**（500件→762ms、1,000件→2,830ms も実測） | ○ 実測 |
| J-Quants（日本株マスタ） | `https://api.jquants.com/v2/equities/master` | `JQUANTS_API_KEY`（設定済み） | `Code,CoName,CoNameEn,S17,S33,ScaleCat,Mkt,Mrgn,ProdCat`。※無料プランで叩けるかは公式仕様書に明記が無く**未確認** | △ 未実行 |
| iShares IVV 構成銘柄CSV | `ishares.com/.../1467271812596.ajax?fileType=csv` | 不要 | **HTMLが返る**（ajax IDが陳腐化）。現状そのままでは使えない | ✕ |
| JPX 東証上場銘柄一覧 `data_j.xls` | 旧 `misc/tvdivq0000001vg2-att/` | 不要 | **404**。配布パスが変わっている。使うなら現行URLの再特定が要る | ✕ |

### 時価総額でどこまで絞るか（Nasdaq screener 実測・5,805社ベース）

| 下限 | 該当数 | 位置づけ |
|---|---|---|
| $1兆 | 16 | 現ユニバースの中核と重複 |
| $2,000億 | 81 | 「超有名株」だけ |
| **$100億** | **990** | 日本の個人が米国株で触る範囲をほぼ網羅 |
| $20億 | 2,221 | 中小型まで拡張 |
| $3億 | 3,738 | ここから先は流動性・開示品質が急落 |

---

## 2. ファンダメンタル材料の入手先

| ソース | 取れるもの | 規模あたりのコスト | キー | 実測 |
|---|---|---|---|---|
| **SEC XBRL frames** `data.sec.gov/api/xbrl/frames/{taxonomy}/{concept}/{unit}/{period}.json` | **1指標 × 全提出者を1リクエスト**。決算の生値（売上・利益・資産・資本・CF…） | 指標1つ＝1リクエスト。**ユニバースが何銘柄でも変わらない** | 不要（UA必須） | ○ |
| **SEC companyfacts（個社）** `data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | 1社の全XBRL事実・全期間 | 1社1リクエスト | 不要 | ○ |
| **SEC 一括ZIP** `sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip` | 上記の全社ぶん | **1.41GB**・毎晩05:07 UTC更新（`submissions.zip` は1.56GB） | 不要 | ○ HEAD |
| **Yahoo `quote()` バッチ** | `pe, pb, marketCap, eps, forwardPE, 52週高安, bookValue, dividendYield` | **1,500銘柄/1リクエスト** | 不要 | ○ |
| Yahoo `quoteSummary`（現行実装） | `roe, roa, 各マージン, debtToEquity, currentRatio, revenueGrowth, earningsGrowth, freeCashflow, peg, evToEbitda` | 1銘柄1リクエスト | 不要 | 既存 |
| **SEC 13F-HR** | 著名投資家の**実際の保有銘柄**（CUSIP・時価・株数） | 1ファイル1リクエスト | 不要 | ○ |
| SEC Form 13F Data Sets（DERA） | 13Fを四半期ごとにフラット化した公式配布 | 四半期1ファイル | 不要 | △ 未取得 |
| **OpenFIGI** `api.openfigi.com/v3/mapping` | **CUSIP → ティッカー**（13Fに必須） | キー無しで25req/分・1req最大10件 | 不要 | ○ |
| EDINET API v2 | 日本のXBRL（`type=5` でCSV変換済み） | 書類1件1リクエスト | メール登録で無料 | △ 未実行 |
| Twelve Data | 米国株フェイルオーバー（設定済み） | 8req/分・800req/日 | 設定済み | 既存 |

### SEC frames の実測カバレッジ（1リクエストあたりの社数）

| 概念 | 期間 | 社数 |
|---|---|---|
| `us-gaap/Assets` | CY2025Q4I | **6,131** |
| `us-gaap/StockholdersEquity` | CY2025Q4I | **5,734** |
| `us-gaap/NetCashProvidedByUsedInOperatingActivities` | CY2025 | **5,731** |
| `us-gaap/NetIncomeLoss` | CY2025 | **5,633** |
| `us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax` | CY2025 | **2,692** |
| `us-gaap/Revenues` | CY2025 | **2,223** |
| `dei/EntityCommonStockSharesOutstanding` | CY2025Q4I | **2,637** |

---

## 3. 13F ＝「著名投資家シミュレーター」に直撃する材料

実測（バークシャー・ハサウェイ CIK 0001067983）:

- `data.sec.gov/submissions/CIK0001067983.json` → 13F-HR の提出履歴。直近4本は
  **2026-06-30期（2026-08-14提出）／2026-03-31期／2025-12-31期／2025-09-30期**。
- 明細は同ファイリング配下の情報表XML（例 `.../000119312526352200/56757.xml`、44KB）。
  **89件の `<infoTable>`** に `nameOfIssuer / cusip / value / sshPrnamt` が入る。
  先頭は `ALLY FINL INC / 02005N100 / $577,211,815 / 12,561,737株`。
- CUSIP→ティッカーは OpenFIGI で解決（実測 `02005N100 → ALLY`、`037833100 → AAPL`）。

**これが効く理由**: 今の投資家モデル（`lib/backtest/investor-presets.ts`）は「言語化した信念 → 実在ファンダへの近似写像」で、そのギャップを `approximationNotes` に正直注記している。13Fは近似ではなく**本人の実際の行動**なので、「モデルの推奨」と「本人が実際に持っている銘柄」を突き合わせられる。原則11（人間の投資スキル向上）の教材として、近似の弁明よりはるかに強い。

**正直に書かねばならない制約**:
- 四半期末基準・提出まで最大45日の遅延。「今の保有」ではない。
- 米国上場のロング株式のみ。空売り・現金・債券・海外株は写らない。
- 運用資産1億ドル超の機関のみが提出義務。

---

## 4. `FundamentalsData` 19項目 × 調達可能性

| 項目 | 調達 | 手段 |
|---|---|---|
| `pe` `pb` `eps` `marketCap` `dividendYield` `week52High` `week52Low` | ○ 全市場 | Yahoo `quote()` バッチ（1,500件/req） |
| `roe` | ○ 全市場 | SEC: `NetIncomeLoss ÷ StockholdersEquity` |
| `roa` | ○ 全市場 | SEC: `NetIncomeLoss ÷ Assets` |
| `profitMargin` | ○ 全市場 | SEC: `NetIncomeLoss ÷ 売上` |
| `operatingMargin` | ○ 全市場 | SEC: `OperatingIncomeLoss ÷ 売上` |
| `grossMargin` | ○ 全市場 | SEC: `GrossProfit ÷ 売上` |
| `freeCashflow` | ○ 全市場 | SEC: `営業CF + CapEx` |
| `debtToEquity` | ○ 全市場 | SEC: 負債 ÷ `StockholdersEquity` |
| `currentRatio` | ○ 全市場 | SEC: `AssetsCurrent ÷ LiabilitiesCurrent` |
| `revenueGrowth` `earningsGrowth` | ○ 全市場 | SEC: CY2025 frame と CY2024 frame の差分 |
| `evToEbitda` | ○ 全市場（合成） | 時価総額(Yahoo) ＋ 有利子負債 − 現金(SEC) ÷ EBITDA(SEC) |
| **`pegRatio`** | **✕** | 将来EPS予想が必要。無料源が無い。**取れない項目として空のまま残す**（原則9） |

---

## 4.5 「SEC自前計算」と「Yahoo既製比率」のズレ — 実測（2026-09-03・米国大型株47銘柄）

同じ会社の同じ指標を、Yahoo の既製値と SEC の生値からの自前計算で突き合わせた結果。

### 乖離の大きさ（絶対値の中央値）

| 指標 | 中央値 | 最大 | 評価 |
|---|---|---|---|
| 流動比率 | **7%** | ±26% | 許容 |
| 純利益率 | **9%** | ±40% | 許容 |
| ROE | **15%** | ±46% | 要注意 |
| D/E | **150%** | +342% | **バグ。定義違い** |

### ズレの正体は3つで、許容度がまったく違う

1. **期ズレ（許容・ただし明示が必要）** — Yahooは直近12ヶ月(TTM)、SEC framesは暦年CY2025。決算期が9月・3月の会社ほど離れる。ROE・純利益率の中央値10%前後はほぼこれ。**どちらの期間基準かをUIに書けば済む**。
2. **定義違い（許容できない＝直す）** — D/Eの150%は「Yahoo＝有利子負債÷資本」に対し「自前＝**総負債**÷資本」を当てた結果で、データの問題ではなく実装の誤り。`LiabilitiesCurrent` ではなく有利子負債のタグを使えば消える。
3. **分母がゼロ・マイナス（除外すべき）** — MCD の ROE が **−478%** になったのは自己資本がマイナスだから。Yahooは値を出さない。サンプル47件中 LOW・MCD・SBUX・ABBV の4社が該当。**比率を計算せず欠損として扱う**のが正しい（原則9）。

### 「どれくらいなら問題ないか」の答え＝判定が変わらないこと

このアプリでファンダを使う場所はスクリーニング＝**順位と足切り**なので、%の乖離そのものではなく「合否が入れ替わるか」が基準になる。実測（両方に値がある銘柄のみ比較・fail-closed）:

| 条件 | 比較可能 | 判定不一致 |
|---|---|---|
| ROE ≥ 15% | 34件 | **2件（6%）** |
| ROE ≥ 20% | 34件 | **2件（6%）** |
| 純利益率 ≥ 10% | 45件 | **4件（9%）** |
| 純利益率 ≥ 20% | 45件 | **4件（9%）** |
| 流動比率 ≥ 1.5 | 44件 | **3件（7%）** |
| 流動比率 ≥ 1.0 | 44件 | **5件（11%）** |

不一致の中身は2種類しかなかった:
- **閾値ちょうどの境界銘柄**（INTU 1.5 vs 1.3、PEP 10.8% vs 8.8% など）。どちらが正しいかではなく、そもそも境界上の1件を断定してはいけない領域。
- **異常値1社（MRK）**: ROE 7.0% vs 34.7%、純利益率 4.8% vs 28.1%。TTMに一時的な大型費用が入っている典型。**47件中1件だけが全指標で外れる**という形なので、外れ値として検出できる。

**結論**: **判定不一致 6〜11% は、単一ソースに寄せる根拠として十分**。ただしそれは次の3つを守った場合に限る。

1. 期間基準（TTM か 暦年か）を1つに決め、画面に明示する。混ぜない。
2. 自己資本がマイナス・分母が0の銘柄は比率を計算せず**欠損**にする。
3. 閾値ぴったりの銘柄を「条件を満たす／満たさない」と**断定しない**（既存の `approximationNotes` と同じ扱いで、境界であることを見せる）。

逆に**やってはいけないのは、YahooとSECを指標ごとに混ぜること**。ROEはYahoo・純利益率はSECのように混ぜると、同じ銘柄の中で期間基準が食い違い、上の3つを守っても説明できない数字になる。

---

## 5. 採用時に必ず守る制約（実測で確認した落とし穴）

1. **SECはUser-Agent必須・10req/秒上限。** 公式文言は「10 requests/second」「declare your user agent in request headers」「The SEC does not allow botnets or automated tools to crawl the site」。名乗らないと弾かれる。
2. **売上のXBRLタグは1本ではない。** `Revenues`（2,223社）と `RevenueFromContractWithCustomerExcludingAssessedTax`（2,692社）に割れている。フォールバック連鎖が要る。**どのタグにも当たらなかった銘柄は、その項目を欠損のまま残す**（推定値で埋めない＝原則9）。
3. **frames の「CY2025」は決算期がズレた会社も含む。** 実測でエア・プロダクツは `start 2024-10-01 / end 2025-09-30` の値がCY2025枠に入っていた。SEC側が暦年に寄せる正規化であり、**近似であることをUIで明示**する必要がある（`approximationNotes` と同じ扱い）。
4. **Yahooバッチは本番IPでは使えない可能性が高い。** VercelのIPからのYahooは恒常429（DECISIONS 2026-07-16 ／ `.env.example` に記載済み）。**バッチはローカルのseedスクリプトかGitHub Actionsランナーで回す**のが前提。ただしリクエスト数が数千→数本になるので、レート制限下でも成立する。
5. **Nasdaq screener API は非公式。** 壊れうる。安定版が要るなら Nasdaq Trader の `.txt` 2本（公式）を正とし、screener APIは時価総額の付加情報に留める。
6. **OTC 2,497件は外す。** 流動性・開示品質が落ち、原則11（利用者のスキル向上）の教材として害のほうが大きい。`nasdaqlisted.txt` の `Test Issue` フラグと `otherlisted.txt` の `ETF=Y`（4,397件）も除外対象。
7. **OpenFIGIはキー無しで25req/分（1req最大10件）。** 13Fの89銘柄なら9リクエスト＝1分未満。ユニバース全体のCUSIP解決をやるなら要キー。

---

## 6. 次に決めること（オーナー判断）

- **ユニバースの規模**: 104 → 990（時価総額$100億以上）／2,221（$20億以上）／3,738（$3億以上）のどれか。
- **ファンダの一次ソースをSECに寄せるか**: 寄せると全市場ぶんが数リクエストで済み、かつ「決算書の生値」なので出典が明確になる。ただし比率は自前計算になり、Yahooの既製比率との**数値のズレが必ず出る**（会計タグの選び方の差）。どちらを正とするかは決めておく必要がある。
- **13Fを機能として出すか**: 出すなら「四半期末・最大45日遅延・ロング株式のみ」の注記をUIに常設する前提。

---

## 参照

- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC Accessing EDGAR Data（レート制限・UA規定）](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [SEC Form 13F Data Sets](https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets)
- [Nasdaq Trader Symbol Directory 定義](https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs)
- [J-Quants API Reference（equities master）](https://jpx-jquants.com/ja/spec/eq-master)
- [EDINET API 仕様書 Version 2（2026年6月）](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/download/ESE140206.pdf)
