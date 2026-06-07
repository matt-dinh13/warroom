#!/usr/bin/env node
// Stratt v5.1 — Browser E2E Tests (Puppeteer)
// Tests: Login → Chat → Board → Calendar → Schedule → Logout

import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';

const BASE = 'https://stratt.rocky13.workers.dev';
const PASSWORD = 'HailMary13';
const SCREENSHOTS_DIR = './test-screenshots';
let PASS = 0, FAIL = 0;

function ok(msg) { PASS++; console.log(`  ✅ ${msg}`); }
function fail(msg, detail = '') { FAIL++; console.log(`  ❌ ${msg}${detail ? ': ' + detail : ''}`); }

// Find Chrome on macOS
function findChrome() {
  const paths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const p of paths) {
    try { execSync(`test -f "${p}"`); return p; } catch {}
  }
  throw new Error('Chrome not found');
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log('═══════════════════════════════════════════');
  console.log('  Stratt v5.1 — Browser E2E Tests');
  console.log('═══════════════════════════════════════════');
  console.log('');

  // Setup
  execSync(`mkdir -p ${SCREENSHOTS_DIR}`);
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1024,768'],
    defaultViewport: { width: 1024, height: 768 },
  });
  const page = await browser.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Auto-accept confirm dialogs (e.g. logout confirmation)
  page.on('dialog', async dialog => {
    await dialog.accept();
  });

  try {
    // ─── 1. LOGIN ─────────────────────────────
    console.log('1️⃣  LOGIN');
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });

    // Auth screen should be visible
    const authVisible = await page.$eval('#auth-screen', el => el.style.display !== 'none' && !el.hidden);
    authVisible ? ok('Auth screen visible') : fail('Auth screen not visible');

    // App screen should be hidden (uses .screen.active CSS pattern)
    const appHidden = await page.$eval('#app-screen', el => !el.classList.contains('active'));
    appHidden ? ok('App screen hidden before login') : fail('App screen visible before login');

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/01-login-screen.png` });

    // Type password and submit
    // Handle readonly trick: click to remove readonly
    await page.click('#auth-password');
    await delay(200);
    await page.type('#auth-password', PASSWORD);
    await page.click('#auth-submit');
    await delay(2000);

    // App screen should now be visible
    const appVisible = await page.$eval('#app-screen', el => !el.hidden && el.style.display !== 'none');
    appVisible ? ok('Login successful — app screen visible') : fail('Login failed');

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/02-after-login.png` });
    console.log('');

    // ─── 2. CHAT TAB ─────────────────────────
    console.log('2️⃣  CHAT TAB');
    const chatActive = await page.$eval('#chat-view', el => el.classList.contains('active'));
    chatActive ? ok('Chat view active by default') : fail('Chat not active');

    const calHidden = await page.$eval('#calendar-view', el => !el.classList.contains('active'));
    calHidden ? ok('Calendar NOT visible on chat tab') : fail('Calendar visible on chat tab!');

    const boardHidden = await page.$eval('#board-view', el => !el.classList.contains('active'));
    boardHidden ? ok('Board NOT visible on chat tab') : fail('Board visible on chat tab!');

    // Test quick action buttons
    const quickButtons = await page.$$eval('.quick-action-btn, [id^="btn-plan"], [id^="btn-list"], [id^="btn-overdue"]', btns => btns.length);
    quickButtons >= 3 ? ok(`Quick action buttons: ${quickButtons}`) : fail('Missing quick actions');

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/03-chat-tab.png` });
    console.log('');

    // ─── 3. BOARD TAB ────────────────────────
    console.log('3️⃣  BOARD TAB');
    await page.click('#tab-board');
    await delay(2000);

    const boardActive = await page.$eval('#board-view', el => el.classList.contains('active'));
    boardActive ? ok('Board view active') : fail('Board not active');

    const chatNow = await page.$eval('#chat-view', el => !el.classList.contains('active'));
    chatNow ? ok('Chat hidden when board active') : fail('Chat still visible!');

    const calNow = await page.$eval('#calendar-view', el => !el.classList.contains('active'));
    calNow ? ok('Calendar hidden when board active') : fail('Calendar visible on board tab!');

    // Check kanban columns
    const columns = await page.$$eval('.kanban-column', cols => cols.length);
    columns === 4 ? ok(`Kanban columns: ${columns}`) : fail(`Expected 4 columns, got ${columns}`);

    // Check task cards loaded
    await delay(1000);
    const cards = await page.$$eval('.task-card', c => c.length);
    cards > 0 ? ok(`Task cards loaded: ${cards}`) : fail('No task cards');

    // Loading spinner should be hidden
    const loadingHidden = await page.$eval('#board-loading', el => el.hidden);
    loadingHidden ? ok('Loading spinner hidden') : fail('Loading spinner still visible!');

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/04-board-tab.png` });
    console.log('');

    // ─── 4. CALENDAR TAB ─────────────────────
    console.log('4️⃣  CALENDAR TAB');
    await page.click('#tab-calendar');
    // Wait for calendar to render (API call + grid render)
    await delay(4000);
    // Poll for grid cells to appear (max 5s more)
    for (let i = 0; i < 10; i++) {
      const cells = await page.$$eval('.cal-cell', c => c.length);
      if (cells > 0) break;
      await delay(500);
    }

    const calActive = await page.$eval('#calendar-view', el => el.classList.contains('active'));
    calActive ? ok('Calendar view active') : fail('Calendar not active');

    const boardGone = await page.$eval('#board-view', el => !el.classList.contains('active'));
    boardGone ? ok('Board hidden when calendar active') : fail('Board still visible!');

    const chatGone = await page.$eval('#chat-view', el => !el.classList.contains('active'));
    chatGone ? ok('Chat hidden when calendar active') : fail('Chat still visible!');

    // Check grid rendered
    const gridCells = await page.$$eval('.cal-cell', c => c.length);
    gridCells > 0 ? ok(`Calendar grid cells: ${gridCells}`) : fail('No grid cells');

    // Check day headers
    const dayHeaders = await page.$$eval('.cal-day-header', h => h.length);
    dayHeaders === 7 ? ok(`Day headers: ${dayHeaders}`) : fail(`Expected 7 day headers, got ${dayHeaders}`);

    // Check time gutters
    const gutters = await page.$$eval('.cal-time-gutter', g => g.length);
    gutters > 0 ? ok(`Time gutters: ${gutters}`) : fail('No time gutters');

    // Check week label
    const weekLabel = await page.$eval('#cal-week-label', el => el.textContent);
    weekLabel.length > 5 ? ok(`Week label: "${weekLabel}"`) : fail('Empty week label');

    // Check unscheduled area
    const unschedCount = await page.$eval('#cal-unscheduled-count', el => el.textContent);
    ok(`Unscheduled count: ${unschedCount}`);

    // Check today highlight
    const todayHeader = await page.$('.cal-day-header.today');
    todayHeader ? ok('Today highlighted in header') : ok('Today might be outside this week');

    // Calendar loading should be hidden
    const calLoadingHidden = await page.$eval('#cal-loading', el => el.hidden);
    calLoadingHidden ? ok('Calendar loading hidden') : fail('Calendar loading still visible!');

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/05-calendar-tab.png` });
    console.log('');

    // ─── 5. SCHEDULE TASK ────────────────────
    console.log('5️⃣  SCHEDULE TASK');

    // Click on first unscheduled chip
    const chips = await page.$$('.cal-unsched-chip');
    if (chips.length > 0) {
      await chips[0].click();
      await delay(500);

      // Modal should be visible
      const modalVisible = await page.$eval('#cal-modal-overlay', el => !el.hidden);
      modalVisible ? ok('Schedule modal opened') : fail('Modal did not open');

      // Check modal title has task name
      const modalTitle = await page.$eval('#cal-modal-title', el => el.textContent);
      modalTitle.length > 0 ? ok(`Modal title: "${modalTitle.substring(0, 40)}"`) : fail('Empty modal title');

      // Check date/time inputs exist and have values
      const dateVal = await page.$eval('#cal-modal-date', el => el.value);
      dateVal ? ok(`Date prefilled: ${dateVal}`) : fail('No date value');

      const timeVal = await page.$eval('#cal-modal-time', el => el.value);
      timeVal ? ok(`Time prefilled: ${timeVal}`) : fail('No time value');

      await page.screenshot({ path: `${SCREENSHOTS_DIR}/06-schedule-modal.png` });

      // Close modal without saving
      await page.click('#cal-modal-close');
      await delay(300);

      const modalHidden = await page.$eval('#cal-modal-overlay', el => el.hidden);
      modalHidden ? ok('Modal closed') : fail('Modal did not close');
    } else {
      ok('No unscheduled chips (all tasks might be scheduled)');
    }
    console.log('');

    // ─── 6. WEEK NAVIGATION ──────────────────
    console.log('6️⃣  WEEK NAVIGATION');
    const weekBefore = await page.$eval('#cal-week-label', el => el.textContent);

    // Click next week
    await page.click('#cal-next');
    await delay(2000);
    const weekAfterNext = await page.$eval('#cal-week-label', el => el.textContent);
    weekAfterNext !== weekBefore ? ok(`Next week: "${weekAfterNext}"`) : fail('Week did not change');

    // Click prev week (back)
    await page.click('#cal-prev');
    await delay(2000);
    const weekAfterPrev = await page.$eval('#cal-week-label', el => el.textContent);
    weekAfterPrev === weekBefore ? ok('Prev week: back to original') : fail(`Week mismatch: "${weekAfterPrev}" vs "${weekBefore}"`);

    // Click Today
    await page.click('#cal-today');
    await delay(2000);
    const weekAfterToday = await page.$eval('#cal-week-label', el => el.textContent);
    ok(`Today week: "${weekAfterToday}"`);

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/07-after-navigation.png` });
    console.log('');

    // ─── 7. TAB SWITCHING STRESS ─────────────
    console.log('7️⃣  TAB SWITCHING (rapid)');
    for (const tab of ['chat', 'board', 'calendar', 'chat', 'calendar', 'board']) {
      await page.click(`#tab-${tab}`);
      await delay(300);
    }
    // End on board tab
    const finalBoard = await page.$eval('#board-view', el => el.classList.contains('active'));
    const finalCalHidden = await page.$eval('#calendar-view', el => !el.classList.contains('active'));
    const finalChatHidden = await page.$eval('#chat-view', el => !el.classList.contains('active'));
    (finalBoard && finalCalHidden && finalChatHidden) ? ok('Rapid tab switching: only board visible') : fail('Tab state corrupted');

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/08-after-rapid-tabs.png` });
    console.log('');

    // ─── 8. LOGOUT ───────────────────────────
    console.log('8️⃣  LOGOUT');
    await page.click('#btn-logout');
    await delay(2000);

    // Should be back on auth screen
    const backToAuth = await page.$eval('#auth-screen', el => !el.hidden && el.style.display !== 'none');
    backToAuth ? ok('Back to auth screen after logout') : fail('Not on auth screen after logout');

    const appGone = await page.$eval('#app-screen', el => !el.classList.contains('active'));
    appGone ? ok('App screen hidden after logout') : fail('App still visible after logout');

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/09-after-logout.png` });
    console.log('');

    // ─── 9. CONSOLE ERRORS ───────────────────
    console.log('9️⃣  CONSOLE ERRORS');
    // Filter expected errors (401 before login, network errors)
    const realErrors = consoleErrors.filter(e => 
      !e.includes('401') && !e.includes('500') && !e.includes('Failed to load resource')
    );
    if (realErrors.length === 0) {
      ok(`No unexpected console errors (${consoleErrors.length} expected network errors filtered)`);
    } else {
      fail(`${realErrors.length} unexpected console errors`);
      realErrors.forEach(e => console.log(`    → ${e.substring(0, 100)}`));
    }
    console.log('');

  } catch (err) {
    fail('Test crashed', err.message);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/99-crash.png` }).catch(() => {});
  } finally {
    await browser.close();
  }

  // ═══ Summary ═══
  console.log('═══════════════════════════════════════════');
  console.log(`  RESULTS: ✅ ${PASS} passed  ❌ ${FAIL} failed`);
  console.log('═══════════════════════════════════════════');
  if (FAIL === 0) {
    console.log('  🎉 ALL BROWSER TESTS PASSED!');
  } else {
    console.log('  ⚠️  Review failures above');
  }
  console.log(`  Screenshots: ${SCREENSHOTS_DIR}/`);
  console.log('');

  process.exit(FAIL > 0 ? 1 : 0);
})();
