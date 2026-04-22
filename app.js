// ========== Global State ==========
let calendarData = null;
let contentsData = null;
let performanceData = null;
let revenueData = null;

// 현재 날짜 기준으로 초기화
const now = new Date();
let currentYear = now.getFullYear();
let currentMonth = now.getMonth() + 1; // 1-indexed (0-11 -> 1-12)
let currentView = 'monthly';

const categoryColors = {
  // 일반 카테고리
  '취업/이직': '#879483',
  'AI활용': '#5C6B5A',
  '재테크': '#C1725D',
  '대기업라이프': '#D4A574',
  '쇼핑/여행': '#7BA3A8',
  // 수익 카테고리
  '광고': '#9B6B8C',
  '판매': '#6B8E8E',
  '협찬': '#C8B6A6'
};

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];

// ========== Supabase 설정 ==========
const SUPABASE_URL = 'https://vihrydqudawrlwddffwa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaHJ5ZHF1ZGF3cmx3ZGRmZndhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTcxNjIsImV4cCI6MjA5MTgzMzE2Mn0.5QkOjtl25PgbCDenWNgyqelbgPeerg6sqROQa624G9A';
const SUPABASE_TABLE = 'studio_data';
const DEFAULT_CLIENT_NOTION = 'https://www.notion.so/34a066f53222807e9fc9e625d5edee26';
const fmt = (n) => (Number(n) || 0).toLocaleString();

function updateSaveStatus(status) {
  const el = document.getElementById('save-status');
  if (!el) return;
  if (status === 'saving') el.innerHTML = '<span class="text-botanical-sage">저장 중…</span>';
  else if (status === 'saved') el.innerHTML = '<span class="text-botanical-sage">✓ 저장됨</span>';
  else if (status === 'error') el.innerHTML = '<span class="text-red-500">⚠️ 저장 실패 (로컬 백업만 됨)</span>';
  else if (status === 'offline') el.innerHTML = '<span class="text-red-500">⚠️ 오프라인 모드</span>';
}

async function loadFromSupabase() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=key,data`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!res.ok) throw new Error('Supabase 로드 실패: ' + res.status);
  const rows = await res.json();
  const map = {};
  rows.forEach(r => map[r.key] = r.data);
  return map;
}

async function upsertToSupabase(key, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({ key, data, updated_at: new Date().toISOString() })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`upsert ${key} 실패: ${res.status} ${text}`);
  }
}

// ========== Data Loading ==========
async function loadData() {
  try {
    const remote = await loadFromSupabase();
    const hasRemote = remote.calendar || remote.contents || remote.performance || remote.revenue;

    if (hasRemote) {
      calendarData = remote.calendar || { currentMonth: "2026-04", items: [] };
      contentsData = remote.contents || { contents: [] };
      performanceData = remote.performance || { follower: { current: 0, history: { daily: [], monthly: [] } }, monthly: {} };
      revenueData = remote.revenue || { summary: { thisMonth: 0, thisYear: 0 }, byType: { ad: {}, sales: {}, sponsor: {} }, tax: {}, monthly: [], items: { ad: [], sales: [], sponsor: [] } };
      console.log('Supabase에서 데이터 로드됨');
    } else {
      // Supabase에 아직 데이터 없음 → localStorage에 있으면 마이그레이션
      const savedContents = localStorage.getItem('yudit_contents');
      if (savedContents) {
        calendarData = JSON.parse(localStorage.getItem('yudit_calendar') || '{"currentMonth":"2026-04","items":[]}');
        contentsData = JSON.parse(savedContents);
        performanceData = JSON.parse(localStorage.getItem('yudit_performance') || '{"follower":{"current":0,"history":{"daily":[],"monthly":[]}},"monthly":{}}');
        revenueData = JSON.parse(localStorage.getItem('yudit_revenue') || '{"summary":{"thisMonth":0,"thisYear":0},"byType":{"ad":{},"sales":{},"sponsor":{}},"tax":{},"monthly":[],"items":{"ad":[],"sales":[],"sponsor":[]}}');
        console.log('localStorage에서 로드 → Supabase로 마이그레이션 중...');
        await Promise.all([
          upsertToSupabase('calendar', calendarData),
          upsertToSupabase('contents', contentsData),
          upsertToSupabase('performance', performanceData),
          upsertToSupabase('revenue', revenueData)
        ]);
        console.log('마이그레이션 완료');
      } else {
        // 최초 실행 - 빈 JSON 파일에서 기본값 로드
        const [calendar, contents, performance, revenue] = await Promise.all([
          fetch('data/calendar.json').then(r => r.json()),
          fetch('data/contents.json').then(r => r.json()),
          fetch('data/performance.json').then(r => r.json()),
          fetch('data/revenue.json').then(r => r.json())
        ]);
        calendarData = calendar;
        contentsData = contents;
        performanceData = performance;
        revenueData = revenue;
      }
    }

    updateSaveStatus('saved');
    initApp();
  } catch (e) {
    console.error('Supabase 로드 실패:', e);
    // 오프라인 폴백 - localStorage 시도
    const savedContents = localStorage.getItem('yudit_contents');
    if (savedContents) {
      calendarData = JSON.parse(localStorage.getItem('yudit_calendar') || '{"currentMonth":"2026-04","items":[]}');
      contentsData = JSON.parse(savedContents);
      performanceData = JSON.parse(localStorage.getItem('yudit_performance') || '{}');
      revenueData = JSON.parse(localStorage.getItem('yudit_revenue') || '{}');
      updateSaveStatus('offline');
      alert('⚠️ Supabase 연결 실패 — 로컬 백업 데이터로 실행합니다.\n인터넷 확인 후 새로고침하세요.');
      initApp();
    } else {
      alert('데이터 로드 실패. 인터넷 연결을 확인하세요.\n\n' + e.message);
    }
  }
}

// ========== Data Saving (Supabase + localStorage 백업) ==========
let saveTimer = null;
function saveAllData() {
  // 1) localStorage 즉시 백업 (네트워크 끊겨도 잃지 않게)
  localStorage.setItem('yudit_calendar', JSON.stringify(calendarData));
  localStorage.setItem('yudit_contents', JSON.stringify(contentsData));
  localStorage.setItem('yudit_performance', JSON.stringify(performanceData));
  localStorage.setItem('yudit_revenue', JSON.stringify(revenueData));

  // 2) Supabase에는 디바운스 (연속 호출 시 500ms 후 1번만)
  updateSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await Promise.all([
        upsertToSupabase('calendar', calendarData),
        upsertToSupabase('contents', contentsData),
        upsertToSupabase('performance', performanceData),
        upsertToSupabase('revenue', revenueData)
      ]);
      updateSaveStatus('saved');
      console.log('Supabase 저장 완료:', new Date().toLocaleTimeString());
    } catch (e) {
      console.error('Supabase 저장 실패:', e);
      updateSaveStatus('error');
    }
  }, 500);
}

// ========== Initialize ==========
function initApp() {
  setTodayDate();
  renderCalendar();
  renderDashboard();
  renderContentList();
  renderPerformance();
  renderRevenue();
}

function setTodayDate() {
  const today = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 (${days[today.getDay()]})`;
  document.getElementById('today-date').textContent = dateStr;
}

// ========== Tab Switching ==========
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => {
    el.classList.remove('text-botanical-fg', 'border-botanical-fg');
    el.classList.add('text-botanical-sage', 'border-transparent');
  });
  document.getElementById(tabName + '-tab').classList.add('active');
  const btn = document.getElementById('tab-' + tabName);
  btn.classList.remove('text-botanical-sage', 'border-transparent');
  btn.classList.add('text-botanical-fg', 'border-botanical-fg');
}

// ========== Calendar ==========
function renderCalendar() {
  renderCalendarTitle();
  renderTodaySummary();
  if (currentView === 'monthly') {
    renderMonthlyView();
  } else if (currentView === 'weekly') {
    renderWeeklyView();
  } else {
    renderMilestoneView();
  }
}

function renderCalendarTitle() {
  const title = document.getElementById('calendar-title');
  title.innerHTML = `<span class="italic">${monthNames[currentMonth - 1]}</span> ${currentYear}`;
}

function renderTodaySummary() {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayItems = calendarData.items.filter(item => item.date === todayStr);

  const days = ['일', '월', '화', '수', '목', '금', '토'];

  // Count this week's items
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const weekItems = calendarData.items.filter(item => {
    const d = new Date(item.date);
    return d >= weekStart && d <= weekEnd;
  });

  let todayItemsHtml = '';
  if (todayItems.length > 0) {
    todayItemsHtml = todayItems.map(item => `
      <div class="flex items-center gap-2 text-sm">
        <span class="w-2 h-2 rounded-full" style="background-color: ${categoryColors[item.category] || '#8C9A84'};"></span>
        <span class="${item.type === '광고' ? 'text-botanical-terracotta font-medium' : ''}">${item.title}</span>
        <span class="text-botanical-sage text-xs">${item.status}</span>
      </div>
    `).join('');
  } else {
    todayItemsHtml = '<p class="text-sm text-botanical-sage">오늘 일정 없음</p>';
  }

  document.getElementById('today-summary').innerHTML = `
    <div class="flex gap-4 mb-6">
      <div class="flex-1 p-4 bg-white rounded-2xl shadow-sm border-l-4 border-botanical-fg">
        <div class="flex items-center gap-3 mb-3">
          <span class="w-8 h-8 rounded-full bg-botanical-fg text-white text-sm flex items-center justify-center font-semibold">${today.getDate()}</span>
          <div>
            <p class="text-sm font-medium">오늘</p>
            <p class="text-xs text-botanical-sage">${days[today.getDay()]}요일</p>
          </div>
        </div>
        <div class="space-y-2">
          ${todayItemsHtml}
        </div>
      </div>
      <div class="w-32 p-4 bg-botanical-sage/10 rounded-2xl text-center flex flex-col justify-center">
        <p class="text-xs text-botanical-sage mb-1">이번 주</p>
        <p class="text-3xl font-semibold font-serif text-botanical-fg">${weekItems.length}</p>
        <p class="text-xs text-botanical-sage">건 예정</p>
      </div>
    </div>
  `;
}

function renderMonthlyView() {
  const firstDay = new Date(currentYear, currentMonth - 1, 1);
  const lastDay = new Date(currentYear, currentMonth, 0);
  const startDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = lastDay.getDate();

  // Previous month days
  const prevLastDay = new Date(currentYear, currentMonth - 1, 0).getDate();

  let html = `
    <div class="grid grid-cols-7 gap-2 mb-2">
      <div class="text-center text-sm font-medium text-botanical-sage py-2">월</div>
      <div class="text-center text-sm font-medium text-botanical-sage py-2">화</div>
      <div class="text-center text-sm font-medium text-botanical-sage py-2">수</div>
      <div class="text-center text-sm font-medium text-botanical-sage py-2">목</div>
      <div class="text-center text-sm font-medium text-botanical-sage py-2">금</div>
      <div class="text-center text-sm font-medium text-botanical-sage py-2">토</div>
      <div class="text-center text-sm font-medium text-botanical-terracotta py-2">일</div>
    </div>
    <div class="grid grid-cols-7 gap-2">
  `;

  // Previous month
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const day = prevLastDay - i;
    html += `<div class="h-24 p-2 rounded-xl text-sm text-botanical-clay">${day}</div>`;
  }

  // Current month
  const today = new Date();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const items = calendarData.items.filter(item => item.date === dateStr);
    const dayOfWeek = (startDayOfWeek + day - 1) % 7;
    const isSunday = dayOfWeek === 6;
    const isToday = today.getFullYear() === currentYear && today.getMonth() + 1 === currentMonth && today.getDate() === day;

    let cellClass = 'h-24 p-2 rounded-xl text-sm cursor-pointer transition-all';
    let dayClass = 'font-medium';

    if (isToday) {
      cellClass += ' bg-botanical-fg text-white';
    } else if (items.length > 0) {
      const hasAd = items.some(i => i.type === '광고');
      if (hasAd) {
        cellClass += ' bg-botanical-terracotta/10 border border-botanical-terracotta';
      } else {
        cellClass += ' bg-botanical-sage/10 border border-botanical-sage';
      }
    } else {
      cellClass += ' hover:bg-botanical-cream';
    }

    if (isSunday && !isToday) {
      dayClass += ' text-botanical-terracotta';
    }

    let itemsHtml = '';
    if (items.length > 0 && !isToday) {
      itemsHtml = items.slice(0, 2).map(item => `
        <div class="mt-1 text-xs">
          <p class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${categoryColors[item.category] || '#8C9A84'};"></span>
            ${item.title}
          </p>
          <p class="ml-2.5 ${item.type === '광고' ? 'text-botanical-terracotta' : 'text-botanical-sage'}">${item.status}</p>
        </div>
      `).join('');
    } else if (items.length > 0 && isToday) {
      itemsHtml = items.slice(0, 2).map(item => `
        <div class="mt-1 text-xs font-normal">
          <p class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-white"></span>
            ${item.title}
          </p>
          <p class="ml-2.5 opacity-70">${item.status}</p>
        </div>
      `).join('');
    }

    html += `
      <div class="${cellClass}" onclick="openDateDetail('${dateStr}')">
        <span class="${dayClass}">${day}</span>
        ${itemsHtml}
      </div>
    `;
  }

  // Next month
  const remainingCells = (7 - ((startDayOfWeek + daysInMonth) % 7)) % 7;
  for (let i = 1; i <= remainingCells; i++) {
    html += `<div class="h-24 p-2 rounded-xl text-sm text-botanical-clay">${i}</div>`;
  }

  html += '</div>';

  // Legend
  html += `
    <div class="flex flex-wrap gap-4 mt-4 pt-3 border-t border-botanical-stone text-xs">
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #879483;"></div><span class="text-botanical-sage">취업/이직</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #5C6B5A;"></div><span class="text-botanical-sage">AI활용</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #C1725D;"></div><span class="text-botanical-sage">재테크</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #D4A574;"></div><span class="text-botanical-sage">대기업라이프</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #7BA3A8;"></div><span class="text-botanical-sage">쇼핑/여행</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #9B6B8C;"></div><span class="text-botanical-sage">광고</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #6B8E8E;"></div><span class="text-botanical-sage">판매</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #C8B6A6;"></div><span class="text-botanical-sage">협찬</span></div>
    </div>
  `;

  document.getElementById('monthly-view').innerHTML = html;
  document.getElementById('monthly-view').classList.remove('hidden');
  document.getElementById('weekly-view').classList.add('hidden');
  document.getElementById('milestone-view').classList.add('hidden');
}

function renderWeeklyView() {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  let html = `
    <div class="grid grid-cols-7 gap-2 mb-3">
      <div class="text-center text-sm font-medium text-botanical-sage py-2">월</div>
      <div class="text-center text-sm font-medium text-botanical-sage py-2">화</div>
      <div class="text-center text-sm font-medium text-botanical-sage py-2">수</div>
      <div class="text-center text-sm font-medium text-botanical-sage py-2">목</div>
      <div class="text-center text-sm font-medium text-botanical-sage py-2">금</div>
      <div class="text-center text-sm font-medium text-botanical-sage py-2">토</div>
      <div class="text-center text-sm font-medium text-botanical-terracotta py-2">일</div>
    </div>
  `;

  // This week
  html += '<div class="grid grid-cols-7 gap-2 mb-3">';
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    html += renderWeeklyCell(d, today);
  }
  html += '</div>';

  // Next week
  html += '<div class="grid grid-cols-7 gap-2">';
  for (let i = 7; i < 14; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    html += renderWeeklyCell(d, today);
  }
  html += '</div>';

  // Legend
  html += `
    <div class="flex flex-wrap gap-4 mt-4 pt-3 border-t border-botanical-stone text-xs">
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #5C6B5A;"></div><span class="text-botanical-sage">대기업</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #879483;"></div><span class="text-botanical-sage">취업</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #9B6B8C;"></div><span class="text-botanical-sage">광고</span></div>
    </div>
  `;

  document.getElementById('weekly-view').innerHTML = html;
  document.getElementById('weekly-view').classList.remove('hidden');
  document.getElementById('monthly-view').classList.add('hidden');
  document.getElementById('milestone-view').classList.add('hidden');
}

function renderWeeklyCell(date, today) {
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const items = calendarData.items.filter(item => item.date === dateStr);
  const isSunday = date.getDay() === 0;
  const isToday = date.toDateString() === today.toDateString();

  const displayDate = date.getMonth() + 1 !== currentMonth
    ? `${date.getMonth() + 1}/${date.getDate()}`
    : date.getDate();

  let cellClass = 'h-44 p-3 rounded-xl cursor-pointer transition-all';

  if (isToday) {
    cellClass += ' bg-botanical-fg text-white';
  } else if (items.length > 0) {
    const hasAd = items.some(i => i.type === '광고');
    if (hasAd) {
      cellClass += ' bg-botanical-terracotta/10 border border-botanical-terracotta';
    } else {
      cellClass += ' bg-botanical-sage/10 border border-botanical-sage';
    }
  } else {
    cellClass += ' hover:bg-botanical-cream';
  }

  let itemsHtml = items.slice(0, 3).map(item => `
    <div class="mt-2 text-xs ${isToday ? 'font-normal' : ''}">
      <p class="flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${isToday ? 'white' : categoryColors[item.category] || '#8C9A84'};"></span>
        ${item.title}
      </p>
      <p class="ml-2.5 ${isToday ? 'opacity-70' : (item.type === '광고' ? 'text-botanical-terracotta' : 'text-botanical-sage')}">${item.status}</p>
    </div>
  `).join('');

  return `
    <div class="${cellClass}">
      <span class="font-medium ${isSunday && !isToday ? 'text-botanical-terracotta' : ''}">${displayDate}</span>
      ${itemsHtml}
    </div>
  `;
}

function renderMilestoneView() {
  const currentMonthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  // Filter contents that have milestones in the current month
  const contentsWithMilestones = contentsData.contents.filter(c => {
    if (!c.milestones || c.milestones.length === 0) return false;
    return c.milestones.some(m => m.date && m.date.startsWith(currentMonthStr));
  });

  const calendarMilestones = calendarData.items.filter(item =>
    item.contentId && item.isMilestone && item.date && item.date.startsWith(currentMonthStr)
  );

  const milestonesByContent = {};
  calendarMilestones.forEach(item => {
    if (!milestonesByContent[item.contentId]) {
      milestonesByContent[item.contentId] = [];
    }
    milestonesByContent[item.contentId].push(item);
  });

  let html = '';

  if (contentsWithMilestones.length === 0 && Object.keys(milestonesByContent).length === 0) {
    html = `
      <div class="text-center py-12 text-botanical-sage">
        <p class="mb-2">${currentMonth}월 마일스톤이 없습니다</p>
        <p class="text-sm">콘텐츠 등록 시 일정을 입력하면 마일스톤이 표시됩니다</p>
      </div>
    `;
  } else {
    const allContents = [...contentsWithMilestones];
    const contentIds = new Set(contentsWithMilestones.map(c => c.id));

    Object.keys(milestonesByContent).forEach(contentId => {
      const numId = parseInt(contentId);
      if (!contentIds.has(numId)) {
        const content = contentsData.contents.find(c => c.id === numId);
        if (content) allContents.push(content);
      }
    });

    // Define stage order
    const generalStages = ['아이디어', '기획중', '제작중', '업로드완료'];
    const revenueStages = ['계약완료', '기획안1차공유', '기획안최종컨펌', '영상1차공유', '영상최종컨펌', '업로드완료'];

    allContents.forEach(content => {
      const color = categoryColors[content.category] || '#8C9A84';
      const milestones = content.milestones || milestonesByContent[content.id] || [];
      const stages = content.isRevenue ? revenueStages : generalStages;
      const stageLabels = content.isRevenue
        ? ['계약', '기획1차', '기획최종', '영상1차', '영상최종', '업로드']
        : ['아이디어', '기획중', '제작중', '업로드'];

      // Get date for each stage
      const stageDates = {};
      milestones.forEach(m => {
        if (m.status && m.date) stageDates[m.status] = m.date;
      });

      // Find current progress (how many stages completed based on today's date)
      const today = new Date().toISOString().slice(0, 10);
      let completedStages = 0;
      stages.forEach((stage, idx) => {
        if (stageDates[stage] && stageDates[stage] <= today) {
          completedStages = idx + 1;
        }
      });

      // Find last filled stage
      let lastFilledIdx = -1;
      stages.forEach((stage, idx) => {
        if (stageDates[stage]) lastFilledIdx = idx;
      });

      html += `
        <div class="mb-5 last:mb-0 p-4 bg-botanical-cream/30 rounded-xl">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${color};"></div>
            <h4 class="font-medium text-sm">${content.title}</h4>
            <span class="text-xs px-2 py-0.5 rounded-full bg-botanical-stone text-botanical-sage">${content.type}</span>
            ${content.isRevenue ? `<span class="text-xs px-2 py-0.5 rounded-full bg-botanical-terracotta/20 text-botanical-terracotta">${content.category}</span>` : ''}
          </div>

          <!-- Gantt Bar -->
          <div class="relative">
            <!-- Stage labels -->
            <div class="flex mb-1">
              ${stages.map((stage, idx) => `
                <div class="flex-1 text-center">
                  <span class="text-[10px] text-botanical-sage">${stageLabels[idx]}</span>
                </div>
              `).join('')}
            </div>

            <!-- Bar track -->
            <div class="relative h-6 bg-botanical-stone rounded-full overflow-hidden">
              <!-- Background bar (shows how far dates are filled) -->
              ${lastFilledIdx >= 0 ? `
                <div class="absolute top-0 left-0 h-full bg-botanical-clay/50 rounded-full" style="width: ${((lastFilledIdx + 1) / stages.length) * 100}%;"></div>
              ` : ''}

              <!-- Progress bar (colored portion - completed stages) -->
              ${completedStages > 0 ? `
                <div class="absolute top-0 left-0 h-full rounded-full" style="width: ${(completedStages / stages.length) * 100}%; background-color: ${color};"></div>
              ` : ''}

              <!-- Stage markers -->
              <div class="absolute top-0 left-0 w-full h-full flex">
                ${stages.map((stage, idx) => {
                  const hasDate = !!stageDates[stage];
                  const isPast = hasDate && stageDates[stage] <= today;
                  const isLast = idx === stages.length - 1;
                  return `
                    <div class="flex-1 flex items-center justify-center relative ${!isLast ? 'border-r border-white/30' : ''}">
                      ${hasDate ? `
                        <div class="w-2 h-2 rounded-full ${isPast ? 'bg-white' : 'bg-white/50'}"></div>
                      ` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>

            <!-- Dates below -->
            <div class="flex mt-1">
              ${stages.map((stage, idx) => `
                <div class="flex-1 text-center">
                  <span class="text-[10px] ${stageDates[stage] ? 'text-botanical-fg' : 'text-botanical-clay'}">${stageDates[stage] ? stageDates[stage].slice(5).replace('-', '/') : '-'}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    });
  }

  document.getElementById('milestone-view').innerHTML = html;
  document.getElementById('monthly-view').classList.add('hidden');
  document.getElementById('weekly-view').classList.add('hidden');
  document.getElementById('milestone-view').classList.remove('hidden');
}

function switchCalendarView(view) {
  currentView = view;
  document.querySelectorAll('.calendar-view-btn').forEach(el => {
    el.classList.remove('bg-white', 'shadow-sm', 'text-botanical-fg');
    el.classList.add('text-botanical-sage');
  });
  document.getElementById('view-' + view).classList.remove('text-botanical-sage');
  document.getElementById('view-' + view).classList.add('bg-white', 'shadow-sm', 'text-botanical-fg');
  renderCalendar();
}

function prevMonth() {
  if (currentView === 'monthly') {
    currentMonth--;
    if (currentMonth < 1) {
      currentMonth = 12;
      currentYear--;
    }
    renderCalendar();
  }
}

function nextMonth() {
  if (currentView === 'monthly') {
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
    renderCalendar();
  }
}

function openDateDetail(dateStr) {
  const items = calendarData.items.filter(item => item.date === dateStr);
  const popup = document.getElementById('calendar-popup');
  const popupContent = document.getElementById('popup-content');

  if (items.length === 0) {
    // Empty date - show new content registration form
    popupContent.innerHTML = getRegistrationFormHTML(dateStr);
  } else {
    // Has items - show item info with option to add new
    const item = items[0];
    const linkedContent = item.contentId ? contentsData.contents.find(c => c.id === item.contentId) : null;

    if (linkedContent) {
      // Linked to content - show content info
      popupContent.innerHTML = `
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-lg">${linkedContent.title}</h3>
          <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="space-y-3 mb-6">
          <div class="flex items-center gap-2">
            <span class="text-sm text-botanical-sage w-16">카테고리</span>
            <span class="px-2 py-1 rounded-full text-xs" style="background-color: ${categoryColors[linkedContent.category] || '#8C9A84'}20; color: ${categoryColors[linkedContent.category] || '#8C9A84'};">${linkedContent.category}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-botanical-sage w-16">타입</span>
            <span class="text-sm">${linkedContent.type}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-botanical-sage w-16">상태</span>
            <span class="text-sm">${linkedContent.status}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-botanical-sage w-16">업로드</span>
            <span class="text-sm">${linkedContent.uploadDate}</span>
          </div>
        </div>
        <div class="flex gap-2">
          <button onclick="goToContentExpanded(${linkedContent.id})" class="flex-1 py-2 bg-botanical-fg text-white rounded-xl hover:bg-botanical-fg/90 transition-all">바로가기</button>
          <button onclick="showNewItemForm('${dateStr}')" class="px-4 py-2 border border-botanical-stone rounded-xl text-botanical-sage hover:bg-botanical-cream transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button onclick="deleteCalendarItem(${item.id})" class="px-4 py-2 border border-red-300 rounded-xl text-red-400 hover:bg-red-50 transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      `;
    } else {
      // Not linked - show calendar item info + link button
      popupContent.innerHTML = `
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-lg">${item.title}</h3>
          <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="space-y-3 mb-6">
          <div class="flex items-center gap-2">
            <span class="text-sm text-botanical-sage w-16">날짜</span>
            <span class="text-sm">${item.date}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-botanical-sage w-16">카테고리</span>
            <span class="px-2 py-1 rounded-full text-xs" style="background-color: ${categoryColors[item.category] || '#8C9A84'}20; color: ${categoryColors[item.category] || '#8C9A84'};">${item.category}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-botanical-sage w-16">타입</span>
            <span class="text-sm">${item.type || '-'}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-botanical-sage w-16">상태</span>
            <span class="text-sm">${item.status}</span>
          </div>
        </div>
        <div class="space-y-3">
          <div>
            <label class="text-sm font-medium block mb-1">콘텐츠 연동</label>
            <select id="link-content-select" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
              <option value="">선택하세요</option>
              ${contentsData.contents.filter(c => !calendarData.items.some(ci => ci.contentId === c.id)).map(c => `<option value="${c.id}">${c.title}</option>`).join('')}
            </select>
          </div>
          <div class="flex gap-2">
            <button onclick="linkToContent(${item.id})" class="flex-1 py-2 bg-botanical-terracotta text-white rounded-xl hover:bg-botanical-terracotta/90 transition-all">콘텐츠 연동하기</button>
            <button onclick="showNewItemForm('${dateStr}')" class="px-4 py-2 border border-botanical-stone rounded-xl text-botanical-sage hover:bg-botanical-cream transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            </button>
            <button onclick="deleteCalendarItem(${item.id})" class="px-4 py-2 border border-red-300 rounded-xl text-red-400 hover:bg-red-50 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }
  }

  popup.classList.remove('hidden');
}

function closeCalendarPopup() {
  document.getElementById('calendar-popup').classList.add('hidden');
}

function deleteCalendarItem(itemId) {
  if (confirm('삭제하시겠습니까?')) {
    calendarData.items = calendarData.items.filter(item => item.id !== itemId);
    saveAllData();
    closeCalendarPopup();
    renderCalendar();
  }
}

function showNewItemForm(dateStr) {
  const popupContent = document.getElementById('popup-content');
  popupContent.innerHTML = getRegistrationFormHTML(dateStr);
}

function getRegistrationFormHTML(dateStr) {
  return `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-lg">콘텐츠 등록</h3>
      <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <p class="text-sm text-botanical-sage mb-4">${dateStr}</p>

    <!-- Tab buttons -->
    <div class="flex gap-2 mb-4">
      <button onclick="switchRegisterTab('general')" id="reg-tab-general" class="reg-tab-btn flex-1 py-2 rounded-xl text-sm font-medium bg-botanical-fg text-white">일반</button>
      <button onclick="switchRegisterTab('revenue')" id="reg-tab-revenue" class="reg-tab-btn flex-1 py-2 rounded-xl text-sm font-medium bg-botanical-stone text-botanical-sage">수익</button>
      <button onclick="switchRegisterTab('link')" id="reg-tab-link" class="reg-tab-btn flex-1 py-2 rounded-xl text-sm font-medium bg-botanical-stone text-botanical-sage">연동</button>
    </div>

    <!-- General form -->
    <div id="reg-form-general" class="reg-form space-y-4">
      <div>
        <label class="text-sm font-medium block mb-1">키워드</label>
        <input type="text" id="new-keyword" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none focus:border-botanical-sage" placeholder="캘린더 표시용 키워드">
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">카테고리</label>
        <select id="new-category" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
          <option value="취업/이직">취업/이직</option>
          <option value="AI활용">AI활용</option>
          <option value="재테크">재테크</option>
          <option value="대기업라이프">대기업라이프</option>
          <option value="쇼핑/여행">쇼핑/여행</option>
        </select>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">타입</label>
        <select id="new-type" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
          <option value="릴스">릴스</option>
          <option value="캐러셀">캐러셀</option>
        </select>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">상태</label>
        <select id="new-status" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
          <option value="아이디어">아이디어</option>
          <option value="기획중">기획중</option>
          <option value="제작중">제작중</option>
          <option value="업로드완료">업로드 완료</option>
        </select>
      </div>
      <button onclick="saveNewCalendarItem('${dateStr}', 'general')" class="w-full py-2 bg-botanical-fg text-white rounded-xl hover:bg-botanical-fg/90 transition-all">등록</button>
    </div>

    <!-- Revenue form -->
    <div id="reg-form-revenue" class="reg-form space-y-4 hidden">
      <div>
        <label class="text-sm font-medium block mb-1">브랜드</label>
        <input type="text" id="new-brand" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none focus:border-botanical-sage" placeholder="브랜드명">
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">수익 유형</label>
        <div class="flex gap-2">
          <button onclick="selectRevenueType('광고')" id="rev-type-광고" class="rev-type-btn flex-1 py-2 rounded-xl text-sm font-medium border-2 border-botanical-terracotta bg-botanical-terracotta/10 text-botanical-terracotta">광고</button>
          <button onclick="selectRevenueType('판매')" id="rev-type-판매" class="rev-type-btn flex-1 py-2 rounded-xl text-sm font-medium border-2 border-botanical-stone text-botanical-sage">판매</button>
          <button onclick="selectRevenueType('협찬')" id="rev-type-협찬" class="rev-type-btn flex-1 py-2 rounded-xl text-sm font-medium border-2 border-botanical-stone text-botanical-sage">협찬</button>
        </div>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">타입</label>
        <select id="new-revenue-content-type" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
          <option value="릴스">릴스</option>
          <option value="캐러셀">캐러셀</option>
        </select>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">상태</label>
        <select id="new-revenue-status" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
          <option value="계약완료">계약완료</option>
          <option value="기획안1차공유">기획안 1차 공유</option>
          <option value="기획안최종컨펌">기획안 최종 컨펌</option>
          <option value="영상1차공유">영상 1차 공유</option>
          <option value="영상최종컨펌">영상 최종 컨펌</option>
          <option value="업로드완료">업로드 완료</option>
        </select>
      </div>
      <button onclick="saveNewCalendarItem('${dateStr}', 'revenue')" class="w-full py-2 bg-botanical-terracotta text-white rounded-xl hover:bg-botanical-terracotta/90 transition-all">등록</button>
    </div>
  `;
}

let selectedRevenueType = '광고';

function switchRegisterTab(tab) {
  document.querySelectorAll('.reg-tab-btn').forEach(btn => {
    btn.classList.remove('bg-botanical-fg', 'text-white', 'bg-botanical-terracotta');
    btn.classList.add('bg-botanical-stone', 'text-botanical-sage');
  });
  document.querySelectorAll('.reg-form').forEach(form => form.classList.add('hidden'));

  const tabBtn = document.getElementById('reg-tab-' + tab);
  const form = document.getElementById('reg-form-' + tab);

  if (tab === 'general') {
    tabBtn.classList.remove('bg-botanical-stone', 'text-botanical-sage');
    tabBtn.classList.add('bg-botanical-fg', 'text-white');
  } else {
    tabBtn.classList.remove('bg-botanical-stone', 'text-botanical-sage');
    tabBtn.classList.add('bg-botanical-terracotta', 'text-white');
  }
  form.classList.remove('hidden');
}

function selectRevenueType(type) {
  selectedRevenueType = type;
  document.querySelectorAll('.rev-type-btn').forEach(btn => {
    btn.classList.remove('border-botanical-terracotta', 'bg-botanical-terracotta/10', 'text-botanical-terracotta');
    btn.classList.add('border-botanical-stone', 'text-botanical-sage');
  });
  const btn = document.getElementById('rev-type-' + type);
  btn.classList.remove('border-botanical-stone', 'text-botanical-sage');
  btn.classList.add('border-botanical-terracotta', 'bg-botanical-terracotta/10', 'text-botanical-terracotta');
}

function saveNewCalendarItem(dateStr, formType) {
  let keyword, category, type, status;

  if (formType === 'general') {
    keyword = document.getElementById('new-keyword').value;
    category = document.getElementById('new-category').value;
    type = document.getElementById('new-type').value;
    status = document.getElementById('new-status').value;
  } else {
    keyword = document.getElementById('new-brand').value;
    category = selectedRevenueType;
    type = document.getElementById('new-revenue-content-type').value;
    status = document.getElementById('new-revenue-status').value;
  }

  if (!keyword) {
    alert(formType === 'general' ? '키워드를 입력하세요' : '브랜드를 입력하세요');
    return;
  }

  const newItem = {
    id: Date.now(),
    date: dateStr,
    title: keyword,
    category: category,
    type: type,
    status: status,
    contentId: null,
    isRevenue: formType === 'revenue',
    revenueType: formType === 'revenue' ? selectedRevenueType : null
  };

  calendarData.items.push(newItem);
  saveAllData();
  closeCalendarPopup();
  renderCalendar();
}

function linkToContent(calendarItemId) {
  const contentId = parseInt(document.getElementById('link-content-select').value);
  if (!contentId) {
    alert('연동할 콘텐츠를 선택하세요');
    return;
  }

  const item = calendarData.items.find(i => i.id === calendarItemId);
  if (item) {
    item.contentId = contentId;
    saveAllData();
    closeCalendarPopup();
    renderCalendar();
  }
}

function goToContentExpanded(contentId) {
  closeCalendarPopup();
  switchTab('content');
  setTimeout(() => {
    const form = document.getElementById('form-' + contentId);
    const arrow = document.getElementById('arrow-' + contentId);
    if (form && !form.classList.contains('active')) {
      form.classList.add('active');
      arrow.style.transform = 'rotate(180deg)';
    }
    document.getElementById('form-' + contentId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

// ========== Dashboard ==========
function renderDashboard() {
  // 현재 월 기준 업로드완료 콘텐츠만 카운트
  const currentMonthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  const uploadedThisMonth = contentsData.contents.filter(c =>
    c.status === '업로드완료' && c.uploadDate && c.uploadDate.startsWith(currentMonthStr)
  );

  const generalContents = uploadedThisMonth.filter(c => !['광고', '판매', '협찬'].includes(c.category)).length;
  const adContents = uploadedThisMonth.filter(c => ['광고', '판매', '협찬'].includes(c.category)).length;
  // 단계별 진행 상태: 기획 → 제작 → 업로드
  const needPlanning = contentsData.contents.filter(c => ['아이디어', '계약완료'].includes(c.status)).length;
  const needProduction = contentsData.contents.filter(c => ['기획중', '기획안1차공유', '기획안최종컨펌'].includes(c.status)).length;
  const needUpload = contentsData.contents.filter(c => ['제작중', '영상1차공유', '영상최종컨펌'].includes(c.status)).length;

  // Category balance with goals (업로드완료 기준)
  const categoryGoals = {
    '취업/이직': 2, 'AI활용': 2, '재테크': 2, '대기업라이프': 1, '쇼핑/여행': 1
  };
  const categoryCounts = {
    '취업/이직': uploadedThisMonth.filter(c => c.category === '취업/이직').length,
    'AI활용': uploadedThisMonth.filter(c => c.category === 'AI활용').length,
    '재테크': uploadedThisMonth.filter(c => c.category === '재테크').length,
    '대기업라이프': uploadedThisMonth.filter(c => c.category === '대기업라이프').length,
    '쇼핑/여행': uploadedThisMonth.filter(c => c.category === '쇼핑/여행').length
  };
  const totalGoal = 8;
  const totalCount = Object.values(categoryCounts).reduce((a, b) => a + b, 0);

  // Monthly trend data (12 months) - 실제 데이터 기반
  const monthlyContents = Array(12).fill(0);
  contentsData.contents.forEach(c => {
    if (c.uploadDate && c.status === '업로드완료') {
      const uploadMonth = parseInt(c.uploadDate.slice(5, 7)); // Extract month (1-12)
      const uploadYear = parseInt(c.uploadDate.slice(0, 4));
      if (uploadYear === currentYear && uploadMonth >= 1 && uploadMonth <= 12) {
        monthlyContents[uploadMonth - 1]++;
      }
    }
  });
  const totalUploaded = monthlyContents.reduce((a, b) => a + b, 0);
  const monthsWithContent = monthlyContents.filter(m => m > 0).length;
  const monthlyAvg = monthsWithContent > 0 ? parseFloat((totalUploaded / monthsWithContent).toFixed(1)) : 0;
  const maxContents = Math.max(...monthlyContents, 1);

  document.getElementById('dashboard-content').innerHTML = `
    <!-- 콘텐츠 현황 -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
      <div class="bg-white rounded-2xl p-4 shadow-sm border border-botanical-stone">
        <p class="text-xs text-botanical-sage font-medium tracking-wide uppercase mb-1">일반 콘텐츠</p>
        <p class="font-serif text-2xl font-semibold">${generalContents}<span class="text-botanical-clay text-base">/8</span></p>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm border border-botanical-stone">
        <p class="text-xs text-botanical-sage font-medium tracking-wide uppercase mb-1">광고 콘텐츠</p>
        <p class="font-serif text-2xl font-semibold">${adContents}<span class="text-botanical-clay text-base">/2</span></p>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm border border-botanical-stone">
        <p class="text-xs text-botanical-sage font-medium tracking-wide uppercase mb-1">기획 필요</p>
        <p class="font-serif text-2xl font-semibold text-botanical-terracotta">${needPlanning}</p>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm border border-botanical-stone">
        <p class="text-xs text-botanical-sage font-medium tracking-wide uppercase mb-1">제작 필요</p>
        <p class="font-serif text-2xl font-semibold text-botanical-terracotta">${needProduction}</p>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm border border-botanical-stone">
        <p class="text-xs text-botanical-sage font-medium tracking-wide uppercase mb-1">업로드 필요</p>
        <p class="font-serif text-2xl font-semibold text-botanical-terracotta">${needUpload}</p>
      </div>
    </div>

    <!-- 카테고리 Balance -->
    <div class="bg-white rounded-2xl p-5 shadow-sm mb-6">
      <div class="flex items-center justify-between mb-4">
        <h4 class="text-base font-semibold">카테고리 <span class="font-serif italic">Balance</span></h4>
        <span class="text-xs text-botanical-sage bg-botanical-cream px-2 py-0.5 rounded-full">월 8개 기준</span>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div class="p-3 rounded-xl text-center border border-botanical-stone" style="background-color: #F9F8F4;">
          <p class="text-sm text-botanical-fg font-medium mb-1">전체</p>
          <p class="text-2xl font-semibold text-botanical-fg font-serif">${totalCount}<span class="text-botanical-clay">/8</span></p>
        </div>
        ${Object.entries(categoryGoals).map(([cat, goal]) => {
          const count = categoryCounts[cat] || 0;
          const isComplete = count >= goal;
          const isZero = count === 0;
          return `
            <div class="p-2.5 bg-white rounded-xl text-center border border-botanical-stone">
              <p class="text-xs ${isComplete ? 'text-botanical-sage' : (isZero ? 'text-botanical-terracotta' : 'text-botanical-sage')} mb-1">${cat}${isComplete ? ' ✓' : ''}</p>
              <p class="text-xl font-semibold ${isZero ? 'text-botanical-terracotta' : ''} font-serif">${count}<span class="text-botanical-clay">/${goal}</span></p>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- 콘텐츠 Trend -->
    <div class="bg-white rounded-2xl p-5 shadow-sm">
      <h4 class="text-base font-semibold mb-4">콘텐츠 <span class="font-serif italic">Trend</span></h4>
      <div class="flex items-end justify-between gap-1" style="height: 120px;">
        ${monthlyContents.map((count, idx) => {
          const month = idx + 1;
          const isCurrentMonth = month === currentMonth;
          const isFuture = month > currentMonth;
          const height = count > 0 ? (count / maxContents) * 100 : 0;
          const bgColor = isFuture ? '#E6E2DA' : (isCurrentMonth ? '#2D3A31' : '#8C9A84');
          const textColor = isFuture ? 'text-botanical-clay' : (isCurrentMonth ? 'text-botanical-fg font-semibold' : 'text-botanical-sage');
          return `
            <div class="flex-1 flex flex-col items-center gap-1">
              <div class="w-full rounded-t" style="height: ${height}px; background-color: ${bgColor};"></div>
              <span class="text-[10px] ${textColor}">${month}</span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="mt-3 pt-3 border-t border-botanical-stone flex justify-between text-xs">
        <span class="text-botanical-sage">총 ${totalUploaded}개 업로드</span>
        <span class="text-botanical-fg font-medium">월 평균 ${monthlyAvg}개</span>
      </div>
    </div>
  `;
}

// ========== Content List ==========
let contentTypeFilter = 'all'; // 'all', 'general', 'revenue'

function switchContentFilter(filter) {
  contentTypeFilter = filter;
  document.querySelectorAll('.content-filter-btn').forEach(btn => {
    btn.classList.remove('bg-botanical-fg', 'text-white');
    btn.classList.add('bg-botanical-stone', 'text-botanical-sage');
  });
  document.getElementById('content-filter-' + filter).classList.remove('bg-botanical-stone', 'text-botanical-sage');
  document.getElementById('content-filter-' + filter).classList.add('bg-botanical-fg', 'text-white');
  renderContentList();
}

function renderContentList() {
  // Filter contents based on type
  let filteredContents = contentsData.contents;
  if (contentTypeFilter === 'general') {
    filteredContents = contentsData.contents.filter(c => !c.isRevenue);
  } else if (contentTypeFilter === 'revenue') {
    filteredContents = contentsData.contents.filter(c => c.isRevenue);
  }
  const contentCount = filteredContents.length;

  let html = `
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-4">
        <select id="content-month-select" onchange="filterContentByMonth()" class="px-4 py-2 pr-8 rounded-full border border-botanical-stone bg-white text-sm focus:outline-none appearance-none bg-no-repeat" style="background-image: url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%238C9A84%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E'); background-position: right 12px center;">
          <option value="2026-04">2026년 4월</option>
          <option value="2026-03">2026년 3월</option>
          <option value="2026-02">2026년 2월</option>
        </select>
        <div class="flex gap-1 bg-botanical-stone p-1 rounded-full">
          <button onclick="switchContentFilter('all')" id="content-filter-all" class="content-filter-btn px-3 py-1 rounded-full text-xs font-medium ${contentTypeFilter === 'all' ? 'bg-botanical-fg text-white' : 'bg-botanical-stone text-botanical-sage'}">전체</button>
          <button onclick="switchContentFilter('general')" id="content-filter-general" class="content-filter-btn px-3 py-1 rounded-full text-xs font-medium ${contentTypeFilter === 'general' ? 'bg-botanical-fg text-white' : 'bg-botanical-stone text-botanical-sage'}">일반</button>
          <button onclick="switchContentFilter('revenue')" id="content-filter-revenue" class="content-filter-btn px-3 py-1 rounded-full text-xs font-medium ${contentTypeFilter === 'revenue' ? 'bg-botanical-fg text-white' : 'bg-botanical-stone text-botanical-sage'}">수익</button>
        </div>
        <span class="text-sm text-botanical-sage">${contentCount}건</span>
      </div>
      <button onclick="showNewContentModal()" class="px-4 py-2 bg-botanical-fg text-white rounded-xl text-sm font-medium hover:bg-botanical-fg/90 transition-all">+ 새 콘텐츠 등록</button>
    </div>

    <div class="bg-botanical-cream/50 rounded-xl px-5 py-3 mb-4">
      <div class="flex items-center gap-3 text-sm font-medium text-botanical-sage">
        <span class="w-20">카테고리</span>
        <span class="w-16">상태</span>
        <span class="w-14">타입</span>
        <span class="flex-1">콘텐츠 제목</span>
        <span class="w-12 text-center">업로드</span>
        <span class="w-10 text-center">URL</span>
        <span class="w-14 text-center">조회</span>
        <span class="w-12 text-center">좋아요</span>
        <span class="w-10 text-center">공유</span>
        <span class="w-10 text-center">댓글</span>
        <span class="w-10 text-center">저장</span>
        <span class="w-5"></span>
      </div>
    </div>

    <div class="space-y-4">
  `;

  filteredContents.forEach((content, idx) => {
    const statusColors = {
      // 일반 상태
      '아이디어': { bg: '#F3F4F6', text: '#4B5563' },
      '기획중': { bg: '#FEF3C7', text: '#92400E' },
      '제작중': { bg: '#DBEAFE', text: '#1E40AF' },
      '업로드완료': { bg: '#D1FAE5', text: '#065F46' },
      // 수익 상태
      '계약완료': { bg: '#FCE7F3', text: '#9D174D' },
      '기획안1차공유': { bg: '#FEF3C7', text: '#92400E' },
      '기획안최종컨펌': { bg: '#FFEDD5', text: '#9A3412' },
      '영상1차공유': { bg: '#DBEAFE', text: '#1E40AF' },
      '영상최종컨펌': { bg: '#E0E7FF', text: '#3730A3' }
    };
    const statusStyle = statusColors[content.status] || statusColors['기획중'];
    const isCompleted = content.status === '완료' || content.status === '업로드완료';
    const categoryColor = categoryColors[content.category] || '#8C9A84';

    // 성과 입력 필요 체크 (업로드 후 2주 지남 + 성과 데이터 없음)
    let needsPerformance = false;
    if (content.uploadDate && isCompleted) {
      const uploadDate = new Date(content.uploadDate);
      const twoWeeksLater = new Date(uploadDate);
      twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);
      const today = new Date();
      const hasPerformance = content.performance && (content.performance.views || content.performance.likes || content.performance.saves);
      needsPerformance = today >= twoWeeksLater && !hasPerformance;
    }

    html += `
      <div class="bg-white rounded-2xl shadow-sm overflow-hidden ${isCompleted ? 'border-l-4 border-botanical-sage' : ''}">
        <div onclick="toggleContentForm(${content.id})" class="px-5 py-4 cursor-pointer hover:bg-botanical-cream/30 transition-all">
          <div class="flex items-center gap-3 text-sm">
            <span class="w-20"><span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${categoryColor};"></span><span class="text-xs text-botanical-sage truncate">${content.category}</span></span></span>
            <span class="w-16"><span class="px-2 py-1 rounded-full text-xs whitespace-nowrap" style="background-color: ${statusStyle.bg}; color: ${statusStyle.text};">${content.status}</span></span>
            <span class="w-14"><span class="px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-botanical-sage/20 text-botanical-sage">${content.type}</span></span>
            <span class="font-medium flex-1 flex items-center gap-2">${content.title}${needsPerformance ? '<span class="text-sm" title="성과 입력 필요">🔔</span>' : ''}</span>
            <span class="w-12 text-botanical-sage text-xs text-center">${content.uploadDate ? content.uploadDate.slice(5).replace('-', '/') : '-'}</span>
            <span class="w-10 text-xs text-center">${content.url ? `<a href="${content.url}" target="_blank" class="text-blue-500 underline" onclick="event.stopPropagation()">링크</a>` : '<span class="text-botanical-sage">-</span>'}</span>
            <span class="w-14 text-xs text-center ${isCompleted ? 'font-semibold' : 'text-botanical-sage'}">${content.performance.views ? (content.performance.views / 1000).toFixed(1) + 'K' : '-'}</span>
            <span class="w-12 text-xs text-center ${isCompleted ? '' : 'text-botanical-sage'}">${content.performance.likes ? (content.performance.likes / 1000).toFixed(1) + 'K' : '-'}</span>
            <span class="w-10 text-xs text-center ${isCompleted ? '' : 'text-botanical-sage'}">${content.performance.shares || '-'}</span>
            <span class="w-10 text-xs text-center ${isCompleted ? '' : 'text-botanical-sage'}">${content.performance.comments || '-'}</span>
            <span class="w-10 text-xs text-center ${isCompleted ? 'font-semibold text-botanical-terracotta' : 'text-botanical-sage'}">${content.performance.saves || '-'}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-botanical-sage transition-transform w-5 flex-shrink-0" id="arrow-${content.id}"><path d="m6 9 6 6 6-6"/></svg>
          </div>
        </div>
        <div id="form-${content.id}" class="production-form border-t border-botanical-stone">
          ${renderContentForm(content)}
        </div>
      </div>
    `;
  });

  html += '</div>';
  document.getElementById('content-list').innerHTML = html;
}

function renderContentForm(content) {
  const sectionColors = {
    'HOOK': '#6366F1',
    'INTRO': '#10B981',
    'MAIN 1': '#10B981',
    'MAIN 2': '#F59E0B',
    'OUTRO': '#EC4899',
    'CTA': '#EF4444'
  };

  const scriptVersions = (content.script?.versions && content.script.versions.length > 0)
    ? content.script.versions
    : [{ rows: [
        {section: 'HOOK', dialogue: '', subtitle: '', scene: ''},
        {section: 'INTRO', dialogue: '', subtitle: '', scene: ''},
        {section: 'MAIN 1', dialogue: '', subtitle: '', scene: ''},
        {section: 'MAIN 2', dialogue: '', subtitle: '', scene: ''},
        {section: 'OUTRO', dialogue: '', subtitle: '', scene: ''},
        {section: 'CTA', dialogue: '', subtitle: '', scene: ''}
      ]}];
  const currentVer = Math.min(content.script?.currentVersion ?? 0, scriptVersions.length - 1);
  const scriptRows = scriptVersions[currentVer].rows || [];
  // 컬럼 너비 복원 (사용자가 드래그해서 저장한 값)
  const colW = content.script?.columnWidths || {};
  const colSection = colW.section ?? 100;
  const colDialogue = colW.dialogue ?? 280;
  const colSubtitle = colW.subtitle ?? 280;
  const colScene = colW.scene ?? 180;

  return `
    <div class="p-6 space-y-6">
      <!-- 상단 정보 수정 영역 -->
      <div class="p-4 bg-botanical-cream/30 rounded-xl space-y-4">
        <div class="grid grid-cols-4 gap-4">
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">상태</label>
            ${content.isRevenue ? `
            <select class="w-full px-3 py-2 rounded-lg border border-botanical-stone bg-white text-sm focus:outline-none">
              <option value="계약완료" ${content.status === '계약완료' ? 'selected' : ''}>계약완료</option>
              <option value="기획안1차공유" ${content.status === '기획안1차공유' ? 'selected' : ''}>기획안 1차 공유</option>
              <option value="기획안최종컨펌" ${content.status === '기획안최종컨펌' ? 'selected' : ''}>기획안 최종 컨펌</option>
              <option value="영상1차공유" ${content.status === '영상1차공유' ? 'selected' : ''}>영상 1차 공유</option>
              <option value="영상최종컨펌" ${content.status === '영상최종컨펌' ? 'selected' : ''}>영상 최종 컨펌</option>
              <option value="업로드완료" ${content.status === '업로드완료' ? 'selected' : ''}>업로드 완료</option>
            </select>
            ` : `
            <select class="w-full px-3 py-2 rounded-lg border border-botanical-stone bg-white text-sm focus:outline-none">
              <option value="아이디어" ${content.status === '아이디어' ? 'selected' : ''}>아이디어</option>
              <option value="기획중" ${content.status === '기획중' ? 'selected' : ''}>기획중</option>
              <option value="제작중" ${content.status === '제작중' ? 'selected' : ''}>제작중</option>
              <option value="업로드완료" ${content.status === '업로드완료' ? 'selected' : ''}>업로드 완료</option>
            </select>
            `}
          </div>
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">카테고리</label>
            <select class="w-full px-3 py-2 rounded-lg border border-botanical-stone bg-white text-sm focus:outline-none">
              <optgroup label="일반">
                <option value="취업/이직" ${content.category === '취업/이직' ? 'selected' : ''}>취업/이직</option>
                <option value="AI활용" ${content.category === 'AI활용' ? 'selected' : ''}>AI활용</option>
                <option value="재테크" ${content.category === '재테크' ? 'selected' : ''}>재테크</option>
                <option value="대기업라이프" ${content.category === '대기업라이프' ? 'selected' : ''}>대기업라이프</option>
                <option value="쇼핑/여행" ${content.category === '쇼핑/여행' ? 'selected' : ''}>쇼핑/여행</option>
              </optgroup>
              <optgroup label="수익">
                <option value="광고" ${content.category === '광고' ? 'selected' : ''}>광고</option>
                <option value="판매" ${content.category === '판매' ? 'selected' : ''}>판매</option>
                <option value="협찬" ${content.category === '협찬' ? 'selected' : ''}>협찬</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">예정일</label>
            <input type="date" value="${content.uploadDate}" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
          </div>
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">${content.isRevenue ? '브랜드 / 상품' : '핵심 키워드'}</label>
            <input type="text" value="${content.keywords ?? content.title ?? ''}" onchange="updateContentField(${content.id}, 'keywords', this.value)" placeholder="${content.isRevenue ? '브랜드 / 상품명' : '핵심 키워드'}" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
          </div>
        </div>
        <div class="grid grid-cols-6 gap-4">
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">URL</label>
            <input type="text" placeholder="인스타 링크" value="${content.url || ''}" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
          </div>
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">조회수</label>
            <input type="text" placeholder="-" value="${content.performance.views || ''}" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
          </div>
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">좋아요</label>
            <input type="text" placeholder="-" value="${content.performance.likes || ''}" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
          </div>
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">공유</label>
            <input type="text" placeholder="-" value="${content.performance.shares || ''}" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
          </div>
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">댓글</label>
            <input type="text" placeholder="-" value="${content.performance.comments || ''}" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
          </div>
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">저장</label>
            <input type="text" placeholder="-" value="${content.performance.saves || ''}" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
          </div>
        </div>

        <!-- 일정 (캘린더 연동) -->
        <div class="border-t border-botanical-stone pt-4 mt-4">
          <p class="text-sm font-medium mb-3">일정 (캘린더 연동)</p>
          ${content.isRevenue ? `
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="text-xs text-botanical-sage block mb-1">계약완료</label>
              <input type="date" id="milestone-${content.id}-contract" value="${getMilestoneDate(content, '계약완료')}" onchange="updateMilestone(${content.id}, '계약완료', this.value)" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">기획안 1차 공유</label>
              <input type="date" id="milestone-${content.id}-plan1" value="${getMilestoneDate(content, '기획안1차공유')}" onchange="updateMilestone(${content.id}, '기획안1차공유', this.value)" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">기획안 최종 컨펌</label>
              <input type="date" id="milestone-${content.id}-planfinal" value="${getMilestoneDate(content, '기획안최종컨펌')}" onchange="updateMilestone(${content.id}, '기획안최종컨펌', this.value)" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">영상 1차 공유</label>
              <input type="date" id="milestone-${content.id}-video1" value="${getMilestoneDate(content, '영상1차공유')}" onchange="updateMilestone(${content.id}, '영상1차공유', this.value)" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">영상 최종 컨펌</label>
              <input type="date" id="milestone-${content.id}-videofinal" value="${getMilestoneDate(content, '영상최종컨펌')}" onchange="updateMilestone(${content.id}, '영상최종컨펌', this.value)" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">업로드 완료</label>
              <input type="date" id="milestone-${content.id}-upload" value="${getMilestoneDate(content, '업로드완료')}" onchange="updateMilestone(${content.id}, '업로드완료', this.value)" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
            </div>
          </div>
          ` : `
          <div class="grid grid-cols-4 gap-3">
            <div>
              <label class="text-xs text-botanical-sage block mb-1">아이디어</label>
              <input type="date" id="milestone-${content.id}-idea" value="${getMilestoneDate(content, '아이디어')}" onchange="updateMilestone(${content.id}, '아이디어', this.value)" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">기획중</label>
              <input type="date" id="milestone-${content.id}-planning" value="${getMilestoneDate(content, '기획중')}" onchange="updateMilestone(${content.id}, '기획중', this.value)" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">제작중</label>
              <input type="date" id="milestone-${content.id}-production" value="${getMilestoneDate(content, '제작중')}" onchange="updateMilestone(${content.id}, '제작중', this.value)" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">업로드 완료</label>
              <input type="date" id="milestone-${content.id}-upload" value="${getMilestoneDate(content, '업로드완료')}" onchange="updateMilestone(${content.id}, '업로드완료', this.value)" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
            </div>
          </div>
          `}
        </div>
      </div>

      <!-- 1. 레퍼런스 분석 (일반) / 광고·판매·협찬 상세 (수익) -->
      ${content.isRevenue ? `
      <div class="border border-botanical-stone rounded-xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-medium flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-botanical-sage/20 text-botanical-sage text-xs flex items-center justify-center">1</span>
            ${content.category} 상세${content.category === '광고' ? ' (수익 연동)' : ''}
          </h3>
          <span class="text-xs text-botanical-sage">${content.category === '광고' ? '수익 리포트 자동 반영' : '수익 연동 없음'}</span>
        </div>

        <div class="border border-botanical-stone rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <tbody>
              ${content.category === '광고' ? `
              <tr class="border-b border-botanical-stone">
                <td class="px-4 py-3 bg-botanical-cream/40 font-medium w-40 align-middle">소득 구분</td>
                <td class="px-4 py-2">
                  <select onchange="updateAdInfo(${content.id}, 'incomeType', this.value); syncRevenueFromContent(contentsData.contents.find(c => c.id === ${content.id}));" class="w-60 px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none bg-white" style="height:38px;">
                    <option value="etc" ${(content.adInfo?.incomeType ?? 'etc') === 'etc' ? 'selected' : ''}>기타소득</option>
                    <option value="biz" ${content.adInfo?.incomeType === 'biz' ? 'selected' : ''}>사업소득</option>
                  </select>
                </td>
              </tr>
              <tr class="border-b border-botanical-stone">
                <td class="px-4 py-3 bg-botanical-cream/40 font-medium align-middle">광고비 (원)</td>
                <td class="px-4 py-2">
                  <div class="grid grid-cols-4 gap-2 items-center">
                    <input type="number" id="adfee-reels-${content.id}" value="${content.adInfo?.reelsFee || ''}" onchange="updateAdFee(${content.id})" placeholder="0" class="w-full px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                    <input type="number" id="adfee-content-${content.id}" value="${content.adInfo?.contentFee || ''}" onchange="updateAdFee(${content.id})" placeholder="0" class="w-full px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                    <input type="number" id="adfee-secondary-${content.id}" value="${content.adInfo?.secondaryFee || ''}" onchange="updateAdFee(${content.id})" placeholder="0" class="w-full px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                    <div class="text-right text-sm"><span class="text-botanical-sage text-xs">합계 </span><span class="font-serif font-semibold" id="adfee-total-${content.id}">${fmt((content.adInfo?.reelsFee || 0) + (content.adInfo?.contentFee || 0) + (content.adInfo?.secondaryFee || 0))}</span></div>
                  </div>
                  <div class="grid grid-cols-4 gap-2 mt-1 text-[10px] text-botanical-sage text-center">
                    <span>릴스업로드비</span><span>컨텐츠제작비</span><span>2차활용비(월)</span><span></span>
                  </div>
                </td>
              </tr>
              <tr class="border-b border-botanical-stone">
                <td class="px-4 py-3 bg-botanical-cream/40 font-medium align-middle">제작 가이드</td>
                <td class="px-4 py-2">
                  <input type="text" value="${content.adInfo?.guideLink || ''}" onchange="updateAdInfo(${content.id}, 'guideLink', this.value)" placeholder="https://..." class="w-full px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                </td>
              </tr>
              <tr class="border-b border-botanical-stone">
                <td class="px-4 py-3 bg-botanical-cream/40 font-medium align-middle">계약서</td>
                <td class="px-4 py-2">
                  <div class="flex gap-2">
                    <input type="text" value="${content.adInfo?.contractLink || ''}" onchange="updateAdInfo(${content.id}, 'contractLink', this.value)" placeholder="https://... 또는 이미지 URL" class="flex-1 px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                    ${content.adInfo?.contractLink ? `<a href="${content.adInfo.contractLink}" target="_blank" class="px-2 text-xs text-blue-500 border border-blue-200 rounded-lg hover:bg-blue-50 flex items-center">열기</a>` : ''}
                  </div>
                </td>
              </tr>
              ` : content.category === '판매' ? `
              <tr class="border-b border-botanical-stone">
                <td class="px-4 py-3 bg-botanical-cream/40 font-medium w-40 align-middle">판매 상품명</td>
                <td class="px-4 py-2">
                  <input type="text" value="${content.adInfo?.productName || ''}" onchange="updateAdInfo(${content.id}, 'productName', this.value)" placeholder="상품명 입력" class="w-full px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                </td>
              </tr>
              <tr class="border-b border-botanical-stone">
                <td class="px-4 py-3 bg-botanical-cream/40 font-medium align-middle">판매 링크</td>
                <td class="px-4 py-2">
                  <div class="flex gap-2">
                    <input type="text" value="${content.adInfo?.saleLink || ''}" onchange="updateAdInfo(${content.id}, 'saleLink', this.value)" placeholder="https://..." class="flex-1 px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                    ${content.adInfo?.saleLink ? `<a href="${content.adInfo.saleLink}" target="_blank" class="px-2 text-xs text-blue-500 border border-blue-200 rounded-lg hover:bg-blue-50 flex items-center">열기</a>` : ''}
                  </div>
                </td>
              </tr>
              ` : `
              <tr class="border-b border-botanical-stone">
                <td class="px-4 py-3 bg-botanical-cream/40 font-medium w-40 align-middle">협찬 상품명</td>
                <td class="px-4 py-2">
                  <input type="text" value="${content.adInfo?.productName || ''}" onchange="updateAdInfo(${content.id}, 'productName', this.value)" placeholder="협찬 받은 상품명" class="w-full px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                </td>
              </tr>
              `}

              <tr class="border-b border-botanical-stone">
                <td class="px-4 py-3 bg-botanical-cream/40 font-medium align-top">메모</td>
                <td class="px-4 py-2">
                  <textarea rows="2" onchange="updateAdInfo(${content.id}, 'note', this.value)" placeholder="제작 시 참고사항..." class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none resize-y">${content.adInfo?.note || ''}</textarea>
                </td>
              </tr>

              <tr ${content.category === '광고' ? 'class="border-b border-botanical-stone"' : ''}>
                <td class="px-4 py-3 bg-botanical-cream/40 font-medium align-middle">참고 링크</td>
                <td class="px-4 py-2">
                  <div class="grid grid-cols-2 gap-3">
                    ${[0, 1].map(idx => {
                      const link = content.adInfo?.refLinks?.[idx] || '';
                      return `
                      <div class="flex gap-2">
                        <input type="text" value="${link}" onchange="updateAdRefLink(${content.id}, ${idx}, this.value)" placeholder="https://..." class="flex-1 min-w-0 px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                        ${link ? `<a href="${link}" target="_blank" class="px-2 text-xs text-blue-500 border border-blue-200 rounded-lg hover:bg-blue-50 flex items-center shrink-0">열기</a>` : ''}
                      </div>`;
                    }).join('')}
                  </div>
                </td>
              </tr>

              ${content.category === '광고' ? `
              <tr>
                <td class="px-4 py-3 bg-botanical-terracotta/10 font-medium text-botanical-terracotta align-middle">광고주 전달 기획안</td>
                <td class="px-4 py-2">
                  <div class="flex gap-2">
                    <input type="text" value="${content.adInfo?.clientNotion ?? DEFAULT_CLIENT_NOTION}" onchange="updateClientNotion(${content.id}, this.value)" placeholder="노션 링크" class="flex-1 px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                    <a href="${content.adInfo?.clientNotion ?? DEFAULT_CLIENT_NOTION}" target="_blank" class="px-2 text-xs text-blue-500 border border-blue-200 rounded-lg hover:bg-blue-50 flex items-center">열기</a>
                  </div>
                </td>
              </tr>
              ` : ''}
            </tbody>
          </table>
        </div>
      </div>
      ` : `
      <div class="border border-botanical-stone rounded-xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-medium flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-botanical-sage/20 text-botanical-sage text-xs flex items-center justify-center">1</span>
            레퍼런스 분석
          </h3>
          <span class="text-xs text-botanical-sage">선택사항</span>
        </div>

        <div class="mb-5 p-4 bg-botanical-cream/50 rounded-lg">
          <p class="text-sm font-medium text-botanical-terracotta mb-3">레퍼런스 체크리스트</p>
          <div class="space-y-2">
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" class="w-4 h-4 rounded border-botanical-stone">
              <span>6개월~1년 이내의 최신 영상인가요?</span>
            </label>
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" class="w-4 h-4 rounded border-botanical-stone">
              <span>팔로워는 낮은데 조회수가 높은 <strong>콘텐츠인가요?</strong> (조회수가 팔로워의 최소 10배수)</span>
            </label>
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" class="w-4 h-4 rounded border-botanical-stone">
              <span>내 주제와 관련성이 있나요?</span>
            </label>
          </div>
        </div>

        <div class="border border-botanical-stone rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <tbody>
              <tr class="border-b border-botanical-stone"><td class="px-4 py-3 bg-botanical-cream/30 font-medium w-1/3">링크</td><td class="px-4 py-3"><input type="text" placeholder="인스타 URL" class="w-full bg-transparent focus:outline-none"></td></tr>
              <tr class="border-b border-botanical-stone"><td class="px-4 py-3 bg-botanical-cream/30 font-medium">썸네일 제목</td><td class="px-4 py-3"><input type="text" class="w-full bg-transparent focus:outline-none"></td></tr>
              <tr class="border-b border-botanical-stone"><td class="px-4 py-3 bg-botanical-cream/30 font-medium">첫 3초 훅킹 멘트, 장면 (1~2줄)</td><td class="px-4 py-3"><input type="text" class="w-full bg-transparent focus:outline-none"></td></tr>
              <tr class="border-b border-botanical-stone"><td class="px-4 py-3 bg-botanical-cream/30 font-medium">계정 팔로워 수</td><td class="px-4 py-3"><input type="text" class="w-full bg-transparent focus:outline-none"></td></tr>
              <tr class="border-b border-botanical-stone"><td class="px-4 py-3 bg-botanical-cream/30 font-medium">조회수</td><td class="px-4 py-3"><input type="text" class="w-full bg-transparent focus:outline-none"></td></tr>
              <tr class="border-b border-botanical-stone"><td class="px-4 py-3 bg-botanical-cream/30 font-medium">좋아요</td><td class="px-4 py-3"><input type="text" class="w-full bg-transparent focus:outline-none"></td></tr>
              <tr class="border-b border-botanical-stone"><td class="px-4 py-3 bg-botanical-cream/30 font-medium">공유</td><td class="px-4 py-3"><input type="text" class="w-full bg-transparent focus:outline-none"></td></tr>
              <tr class="border-b border-botanical-stone"><td class="px-4 py-3 bg-botanical-cream/30 font-medium">저장</td><td class="px-4 py-3"><input type="text" class="w-full bg-transparent focus:outline-none"></td></tr>
              <tr class="border-b border-botanical-stone"><td class="px-4 py-3 bg-botanical-cream/30 font-medium">댓글</td><td class="px-4 py-3"><input type="text" class="w-full bg-transparent focus:outline-none"></td></tr>
              <tr class="border-b border-botanical-stone"><td class="px-4 py-3 bg-botanical-cream/30 font-medium">영상 길이</td><td class="px-4 py-3"><input type="text" class="w-full bg-transparent focus:outline-none"></td></tr>
              <tr><td class="px-4 py-3 bg-botanical-cream/30 font-medium">잘 터진 이유 (정보 / 공감 / 유머 등)</td><td class="px-4 py-3"><input type="text" class="w-full bg-transparent focus:outline-none"></td></tr>
            </tbody>
          </table>
        </div>

        <!-- 노션 링크 여러 개 -->
        <div class="mt-4">
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs text-botanical-sage">노션 링크 (분석 자료)</label>
            <button onclick="addNotionLink(${content.id})" class="px-2 py-0.5 text-xs text-botanical-sage border border-botanical-stone rounded-lg hover:bg-botanical-cream transition-all">+ 링크 추가</button>
          </div>
          <div id="notion-links-${content.id}" class="space-y-2">
            ${(content.notionLinks && content.notionLinks.length > 0 ? content.notionLinks : ['']).map((link, idx) => `
              <div class="flex gap-2">
                <input type="text" value="${link}" onchange="updateNotionLink(${content.id}, ${idx}, this.value)" placeholder="노션 링크 (분석 자료)" class="flex-1 px-4 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none focus:border-botanical-sage">
                ${idx > 0 ? `<button onclick="removeNotionLink(${content.id}, ${idx})" class="px-2 py-1 text-xs text-red-400 border border-red-200 rounded-lg hover:bg-red-50 transition-all">삭제</button>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      `}

      <!-- 2. 촬영 및 대본 -->
      <div class="border border-botanical-stone rounded-xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-medium flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-botanical-sage/20 text-botanical-sage text-xs flex items-center justify-center">2</span>
            촬영 및 대본 (20초 미만~최대 30초)
          </h3>
          <div class="flex gap-2">
            ${scriptVersions.map((_, i) => `
              <button onclick="switchScriptVersion(${content.id}, ${i})" class="px-3 py-1 rounded-full text-xs ${i === currentVer ? 'bg-botanical-sage text-white' : 'border border-botanical-stone hover:bg-botanical-cream transition-all'}">V${i+1}</button>
            `).join('')}
            <button onclick="addScriptVersion(${content.id})" class="px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">+</button>
          </div>
        </div>

        <div class="mb-5 p-4 bg-botanical-cream/50 rounded-lg">
          <p class="text-sm font-medium text-botanical-terracotta mb-3">기획 체크리스트</p>
          <div class="space-y-2">
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="w-4 h-4 rounded border-botanical-stone"><span>이 영상을 봐야할 타겟이 명확한가요?</span></label>
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="w-4 h-4 rounded border-botanical-stone"><span>공유 또는 저장할 이유가 있나요?</span></label>
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="w-4 h-4 rounded border-botanical-stone"><span>첫 3~5초 안에 주제 / 미끼를 드러냈나요?</span></label>
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="w-4 h-4 rounded border-botanical-stone"><span>영상 길이가 30초 이내로 간결한가요?</span></label>
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="w-4 h-4 rounded border-botanical-stone"><span>콘텐츠에서 다 못 알려준 정보는 본문에 상세히 풀었나요?</span></label>
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="w-4 h-4 rounded border-botanical-stone"><span>본문 글이 간결하고 잘 읽히나요?</span></label>
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="w-4 h-4 rounded border-botanical-stone"><span>레퍼런스 카피가 아닌지 냉정하게 판단해주세요.</span></label>
          </div>
        </div>

        <div class="mb-4">
          <label class="text-sm font-medium mb-2 block">썸네일 제목 <span class="text-xs text-botanical-sage font-normal">(목록·캘린더에도 표시됨)</span></label>
          <input type="text" value="${content.title ?? ''}" onchange="updateContentTitle(${content.id}, this.value)" placeholder="썸네일 제목 입력" class="w-full px-4 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none focus:border-botanical-sage">
        </div>

        <div class="mb-4">
          <div class="flex items-center justify-between mb-3">
            <p class="text-sm font-medium text-botanical-terracotta">대본 작성</p>
            <div class="flex gap-2">
              <button onclick="copyScript(${content.id}, 'dialogue')" class="px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">대사 복사</button>
              <button onclick="copyScript(${content.id}, 'subtitle')" class="px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">자막 복사</button>
            </div>
          </div>
          <div class="border border-botanical-stone rounded-lg overflow-x-auto">
            <table class="script-table text-sm" data-content-id="${content.id}" style="table-layout: fixed; width: auto;">
              <colgroup>
                <col style="width: ${colSection}px">
                <col style="width: ${colDialogue}px">
                <col style="width: ${colSubtitle}px">
                <col style="width: ${colScene}px">
              </colgroup>
              <thead>
                <tr class="bg-botanical-cream/50">
                  <th class="col-resizable px-4 py-3 text-left font-medium" data-col="section">구간<span class="col-resize-handle"></span></th>
                  <th class="col-resizable px-4 py-3 text-left font-medium" data-col="dialogue">대사<span class="col-resize-handle"></span></th>
                  <th class="col-resizable px-4 py-3 text-left font-medium" data-col="subtitle">자막<span class="col-resize-handle"></span></th>
                  <th class="px-4 py-3 text-left font-medium" data-col="scene">장면</th>
                </tr>
              </thead>
              <tbody id="script-tbody-${content.id}">
                ${scriptRows.map((row, idx) => `
                  <tr class="border-t border-botanical-stone group">
                    <td class="px-4 py-3 font-semibold relative">
                      <input type="text" value="${row.section || ''}" onchange="updateScriptRow(${content.id}, ${idx}, 'section', this.value)" class="w-full bg-transparent focus:outline-none font-semibold pr-5" style="color: ${sectionColors[row.section] || '#8C9A84'};">
                      <button onclick="removeScriptRow(${content.id}, ${idx})" title="행 삭제" class="absolute top-1 right-1 w-5 h-5 rounded text-xs text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-opacity">×</button>
                    </td>
                    <td class="px-4 py-3 border-l border-botanical-stone"><textarea rows="1" oninput="autoResize(this)" onchange="updateScriptRow(${content.id}, ${idx}, 'dialogue', this.value)" class="script-cell w-full bg-transparent focus:outline-none resize-none overflow-hidden">${row.dialogue || ''}</textarea></td>
                    <td class="px-4 py-3 border-l border-botanical-stone"><textarea rows="1" oninput="autoResize(this)" onchange="updateScriptRow(${content.id}, ${idx}, 'subtitle', this.value)" class="script-cell w-full bg-transparent focus:outline-none resize-none overflow-hidden">${row.subtitle || ''}</textarea></td>
                    <td class="px-4 py-3 border-l border-botanical-stone"><textarea rows="1" oninput="autoResize(this)" onchange="updateScriptRow(${content.id}, ${idx}, 'scene', this.value)" class="script-cell w-full bg-transparent focus:outline-none resize-none overflow-hidden">${row.scene || ''}</textarea></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <button onclick="addScriptRow(${content.id})" class="mt-2 px-3 py-1.5 text-xs text-botanical-sage border border-botanical-stone rounded-lg hover:bg-botanical-cream transition-all">+ 행 추가</button>
        </div>

        <div>
          <input type="text" placeholder="노션 링크 (대본 자료)" class="w-full px-4 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none focus:border-botanical-sage">
        </div>
      </div>

      <!-- 3. 캡션 -->
      <div class="border border-botanical-stone rounded-xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-medium flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-botanical-sage/20 text-botanical-sage text-xs flex items-center justify-center">3</span>
            캡션 작성
          </h3>
          <button onclick="copyCaption(${content.id})" class="px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">캡션 복사</button>
        </div>
        <textarea id="caption-${content.id}" rows="3" onchange="updateContentField(${content.id}, 'caption', this.value)" placeholder="인스타그램 캡션 입력..." class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none focus:border-botanical-sage resize-y">${content.caption || ''}</textarea>
      </div>

      <!-- 4. 공유 링크 + DM 자동 답변 -->
      <div class="border border-botanical-stone rounded-xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-medium flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-botanical-sage/20 text-botanical-sage text-xs flex items-center justify-center">4</span>
            공유 링크 & DM 답변
          </h3>
          <button onclick="copyDM(${content.id})" class="px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">DM 복사</button>
        </div>
        <div class="mb-4">
          <input type="text" value="${content.shareLink || ''}" onchange="updateContentField(${content.id}, 'shareLink', this.value)" placeholder="팔로워 공유용 링크" class="w-full px-4 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none focus:border-botanical-sage">
        </div>
        <div>
          <label class="text-xs text-botanical-sage mb-2 block">DM 자동 답변</label>
          <textarea id="dm-${content.id}" rows="4" onchange="updateContentField(${content.id}, 'dm', this.value)" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none focus:border-botanical-sage resize-y">${content.dm || '안녕하세요 🙋‍♀️\n버튼 누르시면 👇🏻\n[ ]\n자료 확인하실 수 있어요'}</textarea>
        </div>
      </div>

      <!-- Delete Button -->
      <div class="flex justify-end">
        <button onclick="deleteContent(${content.id})" class="px-4 py-2 border border-red-300 text-red-400 rounded-xl text-sm hover:bg-red-50 transition-all">콘텐츠 삭제</button>
      </div>
    </div>
  `;
}

function getMilestoneDate(content, status) {
  if (!content.milestones) return '';
  const milestone = content.milestones.find(m => m.status === status);
  return milestone ? milestone.date : '';
}

function updateMilestone(contentId, status, date) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;

  if (!content.milestones) {
    content.milestones = [];
  }

  const existingIdx = content.milestones.findIndex(m => m.status === status);
  if (date) {
    if (existingIdx >= 0) {
      content.milestones[existingIdx].date = date;
    } else {
      content.milestones.push({ status, date });
    }
  } else {
    if (existingIdx >= 0) {
      content.milestones.splice(existingIdx, 1);
    }
  }

  // 캘린더에도 업데이트
  const existingCalendarItem = calendarData.items.find(
    item => item.contentId === contentId && item.status === status && item.isMilestone
  );

  if (date) {
    if (existingCalendarItem) {
      existingCalendarItem.date = date;
    } else {
      calendarData.items.push({
        id: Date.now(),
        date: date,
        title: content.title,
        category: content.category,
        type: content.type,
        status: status,
        contentId: contentId,
        isRevenue: content.isRevenue,
        revenueType: content.isRevenue ? content.category : null,
        isMilestone: true
      });
    }
  } else {
    if (existingCalendarItem) {
      const idx = calendarData.items.indexOf(existingCalendarItem);
      calendarData.items.splice(idx, 1);
    }
  }

  saveAllData();
  renderCalendar();
}

function toggleContentForm(id) {
  const form = document.getElementById('form-' + id);
  const arrow = document.getElementById('arrow-' + id);
  form.classList.toggle('active');
  arrow.style.transform = form.classList.contains('active') ? 'rotate(180deg)' : 'rotate(0deg)';
  if (form.classList.contains('active')) requestAnimationFrame(autoResizeAllScriptCells);
}

// ========== Script Row/Version 관련 ==========
const DEFAULT_SCRIPT_ROWS = () => [
  {section: 'HOOK', dialogue: '', subtitle: '', scene: ''},
  {section: 'INTRO', dialogue: '', subtitle: '', scene: ''},
  {section: 'MAIN 1', dialogue: '', subtitle: '', scene: ''},
  {section: 'MAIN 2', dialogue: '', subtitle: '', scene: ''},
  {section: 'OUTRO', dialogue: '', subtitle: '', scene: ''},
  {section: 'CTA', dialogue: '', subtitle: '', scene: ''}
];

function ensureScript(content) {
  if (!content.script || !content.script.versions || content.script.versions.length === 0) {
    content.script = { versions: [{ rows: DEFAULT_SCRIPT_ROWS() }], currentVersion: 0 };
  }
  if (content.script.currentVersion == null) content.script.currentVersion = 0;
  if (content.script.currentVersion >= content.script.versions.length) {
    content.script.currentVersion = content.script.versions.length - 1;
  }
}

function reopenForm(contentId) {
  const form = document.getElementById('form-' + contentId);
  if (form) form.classList.add('active');
  const arrow = document.getElementById('arrow-' + contentId);
  if (arrow) arrow.style.transform = 'rotate(180deg)';
  requestAnimationFrame(autoResizeAllScriptCells);
}

function addScriptRow(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  ensureScript(content);
  const ver = content.script.currentVersion;
  if (!content.script.versions[ver].rows) content.script.versions[ver].rows = [];
  content.script.versions[ver].rows.push({section: '', dialogue: '', subtitle: '', scene: ''});
  saveAllData();
  renderContentList();
  reopenForm(contentId);
}

function autoResize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight + 2) + 'px';
}

function autoResizeAllScriptCells() {
  document.querySelectorAll('.script-table textarea.script-cell').forEach(autoResize);
}

function removeScriptRow(contentId, rowIdx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content?.script?.versions) return;
  const ver = content.script.currentVersion ?? 0;
  const rows = content.script.versions[ver]?.rows;
  if (!rows || rows.length <= 1) return;
  rows.splice(rowIdx, 1);
  saveAllData();
  renderContentList();
  reopenForm(contentId);
}

function addScriptVersion(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  ensureScript(content);
  content.script.versions.push({ rows: DEFAULT_SCRIPT_ROWS() });
  content.script.currentVersion = content.script.versions.length - 1;
  saveAllData();
  renderContentList();
  reopenForm(contentId);
}

function switchScriptVersion(contentId, versionIdx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content?.script?.versions?.[versionIdx]) return;
  content.script.currentVersion = versionIdx;
  saveAllData();
  renderContentList();
  reopenForm(contentId);
}

function updateScriptRow(contentId, idx, field, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  ensureScript(content);
  const ver = content.script.currentVersion;
  if (!content.script.versions[ver].rows?.[idx]) return;
  content.script.versions[ver].rows[idx][field] = value;
  saveAllData();
}

function copyScript(contentId, field) {
  const content = contentsData.contents.find(c => c.id === contentId);
  const ver = content?.script?.currentVersion ?? 0;
  const rows = content?.script?.versions?.[ver]?.rows;
  if (!rows || rows.length === 0) { alert('복사할 내용이 없습니다'); return; }
  const text = rows.map(r => r[field] || '').filter(t => t.trim()).join('\n');
  if (!text) { alert('복사할 내용이 없습니다'); return; }
  navigator.clipboard.writeText(text).then(() => {
    alert((field === 'dialogue' ? '대사' : '자막') + ' 복사됨');
  }).catch(() => alert('복사 실패'));
}

function copyCaption(contentId) {
  const el = document.getElementById('caption-' + contentId);
  if (!el || !el.value.trim()) { alert('복사할 캡션이 없습니다'); return; }
  navigator.clipboard.writeText(el.value).then(() => alert('캡션 복사됨'));
}

function copyDM(contentId) {
  const el = document.getElementById('dm-' + contentId);
  if (!el || !el.value.trim()) { alert('복사할 DM이 없습니다'); return; }
  navigator.clipboard.writeText(el.value).then(() => alert('DM 복사됨'));
}

function updateContentField(contentId, field, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  content[field] = value;
  saveAllData();
}

// 제목 변경 — 캘린더에 연동된 항목들의 title도 함께 업데이트
function updateContentTitle(contentId, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  content.title = value;
  calendarData.items.forEach(item => {
    if (item.contentId === contentId) item.title = value;
  });
  // 수익 리포트의 brand도 동기화
  ['ad', 'sales', 'sponsor'].forEach(t => {
    (revenueData.items?.[t] || []).forEach(item => {
      if (item.contentId === contentId) item.brand = value || '무제';
    });
  });
  saveAllData();
  renderContentList();
  renderCalendar();
  renderRevenue();
  // 폼 다시 펼치기
  const form = document.getElementById('form-' + contentId);
  if (form) form.classList.add('active');
  const arrow = document.getElementById('arrow-' + contentId);
  if (arrow) arrow.style.transform = 'rotate(180deg)';
}

// ========== 광고 상세 ==========
function updateAdInfo(contentId, field, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.adInfo) content.adInfo = {};
  content.adInfo[field] = value;
  saveAllData();
  syncRevenueFromContent(content);
}

function updateAdFee(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.adInfo) content.adInfo = {};
  content.adInfo.reelsFee = parseInt(document.getElementById('adfee-reels-' + contentId).value) || 0;
  content.adInfo.contentFee = parseInt(document.getElementById('adfee-content-' + contentId).value) || 0;
  content.adInfo.secondaryFee = parseInt(document.getElementById('adfee-secondary-' + contentId).value) || 0;
  const total = content.adInfo.reelsFee + content.adInfo.contentFee + content.adInfo.secondaryFee;
  const totalEl = document.getElementById('adfee-total-' + contentId);
  if (totalEl) totalEl.textContent = fmt(total);
  saveAllData();
  syncRevenueFromContent(content);
}

function updateAdRefLink(contentId, idx, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.adInfo) content.adInfo = {};
  if (!content.adInfo.refLinks) content.adInfo.refLinks = ['', ''];
  content.adInfo.refLinks[idx] = value;
  saveAllData();
  renderContentList();
  const form = document.getElementById('form-' + contentId);
  if (form) form.classList.add('active');
  const arrow = document.getElementById('arrow-' + contentId);
  if (arrow) arrow.style.transform = 'rotate(180deg)';
}

function updateClientNotion(contentId, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.adInfo) content.adInfo = {};
  content.adInfo.clientNotion = value;
  saveAllData();
  renderContentList();
  const form = document.getElementById('form-' + contentId);
  if (form) form.classList.add('active');
  const arrow = document.getElementById('arrow-' + contentId);
  if (arrow) arrow.style.transform = 'rotate(180deg)';
}

// ========== 노션 링크 (일반 레퍼런스) ==========
function addNotionLink(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.notionLinks) content.notionLinks = [''];
  content.notionLinks.push('');
  saveAllData();
  renderContentList();
  const form = document.getElementById('form-' + contentId);
  if (form) form.classList.add('active');
  const arrow = document.getElementById('arrow-' + contentId);
  if (arrow) arrow.style.transform = 'rotate(180deg)';
}

function updateNotionLink(contentId, idx, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.notionLinks) content.notionLinks = [''];
  content.notionLinks[idx] = value;
  saveAllData();
}

function removeNotionLink(contentId, idx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content?.notionLinks) return;
  content.notionLinks.splice(idx, 1);
  saveAllData();
  renderContentList();
  const form = document.getElementById('form-' + contentId);
  if (form) form.classList.add('active');
  const arrow = document.getElementById('arrow-' + contentId);
  if (arrow) arrow.style.transform = 'rotate(180deg)';
}

// ========== 수익 리포트 자동 연동 ==========
// 광고만 수익 리포트에 연동 (판매/협찬은 추후 별도 처리)
function syncRevenueFromContent(content) {
  if (!content.isRevenue || content.category !== '광고') {
    // 광고가 아니면 혹시라도 등록된 ad 항목 제거
    if (revenueData.items?.ad) {
      revenueData.items.ad = revenueData.items.ad.filter(i => i.contentId !== content.id);
    }
    recalculateRevenueSummary();
    saveAllData();
    renderRevenue();
    return;
  }

  if (!revenueData.items) revenueData.items = { ad: [], sales: [], sponsor: [] };
  if (!revenueData.items.ad) revenueData.items.ad = [];

  const total = (content.adInfo?.reelsFee || 0) + (content.adInfo?.contentFee || 0) + (content.adInfo?.secondaryFee || 0);
  const date = content.uploadDate || new Date().toISOString().slice(0, 10);
  const brand = content.title || '무제';
  const incomeType = content.adInfo?.incomeType || 'etc';

  const existingIdx = revenueData.items.ad.findIndex(item => item.contentId === content.id);
  if (total > 0) {
    const entry = { contentId: content.id, date, brand, amount: total, incomeType };
    if (existingIdx >= 0) revenueData.items.ad[existingIdx] = entry;
    else revenueData.items.ad.push(entry);
  } else {
    if (existingIdx >= 0) revenueData.items.ad.splice(existingIdx, 1);
  }

  recalculateRevenueSummary();
  saveAllData();
  renderRevenue();
}

function recalculateRevenueSummary() {
  const currentMonthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  const yearStr = String(currentYear);

  if (!revenueData.byType) revenueData.byType = { ad: {}, sales: {}, sponsor: {} };
  ['ad', 'sales', 'sponsor'].forEach(t => {
    const items = revenueData.items?.[t] || [];
    revenueData.byType[t].thisMonth = items.filter(i => i.date?.startsWith(currentMonthStr)).reduce((s, i) => s + (i.amount || 0), 0);
    revenueData.byType[t].thisYear = items.filter(i => i.date?.startsWith(yearStr)).reduce((s, i) => s + (i.amount || 0), 0);
  });

  if (!revenueData.summary) revenueData.summary = {};
  revenueData.summary.thisMonth = revenueData.byType.ad.thisMonth + revenueData.byType.sales.thisMonth + revenueData.byType.sponsor.thisMonth;
  revenueData.summary.thisYear = revenueData.byType.ad.thisYear + revenueData.byType.sales.thisYear + revenueData.byType.sponsor.thisYear;

  // 세금 자동 계산 - 광고 item의 incomeType 기반
  let etc88 = 0, biz33 = 0;
  (revenueData.items?.ad || []).forEach(i => {
    if (!i.date?.startsWith(yearStr)) return;
    if (i.incomeType === 'biz') biz33 += (i.amount || 0) * 0.033;
    else etc88 += (i.amount || 0) * 0.088;
  });
  // 판매는 무조건 사업소득
  (revenueData.items?.sales || []).forEach(i => {
    if (!i.date?.startsWith(yearStr)) return;
    biz33 += (i.amount || 0) * 0.033;
  });
  if (!revenueData.tax) revenueData.tax = {};
  revenueData.tax.etc88 = Math.round(etc88);
  revenueData.tax.biz33 = Math.round(biz33);

  // monthly 재계산
  const monthlyMap = {};
  ['ad', 'sales', 'sponsor'].forEach(t => {
    (revenueData.items?.[t] || []).forEach(i => {
      const m = i.date?.slice(0, 7);
      if (!m) return;
      if (!monthlyMap[m]) monthlyMap[m] = { month: m, ad: 0, sales: 0, sponsor: 0 };
      monthlyMap[m][t] += i.amount || 0;
    });
  });
  revenueData.monthly = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));
}

function deleteContent(contentId) {
  if (confirm('이 콘텐츠를 삭제하시겠습니까?')) {
    // 수익 리포트에서도 제거
    if (revenueData.items) {
      ['ad', 'sales', 'sponsor'].forEach(t => {
        if (revenueData.items[t]) {
          revenueData.items[t] = revenueData.items[t].filter(i => i.contentId !== contentId);
        }
      });
      recalculateRevenueSummary();
    }
    contentsData.contents = contentsData.contents.filter(c => c.id !== contentId);
    // 캘린더 연동 항목도 제거
    calendarData.items = calendarData.items.filter(i => i.contentId !== contentId);
    saveAllData();
    renderContentList();
    renderCalendar();
    renderRevenue();
    return;
  }
}

function showNewContentModal() {
  const popup = document.getElementById('calendar-popup');
  const popupContent = document.getElementById('popup-content');

  popupContent.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-lg">새 콘텐츠 등록</h3>
      <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <!-- Tab buttons -->
    <div class="flex gap-2 mb-4">
      <button onclick="switchContentTab('general')" id="content-tab-general" class="content-tab-btn flex-1 py-2 rounded-xl text-sm font-medium bg-botanical-fg text-white">일반</button>
      <button onclick="switchContentTab('revenue')" id="content-tab-revenue" class="content-tab-btn flex-1 py-2 rounded-xl text-sm font-medium bg-botanical-stone text-botanical-sage">수익</button>
    </div>

    <!-- General form -->
    <div id="content-form-general" class="content-form space-y-4">
      <div>
        <label class="text-sm font-medium block mb-1">키워드</label>
        <input type="text" id="new-content-title" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none" placeholder="캘린더 표시용 키워드">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-sm font-medium block mb-1">카테고리</label>
          <select id="new-content-category" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
            <option value="취업/이직">취업/이직</option>
            <option value="AI활용">AI활용</option>
            <option value="재테크">재테크</option>
            <option value="대기업라이프">대기업라이프</option>
            <option value="쇼핑/여행">쇼핑/여행</option>
          </select>
        </div>
        <div>
          <label class="text-sm font-medium block mb-1">타입</label>
          <select id="new-content-type" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
            <option value="릴스">릴스</option>
            <option value="캐러셀">캐러셀</option>
          </select>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-sm font-medium block mb-1">상태 <span class="text-xs text-botanical-sage">(선택)</span></label>
          <select id="new-content-status" class="w-full px-3 rounded-xl border border-botanical-stone focus:outline-none text-sm" style="height: 42px; box-sizing: border-box;">
            <option value="">선택 안 함</option>
            <option value="아이디어">아이디어</option>
            <option value="기획중">기획중</option>
            <option value="제작중">제작중</option>
            <option value="업로드완료">업로드 완료</option>
          </select>
        </div>
        <div>
          <label class="text-sm font-medium block mb-1">날짜 <span class="text-xs text-botanical-sage">(선택)</span></label>
          <input type="date" id="new-content-date" class="w-full px-3 rounded-xl border border-botanical-stone focus:outline-none text-sm" style="height: 42px; box-sizing: border-box;">
        </div>
      </div>
      <button onclick="saveNewContent('general')" class="w-full py-2.5 bg-botanical-fg text-white rounded-xl hover:bg-botanical-fg/90 transition-all font-medium">등록</button>
    </div>

    <!-- Revenue form -->
    <div id="content-form-revenue" class="content-form space-y-4 hidden">
      <div>
        <label class="text-sm font-medium block mb-1">브랜드명</label>
        <input type="text" id="new-content-brand" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none" placeholder="브랜드명">
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">수익 유형</label>
        <div class="flex gap-2">
          <button onclick="selectRevenueContentType('광고')" id="rev-content-type-광고" class="rev-content-type-btn flex-1 py-2 rounded-xl text-sm font-medium border-2 border-botanical-terracotta bg-botanical-terracotta/10 text-botanical-terracotta">광고</button>
          <button onclick="selectRevenueContentType('판매')" id="rev-content-type-판매" class="rev-content-type-btn flex-1 py-2 rounded-xl text-sm font-medium border-2 border-botanical-stone text-botanical-sage">판매</button>
          <button onclick="selectRevenueContentType('협찬')" id="rev-content-type-협찬" class="rev-content-type-btn flex-1 py-2 rounded-xl text-sm font-medium border-2 border-botanical-stone text-botanical-sage">협찬</button>
        </div>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">타입</label>
        <select id="new-content-revenue-type" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
          <option value="릴스">릴스</option>
          <option value="캐러셀">캐러셀</option>
        </select>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-sm font-medium block mb-1">상태 <span class="text-xs text-botanical-sage">(선택)</span></label>
          <select id="new-content-rev-status" class="w-full px-3 rounded-xl border border-botanical-stone focus:outline-none text-sm" style="height: 42px; box-sizing: border-box;">
            <option value="">선택 안 함</option>
            <option value="계약완료">계약완료</option>
            <option value="기획안1차공유">기획안 1차 공유</option>
            <option value="기획안최종컨펌">기획안 최종 컨펌</option>
            <option value="영상1차공유">영상 1차 공유</option>
            <option value="영상최종컨펌">영상 최종 컨펌</option>
            <option value="업로드완료">업로드 완료</option>
          </select>
        </div>
        <div>
          <label class="text-sm font-medium block mb-1">날짜 <span class="text-xs text-botanical-sage">(선택)</span></label>
          <input type="date" id="new-content-rev-date" class="w-full px-3 rounded-xl border border-botanical-stone focus:outline-none text-sm" style="height: 42px; box-sizing: border-box;">
        </div>
      </div>
      <button onclick="saveNewContent('revenue')" class="w-full py-2.5 bg-botanical-terracotta text-white rounded-xl hover:bg-botanical-terracotta/90 transition-all font-medium">등록</button>
    </div>
  `;

  popup.classList.remove('hidden');
}

let selectedRevenueContentType = '광고';

function switchContentTab(tab) {
  document.querySelectorAll('.content-tab-btn').forEach(btn => {
    btn.classList.remove('bg-botanical-fg', 'text-white', 'bg-botanical-terracotta');
    btn.classList.add('bg-botanical-stone', 'text-botanical-sage');
  });
  document.querySelectorAll('.content-form').forEach(form => form.classList.add('hidden'));

  const tabBtn = document.getElementById('content-tab-' + tab);
  const form = document.getElementById('content-form-' + tab);

  if (tab === 'general') {
    tabBtn.classList.remove('bg-botanical-stone', 'text-botanical-sage');
    tabBtn.classList.add('bg-botanical-fg', 'text-white');
  } else {
    tabBtn.classList.remove('bg-botanical-stone', 'text-botanical-sage');
    tabBtn.classList.add('bg-botanical-terracotta', 'text-white');
  }
  form.classList.remove('hidden');
}

function selectRevenueContentType(type) {
  selectedRevenueContentType = type;
  document.querySelectorAll('.rev-content-type-btn').forEach(btn => {
    btn.classList.remove('border-botanical-terracotta', 'bg-botanical-terracotta/10', 'text-botanical-terracotta');
    btn.classList.add('border-botanical-stone', 'text-botanical-sage');
  });
  const btn = document.getElementById('rev-content-type-' + type);
  btn.classList.remove('border-botanical-stone', 'text-botanical-sage');
  btn.classList.add('border-botanical-terracotta', 'bg-botanical-terracotta/10', 'text-botanical-terracotta');
}

function saveNewContent(formType) {
  let title, category, type, selectedStatus, selectedDate;
  const milestones = [];

  if (formType === 'revenue') {
    title = document.getElementById('new-content-brand').value;
    category = selectedRevenueContentType;
    type = document.getElementById('new-content-revenue-type').value;
    selectedStatus = document.getElementById('new-content-rev-status').value;
    selectedDate = document.getElementById('new-content-rev-date').value;
  } else {
    title = document.getElementById('new-content-title').value;
    category = document.getElementById('new-content-category').value;
    type = document.getElementById('new-content-type').value;
    selectedStatus = document.getElementById('new-content-status').value;
    selectedDate = document.getElementById('new-content-date').value;
  }

  if (!title) {
    alert(formType === 'revenue' ? '브랜드명을 입력하세요' : '키워드를 입력하세요');
    return;
  }

  // 상태 + 날짜 둘 다 있으면 마일스톤으로 등록
  if (selectedStatus && selectedDate) {
    milestones.push({ status: selectedStatus, date: selectedDate });
  }

  // 현재 상태: 선택한 상태가 있으면 그것, 없으면 기본값
  const currentStatus = selectedStatus || (formType === 'revenue' ? '계약완료' : '아이디어');
  const uploadDate = (selectedStatus === '업로드완료' && selectedDate) ? selectedDate : '';

  const contentId = Date.now();
  const newContent = {
    id: contentId,
    title: title,
    type: type,
    category: category,
    status: currentStatus,
    uploadDate: uploadDate,
    isRevenue: formType === 'revenue',
    milestones: milestones,
    url: '',
    performance: { views: null, likes: null, shares: null, comments: null, saves: null },
    reference: { links: [], analysis: '' },
    script: { versions: [], currentVersion: 0 },
    caption: '',
    dm: '',
    shareLinks: [],
    checklist: [
      {item: '레퍼런스 분석', checked: false},
      {item: '훅 확정', checked: false},
      {item: '대본 작성', checked: false},
      {item: '촬영', checked: false},
      {item: '편집', checked: false},
      {item: '자막 확인', checked: false},
      {item: '업로드', checked: false}
    ]
  };

  contentsData.contents.unshift(newContent);

  // 캘린더에 마일스톤 자동 등록
  milestones.forEach((m, idx) => {
    calendarData.items.push({
      id: Date.now() + idx + 1,
      date: m.date,
      title: `${title}`,
      category: category,
      type: type,
      status: m.status,
      contentId: contentId,
      isRevenue: formType === 'revenue',
      revenueType: formType === 'revenue' ? category : null,
      isMilestone: true
    });
  });

  saveAllData();
  closeCalendarPopup();
  renderContentList();
  renderCalendar();
}

// ========== Performance ==========
let perfSelectedMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
let perfSelectedYear = currentYear;
let followerViewMode = 'daily';

function renderPerformance() {
  const monthPerf = performanceData.monthly[perfSelectedMonth] || {};
  const monthNum = parseInt(perfSelectedMonth.slice(5));

  // Get contents for selected month
  const monthContents = contentsData.contents.filter(c => c.uploadDate.startsWith(perfSelectedMonth));

  // Daily follower data
  const dailyData = performanceData.follower?.history?.daily || [];
  const maxDailyChange = dailyData.length > 0 ? Math.max(...dailyData.map(d => d.change)) : 0;

  // Monthly follower data
  const monthlyData = performanceData.follower?.history?.monthly || [];
  const maxMonthlyChange = monthlyData.length > 0 ? Math.max(...monthlyData.map(d => d.change)) : 0;

  const today = new Date().toISOString().slice(0, 10);

  document.getElementById('performance-content').innerHTML = `
    <div class="flex gap-6 mb-6 border-b border-botanical-stone/30">
      <button onclick="switchPerfTab('detail')" id="perf-tab-detail" class="perf-tab-btn pb-3 text-sm font-medium border-b-2 border-botanical-fg text-botanical-fg">월 상세</button>
      <button onclick="switchPerfTab('compare')" id="perf-tab-compare" class="perf-tab-btn pb-3 text-sm font-medium border-b-2 border-transparent text-botanical-sage hover:text-botanical-fg">월간 비교</button>
    </div>

    <div id="perf-detail" class="perf-section">
      <!-- Month Selector -->
      <div class="flex items-center gap-3 mb-6">
        <select id="perf-month-select" onchange="changePerfMonth(this.value)" class="px-4 py-2 pr-8 rounded-full border border-botanical-stone bg-white text-sm focus:outline-none appearance-none bg-no-repeat" style="background-image: url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%238C9A84%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E'); background-position: right 12px center;">
          <option value="2026-04" ${perfSelectedMonth === '2026-04' ? 'selected' : ''}>2026년 4월</option>
          <option value="2026-03" ${perfSelectedMonth === '2026-03' ? 'selected' : ''}>2026년 3월</option>
          <option value="2026-02" ${perfSelectedMonth === '2026-02' ? 'selected' : ''}>2026년 2월</option>
          <option value="2026-01" ${perfSelectedMonth === '2026-01' ? 'selected' : ''}>2026년 1월</option>
        </select>
      </div>

      <!-- Month Summary -->
      <div class="bg-white rounded-2xl p-6 shadow-sm mb-6">
        <h3 class="font-medium mb-4">${monthNum}월 성과 요약</h3>
        <div class="grid grid-cols-5 gap-4">
          <div class="text-center">
            <p class="text-xl font-semibold">${monthPerf.totalContents || 0}</p>
            <p class="text-xs text-botanical-sage">총 콘텐츠</p>
          </div>
          <div class="text-center">
            <p class="text-xl font-semibold">${monthPerf.totalViews ? (monthPerf.totalViews / 1000).toFixed(1) + 'K' : 0}</p>
            <p class="text-xs text-botanical-sage">총 조회수</p>
          </div>
          <div class="text-center">
            <p class="text-xl font-semibold">${monthPerf.totalSaves || 0}</p>
            <p class="text-xs text-botanical-sage">총 저장</p>
          </div>
          <div class="text-center">
            <p class="text-xl font-semibold">${monthPerf.avgSaveRate || 0}%</p>
            <p class="text-xs text-botanical-sage">평균 저장률</p>
          </div>
          <div class="text-center">
            <p class="text-xl font-semibold text-botanical-terracotta">${monthPerf.bestContent || '-'}</p>
            <p class="text-xs text-botanical-sage">베스트 콘텐츠</p>
          </div>
        </div>
      </div>

      <!-- Content Performance Input -->
      <div class="bg-white rounded-2xl p-6 shadow-sm mb-6">
        <h3 class="font-medium mb-4">콘텐츠별 성과 입력</h3>
        <div class="border border-botanical-stone rounded-xl overflow-hidden">
          <table class="w-full text-xs">
            <thead>
              <tr class="bg-botanical-cream/50">
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap">콘텐츠</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-16">업로드</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-14">조회</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-14">좋아요</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-12">공유</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-12">댓글</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-12">저장</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-14">유입</th>
              </tr>
            </thead>
            <tbody>
              ${monthContents.length > 0 ? monthContents.map(c => `
                <tr class="border-t border-botanical-stone hover:bg-botanical-cream/30 transition-all">
                  <td class="px-3 py-2">
                    <div class="flex items-center gap-2 whitespace-nowrap">
                      <span class="px-1.5 py-0.5 rounded text-xs bg-botanical-sage/20 text-botanical-sage">${c.type}</span>
                      <span onclick="goToContentExpanded(${c.id})" class="cursor-pointer hover:text-botanical-terracotta hover:underline">${c.title}</span>
                    </div>
                  </td>
                  <td class="px-3 py-2 text-center">${c.uploadDate.slice(5).replace('-', '/')}</td>
                  <td class="px-3 py-2"><input type="text" value="${c.performance.views ? (c.performance.views / 1000).toFixed(1) + 'K' : ''}" placeholder="-" class="w-full text-center bg-transparent border-b border-transparent hover:border-botanical-stone focus:border-botanical-sage focus:outline-none"></td>
                  <td class="px-3 py-2"><input type="text" value="${c.performance.likes ? (c.performance.likes / 1000).toFixed(1) + 'K' : ''}" placeholder="-" class="w-full text-center bg-transparent border-b border-transparent hover:border-botanical-stone focus:border-botanical-sage focus:outline-none"></td>
                  <td class="px-3 py-2"><input type="text" value="${c.performance.shares || ''}" placeholder="-" class="w-full text-center bg-transparent border-b border-transparent hover:border-botanical-stone focus:border-botanical-sage focus:outline-none"></td>
                  <td class="px-3 py-2"><input type="text" value="${c.performance.comments || ''}" placeholder="-" class="w-full text-center bg-transparent border-b border-transparent hover:border-botanical-stone focus:border-botanical-sage focus:outline-none"></td>
                  <td class="px-3 py-2"><input type="text" value="${c.performance.saves || ''}" placeholder="-" class="w-full text-center bg-transparent border-b border-transparent hover:border-botanical-stone focus:border-botanical-sage focus:outline-none"></td>
                  <td class="px-3 py-2"><input type="text" value="" placeholder="-" class="w-full text-center bg-transparent border-b border-transparent hover:border-botanical-stone focus:border-botanical-sage focus:outline-none text-green-600"></td>
                </tr>
              `).join('') : '<tr><td colspan="8" class="px-3 py-4 text-center text-botanical-sage">해당 월 콘텐츠 없음</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Follower Trend -->
      <div class="bg-white rounded-2xl p-6 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-medium">${monthNum}월 팔로워 추이</h3>
          <div class="flex gap-2">
            <button onclick="switchFollowerView('daily')" id="follower-view-daily" class="follower-view-btn px-3 py-1 rounded-full text-xs ${followerViewMode === 'daily' ? 'bg-botanical-sage text-white' : 'border border-botanical-stone hover:bg-botanical-cream'}">일간</button>
            <button onclick="switchFollowerView('weekly')" id="follower-view-weekly" class="follower-view-btn px-3 py-1 rounded-full text-xs ${followerViewMode === 'weekly' ? 'bg-botanical-sage text-white' : 'border border-botanical-stone hover:bg-botanical-cream'}">주간</button>
          </div>
        </div>

        <!-- 팔로워 입력 -->
        <div class="p-4 bg-botanical-cream/30 rounded-xl mb-4 border border-botanical-stone">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <span class="text-sm font-medium">팔로워 입력</span>
              <input type="date" id="follower-date" value="${today}" class="px-3 py-1.5 rounded-lg border border-botanical-stone bg-white text-sm focus:outline-none focus:border-botanical-sage">
              <input type="number" id="follower-count" placeholder="팔로워 수" class="w-32 px-3 py-1.5 rounded-lg border border-botanical-stone bg-white text-sm focus:outline-none focus:border-botanical-sage">
            </div>
            <button onclick="saveFollowerCount()" class="px-4 py-1.5 bg-botanical-sage text-white rounded-lg text-sm font-medium hover:bg-botanical-fg transition-all">저장</button>
          </div>
        </div>

        <!-- Summary Cards -->
        <div class="grid grid-cols-3 gap-4 mb-6">
          <div class="p-4 bg-botanical-cream/30 rounded-xl text-center">
            <p class="text-2xl font-semibold ${dailyData.length > 0 ? 'text-green-600' : 'text-botanical-sage'}">+${dailyData[dailyData.length - 1]?.change || 0}</p>
            <p class="text-xs text-botanical-sage">오늘 증가</p>
          </div>
          <div class="p-4 bg-botanical-cream/30 rounded-xl text-center">
            <p class="text-2xl font-semibold ${dailyData.length > 0 ? 'text-green-600' : 'text-botanical-sage'}">+${dailyData.reduce((sum, d) => sum + d.change, 0)}</p>
            <p class="text-xs text-botanical-sage">이번 주 증가</p>
          </div>
          <div class="p-4 bg-botanical-cream/30 rounded-xl text-center">
            <p class="text-2xl font-semibold ${monthPerf.followerGain ? 'text-green-600' : 'text-botanical-sage'}">+${(monthPerf.followerGain || 0).toLocaleString()}</p>
            <p class="text-xs text-botanical-sage">이번 달 증가</p>
          </div>
        </div>

        ${dailyData.length > 0 ? `
        <!-- Daily Graph -->
        <div id="follower-graph-daily" class="${followerViewMode === 'daily' ? '' : 'hidden'}">
          <p class="text-xs text-botanical-sage mb-3">최근 7일 팔로워 증가</p>
          <div class="flex items-end justify-between gap-3 px-4" style="height: 120px;">
            ${(() => {
              // Get last 7 days ending with today
              const sortedData = [...dailyData].sort((a, b) => a.date.localeCompare(b.date));
              const last7Days = sortedData.slice(-7);
              return last7Days.map((d) => {
                const height = maxDailyChange > 0 ? (d.change / maxDailyChange) * 100 : 0;
                const isMax = d.change === maxDailyChange;
                return `
                  <div class="flex-1 flex flex-col items-center">
                    <div class="w-full rounded-t" style="height: ${height}px; background-color: ${isMax ? '#C27B66' : '#8C9A84'};"></div>
                  </div>
                `;
              }).join('');
            })()}
          </div>
          <div class="flex justify-between gap-3 px-4 mt-2">
            ${(() => {
              const sortedData = [...dailyData].sort((a, b) => a.date.localeCompare(b.date));
              const last7Days = sortedData.slice(-7);
              return last7Days.map((d) => {
                const isMax = d.change === maxDailyChange && maxDailyChange > 0;
                const dateLabel = d.date.slice(5).replace('-', '/'); // MM/DD format
                return `
                  <div class="flex-1 text-center">
                    <span class="text-xs text-botanical-sage">${dateLabel}</span><br>
                    <span class="text-xs font-medium ${isMax ? 'text-botanical-terracotta' : ''}">+${d.change}</span>
                  </div>
                `;
              }).join('');
            })()}
          </div>
        </div>

        <!-- Weekly Graph -->
        <div id="follower-graph-weekly" class="${followerViewMode === 'weekly' ? '' : 'hidden'}">
          <p class="text-xs text-botanical-sage mb-3">${monthNum}월 주차별 팔로워 증가</p>
          <div class="flex items-end justify-between gap-6 px-8" style="height: 120px;">
            ${[0, 0, 0, 0].map((change, idx) => `
              <div class="flex-1 flex flex-col items-center">
                <div class="w-full rounded-t" style="height: 0px; background-color: #8C9A84;"></div>
              </div>
            `).join('')}
          </div>
          <div class="flex justify-between gap-6 px-8 mt-2">
            ${['1주차', '2주차', '3주차', '4주차'].map((week, idx) => `
              <div class="flex-1 text-center">
                <span class="text-xs text-botanical-sage">${week}</span><br>
                <span class="text-xs font-medium">+0</span>
              </div>
            `).join('')}
          </div>
        </div>
        ` : `
        <p class="text-sm text-botanical-sage text-center py-8">팔로워 데이터가 없습니다</p>
        `}
      </div>
    </div>

    <div id="perf-compare" class="perf-section hidden">
      <!-- Year Selector -->
      <div class="flex items-center gap-3 mb-6">
        <select id="perf-year-select" onchange="changePerfYear(this.value)" class="px-4 py-2 pr-8 rounded-full border border-botanical-stone bg-white text-sm focus:outline-none appearance-none bg-no-repeat" style="background-image: url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%238C9A84%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E'); background-position: right 12px center;">
          <option value="2026" ${perfSelectedYear === 2026 ? 'selected' : ''}>2026년</option>
          <option value="2025" ${perfSelectedYear === 2025 ? 'selected' : ''}>2025년</option>
        </select>
      </div>

      <!-- 현재 팔로워 & 월간 트렌드 -->
      <div class="bg-white rounded-2xl p-6 shadow-sm mb-6">
        <h3 class="font-medium mb-4">팔로워 월간 트렌드</h3>
        <div class="flex items-center gap-6 mb-6">
          <div class="p-4 bg-botanical-cream/30 rounded-xl text-center flex-1">
            <p class="text-2xl font-semibold">${(performanceData.follower?.current || 0).toLocaleString()}</p>
            <p class="text-xs text-botanical-sage">현재 팔로워</p>
          </div>
          <div class="p-4 bg-botanical-cream/30 rounded-xl text-center flex-1">
            <p class="text-2xl font-semibold ${monthPerf.followerGain ? 'text-green-600' : 'text-botanical-sage'}">+${(monthPerf.followerGain || 0).toLocaleString()}</p>
            <p class="text-xs text-botanical-sage">이번 달 증가</p>
          </div>
          <div class="p-4 bg-botanical-cream/30 rounded-xl text-center flex-1">
            <p class="text-2xl font-semibold text-botanical-sage">-</p>
            <p class="text-xs text-botanical-sage">전월 대비</p>
          </div>
        </div>
        ${monthlyData.length > 0 ? `
        <p class="text-xs text-botanical-sage mb-3">최근 6개월 팔로워 증가</p>
        <div class="flex items-end justify-between gap-4 px-6" style="height: 120px;">
          ${monthlyData.slice(-6).map((d, idx, arr) => {
            const maxChange = Math.max(...arr.map(x => x.change));
            const height = maxChange > 0 ? (d.change / maxChange) * 100 : 0;
            const isLast = idx === arr.length - 1;
            return `
              <div class="flex-1 flex flex-col items-center">
                <div class="w-full rounded-t" style="height: ${height}px; background-color: ${isLast ? '#C27B66' : '#8C9A84'};"></div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="flex justify-between gap-4 px-6 mt-2">
          ${monthlyData.slice(-6).map((d, idx, arr) => {
            const isLast = idx === arr.length - 1;
            return `
              <div class="flex-1 text-center">
                <span class="text-xs text-botanical-sage">${d.month.slice(5)}월</span><br>
                <span class="text-xs font-medium ${isLast ? 'text-botanical-terracotta' : ''}">+${(d.change/1000).toFixed(1)}K</span>
              </div>
            `;
          }).join('')}
        </div>
        ` : `<p class="text-sm text-botanical-sage text-center py-8">팔로워 데이터가 없습니다</p>`}
      </div>

      <!-- 월간 콘텐츠 성과 비교 -->
      <div class="bg-white rounded-2xl p-6 shadow-sm mb-6">
        <h3 class="font-medium mb-4">월간 콘텐츠 성과 비교</h3>
        <div class="border border-botanical-stone rounded-xl overflow-hidden">
          <table class="w-full text-xs">
            <thead>
              <tr class="bg-botanical-cream/50">
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap">월</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap">콘텐츠</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap">총 조회</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap">총 저장</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap">저장률</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap">팔로워 증가</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap">베스트</th>
              </tr>
            </thead>
            <tbody>
              ${Object.keys(performanceData.monthly || {}).length > 0 ?
                Object.entries(performanceData.monthly).filter(([m]) => m.startsWith(String(perfSelectedYear))).reverse().map(([month, data], idx) => `
                  <tr class="border-t border-botanical-stone ${idx === 0 ? 'bg-botanical-terracotta/5' : ''}">
                    <td class="px-3 py-3 font-medium">${month.slice(5)}월</td>
                    <td class="px-3 py-3 text-center">${data.totalContents || 0}</td>
                    <td class="px-3 py-3 text-center">${data.totalViews ? (data.totalViews / 1000).toFixed(1) + 'K' : '-'}</td>
                    <td class="px-3 py-3 text-center">${data.totalSaves?.toLocaleString() || '-'}</td>
                    <td class="px-3 py-3 text-center">${data.avgSaveRate || 0}%</td>
                    <td class="px-3 py-3 text-center text-green-600">+${(data.followerGain || 0).toLocaleString()}</td>
                    <td class="px-3 py-3 text-center ${idx === 0 ? 'text-botanical-terracotta' : ''}">${data.bestContent || '-'}</td>
                  </tr>
                `).join('') :
                `<tr><td colspan="7" class="px-3 py-4 text-center text-botanical-sage">데이터가 없습니다</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- 인사이트 -->
      <div class="bg-white rounded-2xl p-6 shadow-sm">
        <h3 class="font-medium mb-4">📊 인사이트</h3>
        ${Object.keys(performanceData.monthly || {}).length > 0 ? `
        <div class="space-y-3 text-sm">
          <div class="flex items-start gap-3 p-3 bg-botanical-cream/30 rounded-xl">
            <span class="text-botanical-sage">💡</span>
            <p>데이터를 입력하면 인사이트가 표시됩니다</p>
          </div>
        </div>
        ` : `
        <p class="text-sm text-botanical-sage text-center py-4">성과 데이터가 없습니다</p>
        `}
      </div>
    </div>
  `;
}

function changePerfMonth(month) {
  perfSelectedMonth = month;
  renderPerformance();
}

function changePerfYear(year) {
  perfSelectedYear = parseInt(year);
  renderPerformance();
}

function switchFollowerView(mode) {
  followerViewMode = mode;
  const dailyGraph = document.getElementById('follower-graph-daily');
  const weeklyGraph = document.getElementById('follower-graph-weekly');
  const dailyBtn = document.getElementById('follower-view-daily');
  const weeklyBtn = document.getElementById('follower-view-weekly');

  if (mode === 'daily') {
    dailyGraph.classList.remove('hidden');
    weeklyGraph.classList.add('hidden');
    dailyBtn.classList.add('bg-botanical-sage', 'text-white');
    dailyBtn.classList.remove('border', 'border-botanical-stone');
    weeklyBtn.classList.remove('bg-botanical-sage', 'text-white');
    weeklyBtn.classList.add('border', 'border-botanical-stone');
  } else {
    dailyGraph.classList.add('hidden');
    weeklyGraph.classList.remove('hidden');
    weeklyBtn.classList.add('bg-botanical-sage', 'text-white');
    weeklyBtn.classList.remove('border', 'border-botanical-stone');
    dailyBtn.classList.remove('bg-botanical-sage', 'text-white');
    dailyBtn.classList.add('border', 'border-botanical-stone');
  }
}

function switchPerfTab(tab) {
  document.querySelectorAll('.perf-tab-btn').forEach(btn => {
    btn.classList.remove('text-botanical-fg', 'border-botanical-fg');
    btn.classList.add('text-botanical-sage', 'border-transparent');
  });
  document.getElementById('perf-tab-' + tab).classList.remove('text-botanical-sage', 'border-transparent');
  document.getElementById('perf-tab-' + tab).classList.add('text-botanical-fg', 'border-botanical-fg');

  document.querySelectorAll('.perf-section').forEach(s => s.classList.add('hidden'));
  document.getElementById('perf-' + tab).classList.remove('hidden');
}

function goToPerformance(contentId) {
  switchTab('performance');
}

function saveFollowerCount() {
  const date = document.getElementById('follower-date').value;
  const count = parseInt(document.getElementById('follower-count').value);

  if (!date || !count || isNaN(count)) {
    alert('날짜와 팔로워 수를 입력하세요');
    return;
  }

  // Check if already exists for this date
  const existingIdx = performanceData.follower.history.daily.findIndex(d => d.date === date);

  // Calculate change from previous entry
  const sortedDaily = [...performanceData.follower.history.daily].sort((a, b) => a.date.localeCompare(b.date));
  const prevEntry = sortedDaily.filter(d => d.date < date).pop();
  const change = prevEntry ? count - prevEntry.count : 0;

  if (existingIdx >= 0) {
    // Update existing entry
    performanceData.follower.history.daily[existingIdx] = { date, count, change };
  } else {
    // Add new entry
    performanceData.follower.history.daily.push({ date, count, change });
  }

  // Update current follower count
  performanceData.follower.current = count;

  // Update monthly data
  const monthKey = date.slice(0, 7);
  const monthEntries = performanceData.follower.history.daily.filter(d => d.date.startsWith(monthKey));
  const monthChange = monthEntries.reduce((sum, d) => sum + d.change, 0);

  const monthlyIdx = performanceData.follower.history.monthly.findIndex(m => m.month === monthKey);
  if (monthlyIdx >= 0) {
    performanceData.follower.history.monthly[monthlyIdx].change = monthChange;
  } else {
    performanceData.follower.history.monthly.push({ month: monthKey, change: monthChange });
  }

  // Clear input
  document.getElementById('follower-count').value = '';

  saveAllData();
  alert('저장되었습니다');
  renderPerformance();
}

// ========== Revenue ==========
function renderRevenue() {
  const monthlyData = revenueData.monthly || [];
  const revenues = monthlyData.map(m => (m.ad || 0) + (m.sales || 0) + (m.sponsor || 0));
  const maxRevenue = revenues.length > 0 ? Math.max(...revenues) : 0;

  document.getElementById('revenue-content').innerHTML = `
    <div class="grid grid-cols-2 gap-4 mb-6">
      <div class="bg-white rounded-2xl p-4 shadow-sm border border-botanical-stone">
        <p class="text-sm text-botanical-sage font-medium uppercase mb-1">이번 달</p>
        <p class="text-3xl font-semibold"><span class="font-serif">${fmt(revenueData.summary.thisMonth)}</span><span class="text-lg">원</span></p>
        <div class="flex gap-2 mt-3">
          <div class="flex-1 p-2 rounded-lg border-l-2 border-botanical-terracotta bg-botanical-cream/30">
            <p class="text-xs text-botanical-sage">광고</p>
            <p class="text-base font-semibold font-serif">${fmt(revenueData.byType.ad.thisMonth)}<span class="text-xs">원</span></p>
          </div>
          <div class="flex-1 p-2 rounded-lg border-l-2 border-botanical-sage bg-botanical-cream/30">
            <p class="text-xs text-botanical-sage">판매</p>
            <p class="text-base font-semibold font-serif">${fmt(revenueData.byType.sales.thisMonth)}<span class="text-xs">원</span></p>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm border border-botanical-stone">
        <p class="text-sm text-botanical-sage font-medium uppercase mb-1">연간 누적</p>
        <p class="text-3xl font-semibold"><span class="font-serif">${fmt(revenueData.summary.thisYear)}</span><span class="text-lg">원</span></p>
        <div class="flex gap-2 mt-3">
          <div class="flex-1 p-2 rounded-lg border-l-2 border-botanical-terracotta bg-botanical-cream/30">
            <p class="text-xs text-botanical-sage">광고</p>
            <p class="text-base font-semibold font-serif">${fmt(revenueData.byType.ad.thisYear)}<span class="text-xs">원</span></p>
          </div>
          <div class="flex-1 p-2 rounded-lg border-l-2 border-botanical-sage bg-botanical-cream/30">
            <p class="text-xs text-botanical-sage">판매</p>
            <p class="text-base font-semibold font-serif">${fmt(revenueData.byType.sales.thisYear)}<span class="text-xs">원</span></p>
          </div>
        </div>
      </div>
    </div>

    <!-- Revenue Trend -->
    <div class="bg-white rounded-2xl p-5 shadow-sm mb-6">
      <h4 class="text-base font-semibold mb-4">수익 <span class="font-serif italic">Trend</span></h4>
      <div class="flex items-end justify-between gap-1" style="height: 120px;">
        ${[1,2,3,4,5,6,7,8,9,10,11,12].map(month => {
          const data = monthlyData.find(m => parseInt(m.month.slice(5)) === month);
          const total = data ? data.ad + data.sales + data.sponsor : 0;
          const isCurrentMonth = month === currentMonth;
          const isFuture = month > currentMonth;
          const maxRev = maxRevenue > 0 ? maxRevenue : 1;
          const height = total > 0 ? Math.max((total / maxRev) * 100, 5) : 0;
          const bgColor = isFuture ? '#E6E2DA' : (isCurrentMonth ? '#C27B66' : 'rgba(193,114,93,0.6)');
          const textColor = isFuture ? 'text-botanical-clay' : (isCurrentMonth ? 'text-botanical-fg font-semibold' : 'text-botanical-sage');
          return `
            <div class="flex-1 flex flex-col items-center gap-1">
              <div class="w-full rounded-t" style="height: ${height}px; background-color: ${bgColor};"></div>
              <span class="text-[10px] ${textColor}">${month}</span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="mt-3 pt-3 border-t border-botanical-stone flex justify-between text-xs">
        <span class="text-botanical-sage">연 누적 ${fmt(revenueData.summary?.thisYear || 0)}원</span>
        <span class="text-botanical-terracotta font-medium">기타소득 한도 ${fmt(7500000 - (revenueData.tax?.etc88 || 0))}원 여유</span>
      </div>
    </div>

    <div class="bg-white rounded-2xl p-5 shadow-sm mb-6">
      <p class="text-base font-semibold mb-3">세금 구분</p>
      <div class="grid grid-cols-2 gap-3">
        <div class="p-3 rounded-xl" style="background-color: rgba(135,148,131,0.1);">
          <span class="text-sm text-botanical-sage">기타소득 8.8%</span>
          <p class="text-xl font-semibold mt-1"><span class="font-serif">${fmt(revenueData.tax?.etc88 || 0)}</span><span class="text-base font-sans">원</span></p>
        </div>
        <div class="p-3 rounded-xl" style="background-color: rgba(193,114,93,0.1);">
          <span class="text-sm text-botanical-terracotta">사업소득 3.3%</span>
          <p class="text-xl font-semibold mt-1"><span class="font-serif">${fmt(revenueData.tax?.biz33 || 0)}</span><span class="text-base font-sans">원</span></p>
        </div>
      </div>
    </div>

    <div class="bg-white rounded-2xl p-5 shadow-sm">
      <h3 class="text-base font-semibold mb-4">수익 상세</h3>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        ${renderRevenueList('광고', revenueData.items.ad, 'botanical-terracotta')}
        ${renderRevenueList('판매', revenueData.items.sales, 'botanical-sage')}
        ${renderRevenueList('협찬', revenueData.items.sponsor, 'botanical-clay')}
      </div>
    </div>
  `;
}

function renderRevenueList(title, items, color) {
  const currentMonthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  const monthItems = items.filter(item => item.date.startsWith(currentMonthStr));
  const yearItems = items;

  const colorStyles = {
    'botanical-terracotta': { border: 'border-botanical-terracotta', text: '' },
    'botanical-sage': { border: 'border-botanical-sage', text: '' },
    'botanical-clay': { border: 'border-botanical-clay', text: 'style="color: #C8B6A6;"' }
  };
  const style = colorStyles[color] || colorStyles['botanical-sage'];

  const itemsHtml = items.map(item => {
    const isOld = !item.date.startsWith(currentMonthStr);
    return `
      <div class="flex items-center justify-between py-1 hover:bg-botanical-cream/30 cursor-pointer ${isOld ? 'text-botanical-sage/70' : ''}">
        <div class="flex items-center gap-2">
          <span class="text-xs ${isOld ? '' : 'text-botanical-sage'} w-10">${item.date.slice(5).replace('-', '/')}</span>
          <span class="text-sm">${item.brand}</span>
        </div>
        <span class="text-sm font-semibold font-serif" ${color === 'botanical-clay' ? 'style="color: ' + (isOld ? 'rgba(200,182,166,0.7)' : '#C8B6A6') + ';"' : ''}>${fmt(item.amount)}<span class="font-sans text-xs text-botanical-sage">원</span></span>
      </div>
    `;
  }).join('') || '<p class="text-sm text-botanical-sage">없음</p>';

  return `
    <div class="bg-botanical-cream/30 rounded-xl p-3">
      <div class="flex items-center gap-2 mb-2">
        <h4 class="text-base font-semibold">${title}</h4>
        <span class="text-xs text-botanical-sage">월 <span class="font-serif font-medium text-botanical-fg">${monthItems.length}</span> · 연 <span class="font-serif font-medium text-botanical-fg">${yearItems.length}</span></span>
      </div>
      <div class="${style.border} border-l-2 pl-3 space-y-2">
        ${itemsHtml}
      </div>
    </div>
  `;
}

// ========== 스크립트 테이블 컬럼 리사이즈 ==========
(function () {
  const COL_ORDER = ['section', 'dialogue', 'subtitle', 'scene'];
  document.addEventListener('mousedown', (e) => {
    if (!e.target.matches?.('.script-table .col-resize-handle')) return;
    e.preventDefault();
    const handle = e.target;
    const th = handle.parentElement;
    const colName = th.dataset.col;
    const table = th.closest('.script-table');
    const contentId = parseInt(table.dataset.contentId, 10);
    const colIdx = COL_ORDER.indexOf(colName);
    const colEl = table.querySelectorAll('colgroup col')[colIdx];
    const startX = e.pageX;
    const startWidth = colEl.offsetWidth || th.offsetWidth;

    const onMove = (ev) => {
      const newWidth = Math.max(60, startWidth + (ev.pageX - startX));
      colEl.style.width = newWidth + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      // 저장
      const content = contentsData.contents.find(c => c.id === contentId);
      if (content) {
        if (!content.script) content.script = {};
        if (!content.script.columnWidths) content.script.columnWidths = {};
        content.script.columnWidths[colName] = parseInt(colEl.style.width, 10);
        saveAllData();
      }
    };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

// ========== Date Input: 값 없을 때 placeholder 숨기기 ==========
(function () {
  const update = (inp) => {
    if (!inp.value) inp.classList.add('date-empty');
    else inp.classList.remove('date-empty');
  };
  document.addEventListener('input', (e) => {
    if (e.target.matches?.('input[type="date"]')) update(e.target);
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches?.('input[type="date"]')) update(e.target);
  });
  new MutationObserver((mutations) => {
    mutations.forEach((m) => m.addedNodes.forEach((node) => {
      if (node.nodeType !== 1) return;
      if (node.matches?.('input[type="date"]')) update(node);
      node.querySelectorAll?.('input[type="date"]').forEach(update);
    }));
  }).observe(document.body, { childList: true, subtree: true });
})();

// ========== Init ==========
loadData();
