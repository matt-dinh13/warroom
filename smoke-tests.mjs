import assert from 'node:assert';

const BASE_URL = 'http://127.0.0.1:8787';
let cookieHeader = '';

async function fetchApi(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fetch ${path} failed with ${res.status}: ${text}`);
  }
  return res;
}

async function login() {
  console.log('🔑 Logging in...');
  const res = await fetchApi('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ password: 'HailMary13' }),
  });
  const cookies = res.headers.getSetCookie();
  if (cookies && cookies.length > 0) {
    cookieHeader = cookies[0].split(';')[0];
  }
  console.log('✅ Logged in successfully.');
}

// Helper to cleanup ZZTEST_ tasks
async function cleanupZZTestTasks() {
  console.log('🧹 Cleaning up ZZTEST_ tasks...');
  const res = await fetchApi('/api/tasks');
  const data = await res.json();
  const allTasks = [...(data.active || []), ...(data.doneToday || [])];
  
  const zzTasks = allTasks.filter(t => t.title && t.title.includes('ZZTEST_'));
  console.log(`Found ${zzTasks.length} ZZTEST_ tasks to delete.`);
  
  const fs = await import('node:fs');
  const dotenv = fs.readFileSync('.dev.vars', 'utf8');
  const notionKey = dotenv.match(/NOTION_API_KEY=(\S+)/)?.[1];
  
  if (notionKey) {
    for (const t of zzTasks) {
      console.log(`Deleting task directly via Notion: ${t.title}`);
      try {
        await fetch(`https://api.notion.com/v1/pages/${t.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${notionKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ archived: true }),
        });
      } catch (err) {
        console.error(`Failed to delete ${t.title} directly:`, err.message);
      }
    }

    // Force cache invalidation by creating a dummy task
    console.log('Forcing worker cache invalidation...');
    try {
      const createRes = await fetchApi('/api/tasks/create', {
        method: 'POST',
        body: JSON.stringify({ title: 'ZZTEST_DUMMY', project: 'PERSONAL' }),
      });
      const createData = await createRes.json();
      if (createData.task && createData.task.id) {
        await fetch(`https://api.notion.com/v1/pages/${createData.task.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${notionKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ archived: true }),
        });
      }
    } catch (err) {
      console.error('Failed to force cache invalidation:', err.message);
    }
  }
  console.log('🧹 Cleanup complete.');
}

async function runTests() {
  await login();
  await cleanupZZTestTasks();

  console.log('\n--- Running Smoke Tests ---\n');

  // ─── S1: Analytics baseline & increment
  console.log('👉 S1: Analytics & AI Call tracking...');
  let res = await fetchApi('/api/analytics?days=1');
  let analyticsBaseline = await res.json();
  let aiCallsBase = analyticsBaseline.totals?.ai_calls || 0;
  let interactionsBase = analyticsBaseline.totals?.interactions || 0;
  let capturesBase = Object.values(analyticsBaseline.totals?.captures || {}).reduce((a, b) => a + b, 0);

  // Send vague message to trigger AI capture
  console.log('Sending message to trigger AI capture...');
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'ê nhờ làm ZZTEST_ báo cáo gấp' }),
  });
  let chatRes = await res.json();
  console.log('chatRes from first message:', chatRes);
  assert.ok(chatRes.needs_confirmation, 'AI capture should ask for confirmation');
  
  // Confirm
  console.log('Sending "ok" to confirm capture...');
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'ok' }),
  });
  chatRes = await res.json();
  console.log('chatRes when ok:', chatRes);
  assert.ok(chatRes.response_text.includes('ZZTEST_'), 'Confirmation text should mention task');

  // Verify analytics updated
  res = await fetchApi('/api/analytics?days=1');
  let analyticsAfter = await res.json();
  let aiCallsAfter = analyticsAfter.totals?.ai_calls || 0;
  let interactionsAfter = analyticsAfter.totals?.interactions || 0;
  let capturesAfter = Object.values(analyticsAfter.totals?.captures || {}).reduce((a, b) => a + b, 0);

  assert.strictEqual(aiCallsAfter, aiCallsBase + 1, 'ai_calls should increment by 1');
  assert.strictEqual(interactionsAfter, interactionsBase + 2, 'interactions should increment by 2');
  assert.strictEqual(capturesAfter, capturesBase + 1, 'captures should increment by 1');
  console.log('✅ S1 Passed.');

  // ─── S4 & S5: Confirm capture & pending clear
  console.log('👉 S4/S5: Confirm capture & pending clear...');
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'tạo task ZZTEST_ task Y 30p' }),
  });
  chatRes = await res.json();
  assert.ok(chatRes.needs_confirmation, 'Should require confirmation');
  
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'hủy' }),
  });
  chatRes = await res.json();
  assert.ok(chatRes.response_text.includes('bỏ'), 'Should confirm cancel');

  // Double ok should not do anything
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'ok' }),
  });
  chatRes = await res.json();
  assert.ok(!chatRes.response_text.includes('ZZTEST_ task Y'), 'Pending should have been cleared');
  console.log('✅ S4/S5 Passed.');

  // ─── S6 & S7: Park / Resume
  console.log('👉 S6/S7: Park & Resume...');
  // First create ZZTEST_ Z
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'tạo task ZZTEST_ task Z' }),
  });
  await res.json();
  await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'ok' }),
  });

  // Park
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'park ZZTEST_ task Z' }),
  });
  chatRes = await res.json();
  assert.ok(chatRes.response_text.includes('park'), 'Should confirm task parked');

  // Verify excluded from plan/list
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'list' }),
  });
  chatRes = await res.json();
  assert.ok(!chatRes.response_text.includes('ZZTEST_ task Z'), 'Parked task should not be in list response');

  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'plan' }),
  });
  chatRes = await res.json();
  assert.ok(!chatRes.response_text.includes('ZZTEST_ task Z'), 'Parked task should not be in plan response');

  // Resume
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'resume ZZTEST_ task Z' }),
  });
  chatRes = await res.json();
  assert.ok(chatRes.response_text.includes('resume') || chatRes.response_text.includes('ZZTEST_ task Z'), 'Should confirm task resumed');

  // Verify in list again
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'list' }),
  });
  chatRes = await res.json();
  assert.ok(chatRes.response_text.includes('ZZTEST_ task Z'), 'Resumed task should be back in list response');
  console.log('✅ S6/S7 Passed.');

  // ─── S10: Xếp lịch (Plan Day)
  console.log('👉 S10: Daily planner integration...');
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'xếp lịch' }),
  });
  chatRes = await res.json();
  console.log('chatRes from plan day:', chatRes);
  assert.ok(chatRes.needs_confirmation, 'Daily plan needs confirmation');
  assert.ok(chatRes.response_text.includes('chốt') || chatRes.response_text.includes('plan') || chatRes.response_text.includes('Plan'), 'Should present day plan response');

  // Confirm plan
  console.log('Confirming daily plan...');
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'ok' }),
  });
  chatRes = await res.json();
  assert.ok(chatRes.response_text.includes('Đã chốt lịch'), 'Should confirm plan applied');
  console.log('✅ S10 Passed.');

  // ─── S11: Xếp lại (Replan)
  console.log('👉 S11: Re-plan...');
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'xếp lại' }),
  });
  chatRes = await res.json();
  assert.ok(chatRes.needs_confirmation, 'Replan needs confirmation');
  console.log('✅ S11 Passed.');

  // ─── S12: Lịch tuần (Week Intake)
  console.log('👉 S12: Week intake prompt...');
  res = await fetchApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'lịch tuần' }),
  });
  chatRes = await res.json();
  assert.ok(chatRes.response_text.includes('Tuần này có gì cố định'), 'Should prompt for week intake');
  console.log('✅ S12 Passed.');

  console.log('\n🎉 ALL SMOKE TESTS PASSED SUCCESSFULLY! 🎉\n');

  await cleanupZZTestTasks();
}

runTests().catch(async err => {
  console.error('❌ SMOKE TEST RUN FAILED:', err);
  await cleanupZZTestTasks();
  process.exit(1);
});
