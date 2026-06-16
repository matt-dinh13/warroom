// Response builders v5.3 — ADHD-optimized, no gamification
// Short, focused, next action clear

// ─── VN Context ─────────────────────────────────────────
export function getVNContext() {
  const now = new Date();
  const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const dayNames = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  const dayNum = vnDate.getUTCDay();
  const isFriday = dayNum === 5;
  const isWeekend = dayNum === 0 || dayNum === 6;
  const dayType = isWeekend ? 'Weekend' : isFriday ? 'WFH' : 'Office';
  const capacity = isWeekend ? 120 : isFriday ? 420 : 330;
  const vnHour = vnDate.getUTCHours();
  const block = vnHour < 12 ? '☀️ AM' : vnHour < 18 ? '🌤️ PM' : '🌙 Evening';
  const dayIcon = isWeekend ? '🏠' : '🏢';

  return {
    dateContext: `[Context: ${dayNames[dayNum]} ${vnDate.getUTCDate()}/${vnDate.getUTCMonth() + 1}/${vnDate.getUTCFullYear()}, ${vnHour}:${String(vnDate.getUTCMinutes()).padStart(2, '0')}, ${dayType}, capacity ${capacity}p, block: ${block}]`,
    dayType, capacity, vnHour, dayIcon, isWeekend,
  };
}

// ─── Load Bar ─────────────────────────────────────────
function buildLoadBar(pct) {
  const filled = Math.min(Math.round(pct / 10), 10);
  const empty = 10 - filled;
  const icon = pct > 100 ? '🔴' : pct > 80 ? '🟡' : '🟢';
  return `${icon} ${'━'.repeat(filled)}${'░'.repeat(empty)} ${pct}%`;
}

// ─── Triage (Plan Today) ─────────────────────────────────
export function buildTriageResponse(tasks) {
  const { capacity, dayIcon } = getVNContext();

  if (!tasks.length) {
    return `📭 Không có task nào hôm nay.\n💡 Gõ "backlog" để pick ý tưởng.`;
  }

  const urgencyOrder = { '🔴 Fire': 0, '🟡 Important': 1, '🟢 Wait': 2, '⚪ Someday': 3 };
  tasks.sort((a, b) => {
    const ua = urgencyOrder[a.urgency] ?? 9;
    const ub = urgencyOrder[b.urgency] ?? 9;
    if (ua !== ub) return ua - ub;
    return (a.due_date || '9999').localeCompare(b.due_date || '9999');
  });

  const next = tasks[0];
  const totalEst = tasks.slice(0, 3).reduce((s, t) => s + (t.estimate || 0), 0);
  const loadPct = Math.round((totalEst / capacity) * 100);

  let r = `${dayIcon} Hôm nay — ${tasks.length} tasks\n\n`;

  // NEXT task — prominent
  if (next) {
    const est = next.estimate ? `${next.estimate}p` : '?p';
    const dl = next.due_date ? ` · 📅 ${next.due_date}` : '';
    r += `▶️ TIẾP THEO:\n`;
    r += `${next.urgency || '🟡'} ${next.title}\n`;
    r += `📂 ${next.project || '?'} · ⏱ ${est}${dl}\n\n`;
  }

  // Remaining
  if (tasks.length > 1) {
    r += `📋 +${tasks.length - 1} task nữa:`;
    tasks.slice(1, 4).forEach((t, i) => {
      r += `\n  ${i + 2}. ${t.urgency || '🟡'} ${t.title}`;
    });
    if (tasks.length > 4) r += `\n  ... +${tasks.length - 4} nữa`;
    r += '\n';
  }

  r += `\n${buildLoadBar(loadPct)}`;
  r += `\n\n💡 Gõ "done 1" để hoàn thành task đầu`;

  return r;
}

// ─── Completion ─────────────────────────────────────────
export function buildCompletionResponse(task, remainingCount, remainingTasks) {
  // Sarcastic roast lines
  const roasts = [
    `Cuối cùng cũng xong "${task.title}".`,
    `"${task.title}" — tưởng quên rồi chứ.`,
    `Done "${task.title}". Không tệ.`,
    `"${task.title}" ✓. Dễ mà, sao lâu vậy?`,
    `Xong "${task.title}" rồi. Khen thì hơi sớm.`,
  ];
  let r = `✅ ${roasts[Math.floor(Math.random() * roasts.length)]}`;
  if (remainingCount !== undefined) {
    r += `\n📋 Còn ${remainingCount} task.`;
  }
  // Suggest next task
  if (remainingTasks && remainingTasks.length > 0) {
    const next = remainingTasks[0];
    const est = next.estimate ? ` (~${next.estimate}p)` : '';
    r += `\n\n👉 Tiếp: ${next.urgency || '🟡'} ${next.title}${est}`;
  }
  r += `\n\n💡 Gõ "plan" để xem task tiếp.`;
  return r;
}

// ─── Capture Confirmation ────────────────────────────────
export function buildCaptureConfirmation(d) {
  let r = `✅ Đã tạo task:\n📌 ${d.title || 'Untitled'}`;
  if (d.project) r += `\n📂 ${d.project}`;
  if (d.urgency) r += ` | ${d.urgency}`;
  if (d.estimate) r += `\n⏱ ${d.estimate}p`;
  if (d.due_date) r += ` | 📅 ${d.due_date}`;
  if (d.scheduled_time) {
    const t = d.scheduled_time.split('T')[1] || '';
    r += `\n📅 Calendar: ${t} ${d.due_date || ''}`;
  }
  if (d.assigned_by) r += `\n👤 ${d.assigned_by}`;
  r += `\n\n💡 Gõ "plan" để xem ưu tiên.`;
  return r;
}

// ─── Batch ─────────────────────────────────────────
export function buildBatchResponse(tasks) {
  let r = `✅ Đã tạo ${tasks.length} tasks:\n`;
  tasks.forEach((t, i) => {
    r += `  ${i + 1}. ${t.urgency || '🟡'} ${t.title} (${t.project || '?'})\n`;
  });
  r += `\n💡 Gõ "plan" để xem ưu tiên.`;
  return r;
}

// ─── Overdue ─────────────────────────────────────────
export function buildOverdueResponse(tasks) {
  if (!tasks.length) return '✅ Không có task quá hạn!\n💪 Good job!';

  let r = `⚠️ ${tasks.length} task quá hạn\n\n`;
  r += `▶️ Quan trọng nhất:\n`;
  r += `${tasks[0].urgency || '🟡'} ${tasks[0].title}\n`;
  r += `📂 ${tasks[0].project || '?'} · 📅 ${tasks[0].due_date || '?'}\n`;

  if (tasks.length > 1) r += `\n📋 +${tasks.length - 1} task khác quá hạn`;
  r += `\n\n💡 Gõ "done [task]" hoặc "sửa deadline"`;
  return r;
}

// ─── Load Check ─────────────────────────────────────────
export function buildLoadCheckResponse(tasks) {
  const totalEst = tasks.reduce((s, t) => s + (t.estimate || 0), 0);
  const { capacity } = getVNContext();
  const weekCap = capacity * 5 + 120 * 2;
  const loadPct = Math.round((totalEst / weekCap) * 100);

  const today = new Date().toISOString().split('T')[0];
  const overdue = tasks.filter(t => (t.due_date && t.due_date < today) || (t.do_date && t.do_date < today));

  let r = `📊 Load Check\n\n`;
  r += `📌 ${tasks.length} tasks · ⏱ ${totalEst}p (~${Math.round(totalEst / 60)}h)\n`;
  if (overdue.length > 0) r += `⚠️ ${overdue.length} task quá hạn!\n`;
  r += `\n${buildLoadBar(loadPct)}`;

  if (loadPct > 100) {
    r += `\n\n🔴 OVERLOAD! Cần drop ~${Math.round((totalEst - weekCap) / 60)}h.`;
  } else if (loadPct > 80) {
    r += `\n\n🟡 Heavy — cẩn thận!`;
  } else {
    r += `\n\n✅ OK — còn room.`;
  }
  return r;
}

// ─── Report ─────────────────────────────────────────
export function buildReportResponse(tasks) {
  const completed = tasks.filter(t => t.status === 'Completed');
  const totalTime = completed.reduce((s, t) => s + (t.estimate || 0), 0);

  let r = `📊 Weekly Report\n\n`;
  r += `✅ ${completed.length} tasks (~${Math.round(totalTime / 60)}h)\n`;

  const byProj = {};
  completed.forEach(t => { byProj[t.project || '?'] = (byProj[t.project || '?'] || 0) + 1; });
  if (Object.keys(byProj).length) {
    r += '\n📂 ';
    r += Object.entries(byProj).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p}(${c})`).join(' · ');
  }

  r += `\n\n💡 Keep going! 💪`;
  return r;
}

// ─── Backlog ─────────────────────────────────────────
export function buildBacklogResponse(tasks) {
  // Separate materials from backlog
  const materials = tasks.filter(t => t.project === 'MATERIALS');
  const backlog = tasks.filter(t => t.project !== 'MATERIALS');

  if (!backlog.length && !materials.length) return '📭 Backlog trống.\n💡 Gửi link/idea để lưu!';

  let r = '';
  if (backlog.length) {
    r += `💡 Backlog — ${backlog.length} items\n\n`;
    const byProj = {};
    backlog.forEach(t => {
      const p = t.project || 'Chưa phân loại';
      if (!byProj[p]) byProj[p] = [];
      byProj[p].push(t);
    });
    for (const [proj, items] of Object.entries(byProj)) {
      r += `📂 ${proj}\n`;
      items.slice(0, 5).forEach((t, i) => {
        const link = t.resource ? ' 🔗' : '';
        r += `  ${i + 1}. ${t.title}${link}\n`;
      });
      if (items.length > 5) r += `  ... +${items.length - 5} nữa\n`;
      r += '\n';
    }
  }

  if (materials.length) {
    r += `\n📚 Materials — ${materials.length} items\n`;
    r += `💡 Gõ "materials" để xem chi tiết.`;
  }

  return r;
}

// ─── Materials ─────────────────────────────────────────
export function buildMaterialsResponse(tasks) {
  if (!tasks.length) return '📚 Chưa có materials.\n💡 Gửi link/note/guide để lưu!';

  let r = `📚 Materials — ${tasks.length} items\n\n`;
  tasks.forEach((t, i) => {
    r += `${i + 1}. ${t.title}`;
    if (t.resource) r += ` 🔗`;
    if (t.notes) r += `\n   📝 ${t.notes.substring(0, 60)}${t.notes.length > 60 ? '...' : ''}`;
    r += '\n';
  });
  r += `\n💡 Gõ link/note để thêm materials mới.`;
  return r;
}

// ─── List (All Active) ─────────────────────────────────
export function buildListResponse(tasks) {
  if (!tasks || !tasks.length) return '✨ Không có task nào đang mở!\n\n💡 Gõ task mới để bắt đầu.';
  const grouped = {};
  tasks.forEach(t => { const st = t.status || 'To do'; if (!grouped[st]) grouped[st] = []; grouped[st].push(t); });
  const icons = { 'In progress': '🔥', 'To do': '📋', 'Pending / Wait for approved': '⏳' };
  let lines = [`📊 ${tasks.length} tasks đang mở:\n`];
  for (const [status, items] of Object.entries(grouped)) {
    lines.push(`${icons[status] || '📌'} **${status}** (${items.length})`);
    items.forEach((t, i) => {
      const p = t.project ? ` [${t.project}]` : '';
      const u = t.urgency ? ` ${t.urgency}` : '';
      const d = t.due_date ? ` ⏰${t.due_date}` : '';
      lines.push(`  ${i + 1}. ${t.title}${p}${u}${d}`);
    });
    lines.push('');
  }
  lines.push('💡 Gõ "done [tên]" hoặc "plan" để focus.');
  return lines.join('\n');
}

// ─── Capture Confirmation Card ───────────────────────────
export function buildConfirmCard(d) {
  let r = `📝 Xác nhận tạo:\n📌 ${d.title || 'Untitled'}`;
  if (d.project) r += `\n📂 ${d.project}`;
  if (d.urgency) r += ` | ${d.urgency}`;
  if (d.estimate) r += `\n⏱ ${d.estimate}p`;
  if (d.due_date) r += ` | 📅 ${d.due_date}`;
  if (d.scheduled_time) {
    const t = d.scheduled_time.split('T')[1] || '';
    r += `\n📅 Calendar: ${t} ${d.due_date || ''}`;
  }
  if (d.assigned_by) r += `\n👤 ${d.assigned_by}`;
  r += `\n\nĐúng không?`;
  return r;
}

// ─── Day Plan Response (Planner v7) ───────────────────────
const URGENCY_ICON = {
  '🔴 Fire': '🔴',
  '🟡 Important': '🟡',
  '🟢 Wait': '🟢',
  '⚪ Someday': '⚪',
};

function vnDayName(d) {
  return ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()];
}

export function buildDayPlanResponse(plan, { showConfirmPrompt = true } = {}) {
  const { meta, timeline, selected, parked, pushed, overflow } = plan;
  if (!meta) return '❌ Plan rỗng.';

  const dayName = vnDayName(new Date(meta.today + 'T00:00:00Z'));
  const dayTypeLabel = meta.dayType === 'office' ? 'Office' : meta.dayType === 'wfh' ? 'WFH' : 'Weekend';
  const dayIcon = meta.dayType === 'office' ? '🏢' : meta.dayType === 'wfh' ? '🏠' : '🌿';
  const focusH = (meta.focusCap / 60).toFixed(1);
  const usedH = (meta.used / 60).toFixed(1);

  let r = `📅 ${dayName} ${meta.today.slice(5).replace('-', '/')} — ${dayIcon} ${dayTypeLabel} (focus ~${focusH}h)\n\n`;

  if (timeline.length === 0 && selected.length === 0) {
    r += `📭 Hôm nay không có gì để làm.\n`;
  } else {
    for (const item of timeline) {
      const t = item.task || {};
      const ic = URGENCY_ICON[t.urgency] || '🟡';
      const est = t.estimate ? `${t.estimate}p` : '?p';
      const isAnchor = item.kind === 'anchor';
      const icon = isAnchor ? '📌' : ic;
      const anchorTag = isAnchor ? ' [Họp]' : '';
      const sugTag = t.estimate_suggested && !isAnchor ? ' · đề xuất' : '';
      r += `🕒 ${item.time}  ${icon} ${t.title || 'Untitled'}${anchorTag} (${est}${sugTag})\n`;
    }
    r += '\n';
  }

  if (selected.length || timeline.length) {
    r += `✅ Khít ${usedH}h / ${focusH}h`;
    if (selected.length) r += ` · ${selected.length} task`;
    r += '\n';
  }

  if (showConfirmPrompt) {
    r += `\nGõ "ok" để chốt lịch.\n`;
  }

  if (parked.length) {
    r += `\n🅿️ Auto-park ${parked.length} (chưa gấp):\n`;
    parked.slice(0, 6).forEach(p => {
      r += `  • ${p.urgency || '🟡'} ${p.title} — gõ "resume ${p.title}" để lấy lại\n`;
    });
    if (parked.length > 6) r += `  ... +${parked.length - 6} nữa\n`;
  }

  if (pushed.length) {
    r += `\n➡️ Đẩy mai ${pushed.length}:\n`;
    pushed.slice(0, 6).forEach(p => {
      r += `  • ${p.urgency || '🟡'} ${p.title}\n`;
    });
    if (pushed.length > 6) r += `  ... +${pushed.length - 6} nữa\n`;
  }

  if (overflow.length) {
    r += `\n⚠️ Việc bắt buộc đã vượt giờ (~${usedH}h/${focusH}h). Cần cắt/đẩy gì đó — bạn quyết:\n`;
    overflow.forEach(o => {
      r += `  • ${o.urgency || '🟡'} ${o.title}\n`;
    });
  }

  if (meta.mustOverflow) {
    r = r.replace('Gõ "ok" để chốt lịch.\n', '');
    r += `\n❌ Không auto-park việc bắt buộc. Gõ "ok" để chốt phần vừa sức, hoặc gõ "sửa [tên]" để giảm estimate.\n`;
  }

  return r.trim();
}

// ─── Parked List Response ────────────────────────────────
export function buildParkedResponse(tasks) {
  if (!tasks || !tasks.length) return '🅿️ Không có task nào đang để dành.';
  let r = `🅿️ ${tasks.length} task đang để dành (Parked):\n\n`;
  tasks.forEach((t, i) => {
    const p = t.project ? ` [${t.project}]` : '';
    r += `  ${i + 1}. ${t.title}${p}\n`;
  });
  r += `\n💡 Gõ "resume [tên]" để đưa task quay lại plan hôm nay.`;
  return r;
}
