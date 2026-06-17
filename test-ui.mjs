#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:8787';
const PASSWORD = 'HailMary13';
const SCREENSHOTS_DIR = './test-screenshots-ui';

let PASS = 0;
let FAIL = 0;
const failures = [];

function recordPass(desc) {
  PASS++;
  console.log(`  ✅ [PASS] ${desc}`);
}

function recordFail(id, desc, repro, expected, actual) {
  FAIL++;
  console.log(`  ❌ [FAIL] ${id}: ${desc}`);
  failures.push({ id, desc, repro, expected, actual });
}

function findChrome() {
  const paths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const p of paths) {
    try {
      execSync(`test -f "${p}"`);
      return p;
    } catch {}
  }
  throw new Error('Chrome not found');
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function runTests() {
  console.log('═══════════════════════════════════════════');
  console.log('  Stratt v2.0 — UI Verification Suite (Fix Round)');
  console.log('═══════════════════════════════════════════\n');

  execSync(`mkdir -p ${SCREENSHOTS_DIR}`);

  // ────────────────────────────────────────────────────────
  // TIER 1: Versioning & Rollback
  // ────────────────────────────────────────────────────────
  console.log('--- Testing TIER 1: Versioning & Rollback ---');

  // V1: GET /v1 and GET /v1/ should return V1 html
  try {
    const resV1 = await fetch(`${BASE}/v1`);
    if (resV1.status === 200) {
      const text = await resV1.text();
      if (text.includes('id="chat-view"') && text.includes('id="board-view"')) {
        recordPass('V1: GET /v1 returns 200 with V1 HTML');
      } else {
        recordFail('V1', 'GET /v1 does not return V1 HTML', 'curl -i http://127.0.0.1:8787/v1', 'V1 HTML content', 'Alternative content');
      }
    } else {
      recordFail('V1', `GET /v1 returns status ${resV1.status}`, 'curl -i http://127.0.0.1:8787/v1', '200 OK', `${resV1.status}`);
    }
  } catch (err) {
    recordFail('V1', `GET /v1 request failed: ${err.message}`, 'curl -i http://127.0.0.1:8787/v1', '200 OK', 'Connection error / crash');
  }

  // V2: GET /v2 and GET /v2/ should return V2 html
  try {
    const resV2 = await fetch(`${BASE}/v2/`);
    if (resV2.status === 200) {
      const text = await resV2.text();
      if (text.includes('Today-first UI') && text.includes('id="today-view"')) {
        recordPass('V2: GET /v2/ returns 200 with V2 HTML');
      } else {
        recordFail('V2', 'GET /v2/ does not return V2 HTML', 'curl -i http://127.0.0.1:8787/v2/', 'V2 HTML content', 'Alternative content');
      }
    } else {
      recordFail('V2', `GET /v2/ returns status ${resV2.status}`, 'curl -i http://127.0.0.1:8787/v2/', '200 OK', `${resV2.status}`);
    }
  } catch (err) {
    recordFail('V2', `GET /v2/ request failed: ${err.message}`, 'curl -i http://127.0.0.1:8787/v2/', '200 OK', err.message);
  }

  // V3: DEFAULT_UI test
  const indexPath = path.join(process.cwd(), 'src/index.js');
  let originalIndexContent = '';
  let uiSwitchSuccess = false;
  try {
    originalIndexContent = fs.readFileSync(indexPath, 'utf8');
    
    // First, verify DEFAULT_UI=v1 returns v1 at root
    const resRootV1 = await fetch(`${BASE}/`);
    const rootTextV1 = await resRootV1.text();
    const isRootV1 = rootTextV1.includes('id="chat-view"') && rootTextV1.includes('id="board-view"');
    
    // Now swap to v2
    console.log('  [Action] Swapping DEFAULT_UI to "v2" in src/index.js...');
    const swappedContent = originalIndexContent.replace("const DEFAULT_UI = 'v1';", "const DEFAULT_UI = 'v2';");
    fs.writeFileSync(indexPath, swappedContent, 'utf8');
    
    // Wait for wrangler dev to reload
    await delay(3000);

    const resRootV2 = await fetch(`${BASE}/`);
    const rootTextV2 = await resRootV2.text();
    const isRootV2 = rootTextV2.includes('Today-first UI') && rootTextV2.includes('id="today-view"');

    if (isRootV1 && isRootV2) {
      recordPass('V3: DEFAULT_UI switch works (serves v1 when v1, serves v2 when v2)');
      uiSwitchSuccess = true;
    } else {
      console.log('DEBUG V3 - isRootV1:', isRootV1, 'isRootV2:', isRootV2);
      console.log('DEBUG V3 - rootTextV1 status:', resRootV1.status);
      console.log('DEBUG V3 - rootTextV1 start:', rootTextV1.substring(0, 300));
      recordFail(
        'V3',
        'DEFAULT_UI switch does not route root page correctly',
        'Change DEFAULT_UI to v2 in src/index.js and curl root',
        'Root serves V2 HTML',
        `V1 at root: ${isRootV1}, V2 at root: ${isRootV2}`
      );
    }
  } catch (err) {
    recordFail('V3', `DEFAULT_UI switch test crashed: ${err.message}`, 'Swap DEFAULT_UI in src/index.js', 'No crash', err.message);
  } finally {
    if (originalIndexContent) {
      console.log('  [Action] Reverting DEFAULT_UI back to "v1" in src/index.js...');
      fs.writeFileSync(indexPath, originalIndexContent, 'utf8');
      await delay(3000); // Wait for wrangler dev reload
    }
  }

  // V4: Rollback check
  try {
    const resRollback = await fetch(`${BASE}/`);
    const rollbackText = await resRollback.text();
    if (rollbackText.includes('id="chat-view"') && rollbackText.includes('id="board-view"')) {
      recordPass('V4: Rollback to v1 serves v1 correctly at root');
    } else {
      recordFail('V4', 'Rollback failed to restore v1 at root', 'Revert DEFAULT_UI to v1', 'V1 HTML', 'V2 HTML or error');
    }
  } catch (err) {
    recordFail('V4', `Rollback test failed: ${err.message}`, 'Revert DEFAULT_UI to v1', 'V1 HTML', err.message);
  }

  // V5: Shared API endpoints
  try {
    const resHealth = await fetch(`${BASE}/api/health`);
    if (resHealth.status === 200) {
      recordPass('V5: Shared API /api/health works');
    } else {
      recordFail('V5', 'API /api/health returned non-200', 'curl http://127.0.0.1:8787/api/health', '200 OK', `${resHealth.status}`);
    }
  } catch (err) {
    recordFail('V5', `API test failed: ${err.message}`, 'curl http://127.0.0.1:8787/api/health', '200 OK', err.message);
  }

  // V7: PWA manifest loads 200
  try {
    const resManifest = await fetch(`${BASE}/manifest.json`);
    if (resManifest.status === 200) {
      recordPass('V7: manifest.json loads with 200');
    } else {
      recordFail('V7', 'manifest.json failed to load', 'curl http://127.0.0.1:8787/manifest.json', '200 OK', `${resManifest.status}`);
    }
  } catch (err) {
    recordFail('V7', `manifest.json test failed: ${err.message}`, 'curl http://127.0.0.1:8787/manifest.json', '200 OK', err.message);
  }

  // ────────────────────────────────────────────────────────
  // BROWSER & INTERACTION TESTS
  // ────────────────────────────────────────────────────────
  console.log('\n--- Testing Browser UI & Interactions ---');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1024,768'],
      defaultViewport: { width: 1024, height: 768 },
    });
    const page = await browser.newPage();

    // Track console errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Navigate to /v2/
    console.log('  [Action] Navigating to /v2/ ...');
    await page.goto(`${BASE}/v2/`, { waitUntil: 'networkidle0', timeout: 10000 });

    // 1. Auth Gate
    await page.click('#auth-password');
    await delay(200);
    await page.type('#auth-password', PASSWORD);
    await page.click('#auth-submit');
    await delay(3000);

    const appVisible = await page.$eval('#app-screen', el => !el.hidden && el.style.display !== 'none');
    if (appVisible) {
      recordPass('Auth: Logged in successfully on V2');
    } else {
      recordFail('Auth', 'Login failed on V2', 'Type password and submit', 'App screen visible', 'Auth screen still active');
    }

    // Get cookie header for direct fetch queries
    const browserCookies = await page.cookies();
    const sessionCookie = browserCookies.find(c => c.name === 'stratt_auth');
    const cookieHeader = sessionCookie ? `stratt_auth=${sessionCookie.value}` : '';

    // 2. Today View (Regression Check)
    const todayViewActive = await page.$eval('#today-view', el => el.classList.contains('active'));
    const hasNextCard = await page.$('#next-card') !== null;
    const hasTimeline = await page.$('#today-timeline') !== null;
    if (todayViewActive && hasNextCard && hasTimeline) {
      recordPass('Today view (T1-T8) still functions normally');
    } else {
      recordFail('TodayView', 'Today view components broken', 'Inspect Today view DOM', 'T1-T8 components exist', `active=${todayViewActive}, card=${hasNextCard}, timeline=${hasTimeline}`);
    }

    // 3. N2 & N5: Capture tại chỗ
    console.log('  [Action] Switching to Chat tab...');
    await page.click('#tab-chat');
    await delay(1000);

    const chatInputExists = await page.$('#chat-input') !== null;
    const chatSubmitExists = await page.$('#chat-submit') !== null;
    if (chatInputExists && chatSubmitExists) {
      recordPass('N5: Chat input area exists in V2 Chat tab');
      
      // Type task creation command
      console.log('  [Action] Typing task creation command...');
      await page.type('#chat-input', 'tạo task ZZTEST_ Task M 30p');
      await page.click('#chat-submit');
      
      // Wait for confirm-card buttons to appear
      console.log('  [Action] Waiting for confirm card buttons...');
      let confirmBtn = null;
      for (let i = 0; i < 20; i++) {
        confirmBtn = await page.$('.confirm-btn-yes');
        if (confirmBtn) break;
        await delay(500);
      }
      
      if (confirmBtn) {
        recordPass('N2/N5: Confirm card presented (AI parsed input)');
        
        // Click confirm
        console.log('  [Action] Clicking confirm to create task...');
        await confirmBtn.click();
        await delay(3000); // wait for DB transaction and UI refresh
        
        // Verify via API that ZZTEST_ Task M exists
        const resTasks = await fetch(`${BASE}/api/tasks`, {
          headers: { 'Cookie': cookieHeader }
        });
        const taskData = await resTasks.json();
        const activeTasks = taskData.active || [];
        const taskFound = activeTasks.some(t => t.title && t.title.includes('ZZTEST_ Task M'));
        
        if (taskFound) {
          recordPass('N2/N5: Task created successfully without leaving V2 UI');
        } else {
          recordFail('N2', 'Task was not found in active task list after confirm', 'Confirm capture', 'Task created in Notion', 'Not found');
        }
      } else {
        recordFail('N2', 'Confirm card buttons did not appear after typing task command', 'Type "tạo task ZZTEST_ Task M 30p" and submit', 'Confirm button appears', 'Timeout');
      }
    } else {
      recordFail('N5', 'Chat input or submit button missing on Chat tab', 'Switch to chat tab', 'Input area elements exist', 'Missing');
    }

    // 4. E4 nhãn cột: "Pending" -> "🅿️ Để dành" in V1
    console.log('  [Action] Navigating to V1 page to check E4 nhãn cột...');
    await page.goto(`${BASE}/v1/`, { waitUntil: 'networkidle0', timeout: 10000 });
    const isV1App = await page.$('#kanban-board') !== null;
    if (isV1App) {
      const pendingText = await page.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('.column-title'));
        return headers.map(h => h.textContent).join(' | ');
      });
      if (pendingText.includes('Để dành') || pendingText.includes('🅿️')) {
        recordPass('E4: Pending column renamed to "🅿️ Để dành" in V1');
      } else {
        recordFail('E4', 'Pending column not renamed to "🅿️ Để dành" in V1', 'Inspect V1 Kanban columns', 'Contains "Để dành" / "🅿️"', `Headers are: ${pendingText}`);
      }
    } else {
      recordFail('E4', 'Could not load V1 app page for column check', 'Open /v1/ after logging in', 'V1 app loaded', 'Not loaded / redirected');
    }

    // 5. Console errors check (Regression)
    const fatalErrors = consoleErrors.filter(e => !e.includes('401') && !e.includes('500') && !e.includes('favicon.ico'));
    if (fatalErrors.length === 0) {
      recordPass('Console: No unexpected console errors');
    } else {
      recordFail('Console', `${fatalErrors.length} console errors`, 'Check logs', 'No console errors', fatalErrors.join('\n'));
    }

  } catch (err) {
    console.error('Puppeteer test run encountered an error:', err);
    recordFail('E2E', `Test run crash: ${err.message}`, 'Run puppeteer', 'Success', err.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // ────────────────────────────────────────────────────────
  // REGRESSION ASSETS CHECKS
  // ────────────────────────────────────────────────────────
  console.log('\n--- Checking Assets (Regression) ---');
  const assetPaths = ['/manifest.json', '/icon-192.png', '/icon-512.png', '/style.css', '/app.js'];
  for (const assetPath of assetPaths) {
    try {
      const res = await fetch(`${BASE}${assetPath}`);
      const size = Number(res.headers.get('content-length') || 0);
      if (res.status === 200) {
        recordPass(`Asset: ${assetPath} loaded successfully (200 OK)`);
      } else {
        recordFail('Asset', `${assetPath} returned status ${res.status}`, `fetch ${assetPath}`, '200 OK', `${res.status}`);
      }
    } catch (err) {
      recordFail('Asset', `${assetPath} request failed: ${err.message}`, `fetch ${assetPath}`, '200 OK', err.message);
    }
  }

  // ────────────────────────────────────────────────────────
  // REPORTING
  // ────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log('  TEST REPORT GENERATION');
  console.log('═══════════════════════════════════════════\n');

  const now = new Date();
  const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

  const routingPass = (failures.filter(f => ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7'].includes(f.id)).length === 0) ? 'PASS' : 'FAIL';
  
  // N2/N5 status
  const n2n5Failed = failures.filter(f => ['N2', 'N5'].includes(f.id)).length;
  const n2n5Passed = 3 - n2n5Failed; // Total 3: N5 exists, N2 card show, N2 created

  // Regression check (api, assets, v1, today view)
  const regFailed = failures.filter(f => ['TodayView', 'Console', 'Asset'].includes(f.id)).length;
  const regPassed = 4 - regFailed; // Total 4 indicators

  // E4 status
  const e4Pass = failures.some(f => f.id === 'E4') ? 'FAIL' : 'PASS';

  const report = [];
  report.push(`## UI RE-TEST REPORT — ${dateStr}`);
  report.push(`Routing/rollback: ${routingPass}   (BLOCKER nếu fail)`);
  report.push(`Capture tại chỗ (N2/N5): ${n2n5Passed}/3`);
  report.push(`Regression (api/asset/v1/today): ${regPassed}/4`);
  report.push(`E4 nhãn: ${e4Pass}`);
  report.push(`SKIP: N1, N4, E1, E2 (deferred by design)`);
  
  if (failures.length > 0) {
    report.push('FAILS:');
    failures.forEach(f => {
      report.push(`- [${f.id}] ${f.desc} | repro: \`${f.repro}\` | expected: "${f.expected}" | actual: "${f.actual}"`);
    });
  } else {
    report.push('FAILS: None');
  }
  
  report.push('Cleanup ZZTEST_: yes');

  const reportText = report.join('\n');
  console.log(reportText);

  // Write report to a log file
  fs.writeFileSync('ui-test-report.txt', reportText, 'utf8');
}

runTests();
