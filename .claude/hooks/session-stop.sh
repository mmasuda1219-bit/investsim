#!/usr/bin/env bash
# InvestSim 自動進捗記録 — Stop hook（応答が終わるたびに走る）
#
# 役割は2つ:
#   1) 毎ターン: .claude/SESSION_STATE.md に「今の現在地」を機械的に上書きする。
#      AIは呼ばないのでトークン消費ゼロ・待ち時間ほぼゼロ。
#   2) その日まだ PROGRESS.md に記録が無く、かつ実作業があった場合だけ、
#      exit 2 で親セッションを起こし「secretaryを呼んで日次記録を残せ」と伝える。
#
# 注意: iCloud上のリポジトリなので git は必ず --no-optional-locks で読む
#       （index.lock を作らせない＝並行gitとの競合を避ける）。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$ROOT/.claude/.state"
STATE_FILE="$ROOT/.claude/SESSION_STATE.md"
PROGRESS="$ROOT/PROGRESS.md"
mkdir -p "$STATE_DIR"

g() { git --no-optional-locks -C "$ROOT" "$@" 2>/dev/null; }

# jq が無い環境では状態ファイルがセッション間で混線するため、黙って何もしない
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat 2>/dev/null || true)"
SID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
[ -z "$SID" ] && SID="unknown-$PPID"
SID="${SID//[^a-zA-Z0-9_-]/_}"  # $STATE_DIR の外へ書き込ませない

NOW="$(date '+%Y-%m-%d %H:%M')"
TODAY="${INVESTSIM_HOOK_TODAY:-$(date '+%Y-%m-%d')}"  # 上書きは動作確認用
BRANCH="$(g rev-parse --abbrev-ref HEAD)"
PORCELAIN="$(g status --porcelain)"
CHANGED_COUNT="$(printf '%s' "$PORCELAIN" | grep -c . || true)"
HEAD_SHA="$(g rev-parse HEAD)"

# PROGRESS.md の最新エントリから「日付」と「次の一手」を引く（先頭のテンプレートは読み飛ばす）
LAST_ENTRY_DATE="$(awk '/^## 20/{print substr($0,4); exit}' "$PROGRESS" 2>/dev/null || true)"
LAST_NEXT="$(awk '/^## 20/{f=1} f && /^- \*\*次の一手\*\*/{print; exit}' "$PROGRESS" 2>/dev/null || true)"

# ---- 1) 現在地スナップショットを上書き ----
{
  echo "# 現在地スナップショット（自動生成・手で編集しない）"
  echo
  echo "> Stop hook が応答のたびに上書きします。日次の正式な記録は PROGRESS.md（秘書部門）です。"
  echo
  echo "- **更新時刻**: ${NOW}"
  echo "- **ブランチ**: ${BRANCH:-?}"
  echo "- **HEAD**: ${HEAD_SHA:0:7} $(g log -1 --pretty=%s)"
  echo "- **PROGRESS.md 最新エントリ**: ${LAST_ENTRY_DATE:-なし}"
  if [ -n "$LAST_NEXT" ]; then
    echo "- **前回宣言した次の一手**: ${LAST_NEXT#*: }"
  fi
  echo
  echo "## 直近のコミット5件"
  echo
  g log -5 --pretty='- `%h` %s (%ad)' --date=short
  echo
  echo "## 未コミットの変更（${CHANGED_COUNT}件）"
  echo
  if [ "${CHANGED_COUNT:-0}" -eq 0 ]; then
    echo "なし（作業ツリーはクリーン）"
  else
    echo '```'
    printf '%s\n' "$PORCELAIN"
    echo '```'
  fi
} > "$STATE_FILE.tmp.$$" && mv -f "$STATE_FILE.tmp.$$" "$STATE_FILE"  # 書きかけを読ませない
# .$$（プロセス固有）にするのは、並行セッションの Stop hook が同じ一時ファイル名を
# 奪い合い「mv: No such file or directory」で更新が落ちるのを防ぐため（2026-08-15に実発生）

# ---- 2) 日次記録が要るかの判定 ----
# 実作業の有無 = セッション開始時の指紋（作業ツリー＋HEAD）から変化したか
FINGERPRINT="$(printf '%s\n%s' "$PORCELAIN" "$HEAD_SHA" | shasum | cut -d' ' -f1)"
BASE_FILE="$STATE_DIR/baseline-$SID"
# 判定の足跡を残す（無言の劣化を検知できるようにする。.state配下なのでgit追跡外）
hlog() { printf '%s sid=%s %s\n' "$(date '+%m-%d %H:%M:%S')" "$SID" "$1" >> "$STATE_DIR/hook.log"; }

if [ ! -f "$BASE_FILE" ]; then
  # SessionStart hook が走っていない場合の保険。今回は比較対象がないので促さない。
  printf '%s' "$FINGERPRINT" > "$BASE_FILE"
  hlog "skip: baseline なし（今回作成）"
  exit 0
fi
BASELINE="$(cat "$BASE_FILE")"

# 今日ぶんの記録が既に PROGRESS.md にあるか
if grep -q "^## ${TODAY}\$" "$PROGRESS" 2>/dev/null; then hlog "skip: ${TODAY} は記録済み"; exit 0; fi
# このセッションで既に一度促していれば黙る（同じ促しを繰り返さない）
if [ -e "$STATE_DIR/nudged-$SID" ]; then hlog "skip: このセッションで促し済み"; exit 0; fi
# 何も変わっていなければ記録するものが無い
if [ "$FINGERPRINT" = "$BASELINE" ]; then hlog "skip: 変化なし"; exit 0; fi

# 促す権利をアトミックに取る。mkdir は既存なら失敗するのでテスト&セットとして使える。
# 上の -e チェックだけでは、同一セッションの Stop hook が同時に2つ走ったとき
# 両方がチェックを通過して二重に促す（2026-08-15に実発生）。
if ! mkdir "$STATE_DIR/nudged-$SID" 2>/dev/null; then
  hlog "skip: 促し済み（同時実行のレースを回避）"
  exit 0
fi
hlog "NUDGE: exit 2 で促した（${TODAY} 未記録・変化あり）"
MSG="【自動進捗記録】本日 ${TODAY} ぶんの記録がまだ PROGRESS.md にありません。セッション開始時点から作業ツリーまたはHEADに変化を検知しています。
オーナーの常設指示（毎回の作業を自動で記録する）に基づき、secretary サブエージェントを呼んで PROGRESS.md に ${TODAY} の日次エントリを1件追記してください。日付 ${TODAY} を渡すこと。
記録が済んだら、そのまま作業を続けてください（このメッセージの確認をオーナーに求める必要はありません）。"
# exit 2 でモデルに渡るのは stderr。stdout はトランスクリプト表示用だが、
# 実装差でどちらが読まれても届くよう両方へ出す。
printf '%s\n' "$MSG" >&2
printf '%s\n' "$MSG"
exit 2
