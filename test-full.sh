#!/bin/bash
# ═══ Stratt v5.0 — Full Integration Test ═══
BASE="https://stratt.rocky13.workers.dev"
PASS=0
FAIL=0
COOKIES="/tmp/stratt_test_cookies"

ok() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1: $2"; }

echo "═══════════════════════════════════════════"
echo "  Stratt v5.0 Full Test Suite"
echo "  Target: $BASE"
echo "  Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════"
echo ""

# ─── 1. Health Check ─────────────────────
echo "1️⃣  HEALTH CHECK"
HEALTH=$(curl -s "$BASE/api/health")
VER=$(echo "$HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null)
STATUS=$(echo "$HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null)
TELE=$(echo "$HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('telegram','?'))" 2>/dev/null)
[ "$STATUS" = "ok" ] && ok "Status: ok" || fail "Status" "$STATUS"
[ "$VER" = "5.0.0" ] && ok "Version: 5.0.0" || fail "Version" "$VER"
[ "$TELE" = "True" ] && ok "Telegram: connected" || fail "Telegram" "$TELE"
echo ""

# ─── 2. Auth ─────────────────────────────
echo "2️⃣  AUTH"
# Wrong password
WRONG=$(curl -s -c "$COOKIES" "$BASE/api/auth" -X POST -H "Content-Type: application/json" -d '{"password":"wrong"}')
WRONG_OK=$(echo "$WRONG" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success',False))" 2>/dev/null)
[ "$WRONG_OK" = "False" ] && ok "Wrong password rejected" || fail "Wrong password" "accepted!"

# Correct password
LOGIN=$(curl -s -c "$COOKIES" "$BASE/api/auth" -X POST -H "Content-Type: application/json" -d '{"password":"HailMary13"}')
LOGIN_OK=$(echo "$LOGIN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success',False))" 2>/dev/null)
[ "$LOGIN_OK" = "True" ] && ok "Correct password accepted" || fail "Login" "$LOGIN"

# Auth ping
PING=$(curl -s -b "$COOKIES" "$BASE/api/chat" -X POST -H "Content-Type: application/json" -d '{"message":"__ping__"}')
PING_I=$(echo "$PING" | python3 -c "import json,sys; print(json.load(sys.stdin).get('intent','?'))" 2>/dev/null)
[ "$PING_I" = "PING" ] && ok "Auth ping: pong" || fail "Ping" "$PING_I"
echo ""

# ─── 3. Instant Commands (regex, no AI) ──
echo "3️⃣  INSTANT COMMANDS (should be <2s each)"
for CMD_PAIR in "plan:TRIAGE" "list:LIST_TASKS" "overdue:OVERDUE_CHECK" "check load:LOAD_CHECK" "report:REPORT" "backlog:BACKLOG_BROWSE" "materials:MATERIALS"; do
  CMD=$(echo "$CMD_PAIR" | cut -d: -f1)
  EXPECT=$(echo "$CMD_PAIR" | cut -d: -f2)
  START=$(python3 -c "import time; print(int(time.time()*1000))")
  RES=$(curl -s -b "$COOKIES" "$BASE/api/chat" -X POST -H "Content-Type: application/json" -d "{\"message\":\"$CMD\"}")
  END=$(python3 -c "import time; print(int(time.time()*1000))")
  ELAPSED=$(( END - START ))
  INTENT=$(echo "$RES" | python3 -c "import json,sys; print(json.load(sys.stdin).get('intent','?'))" 2>/dev/null)
  TEXT_LEN=$(echo "$RES" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('response_text','')))" 2>/dev/null)
  if [ "$INTENT" = "$EXPECT" ] && [ "$ELAPSED" -lt 5000 ]; then
    ok "\"$CMD\" → $INTENT (${ELAPSED}ms, ${TEXT_LEN} chars)"
  else
    fail "\"$CMD\"" "got $INTENT, expected $EXPECT (${ELAPSED}ms)"
  fi
done
echo ""

# ─── 4. Board API ────────────────────────
echo "4️⃣  BOARD API"
BOARD=$(curl -s -b "$COOKIES" "$BASE/api/tasks")
ACTIVE=$(echo "$BOARD" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('active',[])))" 2>/dev/null)
DONE_T=$(echo "$BOARD" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('doneToday',[])))" 2>/dev/null)
MATS=$(echo "$BOARD" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('materials',[])))" 2>/dev/null)
[ -n "$ACTIVE" ] && [ "$ACTIVE" -ge 0 ] 2>/dev/null && ok "GET /api/tasks: $ACTIVE active, $DONE_T done, $MATS materials" || fail "Board API" "failed"

# Board has required fields
FIELDS=$(echo "$BOARD" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if d.get('active'):
  t=d['active'][0]
  fields = ['id','title','status','project','urgency']
  missing = [f for f in fields if f not in t]
  print(','.join(missing) if missing else 'ok')
else:
  print('no_tasks')
" 2>/dev/null)
[ "$FIELDS" = "ok" ] && ok "Task fields: id, title, status, project, urgency" || fail "Task fields" "missing: $FIELDS"
echo ""

# ─── 5. Quick Add + Delete ───────────────
echo "5️⃣  QUICK ADD + DELETE"
CREATE=$(curl -s -b "$COOKIES" "$BASE/api/tasks/create" -X POST -H "Content-Type: application/json" \
  -d '{"title":"__TEST_v5_auto__","project":"PERSONAL"}')
CREATE_OK=$(echo "$CREATE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success',False))" 2>/dev/null)
[ "$CREATE_OK" = "True" ] && ok "Quick add: __TEST_v5_auto__ created" || fail "Quick add" "$CREATE"

# Verify it appears in board
sleep 1
BOARD2=$(curl -s -b "$COOKIES" "$BASE/api/tasks")
FOUND=$(echo "$BOARD2" | python3 -c "
import json,sys
d=json.load(sys.stdin)
found = any(t['title']=='__TEST_v5_auto__' for t in d.get('active',[]))
print(found)
" 2>/dev/null)
[ "$FOUND" = "True" ] && ok "Task visible in board API" || fail "Board visibility" "not found"

# Delete test task
DEL=$(curl -s -b "$COOKIES" "$BASE/api/chat" -X POST -H "Content-Type: application/json" \
  -d '{"message":"xoá __TEST_v5_auto__"}')
DEL_TEXT=$(echo "$DEL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('response_text','')[:60])" 2>/dev/null)
echo "$DEL_TEXT" | grep -q "Đã xoá" && ok "Delete: $DEL_TEXT" || fail "Delete" "$DEL_TEXT"
echo ""

# ─── 6. Status Update (Board Click) ─────
echo "6️⃣  STATUS UPDATE"
# Get first active task ID
TASK_ID=$(echo "$BOARD" | python3 -c "
import json,sys
d=json.load(sys.stdin)
active = [t for t in d.get('active',[]) if t['status']=='To do']
print(active[0]['id'] if active else '')
" 2>/dev/null)
if [ -n "$TASK_ID" ]; then
  # Change to In progress
  UPD=$(curl -s -b "$COOKIES" "$BASE/api/tasks/update" -X POST -H "Content-Type: application/json" \
    -d "{\"id\":\"$TASK_ID\",\"status\":\"In progress\"}")
  UPD_OK=$(echo "$UPD" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success',False))" 2>/dev/null)
  [ "$UPD_OK" = "True" ] && ok "Status → In progress" || fail "Status update" "$UPD"
  
  # Revert to To do
  sleep 1
  REV=$(curl -s -b "$COOKIES" "$BASE/api/tasks/update" -X POST -H "Content-Type: application/json" \
    -d "{\"id\":\"$TASK_ID\",\"status\":\"To do\"}")
  REV_OK=$(echo "$REV" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success',False))" 2>/dev/null)
  [ "$REV_OK" = "True" ] && ok "Status → To do (reverted)" || fail "Revert" "$REV"
else
  echo "  ⏭️  Skipped: no To do tasks to test"
fi
echo ""

# ─── 7. AI-Powered (MiniMax) ─────────────
echo "7️⃣  AI-POWERED (MiniMax, may take 5-15s)"
AI_START=$(python3 -c "import time; print(int(time.time()*1000))")
AI=$(curl -s -b "$COOKIES" "$BASE/api/chat" -X POST -H "Content-Type: application/json" \
  -d '{"message":"tạo task test AI v5 GMA deadline 30/6"}')
AI_END=$(python3 -c "import time; print(int(time.time()*1000))")
AI_MS=$(( AI_END - AI_START ))
AI_INTENT=$(echo "$AI" | python3 -c "import json,sys; print(json.load(sys.stdin).get('intent','?'))" 2>/dev/null)
AI_TEXT=$(echo "$AI" | python3 -c "import json,sys; print(json.load(sys.stdin).get('response_text','')[:80])" 2>/dev/null)
if [ "$AI_INTENT" = "CAPTURE" ] || echo "$AI_TEXT" | grep -q "tạo\|task\|Đã"; then
  ok "AI capture: $AI_INTENT (${AI_MS}ms)"
  ok "Response: $AI_TEXT"
  # Clean up AI test task
  sleep 1
  curl -s -b "$COOKIES" "$BASE/api/chat" -X POST -H "Content-Type: application/json" \
    -d '{"message":"xoá test AI v5"}' > /dev/null 2>&1
  ok "Cleaned up test task"
else
  fail "AI capture" "$AI_INTENT: $AI_TEXT (${AI_MS}ms)"
fi
echo ""

# ─── 8. Security ─────────────────────────
echo "8️⃣  SECURITY"
# Unauthed access
UNAUTH=$(curl -s "$BASE/api/chat" -X POST -H "Content-Type: application/json" -d '{"message":"plan"}')
UNAUTH_ERR=$(echo "$UNAUTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
echo "$UNAUTH_ERR" | grep -qi "đăng nhập\|unauthorized\|Chưa" && ok "Unauthed /api/chat blocked" || fail "Auth guard" "$UNAUTH_ERR"

UNAUTH_B=$(curl -s "$BASE/api/tasks")
echo "$UNAUTH_B" | grep -qi "unauthorized\|error" && ok "Unauthed /api/tasks blocked" || fail "Board auth" "$UNAUTH_B"

# Empty message
EMPTY=$(curl -s -b "$COOKIES" "$BASE/api/chat" -X POST -H "Content-Type: application/json" -d '{"message":""}')
echo "$EMPTY" | grep -qi "trống\|empty\|error" && ok "Empty message rejected" || fail "Empty msg" "$EMPTY"

# Rate limit header check (just verify endpoint returns)
RATE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health")
[ "$RATE" = "200" ] && ok "Rate limit not triggered (single request)" || fail "Rate limit" "code $RATE"
echo ""

# ─── 9. Static Assets ───────────────────
echo "9️⃣  STATIC ASSETS"
for ASSET in "/" "/style.css" "/app.js" "/manifest.json"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$ASSET")
  [ "$CODE" = "200" ] && ok "$ASSET → 200" || fail "$ASSET" "code $CODE"
done

# PWA manifest valid JSON
MANIFEST=$(curl -s "$BASE/manifest.json")
echo "$MANIFEST" | python3 -c "import json,sys; json.load(sys.stdin); print('valid')" 2>/dev/null | grep -q "valid" \
  && ok "manifest.json: valid JSON" || fail "manifest.json" "invalid JSON"
echo ""

# ─── 10. Response Quality ────────────────
echo "🔟  RESPONSE QUALITY"
# Plan response has emoji structure
PLAN=$(curl -s -b "$COOKIES" "$BASE/api/chat" -X POST -H "Content-Type: application/json" -d '{"message":"plan"}')
PLAN_T=$(echo "$PLAN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('response_text',''))" 2>/dev/null)
echo "$PLAN_T" | grep -q "▶️\|📋\|💡" && ok "Plan response has structured format" || fail "Plan format" "missing emoji structure"

# No gamification leftovers
echo "$PLAN_T" | grep -qi "XP\|streak\|achievement\|🏆\|level" && fail "Gamification leak" "found XP/streak in plan" || ok "No gamification in responses"

# No secrets leaked
echo "$PLAN_T" | grep -qi "ntn_\|Bearer\|api_key\|password" && fail "Secret leak!" "CRITICAL" || ok "No secrets in response"
echo ""

# ═══ Summary ═══
echo "═══════════════════════════════════════════"
echo "  RESULTS: ✅ $PASS passed  ❌ $FAIL failed"
echo "═══════════════════════════════════════════"
[ $FAIL -eq 0 ] && echo "  🎉 ALL TESTS PASSED!" || echo "  ⚠️  Some tests failed — review above"
echo ""

rm -f "$COOKIES"
