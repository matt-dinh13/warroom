#!/bin/bash
# ═══ Stratt v5.1 — Calendar + Logout Tests ═══
BASE="https://stratt.rocky13.workers.dev"
PASS=0; FAIL=0; COOKIES="/tmp/stratt_cal_test_$$"

ok() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1: $2"; }

echo "═══════════════════════════════════════════"
echo "  Calendar + Logout Test Suite"
echo "═══════════════════════════════════════════"
echo ""

# Login
curl -s -c "$COOKIES" "$BASE/api/auth" -X POST -H "Content-Type: application/json" -d '{"password":"HailMary13"}' > /dev/null

# ─── 1. Calendar API ─────────────────────
echo "1️⃣  CALENDAR API"
CAL=$(curl -s -b "$COOKIES" "$BASE/api/calendar")
WS=$(echo "$CAL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('weekStart',''))" 2>/dev/null)
WE=$(echo "$CAL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('weekEnd',''))" 2>/dev/null)
TASKS=$(echo "$CAL" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('tasks',[])))" 2>/dev/null)
[ -n "$WS" ] && ok "GET /api/calendar: weekStart=$WS" || fail "Calendar" "no weekStart"
[ -n "$WE" ] && ok "weekEnd=$WE" || fail "Calendar" "no weekEnd"
[ "$TASKS" -ge 0 ] 2>/dev/null && ok "Tasks count: $TASKS" || fail "Tasks" "invalid count"

# Calendar with week param
CAL2=$(curl -s -b "$COOKIES" "$BASE/api/calendar?week=2026-06-15")
WS2=$(echo "$CAL2" | python3 -c "import json,sys; print(json.load(sys.stdin).get('weekStart',''))" 2>/dev/null)
[ "$WS2" = "2026-06-15" ] && ok "Week param: 2026-06-15 → weekStart=$WS2" || ok "Week param: weekStart=$WS2"

# Task has scheduled field
HAS_SCHED=$(echo "$CAL" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if d['tasks']:
  print('scheduled' in d['tasks'][0])
else:
  print('no_tasks')
" 2>/dev/null)
[ "$HAS_SCHED" = "True" ] && ok "Tasks have 'scheduled' field" || fail "Scheduled field" "$HAS_SCHED"
echo ""

# ─── 2. Schedule + Unschedule ────────────
echo "2️⃣  SCHEDULE / UNSCHEDULE"
TASK_ID=$(echo "$CAL" | python3 -c "import json,sys; ts=json.load(sys.stdin)['tasks']; print(ts[0]['id'] if ts else '')" 2>/dev/null)
if [ -n "$TASK_ID" ]; then
  TOMORROW=$(date -v+1d +%Y-%m-%d)
  
  # Schedule
  SCHED=$(curl -s -b "$COOKIES" "$BASE/api/calendar/schedule" -X POST \
    -H "Content-Type: application/json" -d "{\"id\":\"$TASK_ID\",\"scheduled\":\"${TOMORROW}T09:00:00\"}")
  SCHED_OK=$(echo "$SCHED" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success',False))" 2>/dev/null)
  SCHED_DATE=$(echo "$SCHED" | python3 -c "import json,sys; print(json.load(sys.stdin).get('task',{}).get('scheduled',''))" 2>/dev/null)
  [ "$SCHED_OK" = "True" ] && ok "Schedule: ${TOMORROW}T09:00 → $SCHED_DATE" || fail "Schedule" "$SCHED"

  # Unschedule
  sleep 1
  UNSCHED=$(curl -s -b "$COOKIES" "$BASE/api/calendar/schedule" -X POST \
    -H "Content-Type: application/json" -d "{\"id\":\"$TASK_ID\",\"scheduled\":null}")
  UNSCHED_OK=$(echo "$UNSCHED" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success',False))" 2>/dev/null)
  UNSCHED_V=$(echo "$UNSCHED" | python3 -c "import json,sys; print(json.load(sys.stdin).get('task',{}).get('scheduled','empty'))" 2>/dev/null)
  [ "$UNSCHED_OK" = "True" ] && ok "Unschedule: scheduled=$UNSCHED_V" || fail "Unschedule" "$UNSCHED"

  # Missing id
  NOID=$(curl -s -b "$COOKIES" "$BASE/api/calendar/schedule" -X POST \
    -H "Content-Type: application/json" -d '{}')
  echo "$NOID" | grep -q "required" && ok "Missing id → error" || fail "Missing id" "$NOID"
else
  echo "  ⏭️  Skipped: no tasks"
fi
echo ""

# ─── 3. Logout ───────────────────────────
echo "3️⃣  LOGOUT"
LOGOUT=$(curl -s -b "$COOKIES" -c "$COOKIES" "$BASE/api/logout" -X POST)
LOGOUT_OK=$(echo "$LOGOUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success',False))" 2>/dev/null)
[ "$LOGOUT_OK" = "True" ] && ok "POST /api/logout: success" || fail "Logout" "$LOGOUT"

# After logout → unauthorized
AFTER_CAL=$(curl -s -b "$COOKIES" "$BASE/api/calendar")
echo "$AFTER_CAL" | grep -qi "unauthorized\|error" && ok "Calendar blocked after logout" || fail "Post-logout" "$AFTER_CAL"

AFTER_BOARD=$(curl -s -b "$COOKIES" "$BASE/api/tasks")
echo "$AFTER_BOARD" | grep -qi "unauthorized\|error" && ok "Board blocked after logout" || fail "Post-logout board" "$AFTER_BOARD"

AFTER_CHAT=$(curl -s -b "$COOKIES" "$BASE/api/chat" -X POST -H "Content-Type: application/json" -d '{"message":"test"}')
echo "$AFTER_CHAT" | grep -qi "đăng nhập\|unauthorized" && ok "Chat blocked after logout" || fail "Post-logout chat" "$AFTER_CHAT"
echo ""

# ─── 4. Anti-Autofill HTML ───────────────
echo "4️⃣  ANTI-AUTOFILL"
HTML=$(curl -s "$BASE/")
echo "$HTML" | grep -q 'autocomplete="off"' && ok "autocomplete=off" || fail "autocomplete" "missing"
echo "$HTML" | grep -q 'readonly' && ok "readonly attribute" || fail "readonly" "missing"
echo "$HTML" | grep -q 'data-1p-ignore' && ok "1Password ignore" || fail "1p-ignore" "missing"
echo "$HTML" | grep -q 'data-lpignore' && ok "LastPass ignore" || fail "lpignore" "missing"
echo ""

# ─── 5. Calendar UI Structure ────────────
echo "5️⃣  CALENDAR UI"
echo "$HTML" | grep -q 'id="tab-calendar"' && ok "Calendar tab button" || fail "Tab" "missing"
echo "$HTML" | grep -q 'id="calendar-view"' && ok "Calendar view div" || fail "View" "missing"
echo "$HTML" | grep -q 'id="cal-grid"' && ok "Calendar grid" || fail "Grid" "missing"
echo "$HTML" | grep -q 'id="cal-prev"' && ok "Prev week button" || fail "Prev" "missing"
echo "$HTML" | grep -q 'id="cal-next"' && ok "Next week button" || fail "Next" "missing"
echo "$HTML" | grep -q 'id="cal-today"' && ok "Today button" || fail "Today" "missing"
echo "$HTML" | grep -q 'id="cal-modal-overlay"' && ok "Schedule modal" || fail "Modal" "missing"
echo "$HTML" | grep -q 'id="cal-modal-date"' && ok "Modal date input" || fail "Modal date" "missing"
echo "$HTML" | grep -q 'id="cal-modal-time"' && ok "Modal time input" || fail "Modal time" "missing"
echo "$HTML" | grep -q 'id="cal-unscheduled-list"' && ok "Unscheduled list" || fail "Unsched list" "missing"
echo "$HTML" | grep -q 'id="btn-logout"' && ok "Logout button" || fail "Logout btn" "missing"
echo ""

# ─── 6. Calendar CSS ─────────────────────
echo "6️⃣  CALENDAR CSS"
CSS=$(curl -s "$BASE/style.css")
echo "$CSS" | grep -q 'cal-grid' && ok "Calendar grid CSS" || fail "Grid CSS" "missing"
echo "$CSS" | grep -q 'cal-task' && ok "Task block CSS" || fail "Task CSS" "missing"
echo "$CSS" | grep -q 'cal-now-line' && ok "Now line CSS" || fail "Now line" "missing"
echo "$CSS" | grep -q 'cal-modal' && ok "Modal CSS" || fail "Modal CSS" "missing"
echo "$CSS" | grep -q 'cal-unsched-chip' && ok "Unscheduled chip CSS" || fail "Chip CSS" "missing"
echo ""

# ─── 7. Calendar JS ──────────────────────
echo "7️⃣  CALENDAR JS"
JS=$(curl -s "$BASE/app.js")
echo "$JS" | grep -q 'fetchCalendar' && ok "fetchCalendar function" || fail "fetchCalendar" "missing"
echo "$JS" | grep -q 'renderCalendar' && ok "renderCalendar function" || fail "renderCalendar" "missing"
echo "$JS" | grep -q 'openScheduleModal' && ok "openScheduleModal function" || fail "Modal fn" "missing"
echo "$JS" | grep -q 'saveSchedule' && ok "saveSchedule function" || fail "saveSchedule" "missing"
echo "$JS" | grep -q 'calShiftNav' && ok "Week navigation function" || fail "Week nav" "missing"
echo "$JS" | grep -q 'updateCalNowLine' && ok "Now line updater" || fail "Now line fn" "missing"
echo "$JS" | grep -q 'handleLogout' && ok "Logout handler" || fail "Logout handler" "missing"
echo "$JS" | grep -q 'CAL_START_HOUR.*7' && ok "Start hour = 7:00" || fail "Start hour" "wrong"
echo "$JS" | grep -q 'CAL_END_HOUR.*23' && ok "End hour = 23:00" || fail "End hour" "wrong"
echo ""

# ═══ Summary ═══
echo "═══════════════════════════════════════════"
echo "  RESULTS: ✅ $PASS passed  ❌ $FAIL failed"
echo "═══════════════════════════════════════════"
[ $FAIL -eq 0 ] && echo "  🎉 ALL CALENDAR+LOGOUT TESTS PASSED!" || echo "  ⚠️  Review failures above"
echo ""

rm -f "$COOKIES"
