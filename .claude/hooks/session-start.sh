#!/usr/bin/env bash
# InvestSim 自動進捗記録 — SessionStart hook（セッション開始時に走る）
#
# 役割は2つ:
#   1) 「セッション開始時点の指紋」を保存する。Stop hook はこれと比べて
#      “このセッションで実作業があったか” を判定する。
#   2) 前回までの現在地（.claude/SESSION_STATE.md）と PROGRESS.md の最新エントリを
#      コンテキストに流し込み、ゼロから状況を聞き直さずに続きを始められるようにする。
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

printf '%s' "$(printf '%s\n%s' "$(g status --porcelain)" "$(g rev-parse HEAD)" | shasum | cut -d' ' -f1)" \
  > "$STATE_DIR/baseline-$SID"

# 7日より古い state ファイルを掃除（セッションIDごとに溜まるため）
find "$STATE_DIR" -type f -mtime +7 -delete 2>/dev/null || true

CTX=""
if [ -f "$STATE_FILE" ]; then
  CTX="前回セッション終了時点の現在地スナップショット（.claude/SESSION_STATE.md より自動注入）:

$(cat "$STATE_FILE")
"
fi
if [ -f "$PROGRESS" ]; then
  # 最新エントリ1件だけ（PROGRESS.md はエントリ間に区切り線が無いので見出しの出現回数で切る）
  LATEST="$(awk '/^## 20/{c++} c==1{print} c==2{exit}' "$PROGRESS" 2>/dev/null | head -40)"
  if [ -n "$LATEST" ]; then
    CTX="${CTX}
PROGRESS.md の最新エントリ（秘書部門の日次記録）:

${LATEST}
"
  fi
fi

[ -z "$CTX" ] && exit 0

jq -nc --arg ctx "$CTX" \
  '{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:$ctx}}'
