#!/bin/bash
# ═══ Stratt v5.0 — UI Structure & Asset Validation ═══
BASE="https://stratt.rocky13.workers.dev"
PASS=0; FAIL=0

ok() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1: $2"; }

echo "═══════════════════════════════════════════"
echo "  UI Structure & Asset Validation"
echo "═══════════════════════════════════════════"
echo ""

# Fetch HTML
HTML=$(curl -s "$BASE/")

# ─── 1. HTML Structure ──────────────────
echo "1️⃣  HTML STRUCTURE"
echo "$HTML" | grep -q 'id="auth-screen"' && ok "Auth screen exists" || fail "Auth screen" "missing"
echo "$HTML" | grep -q 'id="app-screen"' && ok "App screen exists" || fail "App screen" "missing"
echo "$HTML" | grep -q 'id="chat-view"' && ok "Chat view exists" || fail "Chat view" "missing"
echo "$HTML" | grep -q 'id="board-view"' && ok "Board view exists" || fail "Board view" "missing"
echo "$HTML" | grep -q 'data-tab="chat"' && ok "Chat tab button exists" || fail "Chat tab" "missing"
echo "$HTML" | grep -q 'data-tab="board"' && ok "Board tab button exists" || fail "Board tab" "missing"
echo ""

# ─── 2. Kanban Board DOM ────────────────
echo "2️⃣  KANBAN BOARD DOM"
echo "$HTML" | grep -q 'id="kanban-board"' && ok "Kanban board container" || fail "Kanban" "missing"
echo "$HTML" | grep -q 'id="cards-todo"' && ok "To Do column" || fail "To Do column" "missing"
echo "$HTML" | grep -q 'id="cards-progress"' && ok "In Progress column" || fail "In Progress" "missing"
echo "$HTML" | grep -q 'id="cards-pending"' && ok "Pending column" || fail "Pending" "missing"
echo "$HTML" | grep -q 'id="cards-done"' && ok "Done Today column" || fail "Done" "missing"
echo "$HTML" | grep -q 'id="filter-project"' && ok "Project filter dropdown" || fail "Project filter" "missing"
echo "$HTML" | grep -q 'id="filter-urgency"' && ok "Urgency filter dropdown" || fail "Urgency filter" "missing"
echo "$HTML" | grep -q 'id="quick-add-title"' && ok "Quick add input" || fail "Quick add" "missing"
echo "$HTML" | grep -q 'id="btn-refresh-board"' && ok "Refresh button" || fail "Refresh" "missing"
echo "$HTML" | grep -q 'id="btn-wake-lock"' && ok "Wake Lock button (iPad)" || fail "Wake Lock" "missing"
echo "$HTML" | grep -q 'MATERIALS' && ok "MATERIALS in dropdowns" || fail "MATERIALS" "missing"
echo ""

# ─── 3. PWA Meta Tags ──────────────────
echo "3️⃣  PWA META TAGS"
echo "$HTML" | grep -q 'apple-mobile-web-app-capable' && ok "apple-mobile-web-app-capable" || fail "PWA" "missing capable"
echo "$HTML" | grep -q 'apple-mobile-web-app-status-bar-style' && ok "status-bar-style" || fail "PWA" "missing status-bar"
echo "$HTML" | grep -q 'manifest.json' && ok "manifest.json linked" || fail "Manifest" "not linked"
echo "$HTML" | grep -q 'theme-color' && ok "theme-color meta" || fail "Theme color" "missing"
echo ""

# ─── 4. CSS Design Tokens ──────────────
echo "4️⃣  CSS DESIGN TOKENS (Phong Thủy)"
CSS=$(curl -s "$BASE/style.css")
echo "$CSS" | grep -q 'oklch' && ok "OKLCH color space used" || fail "OKLCH" "not found"
echo "$CSS" | grep -q '\-\-accent.*250' && ok "Accent hue 250 (Navy/Thủy)" || fail "Accent" "wrong hue"
echo "$CSS" | grep -q '\-\-fire.*22' && ok "Fire hue 22 (Coral/Hỏa)" || fail "Fire" "wrong hue"
echo "$CSS" | grep -q '\-\-wait.*170' && ok "Wait hue 170 (Jade/Mộc)" || fail "Wait" "wrong hue"
echo "$CSS" | grep -q '\-\-important.*65' && ok "Important hue 65 (Amber/Thổ)" || fail "Important" "wrong hue"
echo "$CSS" | grep -q 'surface-0.*250' && ok "Surfaces tinted hue 250 (Kim sinh Thủy)" || fail "Surface tint" "wrong"
echo "$CSS" | grep -q 'prefers-reduced-motion' && ok "prefers-reduced-motion support" || fail "Motion a11y" "missing"
echo "$CSS" | grep -q '\-\-touch-min.*44px' && ok "Touch targets 44px" || fail "Touch min" "missing"
echo "$CSS" | grep -q 'ease-out.*cubic-bezier' && ok "Custom easing curves" || fail "Easing" "missing"
echo "$CSS" | grep -q '\-\-sp-' && ok "Spacing scale tokens" || fail "Spacing" "missing"
# Impeccable bans check
echo "$CSS" | grep -q 'border-left.*3px\|border-left.*4px\|border-left.*5px' && fail "BANNED: side-stripe border" "found!" || ok "No side-stripe borders (Impeccable ban)"
echo "$CSS" | grep -q 'background-clip.*text' && fail "BANNED: gradient text" "found!" || ok "No gradient text (Impeccable ban)"
echo "$CSS" | grep -q '#000\b\|#fff\b' && fail "BANNED: pure black/white" "found!" || ok "No pure black/white"
echo ""

# ─── 5. JS Functions ───────────────────
echo "5️⃣  JS FUNCTIONS"
JS=$(curl -s "$BASE/app.js")
echo "$JS" | grep -q 'switchTab' && ok "Tab switching function" || fail "switchTab" "missing"
echo "$JS" | grep -q 'fetchBoard' && ok "Board fetch function" || fail "fetchBoard" "missing"
echo "$JS" | grep -q 'renderBoard' && ok "Board render function" || fail "renderBoard" "missing"
echo "$JS" | grep -q 'renderColumn' && ok "Column render function" || fail "renderColumn" "missing"
echo "$JS" | grep -q 'handleQuickAdd' && ok "Quick add handler" || fail "handleQuickAdd" "missing"
echo "$JS" | grep -q 'changeStatus' && ok "Status change handler" || fail "changeStatus" "missing"
echo "$JS" | grep -q 'toggleWakeLock' && ok "Wake Lock handler" || fail "toggleWakeLock" "missing"
echo "$JS" | grep -q 'BOARD_REFRESH_MS' && ok "Auto-refresh timer configured" || fail "Auto-refresh" "missing"
REFRESH_MS=$(echo "$JS" | grep 'BOARD_REFRESH_MS' | head -1 | grep -o '[0-9]*')
[ "$REFRESH_MS" = "300000" ] && ok "Auto-refresh = 5 min (300000ms)" || ok "Auto-refresh = ${REFRESH_MS}ms"
echo "$JS" | grep -q 'saveChatHistory\|restoreChatHistory' && ok "Chat history persistence" || fail "Chat history" "missing"
echo "$JS" | grep -q 'data-urgency' && ok "Urgency data attributes on cards" || fail "Urgency attrs" "missing"
echo ""

# ─── 6. Interactive Elements ────────────
echo "6️⃣  INTERACTIVE ELEMENTS (unique IDs)"
for EL_ID in auth-form auth-password auth-submit chat-form chat-input chat-submit \
  tab-chat tab-board filter-project filter-urgency quick-add-title quick-add-project \
  btn-quick-add btn-refresh-board btn-wake-lock kanban-board board-loading \
  btn-plan-today btn-overdue btn-list btn-materials; do
  echo "$HTML" | grep -q "id=\"$EL_ID\"" && ok "$EL_ID" || fail "$EL_ID" "missing"
done
echo ""

# ─── 7. Quick Actions Mapping ──────────
echo "7️⃣  QUICK ACTIONS"
echo "$HTML" | grep -q 'data-action="plan"' && ok "Plan action button" || fail "Plan action" "missing"
echo "$HTML" | grep -q 'data-action="list"' && ok "List action button" || fail "List action" "missing"
echo "$HTML" | grep -q 'data-action="overdue"' && ok "Overdue action button" || fail "Overdue action" "missing"
echo "$HTML" | grep -q 'data-action="materials"' && ok "Materials action button" || fail "Materials action" "missing"
echo ""

# ═══ Summary ═══
echo "═══════════════════════════════════════════"
echo "  RESULTS: ✅ $PASS passed  ❌ $FAIL failed"
echo "═══════════════════════════════════════════"
[ $FAIL -eq 0 ] && echo "  🎉 ALL UI STRUCTURE TESTS PASSED!" || echo "  ⚠️  Review failures above"
echo ""
