import assert from 'node:assert';
import { buildDayPlan } from './src/planner.js';

// Setup Mock Date for target: 2026-06-17 (Wednesday - Office day)
const baseDate = new Date('2026-06-17T08:00:00+07:00'); // 8 AM VN

console.log('🧪 Starting Planner Engine Unit Tests...\n');

// ─── U1 Anchor cố định
{
  const tasks = [
    { id: '1', title: 'Họp GMA', scheduled: '2026-06-17T10:00:00+07:00', estimate: 45, status: 'To do' }
  ];
  const plan = buildDayPlan(tasks, { now: baseDate });
  const anchorTimeline = plan.timeline.find(t => t.kind === 'anchor');
  assert.ok(anchorTimeline, 'Should find anchor in timeline');
  assert.strictEqual(anchorTimeline.time, '10:00', 'Anchor should start at 10:00');
  assert.strictEqual(anchorTimeline.task.title, 'Họp GMA');
  console.log('✅ U1 Passed: Anchor scheduled correctly.');
}

// ─── U2 Vừa sức
{
  const tasks = [
    { id: '1', title: 'Task 1', estimate: 120, urgency: '🟡 Important', status: 'To do' },
    { id: '2', title: 'Task 2', estimate: 120, urgency: '🟡 Important', status: 'To do' },
    { id: '3', title: 'Task 3', estimate: 120, urgency: '🟡 Important', status: 'To do' },
    { id: '4', title: 'Task 4', estimate: 120, urgency: '🟡 Important', status: 'To do' },
  ];
  // Office capacity = 330. Each selected task takes task.estimate + 10m buffer.
  // 120+10 = 130m. So 2 tasks = 260m fits. 3 tasks = 390m exceeds 330m.
  const plan = buildDayPlan(tasks, { now: baseDate });
  assert.ok(plan.selected.length <= 2, `Selected length ${plan.selected.length} should be <= 2`);
  console.log('✅ U2 Passed: Daily capacity respected.');
}

// ─── U3 Must-include guard (RAIL)
{
  const tasks = [
    { id: '1', title: 'Regular Task', estimate: 30, urgency: '🟢 Wait', status: 'To do' },
    { id: '2', title: 'Fire Task', estimate: 30, urgency: '🔴 Fire', status: 'To do' },
    { id: '3', title: 'Overdue Task', estimate: 30, urgency: '🟢 Wait', due_date: '2026-06-16', status: 'To do' }
  ];
  const plan = buildDayPlan(tasks, { now: baseDate });
  const selectedTitles = plan.selected.map(t => t.title);
  assert.ok(selectedTitles.includes('Fire Task'), 'Fire task must be selected');
  assert.ok(selectedTitles.includes('Overdue Task'), 'Overdue task must be selected');
  console.log('✅ U3 Passed: Must-include guards (Fire & Overdue) active.');
}

// ─── U4 Overcommit must-do
{
  const tasks = [
    { id: '1', title: 'Huge Fire 1', estimate: 200, urgency: '🔴 Fire', status: 'To do' },
    { id: '2', title: 'Huge Fire 2', estimate: 200, urgency: '🔴 Fire', status: 'To do' },
  ];
  // Capacity: 330. 200 + 10 + 200 + 10 = 420m > 330m.
  const plan = buildDayPlan(tasks, { now: baseDate });
  assert.strictEqual(plan.overflow.length, 1, 'Should have 1 overflow task');
  assert.strictEqual(plan.overflow[0].title, 'Huge Fire 2');
  assert.strictEqual(plan.parked.length, 0, 'No must-do tasks should be auto-parked');
  console.log('✅ U4 Passed: Overcommit handled, must-do tasks not auto-parked.');
}

// ─── U5 Auto-park đúng đối tượng (RAIL)
{
  const tasks = [
    { id: '1', title: 'Wait task far deadline', estimate: 30, urgency: '🟢 Wait', due_date: '2026-06-25', status: 'To do' },
    { id: '2', title: 'Someday task no deadline', estimate: 30, urgency: '⚪ Someday', status: 'To do' },
    { id: '3', title: 'Fire task', estimate: 30, urgency: '🔴 Fire', status: 'To do' },
    { id: '4', title: 'Wait task near deadline', estimate: 30, urgency: '🟢 Wait', due_date: '2026-06-18', status: 'To do' },
  ];
  // Restrict capacity so they don't all fit
  const plan = buildDayPlan(tasks, { now: baseDate, capacity: 50 });
  const parkedTitles = plan.parked.map(t => t.title);
  assert.ok(parkedTitles.includes('Wait task far deadline'), 'Should park far deadline Wait task');
  assert.ok(parkedTitles.includes('Someday task no deadline'), 'Should park Someday task');
  assert.ok(!parkedTitles.includes('Fire task'), 'Must NOT park Fire task');
  console.log('✅ U5 Passed: Auto-parking correctly targeted to low urgency.');
}

// ─── U6 Đẩy vs park
{
  const tasks = [
    { id: '1', title: 'Fit task', estimate: 30, urgency: '🔴 Fire', status: 'To do' },
    { id: '2', title: 'Important near deadline task', estimate: 300, urgency: '🟡 Important', due_date: '2026-06-18', status: 'To do' },
  ];
  // Capacity = 330. Fit task fits. Task 2 does not fit (300+10 + 30+10 = 350 > 330).
  const plan = buildDayPlan(tasks, { now: baseDate });
  assert.strictEqual(plan.pushed.length, 1, 'Important near deadline should be pushed');
  assert.strictEqual(plan.pushed[0].title, 'Important near deadline task');
  assert.strictEqual(plan.pushed[0].to_date, '2026-06-18', 'Should be pushed to tomorrow');
  assert.strictEqual(plan.parked.length, 0, 'Should not park important near deadline');
  console.log('✅ U6 Passed: Pushing to next day vs parking handled correctly.');
}

// ─── U7 Fill estimate
{
  const tasks = [
    { id: '1', title: 'No est Fire', urgency: '🔴 Fire', status: 'To do' },
    { id: '2', title: 'No est Wait', urgency: '🟢 Wait', status: 'To do' }
  ];
  const plan = buildDayPlan(tasks, { now: baseDate });
  const fireTask = plan.selected.find(t => t.title === 'No est Fire');
  const waitTask = plan.selected.find(t => t.title === 'No est Wait');
  assert.strictEqual(fireTask.estimate, 45, 'Fire should default to 45p');
  assert.ok(fireTask.estimate_suggested);
  assert.strictEqual(waitTask.estimate, 30, 'Wait should default to 30p');
  assert.ok(waitTask.estimate_suggested);
  console.log('✅ U7 Passed: Estimates auto-suggested correctly.');
}

// ─── U8 Sequencing
{
  const tasks = [
    { id: '1', title: 'Morning Heavy', estimate: 60, urgency: '🔴 Fire', status: 'To do' },
    { id: '2', title: 'Afternoon Light', estimate: 15, urgency: '🟢 Wait', status: 'To do' },
    { id: '3', title: 'Họp', scheduled: '2026-06-17T11:00:00+07:00', estimate: 30, status: 'To do' }
  ];
  const plan = buildDayPlan(tasks, { now: baseDate });
  
  // Verify order in timeline
  const timelineKinds = plan.timeline.map(t => t.kind);
  const timelineTitles = plan.timeline.map(t => t.task.title);

  // Check no overlaps
  for (let i = 0; i < plan.timeline.length - 1; i++) {
    // Timeline contains times like "10:00", "11:00". Let's verify start order.
    assert.ok(plan.timeline[i].time.localeCompare(plan.timeline[i+1].time) < 0, 'Timeline should be sorted chronologically');
  }

  // Morning Heavy (Fire/heavy) must be scheduled first
  const idxHeavy = timelineTitles.indexOf('Morning Heavy');
  const idxLight = timelineTitles.indexOf('Afternoon Light');
  assert.ok(idxHeavy < idxLight, 'Heavy task should precede light task');
  console.log('✅ U8 Passed: Sequencing (morning heavy first, chronological order) succeeded.');
}

// ─── U9 Re-plan giữa ngày
{
  const tasks = [
    { id: '1', title: 'Họp Sáng', scheduled: '2026-06-17T10:00:00+07:00', estimate: 30, status: 'To do' },
    { id: '2', title: 'Họp Chiều', scheduled: '2026-06-17T15:00:00+07:00', estimate: 30, status: 'To do' },
    { id: '3', title: 'Task Chiều', estimate: 45, urgency: '🔴 Fire', status: 'To do' }
  ];
  
  // Re-plan starting at 14:00 (2 PM)
  const plan = buildDayPlan(tasks, {
    now: new Date('2026-06-17T14:00:00+07:00'),
    startFromNow: true,
    fromTime: { hour: 14, min: 0 }
  });

  const timelineTitles = plan.timeline.map(t => t.task.title);
  assert.ok(!timelineTitles.includes('Họp Sáng'), 'Past anchor should be skipped');
  assert.ok(timelineTitles.includes('Họp Chiều'), 'Future anchor should be kept');
  assert.ok(timelineTitles.includes('Task Chiều'), 'Remaining floating task should be scheduled');
  console.log('✅ U9 Passed: Re-plan mid-day successfully skipped past items.');
}

// ─── U10 Khung giờ
{
  const tasks = [{ id: '1', title: 'Task 1', estimate: 30, urgency: '🔴 Fire', status: 'To do' }];
  
  // WFH starts at 9:00
  const wfhPlan = buildDayPlan(tasks, { now: baseDate, dayType: 'wfh' });
  assert.strictEqual(wfhPlan.timeline[0].time, '09:00');

  // Office starts at 10:00
  const officePlan = buildDayPlan(tasks, { now: baseDate, dayType: 'office' });
  assert.strictEqual(officePlan.timeline[0].time, '10:00');

  console.log('✅ U10 Passed: Time windows for Office and WFH respected.');
}

// ─── U11 Rỗng / biên
{
  const planEmpty = buildDayPlan([], { now: baseDate });
  assert.strictEqual(planEmpty.timeline.length, 0);

  const giantTasks = [{ id: '1', title: 'Giant Task', estimate: 500, urgency: '🔴 Fire', status: 'To do' }];
  const planGiant = buildDayPlan(giantTasks, { now: baseDate });
  assert.strictEqual(planGiant.overflow.length, 1, 'Giant Fire task should trigger overflow');
  console.log('✅ U11 Passed: Empty and boundary limits handled without crash.');
}

console.log('\n🎉 ALL UNIT TESTS PASSED SUCCESSFULLY! 🎉\n');
