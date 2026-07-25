# InvestSim 投資知識ベース

> scout（知識開拓部門）が専有して書き込む。YouTube・ニュース・書籍などから開拓した投資知識を蒸留・蓄積し、investsimの改善につなげる。
> 1トピック=1エントリ。フォーマット: 日付 / トピック / 出典URL / 要点 / investsimへの示唆。
> researcher（API/技術仕様）・strategist（投資家モデル設計）・secretary（日次進捗=PROGRESS.md）とは役割を分ける。

---

<!-- 例:
## 2026-07-24: <トピック>
- 出典: <URL>
- 要点: <箇条書き>
- investsimへの示唆: <どの機能に・なぜ・どう活かすか>
-->

## 2026-07-24: バフェットの投資哲学（能力の輪・経済的な堀・質重視）
- 出典: https://www.trustnet.com/investing/13445205/warren-buffetts-investment-philosophy-lessons-for-every-investor / https://www.kavout.com/market-lens/buffetts-investment-principles-navigating-market-mania-with-strategic-wisdom
- 要点:
  - 能力の輪（circle of competence）: 理解できるビジネスにのみ投資。分からない領域は避けることで認知バイアスと不要なリスクを排除。
  - 経済的な堀（economic moat）: 持続的な競争優位。ブランド（コカ・コーラ）、スイッチングコスト（企業向けSW）、ネットワーク効果（アメックス）、コスト優位（Geico）、規制障壁の5類型。
  - 質重視: 「素晴らしい企業を適正価格で買う方が、平凡な企業を格安で買うより遥かに良い」。安定収益・高ROE・低負債・優れた資本配分の経営を選ぶ。
  - 哲学は不変だが対象は進化: かつて技術株を避けたがAppleは「強い顧客ロイヤリティと堅牢なキャッシュフローを持つ消費者ブランド」と位置づけ保有。
- investsimへの示唆:
  - `lib/investors/` のバフェットモデルに「堀の5類型」を明示的な評価軸として持たせ、判断根拠（/reportの根拠欄）で「どの堀に該当するか」を必ず言語化させると信念と実装の一貫性が上がる。
  - AIセッションで銘柄がバフェットの「能力の輪」外（例: 難解なバイオ・投機的テーマ株）なら見送る、という抑制ロジックを入れると人格の再現性が増す。

## 2026-07-24: グレアムの安全域・ミスターマーケット・内在価値
- 出典: https://www.trustnet.com/investing/13430888/the-take-home-points-of-benjamin-grahams-the-intelligent-investor / https://pictureperfectportfolios.com/how-to-invest-like-benjamin-graham-the-intelligent-investor/
- 要点:
  - 安全域（margin of safety）: 投資の中心概念。保守的に見積もった内在価値より「意味のある幅」で安く買う。$50の価値の株を$30で買えば$20が誤差・不運への緩衝材。
  - 内在価値 vs 価格: 「価格は払うもの、価値は所有するもの」。市場価格と内在的価値はたまにしか一致しない。収益・資産・配当・財務健全性から算定。
  - ミスターマーケット: 躁うつの取引相手。毎日変動する売買価格を提示するが、あなたに「仕える」のであり「指図する」のではない。極端な時だけ利用し、普段は無視してよい。
  - ディフェンシブ投資家 vs エンタープライジング投資家: 前者は重大ミスの回避と手間の少なさを優先（高格付債＋優良株を50/50〜75/25）。後者は労力をかけ平均超のリターンを狙う。
- investsimへの示唆:
  - グレアムモデルの売買判断に「内在価値の保守推定 − 現在値」＝安全域%を数値化し、閾値（例: 30%以上の割安）を満たさなければ買わない設計にすると、人格が定量的に効く。
  - ミスターマーケットの発想は「相場のボラティリティ／センチメントを機会として扱う」学習メモリの教訓として活用可能（狼狽売り局面での逆張り是非を教訓化）。

## 2026-07-24: リンチの「知っているものに投資」・PEG・6分類・テンバガー
- 出典: https://pictureperfectportfolios.com/peter-lynch-six-stock-categories/ / https://www.supermoney.com/encyclopedia/peter-lynch
- 要点:
  - 「知っているものに投資（invest in what you know）」: 日常で出会う企業から着想を得て、必ず裏付けリサーチで検証。
  - PEGレシオ: 適正株価はPER≒利益成長率。成長20%ならPER20が適正（PEG=1.0）。テンバガー候補はPEG<1.0を要求（成長と割安の両立が複利の条件）。
  - 6分類: 低成長株（配当安全性・payout重視）／優良株stalwarts（年10-12%成長、割安買いで30-50%狙い、"diworseification"に警戒）／急成長株fast growers（年20-25%、小型で高リスク高リターン、ユニットエコノミクスと財務健全性が鍵）／景気循環株cyclicals（サイクルと在庫規律）／再生株turnarounds／資産株asset plays。
  - テンバガー: 10倍（+1,000%）銘柄。急成長株と優良株が長期複利の中核、循環・再生・資産株は機会的な上乗せ。
- investsimへの示唆:
  - リンチモデルに「6分類タグ付け」ステップを入れ、銘柄を分類してから分類ごとに異なる評価基準（PEG／payout／サイクル位置）を適用すると、単一ルールより人格が濃くなる。
  - スクリーナー/AIセッションで PEG<1.0 かつ成長カテゴリという複合フィルタを提供すると「リンチ流の探索」体験になる。

## 2026-07-24: ソロスの再帰性（reflexivity）とブーム・バスト
- 出典: https://finimize.com/content/how-use-theory-made-george-soros-investing-legend / https://macro-ops.com/understanding-george-soross-theory-of-reflexivity-in-markets/ / https://www.georgesoros.com/2014/01/13/fallibility-reflexivity-and-the-human-uncertainty-principle-2/
- 要点:
  - 再帰性: 投資家の認識が現実（ファンダ）に影響し、その現実が再び認識を変えるフィードバックループ。市場は均衡に向かわず自己強化する。
  - 認知機能（現実→認識）と参加機能（認識→行動→現実の変化）の双方向。認識は常に不完全でバイアスを持つ（可謬性 fallibility）。
  - ブーム・バスト: バブルは「現実のトレンド」＋「そのトレンドに関する誤解」で構成。両者に正のフィードバックが生じると自己強化的な上昇→崩壊が起こる。
  - 可謬性の原則: 市場は常に現実を歪めて映す。価格はしばしばファンダから大きく乖離する。
- investsimへの示唆:
  - ソロスモデルはバフェット/グレアムと対極の「トレンドフォロー＋転換点狙い」人格として設計価値が高い。モメンタムと乖離（価格 vs ファンダ）の両方を見て、乖離が極大化した局面で逆張り、という判断軸を実装。
  - AIセッションの市場観コメントに「今はブームのどの段階か（誤解が自己強化中か、転換が近いか）」の視点を持たせると、単なる指標読みより深いナラティブになる。

## 2026-07-24: ダリオのオールウェザーと経済の4レジーム
- 出典: https://www.optimizedportfolio.com/all-weather-portfolio/ / https://portfolioslab.com/portfolio/ray-dalio-all-weather / https://marketxls.com/blog/all-weather-portfolio-dashboard-excel-june-2026-ray-dalio-allocation-tracker
- 要点:
  - オールウェザー配分（公開版）: 株30% / 長期米国債40% / 中期米国債15% / 金7.5% / 商品7.5%。どの経済環境でも大きなドローダウンを避ける設計。
  - 4レジーム: 市場は「成長（上/下）」×「インフレ（上/下）」の2軸で4つの経済の季節に分かれ、各資産クラスは季節ごとに異なる振る舞いをする。バランスさせて特定レジームでの過大な下落を防ぐ。
  - 経済の機械（economic machine）: Bridgewaterは景気サイクルの分析を重視。
  - 2026年時点: 7/20時点でYTD +4.31%、過去10年年率+5.43%。Fedは一時停止モード、金は最高値圏、長期金利は利下げサイクルを消化中。
- investsimへの示唆:
  - ダリオモデルは個別株ピッカーではなく「レジーム判定→資産配分」型。現在のマクロ（成長/インフレの方向）を推定し、レジームに応じて株/債券/金/商品の傾斜を変える人格として実装すると他4人と差別化できる。
  - AIセッションに「現在のレジーム推定」を表示する共通コンポーネントを作れば、全モデルの判断コンテキストとして再利用可能。

## 2026-07-24: 2026年のマクロ主要テーマ（AI設備投資・利下げ・ドル安・分断）
- 出典: https://www.bloomberg.com/graphics/2026-investment-outlooks/ / https://www.morganstanley.com/insights/articles/ai-market-trends-institute-2026 / https://www.jpmorgan.com/insights/global-research/outlook/mid-year-outlook
- 要点:
  - AI設備投資が2026年の株式市場の「定義的テーマ」。米ビッグテック投資は2025年に約+60%、2026年はさらに+50%で$6,000億超、売上比capex intensityは約23%へ。Morgan Stanleyは2028年までに約$3兆のAIインフラ投資が流れ、その8割超がまだ先と推計。
  - 市場は「AIセクター」と「非AIセクター」に二極化。米経済は堅調なcapexと軟調な労働需要、家計消費の格差拡大が併存。
  - 金融政策: Fedは中立に向けた利下げ継続が主流見通しだが、JPMは「2026年は利下げなし」の非コンセンサス見解。見方が割れる。
  - その他テーマ: グローバル分断、ドル安、Fedの独立性、Tech Diffusion/エネルギーの未来/多極世界/社会変化（Morgan Stanleyの4テーマ）。AI投資は最大の成長ドライバーであると同時に市場の最大の依存リスク。
- investsimへの示唆:
  - AIセッションの市場観・ニュース総合判断に「AI capexサイクルの現在地」と「二極化（AI vs 非AI）」を織り込むと2026年の相場観がリアルになる。
  - リスク面: AI依存の集中リスクを教訓メモリに登録し、AI関連銘柄への過度な傾斜をモデルが自省できるようにする。
  - マクロは見方が割れる（利下げ有無）ため、モデルに「単一シナリオ断定を避け、シナリオ別の対応」を促すプロンプト設計が有効。

## 2026-07-24: 品質×バリューのスクリーニング（Piotroski F-score・Greenblatt Magic Formula）
- 出典: https://en.wikipedia.org/wiki/Piotroski_F-score / https://www.quant-investing.com/blog/piotroski-f-score-complete-guide / https://www.validea.com/definitions/piotroski-f-score
- 要点:
  - Piotroski F-score: 0〜9の会計スコアカード（Piotroski 2000）。収益性・レバレッジ/流動性・営業効率の9項目で財務の強さを採点し、割安株の中から「バリュートラップ」を除外。F≥7の企業群はサイズ調整後で年平均+5.5%のリターン。当初はバリュー株フィルタ用だがグラマー株の除外にも有効。
  - Greenblatt Magic Formula: 益回り（earnings yield）とROC（資本利益率）で銘柄をランク付け。安くて質の高い企業を機械的に抽出。
  - ハイブリッド: Magic Formulaのランキングに F-score≥7 のフィルタを重ねると財務最弱の企業を除け、品質×バリューのより堅牢なスクリーニングになる。
- investsimへの示唆:
  - スクリーナー/screen APIに「F-scoreの近似」「益回り＋ROCランク」を実データファンダから計算する指標として追加すれば、グレアム/バフェット系モデルの定量的裏付けになる（既存のファンダキャッシュ土台 S5c-1 を活用）。
  - AIセッションのファンダ判断に「バリュートラップ回避チェック（財務が改善しているか）」の一項目を入れると、単なる割安買いの失敗を学習ループで減らせる。
