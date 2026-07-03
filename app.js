// ========== Global State ==========
let calendarData = null;
let contentsData = null;
let performanceData = null;
let revenueData = null;
let memosData = null;
let plansData = null;
let selectedMemoId = null;
let perfRecalculated = false; // 성과 데이터 재계산 완료 플래그
let isOfflineMode = false; // 오프라인 모드 (읽기 전용)
const dirtyTables = new Set(); // 변경된 테이블만 저장하기 위한 플래그

// 카테고리 목표 설정 (localStorage에 저장)
let categoryGoalsConfig = JSON.parse(localStorage.getItem('yudit_categoryGoals') || '{"Career Guide":2,"AI Work":2,"Money Log":2,"Life Style":2}');
let totalGoalConfig = parseInt(localStorage.getItem('yudit_totalGoal') || '8');

// Lazy Loading - 탭 렌더링 상태 추적
const tabRendered = {
  calendar: false,
  dashboard: false,
  content: false,
  performance: false,
  revenue: false,
  memos: false
};

// 현재 날짜 기준으로 초기화
const now = new Date();
let currentYear = now.getFullYear();
let currentMonth = now.getMonth() + 1; // 1-indexed (0-11 -> 1-12)
let currentView = 'monthly';

// 스크롤 위치 저장 함수 (재사용, 메모리 누수 방지, throttle로 성능 최적화)
let _scrollSaveTimer = null;
const saveScrollPosition = () => {
  if (_scrollSaveTimer) return;
  _scrollSaveTimer = setTimeout(() => {
    localStorage.setItem('yudit_scrollY', window.scrollY.toString());
    _scrollSaveTimer = null;
  }, 200);
};

// ========== 월 선택 헬퍼 (탭별 독립 상태) ==========
// 각 탭은 자신의 월 상태를 가짐. 탭 간 UI는 연동되지 않음.
// 데이터 소스(contentsData, revenueData 등)는 공통이라 "4월"을 선택하면
// 어느 탭이든 같은 4월 데이터를 본다.
function pad2(n) { return String(n).padStart(2, '0'); }
function ym(y, m) { return `${y}-${pad2(m)}`; }

// 시작 기준월 = 2026-03 (스튜디오 사용 시작 시점, 이전 월은 표시 안 함)
// 상단(가장 최신) = 오늘의 실제 월. 달력이 다음 달로 넘어가면 자동 반영.
// 하단(가장 과거) = 2026-03.
const MONTH_SELECT_START = '2026-03'; // 최저월
function getMonthOptions(selectedMonth) {
  const [startY, startM] = MONTH_SELECT_START.split('-').map(Number);
  const realNow = new Date();
  let topY = realNow.getFullYear();
  let topM = realNow.getMonth() + 2; // 다음 달까지 포함
  // 12월 넘어가면 다음 해로
  if (topM > 12) {
    topM = topM - 12;
    topY++;
  }
  // 오늘이 시작월보다 이전이면 시작월 = 오늘 (방어적)
  if (topY < startY || (topY === startY && topM < startM)) {
    topY = startY; topM = startM;
  }
  const opts = [];
  const seen = new Set();
  // top부터 start까지 역순으로 쌓기
  let y = topY, m = topM;
  while (y > startY || (y === startY && m >= startM)) {
    const value = ym(y, m);
    seen.add(value);
    opts.push({ value, label: `${y}년 ${m}월` });
    m--;
    if (m < 1) { m = 12; y--; }
  }
  if (selectedMonth && !seen.has(selectedMonth)) {
    const [sy, sm] = selectedMonth.split('-').map(Number);
    opts.push({ value: selectedMonth, label: `${sy}년 ${sm}월` });
    opts.sort((a, b) => b.value.localeCompare(a.value));
  }
  return opts;
}

// 시작월(2026-04) 부터 오늘 연도까지 연도 옵션 (역순)
function getYearOptions() {
  const startY = parseInt(MONTH_SELECT_START.slice(0, 4));
  const nowY = new Date().getFullYear();
  const top = Math.max(nowY, startY);
  const opts = [];
  for (let y = top; y >= startY; y--) opts.push(y);
  return opts;
}

// 오늘 실제 월을 "YYYY-MM" 으로 (시작월보다 과거면 시작월로 클램프)
function getDefaultSelectedMonth() {
  const [startY, startM] = MONTH_SELECT_START.split('-').map(Number);
  const realNow = new Date();
  const y = realNow.getFullYear();
  const m = realNow.getMonth() + 1;
  if (y < startY || (y === startY && m < startM)) return MONTH_SELECT_START;
  return ym(y, m);
}

function renderMonthSelect(id, selectedMonth, onchangeFnName) {
  const opts = getMonthOptions(selectedMonth);
  const caret = `url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%238C9A84%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E')`;
  return `
    <select id="${id}" onchange="${onchangeFnName}(this.value)" class="px-4 py-2 pr-8 rounded-full border border-botanical-stone bg-white text-sm focus:outline-none appearance-none bg-no-repeat" style="background-image: ${caret}; background-position: right 12px center;">
      ${opts.map(o => `<option value="${o.value}" ${o.value === selectedMonth ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>
  `;
}

// 탭별 월 상태 (초기값: 오늘의 실제 월, 시작월 2026-04보다 과거면 시작월로 클램프)
let dashSelectedMonth = getDefaultSelectedMonth();
let revenueSelectedMonth = getDefaultSelectedMonth();
let perfSelectedMonth = getDefaultSelectedMonth();
let contentSelectedMonth = getDefaultSelectedMonth();

// 콘텐츠의 기준 날짜: 업로드완료 마일스톤 > 예정일(uploadDate 메모). 둘 다 없으면 null.
function getContentRefDate(content) {
  const upload = getUploadDate(content); // 업로드완료 마일스톤 날짜
  if (upload) return upload;
  if (content.uploadDate) return content.uploadDate; // 예정일 메모
  return null;
}

const categoryColors = {
  // 일반 카테고리
  'Career Guide': '#4A6FA5',  // 차분한 파란색
  'AI Work': '#7B5EA7',       // 보라색
  'Money Log': '#D97746',     // 주황색
  'Life Style': '#2A9D8F',    // 청록색
  // 수익 카테고리
  '광고': '#9B6B8C',
  '판매': '#6B8E8E',
  '협찬': '#C8B6A6'
};

// 한글 → 영어 카테고리 일회성 마이그레이션 매핑 (대기업라이프+쇼핑/여행 → Life Style)
const CATEGORY_MIGRATION = {
  '취업/이직': 'Career Guide',
  'AI활용': 'AI Work',
  '재테크': 'Money Log',
  '대기업라이프': 'Life Style',
  '쇼핑/여행': 'Life Style'
};

function migrateCategoryNames() {
  let changed = false;
  if (Array.isArray(contentsData?.contents)) {
    contentsData.contents.forEach(c => {
      if (CATEGORY_MIGRATION[c.category]) {
        c.category = CATEGORY_MIGRATION[c.category];
        changed = true;
      }
    });
  }
  if (Array.isArray(calendarData?.items)) {
    calendarData.items.forEach(it => {
      if (CATEGORY_MIGRATION[it.category]) {
        it.category = CATEGORY_MIGRATION[it.category];
        changed = true;
      }
    });
  }
  return changed;
}

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];

// ========== Supabase 설정 ==========
const SUPABASE_URL = 'https://vihrydqudawrlwddffwa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaHJ5ZHF1ZGF3cmx3ZGRmZndhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTcxNjIsImV4cCI6MjA5MTgzMzE2Mn0.5QkOjtl25PgbCDenWNgyqelbgPeerg6sqROQa624G9A';
const SUPABASE_TABLE = 'studio_data';
const DEFAULT_CLIENT_NOTION = 'https://www.notion.so/34a066f53222807e9fc9e625d5edee26';
const DEFAULT_TRANSCRIPT_LINK = 'https://getthescript.app/instagram-transcript';
const MY_INSTA_URL = 'https://www.instagram.com/yudit_life/';

// 자주 쓰는 내용 — 처음 실행 시 시드되는 기본 템플릿 (이후에는 사용자가 UI로 관리)
// type: 'text' (텍스트만) | 'titled' (제목 4자 + 내용)
const TEMPLATE_GROUPS_SEED = [
  {
    id: 1,
    name: '답글',
    type: 'text',
    items: [
      '요청하신 내용 DM으로 발송해 드렸어요 🤗',
      '메시지함 확인 부탁드려요! 방금 전송 완료했어요 💌',
      '문의하신 내용에 대한 답변 지금 막 보내드렸습니다 📲',
      '방금 DM 드렸어요! 오늘 하루도 행복하게 보내세요 ☀️',
      '확인 부탁드려요! 방금 DM함으로 전송했습니다 🎀',
      '메시지함 보시면 제가 보낸 자료 보이실 거예요 👀',
      '자료 공유해 드렸습니다! 유용하게 사용해 주세요 🛠️',
      'DM 발송 완료! 메시지 알람 확인 부탁드립니다 🔔',
      '따뜻한 관심 감사드려요! DM으로 답변 드렸습니다 🧡',
      'DM 전송 완료! 오늘도 좋은 하루 되시길 바랄게요 ☕️',
      '메시지 확인 부탁드려요! 지금 막 보내드렸어요 📩',
      '정보 공유해 드렸어요! DM함 꼭 체크해 주세요 📍',
      '요청하신 내용 정리해서 메시지로 보내드렸어요 📝',
      '방금 메시지 드렸는데 혹시 안 왔으면 알려주세요 🙋‍♀️',
      '지금 막 보내드렸어요 메시지함 확인해주세요📬'
    ].map((text, i) => ({ id: 1000 + i + 1, text }))
  }
];
const fmt = (n) => (Number(n) || 0).toLocaleString();

// 상태 표시 전용 짧은 레이블 (데이터 값은 기존 그대로 유지)
const STATUS_LABEL = {
  '기획안1차공유': '기획안 공유',
  '기획안최종컨펌': '기획안 컨펌',
  '영상1차공유': '영상 공유',
  '영상최종컨펌': '영상 컨펌'
};
const statusText = (s) => STATUS_LABEL[s] || s || '';

// 실제 업로드 날짜는 '업로드완료' 마일스톤에서만 가져옴
// content.uploadDate (상단 '예정일' 메모 필드)는 어느 로직에도 연결 안 함
function getUploadDate(content) {
  return (content?.milestones || []).find(m => m.status === '업로드완료')?.date || '';
}

// 플래너 제목: 연동된 콘텐츠가 있으면 콘텐츠 제목 사용 (양방향 연동)
function getPlanDisplayTitle(plan) {
  if (plan.linkedContentId) {
    const content = contentsData?.contents?.find(c => c.id === plan.linkedContentId);
    if (content && content.title) return content.title;
  }
  return plan.title || '';
}

// 콘텐츠 제목 → 플래너 제목 동기화
function syncTitleToPlan(contentId, title) {
  const content = contentsData?.contents?.find(c => c.id === contentId);
  if (!content?.linkedPlanId) return;
  // 모든 월의 plans에서 찾기
  for (const month of Object.keys(plansData || {})) {
    const plan = plansData[month]?.plans?.find(p => p.id === content.linkedPlanId);
    if (plan) {
      plan.title = title;
      markDirty('plans');
      return;
    }
  }
}

// 링크 열기 버튼 — URL 있으면 활성 <a>, 없으면 회색 disabled <span> (외부 Safari로 열기)
function openLinkBtn(url) {
  const base = 'px-2 py-1 text-xs border rounded-lg whitespace-nowrap';
  return url
    ? `<a href="${url}" onclick="event.preventDefault(); window.open('${url}', '_system') || window.open('${url}', '_blank');" class="${base} text-blue-500 border-blue-300 hover:bg-blue-50">열기</a>`
    : `<span class="${base} text-botanical-sage/40 border-botanical-stone/50 cursor-default">열기</span>`;
}

// 입력 필드에서 링크 열기 (계획/아이디어 모달용, 외부 Safari로 열기)
function openPlanLinkFromInput(inputId) {
  const input = document.getElementById(inputId);
  const url = input?.value?.trim();
  if (!url) {
    alert('링크를 입력하세요');
    return;
  }
  window.open(url, '_system') || window.open(url, '_blank');
}

// 링크 복사 버튼 — URL 있으면 활성, 없으면 회색 disabled
function copyLinkBtn(url) {
  const base = 'px-2 py-1 text-xs border rounded-lg whitespace-nowrap';
  return url
    ? `<button onclick="navigator.clipboard.writeText('${url}').then(() => alert('링크 복사 완료')).catch(() => alert('복사 실패'))" class="${base} text-emerald-500 border-emerald-300 hover:bg-emerald-50">복사</button>`
    : `<span class="${base} text-botanical-sage/40 border-botanical-stone/50 cursor-default">복사</span>`;
}

// 대본 버튼 (외부 Safari로 열기)
function scriptLinkBtn() {
  const base = 'px-2 py-1 text-xs border rounded-lg whitespace-nowrap';
  return `<a href="${DEFAULT_TRANSCRIPT_LINK}" onclick="event.preventDefault(); window.open('${DEFAULT_TRANSCRIPT_LINK}', '_system') || window.open('${DEFAULT_TRANSCRIPT_LINK}', '_blank');" class="${base} text-botanical-terracotta border-botanical-terracotta/40 hover:bg-botanical-terracotta/10">대본</a>`;
}

// 조회·좋아요 등 큰 숫자를 "1.5K" 형식으로
function toK(v, empty = '-') {
  return v ? (v / 1000).toFixed(1) + 'K' : empty;
}

// "1.5K" / "245" 양쪽 모두 받아 정수로 파싱
function parseK(raw) {
  const s = (raw || '').trim();
  if (s === '' || s === '-') return 0;
  const num = /^[\d.]+\s*[Kk]$/.test(s) ? parseFloat(s) * 1000 : parseFloat(s);
  return isNaN(num) ? 0 : Math.round(num);
}

// 캘린더 항목 표시명 — 연동 콘텐츠의 keywords > title > item.title 순
function getCalendarItemName(item) {
  if (!item) return '무제';
  const c = item.contentId
    ? (_contentByIdCache?.get(item.contentId) ?? contentsData.contents.find(c => c.id === item.contentId))
    : null;
  return c?.keywords || c?.title || item.title || '무제';
}

// 캘린더 한 번 렌더하는 동안 N+1 lookup 줄이려는 임시 캐시
let _contentByIdCache = null;

let _saveStatusFadeTimer;
function updateSaveStatus(status) {
  const el = document.getElementById('save-status');
  if (!el) return;
  clearTimeout(_saveStatusFadeTimer);
  el.style.transition = 'opacity 0.5s ease';
  if (status === 'saving') {
    el.innerHTML = '<span class="text-botanical-sage italic">저장 중…</span>';
    el.style.opacity = '0.55';
  } else if (status === 'saved') {
    el.innerHTML = '<span class="text-botanical-sage">✓ 저장됨</span>';
    el.style.opacity = '0.85';
    _saveStatusFadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
  } else if (status === 'error') {
    el.innerHTML = '<span class="text-red-500">⚠️ 저장 실패 (로컬 백업만 됨)</span>';
    el.style.opacity = '1';
  } else if (status === 'offline') {
    el.innerHTML = '<span class="text-red-500">⚠️ 오프라인 모드</span>';
    el.style.opacity = '1';
  } else if (status === 'syncing') {
    el.innerHTML = '<span class="text-blue-500">🔄 동기화 중…</span>';
    el.style.opacity = '1';
  }
}

// 마지막으로 Supabase에서 로드한 시점의 max updated_at — 다른 기기 충돌 감지용
let lastLoadedAt = null;
let lastOwnSaveAt = 0; // 내가 마지막으로 성공 저장한 wallclock (ms) — 자기 저장 grace period
let isSyncing = false; // 원격 동기화 중 플래그 — true면 저장 차단
const REMOTE_DRIFT_TOLERANCE_MS = 15000; // 서버/클라 시계 오차 허용 ±15초
const OWN_SAVE_GRACE_MS = 30000; // 자기 저장 후 30초간은 충돌 검사 스킵

function isRemoteSignificantlyNewer(remoteAt, localAt) {
  if (!remoteAt || !localAt) return false;
  const remoteMs = new Date(remoteAt).getTime();
  const localMs = new Date(localAt).getTime();
  return remoteMs - localMs > REMOTE_DRIFT_TOLERANCE_MS;
}

async function loadFromSupabase() {
  // 일시적 네트워크 흔들림 대응: 최대 3번 시도 (즉시, 600ms, 1800ms)
  const delays = [0, 600, 1800];
  let lastErr;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=key,data,updated_at`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
      if (!res.ok) throw new Error('Supabase 로드 실패: ' + res.status);
      const rows = await res.json();
      const map = {};
      const timestamps = {};
      let maxAt = null;
      rows.forEach(r => {
        // 각 key별로 updated_at이 가장 최신인 데이터만 사용
        if (!timestamps[r.key] || r.updated_at > timestamps[r.key]) {
          map[r.key] = r.data;
          timestamps[r.key] = r.updated_at;
        }
        if (r.updated_at && (!maxAt || r.updated_at > maxAt)) maxAt = r.updated_at;
      });
      lastLoadedAt = maxAt;
      return map;
    } catch (e) {
      lastErr = e;
      console.warn(`Supabase 로드 시도 ${i + 1}/${delays.length} 실패:`, e.message);
    }
  }
  throw lastErr;
}

// 원격에 더 새로운 데이터가 있는지 확인 (다른 기기에서 변경된 경우)
async function getRemoteLatestUpdatedAt() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=updated_at&order=updated_at.desc&limit=1`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.updated_at || null;
  } catch (e) { return null; }
}

// 팔로워 일간 기록 병합 — 원격 데이터로 통째 교체하면 한쪽에만 있는 날짜가 유실되므로
// 날짜 단위로 합침 (팔로워 기록은 삭제 기능이 없어 union이 항상 안전)
// 반환: { data: 병합된 performance, changed: 로컬에만 있던 날짜가 있었는지 }
function mergeFollowerHistory(localPerf, remotePerf) {
  if (!remotePerf) return { data: localPerf, changed: false };
  const localDaily = localPerf?.follower?.history?.daily;
  if (!Array.isArray(localDaily) || localDaily.length === 0) return { data: remotePerf, changed: false };

  const merged = remotePerf; // 원격을 기본으로 (팔로워 외 성과 데이터는 원격 우선)
  if (!merged.follower) merged.follower = { current: 0, history: { daily: [], monthly: [] } };
  if (!merged.follower.history) merged.follower.history = { daily: [], monthly: [] };
  if (!Array.isArray(merged.follower.history.daily)) merged.follower.history.daily = [];
  if (!Array.isArray(merged.follower.history.monthly)) merged.follower.history.monthly = [];

  const byDate = new Map(merged.follower.history.daily.map(e => [e.date, e]));
  let changed = false;
  localDaily.forEach(e => {
    if (!e?.date) return;
    const r = byDate.get(e.date);
    if (!r) {
      byDate.set(e.date, e); // 원격에 없는 날짜 → 보존
      changed = true;
    } else if (e.at && (!r.at || e.at > r.at) && e.count !== r.count) {
      byDate.set(e.date, e); // 같은 날짜면 더 최근에 입력된 값 우선
      changed = true;
    }
  });
  if (!changed) return { data: merged, changed: false };

  // 병합된 daily 기준으로 change / 월별 증가 / 현재 팔로워 재계산
  const daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  daily.forEach((e, i) => { if (i > 0) e.change = e.count - daily[i - 1].count; });
  merged.follower.history.daily = daily;
  merged.follower.current = daily[daily.length - 1].count;

  const monthChanges = {};
  daily.forEach(e => {
    const m = e.date.slice(0, 7);
    monthChanges[m] = (monthChanges[m] || 0) + (e.change || 0);
  });
  Object.entries(monthChanges).forEach(([m, change]) => setMonthlyFollowerChange(merged, m, change));
  return { data: merged, changed: true };
}

// 특정 월의 팔로워 증가분을 history.monthly와 monthly[m].followerGain 양쪽에 반영
function setMonthlyFollowerChange(perf, month, change) {
  const monthly = perf.follower.history.monthly;
  const idx = monthly.findIndex(m => m.month === month);
  if (idx >= 0) monthly[idx].change = change;
  else monthly.push({ month, change });
  if (!perf.monthly) perf.monthly = {};
  if (!perf.monthly[month]) perf.monthly[month] = {};
  perf.monthly[month].followerGain = change;
}

// 공통 동기화 함수 (중복 코드 제거)
async function syncFromRemote(options = {}) {
  const { showToast = true, checkNewer = true, force = false } = options;

  if (!force) {
    if (isSyncing) return false;
    if (Date.now() - lastOwnSaveAt < OWN_SAVE_GRACE_MS) return false;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return false;
  }

  try {
    if (checkNewer && lastLoadedAt) {
      const latest = await getRemoteLatestUpdatedAt();
      if (!isRemoteSignificantlyNewer(latest, lastLoadedAt)) return false;
    }

    const remote = await loadFromSupabase();
    if (!remote) return false;

    if (remote.calendar) calendarData = remote.calendar;
    if (remote.contents) contentsData = remote.contents;
    if (remote.performance) {
      // 팔로워 기록은 통째 교체 대신 날짜별 병합 (덮어쓰기 유실 방지 안전망)
      const { data: mergedPerf, changed } = mergeFollowerHistory(performanceData, remote.performance);
      performanceData = mergedPerf;
      if (changed) {
        localStorage.setItem('yudit_performance', JSON.stringify(performanceData));
        markDirty('performance');
        // isSyncing 해제 후 저장되도록 지연 호출 → 서버도 병합 결과를 갖게 됨
        setTimeout(() => saveAllData(), 1500);
        console.log('🔀 팔로워 기록 병합: 로컬에만 있던 날짜를 보존했어요');
      }
    }
    if (remote.revenue) revenueData = remote.revenue;
    if (remote.memos) {
      memosData = remote.memos;
      // tabId 없는 메모 자동 할당
      let migrated = 0;
      memosData.memos?.forEach(m => { if (!m.tabId) { m.tabId = 'tab_memo'; migrated++; } });
      if (migrated > 0) { markDirty('memos'); saveAllData(); }
    }
    if (remote.plans) plansData = remote.plans;
    reconcileCalendarMilestones();

    // 현재 탭만 렌더링
    const activeTab = document.querySelector('.tab-content.active')?.id.replace('-tab', '');
    if (activeTab === 'calendar') renderCalendar();
    else if (activeTab === 'dashboard') renderDashboard();
    else if (activeTab === 'content') renderContentList();
    else if (activeTab === 'performance' && typeof renderPerformance === 'function') renderPerformance();
    else if (activeTab === 'revenue') renderRevenue();
    else if (activeTab === 'memos') renderMemos();

    if (showToast) showMemoSaveToast('최신 데이터 동기화됨');
    console.log('✅ 동기화 완료:', new Date().toLocaleTimeString());
    return true;
  } catch (e) {
    console.warn('동기화 실패:', e);
    return false;
  }
}

// 자동 동기화: 원격이 더 새 거면 silent하게 다시 로드
async function autoReloadFromRemote() {
  await syncFromRemote({ showToast: true, checkNewer: true });
}

// 콘텐츠 마일스톤 ↔ 캘린더 항목 정합성 재구성
// - (isMilestone+contentId) 캘린더 항목 중 콘텐츠 마일스톤과 status+date 매칭 안되면 제거
// - 콘텐츠 마일스톤 중 캘린더에 없는 (status+date) 추가
function reconcileCalendarMilestones() {
  if (!Array.isArray(calendarData?.items) || !Array.isArray(contentsData?.contents)) return;
  const beforeLen = calendarData.items.length;

  // 중복 제거 + 유효성 검사를 한 번에 처리
  const seen = new Set();
  calendarData.items = calendarData.items.filter(it => {
    if (!it.isMilestone || !it.contentId) return true;
    // 중복 체크
    const key = `${it.contentId}-${it.status}-${it.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    // 유효성 체크
    const content = contentsData.contents.find(c => c.id === it.contentId);
    if (!content) return true;
    return (content.milestones || []).some(m => m.status === it.status && m.date === it.date);
  });

  let nextId = Date.now();
  contentsData.contents.forEach(content => {
    (content.milestones || []).forEach(m => {
      if (!m.date) return;
      const exists = calendarData.items.some(it =>
        it.isMilestone && it.contentId === content.id && it.status === m.status && it.date === m.date
      );
      if (!exists) {
        calendarData.items.push({
          id: ++nextId,
          date: m.date,
          title: content.title || '',
          category: content.category,
          type: content.type,
          status: m.status,
          contentId: content.id,
          isRevenue: content.isRevenue,
          revenueType: content.isRevenue ? content.category : null,
          isMilestone: true
        });
      }
    });
  });

  if (calendarData.items.length !== beforeLen) {
    console.log(`Calendar reconciled: ${beforeLen} → ${calendarData.items.length}`);
    saveAllData();
  }
}

// 비차단 상단 배너 (alert 대체)
function showOfflineBanner(msg) {
  let bar = document.getElementById('offline-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'offline-banner';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:60;background:#FEF3C7;color:#92400E;padding:8px 14px;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);';
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<span>⚠️ ${msg}</span><button onclick="document.getElementById('offline-banner').remove()" style="background:transparent;border:none;color:#92400E;font-size:16px;cursor:pointer;padding:0 4px;">×</button>`;
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

// ========== 중복 데이터 감지 (매일 최초 실행 시 1회) ==========
// 실제 삭제는 cleanup_duplicates.py 스크립트 사용
async function maybeCheckDuplicates() {
  const today = new Date().toISOString().slice(0, 10);
  const lastCheck = localStorage.getItem('yudit_lastDuplicateCheck');

  if (lastCheck === today) return;

  try {
    // key와 updated_at만 조회 (최적화)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=key,updated_at`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    if (!res.ok) return;

    const rows = await res.json();
    if (!rows || rows.length === 0) return;

    // key별 개수 확인
    const counts = {};
    rows.forEach(r => counts[r.key] = (counts[r.key] || 0) + 1);

    const duplicates = Object.entries(counts).filter(([_, count]) => count > 1);

    if (duplicates.length > 0) {
      console.warn(`⚠️  중복 데이터 발견: ${duplicates.length}개 key에 중복 존재`);
      console.warn('cleanup_duplicates.py 스크립트로 정리하세요');
    }

    localStorage.setItem('yudit_lastDuplicateCheck', today);

  } catch (e) {
    // 감지 실패는 무시 (중요하지 않음)
  }
}

// ========== Data Loading ==========
async function loadData() {
  // 1단계: localStorage 캐시로 즉시 시작 (빠른 초기 로딩)
  const cachedContents = localStorage.getItem('yudit_contents');
  if (cachedContents) {
    calendarData = JSON.parse(localStorage.getItem('yudit_calendar') || '{"currentMonth":"2026-04","items":[],"plans":[]}');
    contentsData = JSON.parse(cachedContents);
    performanceData = JSON.parse(localStorage.getItem('yudit_performance') || '{"follower":{"current":0,"history":{"daily":[],"monthly":[]}},"monthly":{}}');
    revenueData = JSON.parse(localStorage.getItem('yudit_revenue') || '{"summary":{"thisMonth":0,"thisYear":0},"byType":{"ad":{},"sales":{},"sponsor":{}},"tax":{},"monthly":[],"items":{"ad":[],"sales":[],"sponsor":[]}}');
    memosData = JSON.parse(localStorage.getItem('yudit_memos') || '{"memos":[]}');
    plansData = JSON.parse(localStorage.getItem('yudit_plans') || '{}');
    console.log('localStorage 캐시로 즉시 시작');
    initApp();
    // 2단계: 지난 세션 미전송분 먼저 올린 뒤, 백그라운드에서 Supabase 동기화
    resendPendingDirty().then(() =>
      syncFromRemote({ showToast: false, checkNewer: true, force: false })
    ).then(() => {
      console.log('백그라운드 Supabase 동기화 완료');
    });
    return;
  }

  // localStorage 캐시 없으면 기존 방식 (Supabase 먼저)
  try {
    const remote = await loadFromSupabase();
    const hasRemote = remote.calendar || remote.contents || remote.performance || remote.revenue;

    if (hasRemote) {
      calendarData = remote.calendar || { currentMonth: "2026-04", items: [], plans: [] };
      contentsData = remote.contents || { contents: [] };
      performanceData = remote.performance || { follower: { current: 0, history: { daily: [], monthly: [] } }, monthly: {} };
      revenueData = remote.revenue || { summary: { thisMonth: 0, thisYear: 0 }, byType: { ad: {}, sales: {}, sponsor: {} }, tax: {}, monthly: [], items: { ad: [], sales: [], sponsor: [] } };
      memosData = remote.memos || { memos: [] };
      plansData = remote.plans || {};
      console.log('Supabase에서 데이터 로드됨');

      // tabId 없는 메모 마이그레이션 (영구 저장)
      if (memosData.memos?.length > 0) {
        let migrated = 0;
        memosData.memos.forEach(m => {
          if (!m.tabId) {
            m.tabId = 'tab_memo';
            migrated++;
          }
        });
        if (migrated > 0) {
          console.log(`메모 ${migrated}개에 tabId 할당 → 저장 중...`);
          markDirty('memos');
          saveAllData();
        }
      }

      // 로드 후 오늘 날짜 자동 스냅샷 (하루 1회)
      maybeCreateHourlySnapshot(remote);
    } else {
      // Supabase에 아직 데이터 없음 → localStorage에 있으면 마이그레이션
      const savedContents = localStorage.getItem('yudit_contents');
      if (savedContents) {
        calendarData = JSON.parse(localStorage.getItem('yudit_calendar') || '{"currentMonth":"2026-04","items":[],"plans":[]}');
        contentsData = JSON.parse(savedContents);
        performanceData = JSON.parse(localStorage.getItem('yudit_performance') || '{"follower":{"current":0,"history":{"daily":[],"monthly":[]}},"monthly":{}}');
        revenueData = JSON.parse(localStorage.getItem('yudit_revenue') || '{"summary":{"thisMonth":0,"thisYear":0},"byType":{"ad":{},"sales":{},"sponsor":{}},"tax":{},"monthly":[],"items":{"ad":[],"sales":[],"sponsor":[]}}');
        memosData = JSON.parse(localStorage.getItem('yudit_memos') || '{"memos":[]}');
        plansData = JSON.parse(localStorage.getItem('yudit_plans') || '{}');
        // tabId 없는 메모 마이그레이션
        if (memosData.memos?.length > 0) {
          memosData.memos.forEach(m => { if (!m.tabId) m.tabId = 'tab_memo'; });
        }
        console.log('localStorage에서 로드 → Supabase로 마이그레이션 중...');
        await Promise.all([
          upsertToSupabase('calendar', calendarData),
          upsertToSupabase('contents', contentsData),
          upsertToSupabase('performance', performanceData),
          upsertToSupabase('revenue', revenueData),
          upsertToSupabase('memos', memosData),
          upsertToSupabase('plans', plansData)
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
        memosData = { memos: [] };
        plansData = {};
      }
    }

    updateSaveStatus('saved');

    // 일회성 마이그레이션: 아이디어 마일스톤 제거
    if (!localStorage.getItem('yudit_ideaMilestoneRemoved')) {
      let removed = 0;
      contentsData.contents.forEach(content => {
        if (content.milestones) {
          const before = content.milestones.length;
          content.milestones = content.milestones.filter(m => m.status !== '아이디어');
          removed += (before - content.milestones.length);
        }
      });
      if (removed > 0) {
        console.log(`🗑️  아이디어 마일스톤 ${removed}개 제거됨`);
        saveAllData();
        reconcileCalendarMilestones();
      }
      localStorage.setItem('yudit_ideaMilestoneRemoved', 'true');
    }

    // 일회성 마이그레이션: 월별 아이디어 → 전역 아이디어로 이동
    if (!localStorage.getItem('yudit_ideasGlobalMigrated') && plansData) {
      if (!plansData._ideas) plansData._ideas = [];
      let migrated = 0;
      Object.keys(plansData).forEach(key => {
        if (key !== '_ideas' && plansData[key] && plansData[key].ideas && plansData[key].ideas.length > 0) {
          plansData._ideas.push(...plansData[key].ideas);
          migrated += plansData[key].ideas.length;
          plansData[key].ideas = [];
        }
      });
      if (migrated > 0) {
        console.log(`📦 월별 아이디어 ${migrated}개 → 전역으로 마이그레이션 완료`);
        saveAllData();
      }
      localStorage.setItem('yudit_ideasGlobalMigrated', 'true');
    }

    // 일회성 마이그레이션: 메모 탭 구조 추가
    if (!localStorage.getItem('yudit_memoTabsMigrated') && memosData) {
      const defaultTabs = [
        { id: 'tab_plan', name: '기획', order: 0 },
        { id: 'tab_hook', name: '후킹', order: 1 },
        { id: 'tab_memo', name: '노트', order: 2 }
      ];
      if (!memosData.tabs || memosData.tabs.length === 0) {
        memosData.tabs = defaultTabs;
        memosData.lastActiveTab = 'tab_memo';
        // 기존 메모들을 '메모' 탭으로 이동
        if (memosData.memos) {
          memosData.memos.forEach(m => {
            if (!m.tabId) m.tabId = 'tab_memo';
          });
        }
        console.log('📑 메모 탭 구조 마이그레이션 완료');
        saveAllData();
      }
      localStorage.setItem('yudit_memoTabsMigrated', 'true');
    }

    // 매일 최초 실행 시 중복 데이터 감지 (비동기, 블로킹 안 함)
    maybeCheckDuplicates();

    initApp();
  } catch (e) {
    console.error('Supabase 로드 실패:', e);
    // 오프라인 폴백 - localStorage 읽기 전용 모드
    const savedContents = localStorage.getItem('yudit_contents');
    if (savedContents) {
      isOfflineMode = true; // ← 읽기 전용 모드 활성화
      calendarData = JSON.parse(localStorage.getItem('yudit_calendar') || '{"currentMonth":"2026-04","items":[]}');
      contentsData = JSON.parse(savedContents);
      performanceData = JSON.parse(localStorage.getItem('yudit_performance') || '{}');
      revenueData = JSON.parse(localStorage.getItem('yudit_revenue') || '{}');
      memosData = JSON.parse(localStorage.getItem('yudit_memos') || '{"memos":[]}');
      plansData = JSON.parse(localStorage.getItem('yudit_plans') || '{}');
      updateSaveStatus('offline');
      showOfflineBanner('⚠️  오프라인 모드 (읽기 전용) — 인터넷 연결 후 새로고침하세요. 저장 기능이 비활성화됩니다.');
      initApp();
    } else {
      alert('데이터 로드 실패. 인터넷 연결을 확인하세요.\n\n' + e.message);
    }
  }
}

// ========== Data Saving (Supabase + localStorage 백업) ==========
let saveTimer = null;

// 페이지 언로드 / 백그라운드 시 대기 중인 저장을 즉시 보냄 (iOS Safari 데이터 유실 방지)
// fetch keepalive: 페이지가 닫혀도 브라우저가 요청 끝까지 보냄
// ★ dirty 테이블만 전송 — 수정 안 한 테이블까지 보내면 옛 데이터를 든 기기가
//   다른 기기의 최신 저장을 덮어써서 팔로워 기록 등이 유실됨 (핑퐁 버그)
function flushSaveImmediately() {
  const hadPendingSave = !!saveTimer; // 디바운스 저장이 대기 중이었는지 (markDirty 없이 saveAllData만 부른 경로 대비)
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // 보낼 것: dirty 테이블. dirty가 비었는데 전체 저장이 대기 중이었다면 전체.
  // 둘 다 아니면(그냥 열어만 본 탭) 아무것도 안 보냄 — 이게 핵심.
  const keys = dirtyTables.size > 0 ? [...dirtyTables]
    : (hadPendingSave ? Object.keys(dataMap) : []);
  if (keys.length === 0) return;
  // 전송 시각을 하나로 통일 — 다음 접속 때 "서버 updated_at >= flushAt이면 전송 성공"으로 판정
  const flushAt = new Date().toISOString();
  keys.forEach(key => {
    const data = dataMap[key]();
    if (!data) return;
    try {
      // localStorage 백업 먼저 (재전송 대비 — dirty인데 아직 saveAllData가 안 돈 경우 대비)
      localStorage.setItem('yudit_' + key, JSON.stringify(data));
      fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({ key, data, updated_at: flushAt }),
        keepalive: true
      });
    } catch (e) { /* keepalive 실패해도 페이지는 이미 닫힘 */ }
  });
  // keepalive는 성공 보장이 없음 (특히 payload 합계 64KB 초과분은 조용히 실패)
  // → 다음 접속 때 재전송할 수 있도록 기록 (localStorage에 최신 데이터가 백업돼 있음)
  try {
    localStorage.setItem('yudit_pendingDirty', JSON.stringify({ keys, at: flushAt }));
  } catch (e) { /* 저장 실패 무시 */ }
}

// 지난 세션에서 keepalive 전송이 실패했을 수 있는 변경분 재전송
// 서버 updated_at이 flush 시각보다 오래됐을 때만 = 전송 실패였을 때만 올림
// (서버가 더 새거면 다른 기기가 그 뒤에 저장한 것이므로 절대 덮어쓰지 않음)
async function resendPendingDirty() {
  const raw = localStorage.getItem('yudit_pendingDirty');
  if (!raw) return;
  localStorage.removeItem('yudit_pendingDirty');
  try {
    const { keys, at } = JSON.parse(raw);
    if (!keys?.length || !at) return;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=key,updated_at&key=in.(${keys.join(',')})`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) return;
    const rows = await res.json();
    const remoteAt = {};
    rows.forEach(r => { if (!remoteAt[r.key] || r.updated_at > remoteAt[r.key]) remoteAt[r.key] = r.updated_at; });
    const atMs = new Date(at).getTime();
    for (const key of keys) {
      if (remoteAt[key] && new Date(remoteAt[key]).getTime() >= atMs) continue; // 전송 성공했거나 더 새 데이터 있음
      const cached = localStorage.getItem('yudit_' + key);
      if (!cached) continue;
      await upsertToSupabase(key, JSON.parse(cached));
      console.log(`🔁 지난 세션 미전송분 재전송: ${key}`);
    }
  } catch (e) { console.warn('미전송분 재전송 실패 (무시):', e); }
}

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    if (localStorage.getItem('yudit_openContentId')) {
      localStorage.setItem('yudit_scrollY', window.scrollY.toString());
    }
    flushSaveImmediately();
  } else {
    isSyncing = true;
    updateSaveStatus('syncing');
    const savedScrollY = localStorage.getItem('yudit_scrollY');
    const synced = await syncFromRemote({ showToast: false, checkNewer: false, force: true });
    if (synced && savedScrollY) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo({ top: parseInt(savedScrollY), behavior: 'instant' });
        });
      });
    }
    updateSaveStatus('saved');
    isSyncing = false;
  }
});
window.addEventListener('pagehide', flushSaveImmediately);
window.addEventListener('beforeunload', flushSaveImmediately);
window.addEventListener('focus', autoReloadFromRemote);

// 30초마다 자동 동기화 체크
setInterval(() => {
  if (isOfflineMode) return;
  syncFromRemote({ showToast: true, checkNewer: true });
}, 30000);

// PWA 재진입 시 동기화 (bfcache에서 복원될 때)
window.addEventListener('pageshow', async (e) => {
  if (e.persisted) {
    console.log('📱 bfcache에서 복원 - 동기화 시작');
    isSyncing = true;
    updateSaveStatus('syncing');
    await syncFromRemote({ showToast: false, checkNewer: false, force: true });
    updateSaveStatus('saved');
    isSyncing = false;
  }
});

// 특정 테이블만 dirty로 표시 (저장 최적화용)
function markDirty(...tables) {
  tables.forEach(t => dirtyTables.add(t));
}

// 전체 데이터 맵
const dataMap = {
  calendar: () => calendarData,
  contents: () => contentsData,
  performance: () => performanceData,
  revenue: () => revenueData,
  memos: () => memosData,
  plans: () => plansData
};

function saveAllData() {
  // 동기화 중에는 저장 차단 (원격 데이터 덮어쓰기 방지)
  if (isSyncing) {
    console.warn('⚠️  동기화 중: 저장 대기');
    return;
  }
  // 오프라인 모드(읽기 전용)에서는 저장 금지
  if (isOfflineMode) {
    console.warn('⚠️  오프라인 모드: 저장 불가');
    updateSaveStatus('offline');
    return;
  }

  // dirtyTables가 비어있으면 전체 저장 (기존 호환성)
  const tablesToSave = dirtyTables.size > 0 ? [...dirtyTables] : Object.keys(dataMap);

  // 1) localStorage 즉시 백업 (변경된 테이블만)
  tablesToSave.forEach(key => {
    localStorage.setItem('yudit_' + key, JSON.stringify(dataMap[key]()));
  });

  // 2) Supabase에는 디바운스 (연속 호출 시 1500ms 후 1번만)
  updateSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      // ★ 저장 전 충돌 검사
      const now = Date.now();
      if (now - lastOwnSaveAt > OWN_SAVE_GRACE_MS) {
        const remoteLatest = await getRemoteLatestUpdatedAt();
        if (remoteLatest && lastLoadedAt && isRemoteSignificantlyNewer(remoteLatest, lastLoadedAt)) {
          console.warn('⚠️  충돌 감지: Supabase에 더 최신 데이터가 있음. 저장 중단.');
          updateSaveStatus('error');
          alert('⚠️  다른 기기에서 더 최신 데이터가 저장되었습니다.\n\n새로고침(F5)하여 최신 데이터를 불러오세요.\n\n※ 현재 작업 내용은 로컬에 백업되어 있습니다.');
          return;
        }
      }

      // 변경된 테이블만 저장
      const saveTargets = dirtyTables.size > 0 ? [...dirtyTables] : Object.keys(dataMap);
      await Promise.all(saveTargets.map(key => upsertToSupabase(key, dataMap[key]())));
      dirtyTables.clear();
      localStorage.removeItem('yudit_pendingDirty'); // 정상 저장 완료 → 재전송 예약 해제

      lastLoadedAt = new Date().toISOString();
      lastOwnSaveAt = Date.now();
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
  // 한글 카테고리 → 영어 일회성 마이그레이션
  if (migrateCategoryNames()) {
    saveAllData();
  }
  // 초기 로드 후 캘린더 ↔ 마일스톤 정합성 한 번 정리 (stale orphan 제거 + 누락 추가)
  reconcileCalendarMilestones();

  // 저장된 탭 복원 (앱 전환 후 복귀용) 또는 캘린더 기본
  // 30분(1800000ms) 이상 미사용 시 캘린더로 초기화
  const validTabs = ['calendar', 'planner', 'content', 'performance', 'revenue', 'memos', 'dashboard'];
  const savedTab = localStorage.getItem('yudit_currentTab');
  const lastActiveTime = parseInt(localStorage.getItem('yudit_lastActiveTime') || '0');
  const isStale = Date.now() - lastActiveTime > 30 * 60 * 1000;
  const targetTab = (!isStale && validTabs.includes(savedTab)) ? savedTab : 'calendar';
  if (isStale) {
    localStorage.removeItem('yudit_openContentId');
    localStorage.removeItem('yudit_scrollY');
  }
  switchTab(targetTab);

  // 로딩 완료 - 스피너 숨기기
  const spinner = document.getElementById('loading-spinner');
  if (spinner) spinner.style.display = 'none';
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

  // 현재 탭 저장 (앱 전환 후 복귀용)
  localStorage.setItem('yudit_currentTab', tabName);
  localStorage.setItem('yudit_lastActiveTime', Date.now().toString());

  // Lazy Loading: 처음 클릭한 탭만 렌더링
  if (!tabRendered[tabName]) {
    if (tabName === 'calendar') renderCalendar();
    else if (tabName === 'dashboard') renderDashboard();
    else if (tabName === 'content') renderContentList();
    else if (tabName === 'planning') renderPlanning();
    else if (tabName === 'performance') renderPerformance();
    else if (tabName === 'revenue') renderRevenue();
    else if (tabName === 'memos') renderMemos();
    tabRendered[tabName] = true;
  }

  // 메모탭 진입 시 '자주 쓰는 내용' 항상 접기
  if (tabName === 'memos') {
    templateSectionOpen = false;
    document.querySelectorAll('#memos-content > details').forEach(d => d.removeAttribute('open'));
  }
}

// ========== Calendar ==========
function renderCalendar() {
  _contentByIdCache = new Map(contentsData.contents.map(c => [c.id, c]));
  renderCalendarTitle();
  // renderTodaySummary(); // 오늘 섹션 제거
  document.getElementById('today-summary').innerHTML = '';
  if (currentView === 'monthly') {
    renderMonthlyView();
  } else if (currentView === 'weekly') {
    renderWeeklyView();
  } else {
    renderMilestoneView();
  }
  _contentByIdCache = null;
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
        <span class="${item.type === '광고' ? 'text-botanical-terracotta font-medium' : ''}">${getCalendarItemName(item)}</span>
        <span class="text-botanical-sage text-xs">${statusText(item.status)}</span>
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
    <div class="grid grid-cols-7 gap-1 md:gap-2 mb-2">
      <div class="text-center text-xs md:text-sm font-medium text-botanical-sage py-1 md:py-2">월</div>
      <div class="text-center text-xs md:text-sm font-medium text-botanical-sage py-1 md:py-2">화</div>
      <div class="text-center text-xs md:text-sm font-medium text-botanical-sage py-1 md:py-2">수</div>
      <div class="text-center text-xs md:text-sm font-medium text-botanical-sage py-1 md:py-2">목</div>
      <div class="text-center text-xs md:text-sm font-medium text-botanical-sage py-1 md:py-2">금</div>
      <div class="text-center text-xs md:text-sm font-medium text-botanical-sage py-1 md:py-2">토</div>
      <div class="text-center text-xs md:text-sm font-medium text-botanical-terracotta py-1 md:py-2">일</div>
    </div>
    <div class="grid grid-cols-7 gap-1 md:gap-2">
  `;

  // Previous month
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const day = prevLastDay - i;
    html += `<div class="min-h-[3rem] md:min-h-[6rem] p-1 md:p-2 rounded-lg md:rounded-xl text-xs md:text-sm text-botanical-clay">${day}</div>`;
  }

  // Current month
  const today = new Date();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const items = calendarData.items.filter(item => item.date === dateStr && item.status === '업로드완료');
    const dayOfWeek = (startDayOfWeek + day - 1) % 7;
    const isSunday = dayOfWeek === 6;
    const isToday = today.getFullYear() === currentYear && today.getMonth() + 1 === currentMonth && today.getDate() === day;

    let cellClass = 'min-h-[3rem] md:min-h-[6rem] p-1 md:p-2 rounded-lg md:rounded-xl text-xs md:text-sm cursor-pointer transition-all';
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
    if (items.length > 0) {
      // Mobile: dots only (max 3 + overflow count)
      const dotVisible = items.slice(0, 3);
      const dotExtra = items.length - dotVisible.length;
      const dotsHtml = dotVisible.map(item =>
        `<span class="inline-block w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${isToday ? 'white' : (categoryColors[item.category] || '#8C9A84')};"></span>`
      ).join('');
      const dotExtraHtml = dotExtra > 0 ? `<span class="text-[9px] leading-none ${isToday ? 'opacity-70' : 'text-botanical-sage'}">+${dotExtra}</span>` : '';

      // PC: full text
      const visible = items.slice(0, 2);
      const extra = items.length - visible.length;
      const pcItemsHtml = visible.map(item => `
        <div class="mt-1 text-xs ${isToday ? 'font-normal' : ''}">
          <p class="flex items-start gap-1">
            <span class="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style="background-color: ${isToday ? 'white' : (categoryColors[item.category] || '#8C9A84')};"></span>
            <span class="leading-snug" style="display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden;">${getCalendarItemName(item)}</span>
          </p>
          <p class="ml-2.5 ${isToday ? 'opacity-70' : (item.type === '광고' ? 'text-botanical-terracotta' : 'text-botanical-sage')}">${statusText(item.status)}</p>
        </div>
      `).join('');
      const pcExtraHtml = extra > 0 ? `<p class="mt-1 text-[10px] ${isToday ? 'opacity-70' : 'text-botanical-sage'} font-medium">+${extra} 더보기</p>` : '';

      itemsHtml = `
        <div class="md:hidden flex items-center gap-1 mt-1 flex-wrap">${dotsHtml}${dotExtraHtml}</div>
        <div class="hidden md:block">${pcItemsHtml}${pcExtraHtml}</div>
      `;
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
    html += `<div class="min-h-[3rem] md:min-h-[6rem] p-1 md:p-2 rounded-lg md:rounded-xl text-xs md:text-sm text-botanical-clay">${i}</div>`;
  }

  html += '</div>';

  // Legend
  html += `
    <div class="flex flex-wrap gap-4 mt-4 pt-3 border-t border-botanical-stone text-xs">
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #879483;"></div><span class="text-botanical-sage">Career Guide</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #5C6B5A;"></div><span class="text-botanical-sage">AI Work</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #C1725D;"></div><span class="text-botanical-sage">Money Log</span></div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-full" style="background-color: #7BA3A8;"></div><span class="text-botanical-sage">Life Style</span></div>
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
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  // Mobile: Today + Tomorrow 2 cards
  let html = `
    <div class="md:hidden space-y-3">
      ${renderDayCard(today, today, '오늘')}
      ${renderDayCard(tomorrow, today, '내일')}
    </div>
  `;

  // PC: Two-week grid (기존)
  html += `
    <div class="hidden md:block">
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

  // Close PC wrapper
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

function renderDayCard(date, today, label) {
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const items = calendarData.items.filter(item => item.date === dateStr);
  const isToday = date.toDateString() === today.toDateString();
  const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];

  let cellClass = 'p-4 rounded-xl border cursor-pointer transition-all';
  if (isToday) {
    cellClass += ' bg-botanical-fg text-white border-botanical-fg';
  } else if (items.length > 0) {
    const hasAd = items.some(i => i.type === '광고');
    cellClass += hasAd
      ? ' bg-botanical-terracotta/10 border-botanical-terracotta'
      : ' bg-botanical-sage/10 border-botanical-sage';
  } else {
    cellClass += ' bg-white border-botanical-stone';
  }

  const itemsHtml = items.length > 0
    ? items.map(item => `
        <div class="flex items-start gap-2 mt-2 text-sm">
          <span class="w-2 h-2 rounded-full mt-1.5 shrink-0" style="background-color: ${isToday ? 'white' : (categoryColors[item.category] || '#8C9A84')};"></span>
          <div class="flex-1 min-w-0">
            <p class="leading-snug">${getCalendarItemName(item)}</p>
            <p class="text-xs ${isToday ? 'opacity-70' : (item.type === '광고' ? 'text-botanical-terracotta' : 'text-botanical-sage')}">${statusText(item.status)}</p>
          </div>
        </div>
      `).join('')
    : `<p class="text-sm mt-2 ${isToday ? 'opacity-70' : 'text-botanical-sage'}">일정 없음</p>`;

  return `
    <div class="${cellClass}" onclick="openDateDetail('${dateStr}')">
      <div class="flex items-baseline gap-2">
        <h3 class="font-semibold text-lg">${label}</h3>
        <span class="text-sm ${isToday ? 'opacity-80' : 'text-botanical-sage'}">${date.getMonth() + 1}월 ${date.getDate()}일 (${dayOfWeek})</span>
      </div>
      ${itemsHtml}
    </div>
  `;
}

function renderWeeklyCell(date, today) {
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const items = calendarData.items.filter(item => item.date === dateStr);
  const isSunday = date.getDay() === 0;
  const isToday = date.toDateString() === today.toDateString();

  const displayDate = date.getMonth() + 1 !== currentMonth
    ? `${date.getMonth() + 1}/${date.getDate()}`
    : date.getDate();

  let cellClass = 'min-h-[3rem] md:h-44 p-1 md:p-3 rounded-lg md:rounded-xl text-xs md:text-sm cursor-pointer transition-all';

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

  // Mobile: dots only (max 3 + +N)
  const dotVisible = items.slice(0, 3);
  const dotExtra = items.length - dotVisible.length;
  const dotsHtml = dotVisible.map(item =>
    `<span class="inline-block w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${isToday ? 'white' : (categoryColors[item.category] || '#8C9A84')};"></span>`
  ).join('');
  const dotExtraHtml = dotExtra > 0 ? `<span class="text-[9px] leading-none ${isToday ? 'opacity-70' : 'text-botanical-sage'}">+${dotExtra}</span>` : '';

  // PC: full text (기존)
  const pcItemsHtml = items.slice(0, 3).map(item => `
    <div class="mt-2 text-xs ${isToday ? 'font-normal' : ''}">
      <p class="flex items-start gap-1">
        <span class="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style="background-color: ${isToday ? 'white' : categoryColors[item.category] || '#8C9A84'};"></span>
        <span class="leading-snug" style="display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden;">${getCalendarItemName(item)}</span>
      </p>
      <p class="ml-2.5 ${isToday ? 'opacity-70' : (item.type === '광고' ? 'text-botanical-terracotta' : 'text-botanical-sage')}">${statusText(item.status)}</p>
    </div>
  `).join('');

  const itemsHtml = items.length > 0 ? `
    <div class="md:hidden flex items-center gap-1 mt-1 flex-wrap">${dotsHtml}${dotExtraHtml}</div>
    <div class="hidden md:block">${pcItemsHtml}</div>
  ` : '';

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
    const generalStages = ['기획중', '제작중', '업로드완료'];
    const revenueStages = ['계약완료', '기획안1차공유', '기획안최종컨펌', '영상1차공유', '영상최종컨펌', '업로드완료'];

    allContents.forEach(content => {
      const color = categoryColors[content.category] || '#8C9A84';
      const milestones = content.milestones || milestonesByContent[content.id] || [];
      const stages = content.isRevenue ? revenueStages : generalStages;
      const stageLabels = content.isRevenue
        ? ['계약', '기획1차', '기획최종', '영상1차', '영상최종', '업로드']
        : ['기획중', '제작중', '업로드'];

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
  currentMonth--;
  if (currentMonth < 1) {
    currentMonth = 12;
    currentYear--;
  }
  renderCalendar();
}

function nextMonth() {
  currentMonth++;
  if (currentMonth > 12) {
    currentMonth = 1;
    currentYear++;
  }
  renderCalendar();
}

function openDateDetail(dateStr) {
  const items = calendarData.items.filter(item => item.date === dateStr && item.status === '업로드완료');
  const popup = document.getElementById('calendar-popup');
  const popupContent = document.getElementById('popup-content');

  if (items.length === 0) {
    // Empty date - show empty message
    const [y, m, d] = dateStr.split('-');
    popupContent.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-lg">${parseInt(m)}월 ${parseInt(d)}일</h3>
        <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="text-center py-8 text-botanical-sage">
        <p class="text-sm">등록된 일정이 없습니다</p>
        <p class="text-xs mt-2 text-botanical-clay">플래너 탭에서 계획을 등록하세요</p>
      </div>
    `;
  } else if (items.length > 1) {
    // Multiple items - show list to pick
    popupContent.innerHTML = renderDateItemList(items, dateStr);
  } else {
    // Single item - show detail
    openDateItemDetail(items[0].id, dateStr);
    popup.classList.remove('hidden');
    return;
  }

  popup.classList.remove('hidden');
}

function renderDateItemList(items, dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-lg">${parseInt(m)}월 ${parseInt(d)}일 일정 (${items.length}건)</h3>
      <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="space-y-2 mb-4 max-h-80 overflow-y-auto">
      ${items.map(item => `
          <button onclick="openDateItemDetail(${item.id}, '${dateStr}')" class="w-full text-left p-3 rounded-xl border border-botanical-stone hover:bg-botanical-cream/40 transition-all flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${categoryColors[item.category] || '#8C9A84'};"></span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">${getCalendarItemName(item)}</p>
              <p class="text-xs ${item.type === '광고' ? 'text-botanical-terracotta' : 'text-botanical-sage'}">${statusText(item.status)}${item.type ? ' · ' + item.type : ''}</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-botanical-sage shrink-0"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        `).join('')}
    </div>
  `;
}

function openDateItemDetail(itemId, dateStr) {
  const item = calendarData.items.find(i => i.id === itemId);
  if (!item) return;
  const popup = document.getElementById('calendar-popup');
  const popupContent = document.getElementById('popup-content');
  const linkedContent = item.contentId ? contentsData.contents.find(c => c.id === item.contentId) : null;
  const dateItems = calendarData.items.filter(i => i.date === dateStr);
  const backBtn = dateItems.length > 1
    ? `<button onclick="document.getElementById('popup-content').innerHTML = renderDateItemList(calendarData.items.filter(i => i.date === '${dateStr}'), '${dateStr}')" class="text-xs text-botanical-sage hover:text-botanical-fg mb-2 flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>목록</button>`
    : '';

    if (linkedContent) {
      // Linked to content - show content info
      popupContent.innerHTML = `
        ${backBtn}
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-lg">${linkedContent.title || '무제'}</h3>
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
            <span class="text-sm text-botanical-sage w-16">이 날 일정</span>
            <span class="text-sm font-medium text-botanical-terracotta">${statusText(item.status) || '-'}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-botanical-sage w-16">현재 상태</span>
            <span class="text-sm text-botanical-sage">${statusText(linkedContent.status)}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-botanical-sage w-16">업로드</span>
            <span class="text-sm">${getUploadDate(linkedContent) || '-'}</span>
          </div>
        </div>
        <div class="flex gap-2">
          <button onclick="goToContentExpanded(${linkedContent.id})" class="flex-1 py-2 bg-botanical-fg text-white rounded-xl hover:bg-botanical-fg/90 transition-all">보기</button>
          <button onclick="deleteCalendarItem(${item.id})" class="px-4 py-2 border border-red-300 rounded-xl text-red-400 hover:bg-red-50 transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      `;
    } else {
      // Not linked - show calendar item info + link button
      popupContent.innerHTML = `
        ${backBtn}
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-lg">${item.title || '무제'}</h3>
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
            <span class="text-sm">${statusText(item.status)}</span>
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
            <button onclick="deleteCalendarItem(${item.id})" class="px-4 py-2 border border-red-300 rounded-xl text-red-400 hover:bg-red-50 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
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
          <option value="Career Guide">Career Guide</option>
          <option value="AI Work">AI Work</option>
          <option value="Money Log">Money Log</option>
          <option value="Life Style">Life Style</option>
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
          <option value="기획안1차공유">기획안 공유</option>
          <option value="기획안최종컨펌">기획안 컨펌</option>
          <option value="영상1차공유">영상 공유</option>
          <option value="영상최종컨펌">영상 컨펌</option>
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
  // 해당 콘텐츠의 월로 필터 변경
  const content = contentsData.contents.find(c => c.id === contentId);
  if (content) {
    const refDate = getContentRefDate(content);
    if (refDate) {
      contentSelectedMonth = refDate.slice(0, 7);
    }
  }
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

function goToPerformance(contentId) {
  switchTab('performance');
  setTimeout(() => {
    if (contentId) {
      const row = document.querySelector(`[data-perf-row="${contentId}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('ring-2', 'ring-botanical-terracotta', 'bg-botanical-terracotta/10');
        setTimeout(() => row.classList.remove('ring-2', 'ring-botanical-terracotta', 'bg-botanical-terracotta/10'), 2200);
      }
    } else {
      document.getElementById('performance-tab')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 150);
}

// ========== Dashboard ==========
function changeDashMonth(monthStr) {
  dashSelectedMonth = monthStr;
  renderDashboard();
}

// 아이디어 필터 상태 (아이디어는 기획 탭으로 이동됨)
let ideaCategoryFilter = 'all'; // 'all', 'Career Guide', 'AI Work', 'Money Log', 'Life Style'
let ideaSourceFilter = 'all';   // 'all' | 'original'(링크X) | 'reference'(링크O)

function switchIdeaCategory(cat) {
  ideaCategoryFilter = cat;
  plRenderIdeas();
}
function switchIdeaSource(src) {
  ideaSourceFilter = src;
  plRenderIdeas();
}
// 아이디어 변경 후 기획 탭 아이디어 섹션만 갱신 (DOM에 있을 때만)
function plIdeasRefresh() {
  if (document.getElementById('pl-sec-idea')) plRenderIdeas();
}

function renderDashboard() {
  // 플래너는 dashSelectedMonth 기준
  const dashMonthStr = dashSelectedMonth;
  const dashY = parseInt(dashMonthStr.slice(0, 4));
  const dashM = parseInt(dashMonthStr.slice(5));

  // plansData 초기화 (null 체크)
  if (!plansData) plansData = {};

  // 해당 월의 plans 가져오기
  const monthData = plansData[dashMonthStr] || { plans: [], ideas: [] };
  const monthPlans = monthData.plans || [];

  // 주차별로 plans 그룹화 (1~4주차)
  const plansByWeek = { 1: [], 2: [], 3: [], 4: [] };
  monthPlans.forEach(plan => {
    const week = plan.week || 1;
    if (week >= 1 && week <= 4) {
      plansByWeek[week].push(plan);
    }
  });

  // 카테고리별 진행 상황 계산 (실제 업로드된 콘텐츠 기준)
  const monthContents = contentsData?.contents?.filter(c => {
    const uploadDate = getUploadDate(c);
    if (!uploadDate) return false;
    return uploadDate.startsWith(dashMonthStr);
  }) || [];

  const categoryCount = {};
  const categories = ['Career Guide', 'Money Log', 'AI Work', 'Life Style'];
  categories.forEach(cat => {
    categoryCount[cat] = monthContents.filter(c => c.category === cat).length;
  });
  const totalPlans = monthContents.length;
  const totalGoal = totalGoalConfig || 8;

  document.getElementById('dashboard-content').innerHTML = `
    <!-- 월 선택기 -->
    <div class="mb-6">
      <div class="flex items-center gap-3">
        ${renderMonthSelect('dashboard-month-select', dashSelectedMonth, 'changeDashMonth')}
      </div>
    </div>

    <!-- 카테고리별 진행 상황 -->
    <div class="mb-6">
      <div class="bg-white rounded-2xl p-4 md:p-5 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-semibold text-botanical-fg">카테고리별 진행 상황</h3>
          <span class="text-sm text-botanical-sage">${dashY}년 ${dashM}월</span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          ${categories.map(cat => {
            const goal = categoryGoalsConfig[cat] || 2;
            const current = categoryCount[cat] || 0;
            const percentage = goal > 0 ? Math.round((current / goal) * 100) : 0;
            return `
              <div class="p-3 rounded-lg border border-botanical-stone hover:border-botanical-sage transition-all">
                <p class="text-xs text-botanical-sage mb-1">${cat}</p>
                <div class="flex items-baseline gap-1">
                  <span class="text-lg font-semibold ${current >= goal ? 'text-botanical-sage' : 'text-botanical-fg'}">${current}</span>
                  <span class="text-xs text-botanical-sage">/ ${goal}</span>
                </div>
                <div class="mt-2 h-1 bg-botanical-stone rounded-full overflow-hidden">
                  <div class="h-full bg-botanical-sage transition-all" style="width: ${Math.min(percentage, 100)}%"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="pt-3 border-t border-botanical-stone flex items-center justify-between">
          <span class="text-sm text-botanical-sage">전체 진행</span>
          <span class="text-sm font-semibold ${totalPlans >= totalGoal ? 'text-botanical-sage' : 'text-botanical-fg'}">${totalPlans} / ${totalGoal}</span>
        </div>
      </div>
    </div>

    <!-- 월간 계획 -->
    <div>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        ${[1, 2, 3, 4].map(week => {
          const weekPlans = plansByWeek[week] || [];
          const weekStart = (week - 1) * 7 + 1;
          const weekEnd = Math.min(week * 7, new Date(dashY, dashM, 0).getDate());
          return `
            <div class="bg-white rounded-2xl p-4 shadow-sm">
              <h3 class="text-sm font-semibold text-botanical-sage mb-3 flex items-center justify-between">
                <span>${week}주차</span>
                <span class="text-xs font-normal text-botanical-clay">${dashM}/${weekStart}-${dashM}/${weekEnd}</span>
              </h3>

              ${weekPlans.map(plan => {
                const linkedContent = plan.linkedContentId && contentsData && contentsData.contents
                  ? contentsData.contents.find(c => String(c.id) === String(plan.linkedContentId))
                  : null;
                const isRevenue = linkedContent ? linkedContent.isRevenue : false;
                const typeTag = isRevenue
                  ? '<span class="inline-block px-2 py-0.5 rounded-md text-xs font-medium" style="background-color: #FEF3C7; color: #D97706;">수익</span>'
                  : '<span class="inline-block px-2 py-0.5 rounded-md text-xs font-medium" style="background-color: #87948320; color: #879483;">일반</span>';
                const catColor = categoryColors[plan.category] || '#8C9A84';
                return `
                <div class="mb-3 p-4 rounded-xl border border-botanical-stone hover:border-botanical-sage transition-all">
                  <div class="mb-2 flex items-center gap-1.5">
                    <span class="inline-block px-2 py-0.5 rounded-md text-xs font-medium" style="background-color: ${catColor}20; color: ${catColor};">${plan.category}</span>
                    ${typeTag}
                  </div>
                  <h4 class="text-base font-semibold text-botanical-fg mb-2">${getPlanDisplayTitle(plan)}</h4>
                  ${(() => {
                    // 연동된 콘텐츠에서 인스타 링크 가져오기
                    const contentUrl = linkedContent?.url;
                    return contentUrl ? `
                    <div class="flex items-center gap-2 mb-2">
                      <span class="text-xs text-botanical-sage truncate flex-1">${contentUrl}</span>
                      <a href="${contentUrl}" target="_blank" class="px-2 py-1 text-xs border rounded-lg text-blue-500 border-blue-300 hover:bg-blue-50">열기</a>
                    </div>
                  ` : '';
                  })()}
                  ${(plan.description && !plan.description.match(/^\(.*예정.*\)$/)) ? `<p class="text-xs text-botanical-sage leading-relaxed mb-3">${plan.description.split('\n').map(line => line.trim()).filter(line => line).join('<br>')}</p>` : ''}
                  <div class="flex items-center gap-1.5">
                    <button onclick="editPlan('${plan.id}')" class="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border border-botanical-stone text-botanical-sage hover:bg-botanical-cream transition-all">
                      수정
                    </button>
                    ${plan.linkedContentId ? `
                      <button onclick="goToLinkedContent('${plan.linkedContentId}')" class="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-botanical-fg text-white hover:bg-opacity-90 transition-all">
                        보기 →
                      </button>
                      <button onclick="unlinkContentFromPlan('${plan.id}')" title="연동 해제" class="px-2 py-1.5 rounded-lg text-xs font-medium border border-botanical-stone text-botanical-terracotta hover:bg-red-50 transition-all">
                        ✕
                      </button>
                    ` : `
                      <button onclick="openLinkContentPopup('${plan.id}')" class="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-botanical-fg text-white hover:bg-opacity-90 transition-all">
                        연동
                      </button>
                    `}
                  </div>
                </div>
              `;}).join('')}

              <button onclick="addPlanToWeek(${week})" class="w-full py-2.5 rounded-xl border-2 border-dashed border-botanical-stone text-botanical-sage hover:border-botanical-sage hover:text-botanical-fg transition-all text-sm font-medium">
                + 계획 추가
              </button>
            </div>
          `;
        }).join('')}
      </div>
    </div>

  `;
}

// ========== Planner Functions ==========
function addPlanToWeek(week) {
  const popup = document.getElementById('calendar-popup');
  const popupContent = document.getElementById('popup-content');

  popupContent.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-lg">계획 추가 (${week}주차)</h3>
      <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="space-y-4">
      <div>
        <label class="text-sm font-medium block mb-1">카테고리</label>
        <select id="new-plan-category" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
          <option value="Career Guide">Career Guide</option>
          <option value="AI Work">AI Work</option>
          <option value="Money Log">Money Log</option>
          <option value="Life Style">Life Style</option>
        </select>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">제목</label>
        <input type="text" id="new-plan-title" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none" placeholder="계획 제목">
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">레퍼런스 링크 <span class="text-xs text-botanical-sage">(선택)</span></label>
        <div class="flex gap-2">
          <input type="text" id="new-plan-link" class="flex-1 px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none" placeholder="https://...">
          <button type="button" onclick="openPlanLinkFromInput('new-plan-link')" class="shrink-0 px-3 py-2 rounded-xl border border-botanical-stone text-sm text-botanical-sage hover:bg-botanical-cream transition-all">열기</button>
        </div>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">상세 내용</label>
        <textarea id="new-plan-description" rows="4" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none resize-none" placeholder="• 항목 1\n• 항목 2\n• 항목 3" onkeydown="handlePlanDescriptionEnter(event)"></textarea>
      </div>
      <button onclick="saveNewPlan(${week})" class="w-full py-2.5 bg-botanical-fg text-white rounded-xl hover:bg-botanical-fg/90 transition-all font-medium">추가</button>
    </div>
  `;

  popup.classList.remove('hidden');
}

function editPlan(planId) {
  if (!plansData || !plansData[dashSelectedMonth] || !plansData[dashSelectedMonth].plans) return;

  const numPlanId = typeof planId === 'string' ? parseInt(planId) : planId;
  const plan = plansData[dashSelectedMonth].plans.find(p => p.id === numPlanId || p.id === planId);
  if (!plan) {
    alert('계획을 찾을 수 없습니다');
    return;
  }

  const popup = document.getElementById('calendar-popup');
  const popupContent = document.getElementById('popup-content');

  // 현재 월과 다음 월 계산
  const currentMonthObj = new Date(dashSelectedMonth + '-01');
  const nextMonthObj = new Date(currentMonthObj);
  nextMonthObj.setMonth(nextMonthObj.getMonth() + 1);
  const nextMonthStr = `${nextMonthObj.getFullYear()}-${String(nextMonthObj.getMonth() + 1).padStart(2, '0')}`;

  const currentM = currentMonthObj.getMonth() + 1;
  const nextM = nextMonthObj.getMonth() + 1;
  const currentValue = `${dashSelectedMonth}-${plan.week}`;

  popupContent.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-lg">계획 수정</h3>
      <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-sm font-medium block mb-1">주차</label>
          <select id="edit-plan-week" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
            <option value="${dashSelectedMonth}-1" ${currentValue === `${dashSelectedMonth}-1` ? 'selected' : ''}>${currentM}월 1주차</option>
            <option value="${dashSelectedMonth}-2" ${currentValue === `${dashSelectedMonth}-2` ? 'selected' : ''}>${currentM}월 2주차</option>
            <option value="${dashSelectedMonth}-3" ${currentValue === `${dashSelectedMonth}-3` ? 'selected' : ''}>${currentM}월 3주차</option>
            <option value="${dashSelectedMonth}-4" ${currentValue === `${dashSelectedMonth}-4` ? 'selected' : ''}>${currentM}월 4주차</option>
            <option value="${nextMonthStr}-1">${nextM}월 1주차</option>
            <option value="${nextMonthStr}-2">${nextM}월 2주차</option>
            <option value="${nextMonthStr}-3">${nextM}월 3주차</option>
            <option value="${nextMonthStr}-4">${nextM}월 4주차</option>
          </select>
        </div>
        <div>
          <label class="text-sm font-medium block mb-1">카테고리</label>
          <select id="edit-plan-category" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
            <option value="Career Guide" ${plan.category === 'Career Guide' ? 'selected' : ''}>Career Guide</option>
            <option value="AI Work" ${plan.category === 'AI Work' ? 'selected' : ''}>AI Work</option>
            <option value="Money Log" ${plan.category === 'Money Log' ? 'selected' : ''}>Money Log</option>
            <option value="Life Style" ${plan.category === 'Life Style' ? 'selected' : ''}>Life Style</option>
          </select>
        </div>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">제목</label>
        <input type="text" id="edit-plan-title" value="${plan.title}" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none" placeholder="계획 제목">
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">레퍼런스 링크 <span class="text-xs text-botanical-sage">(선택)</span></label>
        <div class="flex gap-2">
          <input type="text" id="edit-plan-link" value="${plan.link || ''}" class="flex-1 px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none" placeholder="https://...">
          <button type="button" onclick="openPlanLinkFromInput('edit-plan-link')" class="shrink-0 px-3 py-2 rounded-xl border border-botanical-stone text-sm text-botanical-sage hover:bg-botanical-cream transition-all">열기</button>
        </div>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">상세 내용</label>
        <textarea id="edit-plan-description" rows="4" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none resize-none" placeholder="• 항목 1\n• 항목 2\n• 항목 3" onkeydown="handlePlanDescriptionEnter(event)">${plan.description || ''}</textarea>
      </div>
      <div class="flex gap-2">
        <button onclick="deletePlan('${planId}')" class="flex-1 py-2.5 border border-red-300 text-red-500 rounded-xl hover:bg-red-50 transition-all font-medium">삭제</button>
        <button onclick="savePlan('${planId}')" class="flex-1 py-2.5 bg-botanical-fg text-white rounded-xl hover:bg-botanical-fg/90 transition-all font-medium">저장</button>
      </div>
    </div>
  `;

  popup.classList.remove('hidden');
}

function savePlan(planId) {
  const weekValue = document.getElementById('edit-plan-week').value; // "YYYY-MM-W" 형식
  const category = document.getElementById('edit-plan-category').value;
  const title = document.getElementById('edit-plan-title').value;
  const link = document.getElementById('edit-plan-link').value;
  const description = document.getElementById('edit-plan-description').value;

  if (!title) {
    alert('제목을 입력하세요');
    return;
  }

  // 월-주차 파싱
  const [targetMonth, weekStr] = weekValue.split('-').slice(0, 2).join('-') === dashSelectedMonth ?
    [dashSelectedMonth, weekValue.split('-')[2]] :
    [weekValue.substring(0, 7), weekValue.split('-')[2]];
  const week = parseInt(weekStr);

  // 원래 계획 찾기
  const plan = plansData[dashSelectedMonth].plans.find(p => p.id === planId);
  if (!plan) {
    alert('계획을 찾을 수 없습니다');
    return;
  }

  // 월이 변경된 경우 이동 처리
  if (targetMonth !== dashSelectedMonth) {
    // 원래 월에서 제거
    plansData[dashSelectedMonth].plans = plansData[dashSelectedMonth].plans.filter(p => p.id !== planId);

    // 새로운 월로 이동
    if (!plansData[targetMonth]) {
      plansData[targetMonth] = { plans: [], ideas: [] };
    }
    plan.week = week;
    plan.category = category;
    plan.title = title;
    plan.link = link;
    plan.description = description;
    plansData[targetMonth].plans.push(plan);
  } else {
    // 같은 월 내에서 수정
    plan.week = week;
    plan.category = category;
    plan.title = title;
    plan.link = link;
    plan.description = description;
  }

  saveAllData();
  closeCalendarPopup();
  renderDashboard();
}

function deletePlan(planId) {
  if (!confirm('이 계획을 삭제하시겠습니까?\n\n연동된 콘텐츠는 유지되지만, 작성 계획 내용은 삭제됩니다.')) {
    return;
  }

  if (!plansData || !plansData[dashSelectedMonth] || !plansData[dashSelectedMonth].plans) return;

  const numPlanId = typeof planId === 'string' ? parseInt(planId) : planId;

  // plan 삭제
  plansData[dashSelectedMonth].plans = plansData[dashSelectedMonth].plans.filter(p => p.id !== numPlanId && p.id !== planId);

  // 연동된 콘텐츠의 planDetail 비우기 (콘텐츠 자체는 유지)
  if (contentsData && contentsData.contents) {
    contentsData.contents.forEach(content => {
      if (content.planDetail && content.planDetail.includes(planId)) {
        // planId가 직접 저장되지 않으므로, 모든 콘텐츠의 planDetail을 유지
        // 사용자가 수동으로 정리하도록 함
      }
    });
  }

  saveAllData();
  closeCalendarPopup();
  renderDashboard();
}

function saveNewPlan(week) {
  const category = document.getElementById('new-plan-category').value;
  const title = document.getElementById('new-plan-title').value;
  const link = document.getElementById('new-plan-link').value;
  const description = document.getElementById('new-plan-description').value;

  if (!title) {
    alert('제목을 입력하세요');
    return;
  }

  if (!plansData) plansData = {};
  if (!plansData[dashSelectedMonth]) plansData[dashSelectedMonth] = { plans: [], ideas: [] };

  // 고유 ID 생성 (삭제 후 중복 방지)
  const timestamp = Date.now();
  const newPlan = {
    id: `p_${dashSelectedMonth}_${timestamp}`,
    week: week,
    category: category,
    title: title,
    link: link,
    description: description,
    createdAt: new Date().toISOString(),
    createdBy: 'user'
  };

  plansData[dashSelectedMonth].plans.push(newPlan);

  saveAllData();
  closeCalendarPopup();
  renderDashboard();
}

function handlePlanDescriptionEnter(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const textarea = event.target;
    const cursorPos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, cursorPos);
    const textAfter = textarea.value.substring(cursorPos);

    textarea.value = textBefore + '\n• ' + textAfter;
    textarea.selectionStart = textarea.selectionEnd = cursorPos + 3;
  }
}

// 연동된 콘텐츠로 이동
function goToLinkedContent(contentId) {
  const numId = parseInt(contentId);
  const content = contentsData.contents.find(c => c.id === numId || c.id === contentId);
  if (!content) {
    alert('연동된 콘텐츠를 찾을 수 없습니다');
    console.log('찾는 ID:', contentId, '타입:', typeof contentId, '콘텐츠 ID들:', contentsData.contents.map(c => c.id));
    return;
  }
  switchTab('content');
  renderContentList();
  setTimeout(() => {
    toggleContentForm(content.id);
  }, 100);
}

// 플래너-콘텐츠 연동 해제
function unlinkContentFromPlan(planId) {
  if (!confirm('콘텐츠 연동을 해제하시겠습니까?\n(콘텐츠는 삭제되지 않습니다)')) return;

  const numPlanId = typeof planId === 'string' ? parseInt(planId) : planId;
  const plan = plansData[dashSelectedMonth]?.plans?.find(p => p.id === numPlanId || p.id === planId);
  if (!plan) return;

  const linkedContentId = plan.linkedContentId;

  // 플랜에서 연동 해제
  delete plan.linkedContentId;

  // 콘텐츠에서도 연동 해제
  if (linkedContentId && contentsData?.contents) {
    const content = contentsData.contents.find(c => c.id === linkedContentId);
    if (content) {
      delete content.linkedPlanId;
      markDirty('contents');
    }
  }

  markDirty('plans');
  saveAllData();
  renderDashboard();
  showMemoSaveToast('연동 해제됨');
}

// 콘텐츠 연동 팝업 열기
function openLinkContentPopup(planId) {
  const numPlanId = typeof planId === 'string' ? parseInt(planId) : planId;
  const plan = plansData[dashSelectedMonth]?.plans?.find(p => p.id === numPlanId || p.id === planId);
  if (!plan) return;

  // 이미 연동된 콘텐츠 제외, 미연동 콘텐츠만 표시
  const availableContents = (contentsData?.contents || []).filter(c => !c.linkedPlanId);

  if (availableContents.length === 0) {
    alert('연동 가능한 콘텐츠가 없습니다.\n콘텐츠 탭에서 먼저 콘텐츠를 등록해주세요.');
    return;
  }

  const popup = document.getElementById('calendar-popup');
  const popupContent = document.getElementById('popup-content');

  popupContent.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-lg">콘텐츠 연동</h3>
      <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <p class="text-sm text-botanical-sage mb-3">연동할 콘텐츠를 선택하세요</p>
    <div class="space-y-2 max-h-[60vh] overflow-y-auto">
      ${availableContents.map(content => `
        <button onclick="linkContentToPlan('${planId}', ${content.id})" class="w-full p-3 rounded-lg border border-botanical-stone hover:border-botanical-sage cursor-pointer transition-all text-left">
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-botanical-cream text-botanical-sage">${content.category || '미분류'}</span>
            <span class="text-xs text-botanical-sage">${content.status || ''}</span>
          </div>
          <h4 class="text-sm font-semibold text-botanical-fg truncate">${content.title || '제목 없음'}</h4>
        </button>
      `).join('')}
    </div>
  `;

  popup.classList.remove('hidden');
}

// 콘텐츠-플랜 연동 실행
function linkContentToPlan(planId, contentId) {
  const numPlanId = typeof planId === 'string' ? parseInt(planId) : planId;
  const numContentId = typeof contentId === 'string' ? parseInt(contentId) : contentId;

  const plan = plansData[dashSelectedMonth]?.plans?.find(p => p.id === numPlanId || p.id === planId);
  const content = contentsData?.contents?.find(c => c.id === numContentId || c.id === contentId);

  if (!plan || !content) {
    alert('연동 실패: 플랜 또는 콘텐츠를 찾을 수 없습니다');
    return;
  }

  // 연동 ID 설정
  plan.linkedContentId = content.id;
  content.linkedPlanId = plan.id;

  // 제목: 콘텐츠 → 플랜 (바로 덮어씌움)
  plan.title = content.title;

  // 설명: 플랜 → 콘텐츠 복사 (기존 내용에 추가하지 않고 덮어씀)
  if (plan.description) {
    content.planDetail = plan.description;
  }

  markDirty('plans');
  markDirty('contents');
  saveAllData();

  closeCalendarPopup();
  renderDashboard();
  showMemoSaveToast('연동 완료');
}

function addIdea() {
  const popup = document.getElementById('calendar-popup');
  const popupContent = document.getElementById('popup-content');

  popupContent.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-lg">아이디어 추가</h3>
      <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="space-y-4">
      <div>
        <label class="text-sm font-medium block mb-1">카테고리</label>
        <select id="new-idea-category" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
          <option value="Career Guide">Career Guide</option>
          <option value="AI Work">AI Work</option>
          <option value="Money Log">Money Log</option>
          <option value="Life Style">Life Style</option>
        </select>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">제목</label>
        <input type="text" id="new-idea-title" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none" placeholder="아이디어 제목">
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">레퍼런스 링크 <span class="text-xs text-botanical-sage">(선택)</span></label>
        <div class="flex gap-2">
          <input type="text" id="new-idea-link" class="flex-1 px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none" placeholder="https://...">
          <button type="button" onclick="openPlanLinkFromInput('new-idea-link')" class="shrink-0 px-3 py-2 rounded-xl border border-botanical-stone text-sm text-botanical-sage hover:bg-botanical-cream transition-all">열기</button>
        </div>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">상세 내용 <span class="text-xs text-botanical-sage">(선택)</span></label>
        <textarea id="new-idea-description" rows="3" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none resize-none" placeholder="간단한 설명"></textarea>
      </div>
      <button onclick="saveNewIdea()" class="w-full py-2.5 bg-botanical-fg text-white rounded-xl hover:bg-botanical-fg/90 transition-all font-medium">추가</button>
    </div>
  `;

  popup.classList.remove('hidden');
}

function editIdea(ideaId) {
  if (!plansData || !plansData._ideas) return;

  const idea = plansData._ideas.find(i => i.id === ideaId);
  if (!idea) {
    alert('아이디어를 찾을 수 없습니다');
    return;
  }

  const popup = document.getElementById('calendar-popup');
  const popupContent = document.getElementById('popup-content');

  popupContent.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-lg">아이디어 수정</h3>
      <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="space-y-4">
      <div>
        <label class="text-sm font-medium block mb-1">카테고리</label>
        <select id="edit-idea-category" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
          <option value="Career Guide" ${idea.category === 'Career Guide' ? 'selected' : ''}>Career Guide</option>
          <option value="AI Work" ${idea.category === 'AI Work' ? 'selected' : ''}>AI Work</option>
          <option value="Money Log" ${idea.category === 'Money Log' ? 'selected' : ''}>Money Log</option>
          <option value="Life Style" ${idea.category === 'Life Style' ? 'selected' : ''}>Life Style</option>
        </select>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">제목</label>
        <input type="text" id="edit-idea-title" value="${idea.title}" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none" placeholder="아이디어 제목">
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">레퍼런스 링크 <span class="text-xs text-botanical-sage">(선택)</span></label>
        <div class="flex gap-2">
          <input type="text" id="edit-idea-link" value="${idea.link || ''}" class="flex-1 px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none" placeholder="https://...">
          <button type="button" onclick="openPlanLinkFromInput('edit-idea-link')" class="shrink-0 px-3 py-2 rounded-xl border border-botanical-stone text-sm text-botanical-sage hover:bg-botanical-cream transition-all">열기</button>
        </div>
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">상세 내용 <span class="text-xs text-botanical-sage">(선택)</span></label>
        <textarea id="edit-idea-description" rows="3" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none resize-none" placeholder="간단한 설명">${idea.description || ''}</textarea>
      </div>
      <button onclick="saveIdea('${ideaId}')" class="w-full py-2.5 bg-botanical-fg text-white rounded-xl hover:bg-botanical-fg/90 transition-all font-medium">저장</button>
    </div>
  `;

  popup.classList.remove('hidden');
}

function deleteIdea(ideaId) {
  if (confirm('이 아이디어를 삭제하시겠습니까?')) {
    if (!plansData || !plansData._ideas) return;

    plansData._ideas = plansData._ideas.filter(idea => idea.id !== ideaId);

    saveAllData();
    plIdeasRefresh();
  }
}

function saveNewIdea() {
  const category = document.getElementById('new-idea-category').value;
  const title = document.getElementById('new-idea-title').value;
  const link = document.getElementById('new-idea-link').value;
  const description = document.getElementById('new-idea-description').value;

  if (!title) {
    alert('제목을 입력하세요');
    return;
  }

  if (!plansData) plansData = {};
  if (!plansData._ideas) plansData._ideas = [];

  const newIdea = {
    id: `i_${Date.now()}`,
    category: category,
    title: title,
    link: link,
    description: description,
    createdAt: new Date().toISOString(),
    createdBy: 'user'
  };

  plansData._ideas.push(newIdea);

  saveAllData();
  closeCalendarPopup();
  plIdeasRefresh();
}

function saveIdea(ideaId) {
  const category = document.getElementById('edit-idea-category').value;
  const title = document.getElementById('edit-idea-title').value;
  const link = document.getElementById('edit-idea-link').value;
  const description = document.getElementById('edit-idea-description').value;

  if (!title) {
    alert('제목을 입력하세요');
    return;
  }

  const idea = plansData._ideas.find(i => i.id === ideaId);
  if (!idea) {
    alert('아이디어를 찾을 수 없습니다');
    return;
  }

  idea.category = category;
  idea.title = title;
  idea.link = link;
  idea.description = description;

  saveAllData();
  closeCalendarPopup();
  plIdeasRefresh();
}

// 아이디어 → 플래너 이동
function moveIdeaToPlanner(ideaId) {
  const idea = plansData._ideas?.find(i => i.id === ideaId);
  if (!idea) return;

  // 현재 날짜 기준 +4주 옵션 생성
  const today = new Date();
  const options = [];
  for (let i = 0; i < 4; i++) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + i * 7);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    const weekOfMonth = Math.ceil(targetDate.getDate() / 7);
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    options.push({ monthStr, week: weekOfMonth, label: `${month}월 ${weekOfMonth}주차` });
  }

  const popup = document.getElementById('calendar-popup');
  const popupContent = document.getElementById('popup-content');

  popupContent.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-lg">플래너로 이동</h3>
      <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <p class="text-sm text-botanical-sage mb-4">"${idea.title}"을(를) 어느 주차로 이동할까요?</p>
    <div class="space-y-2">
      ${options.map(opt => `
        <button onclick="confirmMoveToPlanner('${ideaId}', '${opt.monthStr}', ${opt.week})" class="w-full py-3 px-4 text-left rounded-xl border border-botanical-stone hover:border-botanical-sage hover:bg-botanical-cream/50 transition-all">
          <span class="font-medium">${opt.label}</span>
        </button>
      `).join('')}
    </div>
  `;

  popup.classList.remove('hidden');
}

function confirmMoveToPlanner(ideaId, monthStr, week) {
  const idea = plansData._ideas?.find(i => i.id === ideaId);
  if (!idea) return;

  // 플래너 데이터 구조 확인
  if (!plansData[monthStr]) plansData[monthStr] = { plans: [], ideas: [] };

  // 새 플랜 생성
  const newPlan = {
    id: `p_${Date.now()}`,
    week: week,
    category: idea.category,
    title: idea.title,
    link: idea.link || '',
    description: idea.description || '',
    createdAt: new Date().toISOString(),
    createdBy: 'user'
  };

  plansData[monthStr].plans.push(newPlan);

  // 아이디어에서 삭제
  plansData._ideas = plansData._ideas.filter(i => i.id !== ideaId);

  saveAllData();
  closeCalendarPopup();
  plIdeasRefresh();
  alert('플래너로 이동되었습니다');
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

function changeContentMonth(monthStr) {
  contentSelectedMonth = monthStr;
  renderContentList();
}

function renderContentList() {
  // 1) 타입 필터 (전체/일반/수익)
  let filteredContents = contentsData.contents;
  if (contentTypeFilter === 'general') {
    filteredContents = contentsData.contents.filter(c => !c.isRevenue);
  } else if (contentTypeFilter === 'revenue') {
    filteredContents = contentsData.contents.filter(c => c.isRevenue);
  }

  // 2) 월 필터: 업로드완료 마일스톤 우선, 없으면 예정일. 둘 다 없으면 항상 표시.
  const monthStr = contentSelectedMonth;
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const isPastMonth = monthStr < currentMonth;

  filteredContents = filteredContents.filter(c => {
    const ref = getContentRefDate(c);
    // 과거월 선택 시: 업로드완료만 표시
    if (isPastMonth) {
      if (c.status !== '업로드완료') return false;
      if (!ref) return false;
      return ref.startsWith(monthStr);
    }
    // 현재월/미래월: 기존 로직
    if (!ref) return true; // 날짜 미정 → 항상 노출
    return ref.startsWith(monthStr);
  });

  // 3) 정렬: 업로드 완료된 것은 맨 아래로, 업로드 완료끼리는 최신순 (위로), 나머지는 등록 순
  filteredContents.sort((a, b) => {
    const aCompleted = a.status === '업로드완료' ? 1 : 0;
    const bCompleted = b.status === '업로드완료' ? 1 : 0;
    if (aCompleted !== bCompleted) return aCompleted - bCompleted; // 완료된 것이 아래로
    // 업로드 완료끼리는 uploadDate 최신순 (위로)
    if (aCompleted && bCompleted) {
      const aDate = getUploadDate(a) || '';
      const bDate = getUploadDate(b) || '';
      if (aDate !== bDate) return bDate.localeCompare(aDate); // 내림차순
    }
    // 나머지는 id 순서 유지 (등록 순)
    return a.id - b.id;
  });

  const contentCount = filteredContents.length;

  let html = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div class="flex flex-wrap items-center gap-2 md:gap-4">
        ${renderMonthSelect('content-month-select', contentSelectedMonth, 'changeContentMonth')}
        <div class="flex gap-1 bg-botanical-stone p-1 rounded-full">
          <button onclick="switchContentFilter('all')" id="content-filter-all" class="content-filter-btn px-3 py-1 rounded-full text-xs font-medium ${contentTypeFilter === 'all' ? 'bg-botanical-fg text-white' : 'bg-botanical-stone text-botanical-sage'}">전체</button>
          <button onclick="switchContentFilter('general')" id="content-filter-general" class="content-filter-btn px-3 py-1 rounded-full text-xs font-medium ${contentTypeFilter === 'general' ? 'bg-botanical-fg text-white' : 'bg-botanical-stone text-botanical-sage'}">일반</button>
          <button onclick="switchContentFilter('revenue')" id="content-filter-revenue" class="content-filter-btn px-3 py-1 rounded-full text-xs font-medium ${contentTypeFilter === 'revenue' ? 'bg-botanical-fg text-white' : 'bg-botanical-stone text-botanical-sage'}">수익</button>
        </div>
        <span class="text-sm text-botanical-sage">${contentCount}건</span>
      </div>
      <div class="flex gap-2">
        <button onclick="collapseAllContentForms()" class="px-4 py-2 border border-botanical-stone rounded-xl text-sm font-medium text-botanical-sage hover:bg-botanical-cream/40 transition-all">목록</button>
        <button id="content-fab-btn" onclick="showNewContentModal()" class="fixed bottom-6 right-6 md:relative md:bottom-auto md:right-auto w-14 h-14 md:w-auto md:h-auto rounded-full md:rounded-xl shadow-lg md:shadow-none z-40 flex items-center justify-center md:px-4 md:py-2 bg-botanical-fg text-white text-2xl md:text-sm font-medium hover:bg-botanical-fg/90 transition-all"><span class="md:hidden leading-none">+</span><span class="hidden md:inline">+ 새 콘텐츠 등록</span></button>
      </div>
    </div>

    <div class="hidden md:block bg-botanical-cream/50 rounded-xl px-5 py-3 mb-4">
      <div class="flex items-center gap-3 text-sm font-medium text-botanical-sage">
        <span class="w-32 shrink-0">카테고리</span>
        <span class="w-24 shrink-0">상태</span>
        <span class="w-14 shrink-0">타입</span>
        <span class="flex-1 min-w-0">콘텐츠 제목</span>
        <span class="w-16 shrink-0 text-center">업로드</span>
        <span class="w-12 shrink-0 text-center">URL</span>
        <span class="w-5 shrink-0"></span>
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
    const uploadedAt = getUploadDate(content);

    html += `
      <div class="bg-white rounded-2xl shadow-sm overflow-hidden ${isCompleted ? 'border-l-4 border-botanical-sage' : ''}">
        <div onclick="toggleContentForm(${content.id})" class="px-3 md:px-5 py-3 md:py-4 cursor-pointer hover:bg-botanical-cream/30 transition-all">
          <!-- Mobile: 2-row stack (업로드/URL까지만, 성과 제거) -->
          <div class="md:hidden space-y-1.5">
            <div class="flex items-center gap-2 text-xs flex-wrap">
              <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${categoryColor};"></span><span class="text-botanical-sage">${content.category}</span></span>
              <span class="px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap" style="background-color: ${statusStyle.bg}; color: ${statusStyle.text};">${statusText(content.status)}</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap bg-botanical-sage/20 text-botanical-sage">${content.type}</span>
              <span class="ml-auto text-botanical-sage text-[10px]">업로드 ${uploadedAt ? uploadedAt.slice(5).replace('-', '/') : '-'}</span>
            </div>
            <div class="flex items-center gap-2">
              <span data-content-title="${content.id}" class="text-base font-medium flex-1 min-w-0 truncate">${content.title || '무제'}</span>
              ${content.url ? `<a href="${content.url}" target="_blank" class="text-[11px] text-blue-500 underline shrink-0" onclick="event.stopPropagation()">링크</a>` : ''}
            </div>
          </div>
          <!-- PC: single-row (업로드/URL까지만, 성과 제거) -->
          <div class="hidden md:flex items-center gap-3 text-sm">
            <span class="w-32 shrink-0"><span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${categoryColor};"></span><span class="text-xs text-botanical-sage">${content.category}</span></span></span>
            <span class="w-24 shrink-0"><span class="px-2 py-1 rounded-full text-xs whitespace-nowrap" style="background-color: ${statusStyle.bg}; color: ${statusStyle.text};">${statusText(content.status)}</span></span>
            <span class="w-14 shrink-0"><span class="px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-botanical-sage/20 text-botanical-sage">${content.type}</span></span>
            <span class="font-medium flex-1 min-w-0"><span data-content-title="${content.id}" class="truncate block">${content.title || '무제'}</span></span>
            <span class="w-16 shrink-0 text-botanical-sage text-xs text-center" data-upload-cell="${content.id}">${uploadedAt ? uploadedAt.slice(5).replace('-', '/') : '-'}</span>
            <span class="w-12 shrink-0 text-xs text-center">${content.url ? `<a href="${content.url}" target="_blank" class="text-blue-500 underline" onclick="event.stopPropagation()">링크</a>` : '<span class="text-botanical-sage">-</span>'}</span>
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

  // 이전에 열려있던 콘텐츠 복원 (앱 전환 후 복귀 시)
  const openContentId = localStorage.getItem('yudit_openContentId');
  if (openContentId) {
    const contentExists = contentsData.contents.some(c => c.id == openContentId);
    if (contentExists) {
      // 먼저 form 열기
      const form = document.getElementById('form-' + openContentId);
      const arrow = document.getElementById('arrow-' + openContentId);
      if (form && !form.classList.contains('active')) {
        form.classList.add('active');
        arrow.style.transform = 'rotate(180deg)';

        // 레이아웃 안정화 후 스크롤 복원
        requestAnimationFrame(() => {
          autoResizeAllScriptCells();
          attachScriptCellObservers();

          // 한 프레임 더 기다려서 레이아웃 완전히 안정화
          requestAnimationFrame(() => {
            const savedScrollY = localStorage.getItem('yudit_scrollY');
            if (savedScrollY) {
              window.scrollTo({
                top: parseInt(savedScrollY),
                behavior: 'instant' // 즉시 이동 (튀는 현상 방지)
              });
            }
          });
        });

        // 스크롤 위치 추적 재시작
        window.addEventListener('scroll', saveScrollPosition, { passive: true });
      }
    } else {
      localStorage.removeItem('yudit_openContentId');
      localStorage.removeItem('yudit_scrollY');
    }
  }

  // 대사 셀 롱프레스 이벤트 (모바일용)
  attachDialogueLongPress();
}

// Helper: 텍스트 선택 방지
function disableTextSelection(...elements) {
  elements.forEach(el => {
    el.style.userSelect = 'none';
    el.style.webkitUserSelect = 'none';
    el.style.webkitTouchCallout = 'none';
  });
}

// Helper: 텍스트 선택 복원
function restoreTextSelection(...elements) {
  elements.forEach(el => {
    el.style.userSelect = '';
    el.style.webkitUserSelect = '';
    el.style.webkitTouchCallout = '';
  });
}

// 대사 셀 롱프레스 이벤트 리스너 (모바일)
function attachDialogueLongPress() {
  const dialogueCells = document.querySelectorAll('.dialogue-cell');

  dialogueCells.forEach(cell => {
    let longPressTimer;
    const textarea = cell.querySelector('textarea');
    if (!textarea) return;

    textarea.addEventListener('touchstart', (e) => {
      disableTextSelection(cell, textarea);

      longPressTimer = setTimeout(() => {
        const contentId = parseInt(cell.dataset.contentId);
        const idx = parseInt(cell.dataset.rowIdx);
        toggleDialogueMenu(contentId, idx);
      }, 500);
    }, { passive: true });

    textarea.addEventListener('touchend', () => {
      clearTimeout(longPressTimer);
      setTimeout(() => restoreTextSelection(cell, textarea), 100);
    }, { passive: true });

    textarea.addEventListener('touchmove', () => {
      clearTimeout(longPressTimer);
      setTimeout(() => restoreTextSelection(cell, textarea), 100);
    }, { passive: true });
  });

  // 메뉴 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dialogue-menu') && !e.target.closest('.dialogue-menu-btn')) {
      document.querySelectorAll('.dialogue-menu').forEach(menu => {
        menu.classList.add('hidden');
      });
    }
    if (!e.target.closest('.version-add-menu') && !e.target.closest('button[onclick*="toggleAddVersionMenu"]')) {
      document.querySelectorAll('.version-add-menu').forEach(menu => {
        menu.classList.add('hidden');
      });
    }
  });
}

function renderContentForm(content) {
  const sectionColors = {
    'HOOK': '#6366F1',
    'INTRO': '#0EA5E9',
    'MAIN 1': '#10B981',
    'MAIN 2': '#F59E0B',
    'MAIN 3': '#06B6D4',
    'MAIN 4': '#A855F7',
    'MAIN 5': '#EF4444',
    'MAIN 6': '#EAB308',
    'MAIN 7': '#14B8A6',
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
  const colSubtitle = colW.subtitle ?? 460;

  return `
    <div class="p-2 md:p-6 space-y-3 md:space-y-6">
      <!-- 상단 정보 수정 영역 -->
      <div class="p-3 md:p-4 bg-botanical-cream/30 rounded-xl space-y-3 md:space-y-4" id="top-info-${content.id}">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <p class="text-sm font-semibold text-botanical-fg">기본 정보</p>
            <span class="text-xs text-botanical-sage/70">(일정 포함 · 자동 저장 중)</span>
          </div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">상태</label>
            ${content.isRevenue ? `
            <select data-field="status" class="w-full px-3 py-2 rounded-lg border border-botanical-stone bg-white text-sm focus:outline-none">
              <option value="계약완료" ${content.status === '계약완료' ? 'selected' : ''}>계약완료</option>
              <option value="기획안1차공유" ${content.status === '기획안1차공유' ? 'selected' : ''}>기획안 공유</option>
              <option value="기획안최종컨펌" ${content.status === '기획안최종컨펌' ? 'selected' : ''}>기획안 컨펌</option>
              <option value="영상1차공유" ${content.status === '영상1차공유' ? 'selected' : ''}>영상 공유</option>
              <option value="영상최종컨펌" ${content.status === '영상최종컨펌' ? 'selected' : ''}>영상 컨펌</option>
              <option value="업로드완료" ${content.status === '업로드완료' ? 'selected' : ''}>업로드 완료</option>
            </select>
            ` : `
            <select data-field="status" class="w-full px-3 py-2 rounded-lg border border-botanical-stone bg-white text-sm focus:outline-none">
              <option value="기획중" ${content.status === '기획중' ? 'selected' : ''}>기획중</option>
              <option value="제작중" ${content.status === '제작중' ? 'selected' : ''}>제작중</option>
              <option value="업로드완료" ${content.status === '업로드완료' ? 'selected' : ''}>업로드 완료</option>
            </select>
            `}
          </div>
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">카테고리</label>
            <select data-field="category" class="w-full px-3 py-2 rounded-lg border border-botanical-stone bg-white text-sm focus:outline-none">
              <optgroup label="일반">
                <option value="Career Guide" ${content.category === 'Career Guide' ? 'selected' : ''}>Career Guide</option>
                <option value="AI Work" ${content.category === 'AI Work' ? 'selected' : ''}>AI Work</option>
                <option value="Money Log" ${content.category === 'Money Log' ? 'selected' : ''}>Money Log</option>
                <option value="Life Style" ${content.category === 'Life Style' ? 'selected' : ''}>Life Style</option>
              </optgroup>
              <optgroup label="수익">
                <option value="광고" ${content.category === '광고' ? 'selected' : ''}>광고</option>
                <option value="판매" ${content.category === '판매' ? 'selected' : ''}>판매</option>
                <option value="협찬" ${content.category === '협찬' ? 'selected' : ''}>협찬</option>
              </optgroup>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="text-xs text-botanical-sage mb-1 block">URL</label>
            <input type="text" data-field="url" placeholder="인스타 링크" value="${content.url || ''}" class="w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
          </div>
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-xs text-botanical-sage">성과 지표 <span class="text-botanical-sage/60">(읽기 전용)</span></label>
              <button type="button" onclick="goToPerformance()" class="text-xs text-botanical-terracotta hover:underline">성과분석에서 수정 →</button>
            </div>
            <div class="grid grid-cols-5 gap-1 text-center">
              <div class="px-2 py-2 rounded-lg bg-botanical-cream/40 border border-botanical-stone/50">
                <p class="text-[10px] text-botanical-sage">조회</p>
                <p class="text-xs font-medium">${toK(content.performance.views)}</p>
              </div>
              <div class="px-2 py-2 rounded-lg bg-botanical-cream/40 border border-botanical-stone/50">
                <p class="text-[10px] text-botanical-sage">좋아요</p>
                <p class="text-xs font-medium">${toK(content.performance.likes)}</p>
              </div>
              <div class="px-2 py-2 rounded-lg bg-botanical-cream/40 border border-botanical-stone/50">
                <p class="text-[10px] text-botanical-sage">공유</p>
                <p class="text-xs font-medium">${content.performance.shares || '-'}</p>
              </div>
              <div class="px-2 py-2 rounded-lg bg-botanical-cream/40 border border-botanical-stone/50">
                <p class="text-[10px] text-botanical-sage">댓글</p>
                <p class="text-xs font-medium">${content.performance.comments || '-'}</p>
              </div>
              <div class="px-2 py-2 rounded-lg bg-botanical-cream/40 border border-botanical-stone/50">
                <p class="text-[10px] text-botanical-sage">저장</p>
                <p class="text-xs font-medium">${content.performance.saves || '-'}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 일정 (캘린더 연동) -->
        <div class="border-t border-botanical-stone pt-3 md:pt-4 mt-3 md:mt-4">
          <p class="text-sm font-medium mb-2 md:mb-3">일정 (캘린더 연동)</p>
          ${content.isRevenue ? `
          <div class="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
            <div>
              <label class="text-xs text-botanical-sage block mb-1">계약완료</label>
              <input type="date" id="milestone-${content.id}-contract" value="${getMilestoneDate(content, '계약완료')}" oninput="updateMilestone(${content.id}, '계약완료', this.value)" class="w-full px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-botanical-stone text-xs md:text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">기획안 공유</label>
              <input type="date" id="milestone-${content.id}-plan1" value="${getMilestoneDate(content, '기획안1차공유')}" oninput="updateMilestone(${content.id}, '기획안1차공유', this.value)" class="w-full px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-botanical-stone text-xs md:text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">기획안 컨펌</label>
              <input type="date" id="milestone-${content.id}-planfinal" value="${getMilestoneDate(content, '기획안최종컨펌')}" oninput="updateMilestone(${content.id}, '기획안최종컨펌', this.value)" class="w-full px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-botanical-stone text-xs md:text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">영상 공유</label>
              <input type="date" id="milestone-${content.id}-video1" value="${getMilestoneDate(content, '영상1차공유')}" oninput="updateMilestone(${content.id}, '영상1차공유', this.value)" class="w-full px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-botanical-stone text-xs md:text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">영상 컨펌</label>
              <input type="date" id="milestone-${content.id}-videofinal" value="${getMilestoneDate(content, '영상최종컨펌')}" oninput="updateMilestone(${content.id}, '영상최종컨펌', this.value)" class="w-full px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-botanical-stone text-xs md:text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">업로드 완료</label>
              <input type="date" id="milestone-${content.id}-upload" value="${getMilestoneDate(content, '업로드완료')}" oninput="updateMilestone(${content.id}, '업로드완료', this.value)" class="w-full px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-botanical-stone text-xs md:text-sm focus:outline-none">
            </div>
          </div>
          ` : `
          <div class="grid grid-cols-3 gap-2 md:gap-3">
            <div>
              <label class="text-xs text-botanical-sage block mb-1">기획중</label>
              <input type="date" id="milestone-${content.id}-planning" value="${getMilestoneDate(content, '기획중')}" oninput="updateMilestone(${content.id}, '기획중', this.value)" class="w-full px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-botanical-stone text-xs md:text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">제작중</label>
              <input type="date" id="milestone-${content.id}-production" value="${getMilestoneDate(content, '제작중')}" oninput="updateMilestone(${content.id}, '제작중', this.value)" class="w-full px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-botanical-stone text-xs md:text-sm focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-botanical-sage block mb-1">업로드 완료</label>
              <input type="date" id="milestone-${content.id}-upload" value="${getMilestoneDate(content, '업로드완료')}" oninput="updateMilestone(${content.id}, '업로드완료', this.value)" class="w-full px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-botanical-stone text-xs md:text-sm focus:outline-none">
            </div>
          </div>
          `}
        </div>
      </div>

      <!-- 1. 레퍼런스 분석 (일반) / 광고·판매·협찬 상세 (수익) -->
      ${content.isRevenue ? `
      <div class="md:border md:border-botanical-stone md:rounded-xl p-0 md:p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-medium flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-botanical-sage/20 text-botanical-sage text-xs flex items-center justify-center">1</span>
            ${content.category} 상세${content.category === '광고' ? ' (수익 연동)' : ''}
          </h3>
          <span class="text-xs text-botanical-sage">${content.category === '광고' ? '수익 리포트 자동 반영' : '수익 연동 없음'}</span>
        </div>

        <div class="border border-botanical-stone rounded-lg overflow-x-auto">
          <table class="w-full text-sm">
            <tbody>
              ${content.category === '광고' ? `
              <tr class="border-b border-botanical-stone">
                <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-cream/40 font-medium w-24 md:w-40 text-xs md:text-sm break-keep align-middle">소득 구분</td>
                <td class="px-4 py-2">
                  <select oninput="updateAdInfo(${content.id}, 'incomeType', this.value); syncRevenueFromContent(contentsData.contents.find(c => c.id === ${content.id}));" class="w-60 px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none bg-white" style="height:38px;">
                    <option value="etc" ${(content.adInfo?.incomeType ?? 'etc') === 'etc' ? 'selected' : ''}>기타소득</option>
                    <option value="biz" ${content.adInfo?.incomeType === 'biz' ? 'selected' : ''}>사업소득</option>
                  </select>
                </td>
              </tr>
              <tr class="border-b border-botanical-stone">
                <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-cream/40 font-medium w-24 md:w-40 text-xs md:text-sm break-keep align-middle">광고비 (원)</td>
                <td class="px-2 md:px-4 py-2">
                  <!-- 모바일: 항목 1줄씩, PC: 4컬럼 -->
                  <div class="space-y-1.5 md:space-y-0 md:grid md:grid-cols-4 md:gap-2 md:items-center">
                    <label class="flex items-center gap-1.5 md:block">
                      <span class="md:hidden text-[10px] text-botanical-sage w-[4.2rem] shrink-0">릴스업로드비</span>
                      <input type="number" id="adfee-reels-${content.id}" value="${content.adInfo?.reelsFee || ''}" oninput="updateAdFee(${content.id})" placeholder="0" class="flex-1 min-w-0 md:w-full px-2 md:px-3 text-sm rounded-lg border border-botanical-stone focus:outline-none" style="height:38px;">
                      <span class="md:hidden text-[9px] text-botanical-sage/70 w-5 shrink-0 text-right">원</span>
                    </label>
                    <label class="flex items-center gap-1.5 md:block">
                      <span class="md:hidden text-[10px] text-botanical-sage w-[4.2rem] shrink-0">컨텐츠제작비</span>
                      <input type="number" id="adfee-content-${content.id}" value="${content.adInfo?.contentFee || ''}" oninput="updateAdFee(${content.id})" placeholder="0" class="flex-1 min-w-0 md:w-full px-2 md:px-3 text-sm rounded-lg border border-botanical-stone focus:outline-none" style="height:38px;">
                      <span class="md:hidden text-[9px] text-botanical-sage/70 w-5 shrink-0 text-right">원</span>
                    </label>
                    <label class="flex items-center gap-1.5 md:block">
                      <span class="md:hidden text-[10px] text-botanical-sage w-[4.2rem] shrink-0">2차활용비(월)</span>
                      <input type="number" id="adfee-secondary-${content.id}" value="${content.adInfo?.secondaryFee || ''}" oninput="updateAdFee(${content.id})" placeholder="0" class="flex-1 min-w-0 md:w-full px-2 md:px-3 text-sm rounded-lg border border-botanical-stone focus:outline-none" style="height:38px;">
                      <span class="md:hidden text-[9px] text-botanical-sage/70 w-5 shrink-0 text-right">원</span>
                    </label>
                    <div class="flex items-center justify-between md:justify-end pt-1.5 md:pt-0 border-t md:border-0 border-botanical-stone/50">
                      <span class="md:hidden text-xs text-botanical-fg font-medium">합계</span>
                      <span class="hidden md:inline text-botanical-sage text-xs">합계 </span>
                      <span class="font-serif font-semibold text-base md:text-sm" id="adfee-total-${content.id}">${fmt((content.adInfo?.reelsFee || 0) + (content.adInfo?.contentFee || 0) + (content.adInfo?.secondaryFee || 0))}</span><span class="md:hidden text-xs text-botanical-sage ml-0.5">원</span>
                    </div>
                  </div>
                  <!-- PC 라벨 (모바일은 각 줄에 라벨이 이미 있음) -->
                  <div class="hidden md:grid md:grid-cols-4 gap-2 mt-1 text-[10px] text-botanical-sage text-center">
                    <span>릴스업로드비</span><span>컨텐츠제작비</span><span>2차활용비(월)</span><span></span>
                  </div>
                </td>
              </tr>
              <tr class="border-b border-botanical-stone">
                <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-cream/40 font-medium w-24 md:w-40 text-xs md:text-sm break-keep align-middle">제작 가이드</td>
                <td class="px-2 md:px-4 py-2">
                  <div class="flex gap-1.5 md:gap-2">
                    <input type="text" value="${content.adInfo?.guideLink || ''}" oninput="updateAdInfo(${content.id}, 'guideLink', this.value)" placeholder="https://..." class="flex-1 min-w-0 px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                    ${openLinkBtn(content.adInfo?.guideLink)}
                  </div>
                </td>
              </tr>
              <tr class="border-b border-botanical-stone">
                <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-cream/40 font-medium w-24 md:w-40 text-xs md:text-sm break-keep align-middle">계약서</td>
                <td class="px-2 md:px-4 py-2">
                  <div class="flex gap-1.5 md:gap-2">
                    <input type="text" value="${content.adInfo?.contractLink || ''}" oninput="updateAdInfo(${content.id}, 'contractLink', this.value)" placeholder="https://... 또는 이미지 URL" class="flex-1 min-w-0 px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                    ${openLinkBtn(content.adInfo?.contractLink)}
                  </div>
                </td>
              </tr>
              ` : content.category === '판매' ? `
              <tr class="border-b border-botanical-stone">
                <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-cream/40 font-medium w-24 md:w-40 text-xs md:text-sm break-keep align-middle">판매 상품명</td>
                <td class="px-4 py-2">
                  <input type="text" value="${content.adInfo?.productName || ''}" oninput="updateAdInfo(${content.id}, 'productName', this.value)" placeholder="상품명 입력" class="w-full px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                </td>
              </tr>
              <tr class="border-b border-botanical-stone">
                <td class="px-4 py-3 bg-botanical-cream/40 font-medium align-middle">판매 링크</td>
                <td class="px-4 py-2">
                  <div class="flex gap-2">
                    <input type="text" value="${content.adInfo?.saleLink || ''}" oninput="updateAdInfo(${content.id}, 'saleLink', this.value)" placeholder="https://..." class="flex-1 px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                    ${openLinkBtn(content.adInfo?.saleLink)}
                  </div>
                </td>
              </tr>
              ` : `
              <tr class="border-b border-botanical-stone">
                <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-cream/40 font-medium w-24 md:w-40 text-xs md:text-sm break-keep align-middle">협찬 상품명</td>
                <td class="px-4 py-2">
                  <input type="text" value="${content.adInfo?.productName || ''}" oninput="updateAdInfo(${content.id}, 'productName', this.value)" placeholder="협찬 받은 상품명" class="w-full px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                </td>
              </tr>
              `}

              <tr class="border-b border-botanical-stone">
                <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-cream/40 font-medium w-24 md:w-40 text-xs md:text-sm break-keep align-top">메모</td>
                <td class="px-2 md:px-4 py-2">
                  <textarea rows="2" oninput="autoResize(this);updateAdInfo(${content.id}, 'note', this.value)" placeholder="제작 시 참고사항..." class="auto-grow w-full px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none resize-none overflow-hidden">${content.adInfo?.note || ''}</textarea>
                </td>
              </tr>

              <tr ${content.category === '광고' ? 'class="border-b border-botanical-stone"' : ''}>
                <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-cream/40 font-medium w-24 md:w-40 text-xs md:text-sm break-keep align-middle">참고 링크</td>
                <td class="px-2 md:px-4 py-2">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
                    ${[0, 1].map(idx => {
                      const link = content.adInfo?.refLinks?.[idx] || '';
                      return `
                      <div class="flex gap-1.5 md:gap-2">
                        <input type="text" value="${link}" oninput="updateAdRefLink(${content.id}, ${idx}, this.value)" placeholder="https://..." class="flex-1 min-w-0 px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                        ${openLinkBtn(link)}
                      </div>`;
                    }).join('')}
                  </div>
                </td>
              </tr>

              ${content.category === '광고' ? `
              <tr>
                <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-terracotta/10 font-medium text-botanical-terracotta w-24 md:w-40 text-xs md:text-sm break-keep align-middle">광고주 전달 기획안</td>
                <td class="px-2 md:px-4 py-2">
                  <div class="flex gap-1.5 md:gap-2">
                    <input type="text" value="${content.adInfo?.clientNotion ?? DEFAULT_CLIENT_NOTION}" oninput="updateClientNotion(${content.id}, this.value)" placeholder="노션 링크" class="flex-1 min-w-0 px-3 rounded-lg border border-botanical-stone text-sm focus:outline-none" style="height:38px;">
                    ${openLinkBtn(content.adInfo?.clientNotion ?? DEFAULT_CLIENT_NOTION)}
                  </div>
                </td>
              </tr>
              ` : ''}
            </tbody>
          </table>
        </div>
      </div>
      ` : `
      <div class="md:border md:border-botanical-stone md:rounded-xl p-0 md:p-5">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-0 mb-4">
          <h3 class="font-medium flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-botanical-sage/20 text-botanical-sage text-xs flex items-center justify-center">1</span>
            레퍼런스 분석
          </h3>
          <span class="text-xs text-botanical-sage">선택사항</span>
        </div>

        <div class="mb-5 p-4 bg-botanical-cream/50 rounded-lg">
          <p class="text-sm font-medium text-botanical-terracotta mb-3">레퍼런스 체크리스트</p>
          <div class="space-y-2">
            ${[
              '6개월~1년 이내의 최신 영상인가요?',
              '팔로워는 낮은데 조회수가 높은 <strong>콘텐츠인가요?</strong> (조회수가 팔로워의 최소 10배수)',
              '내 주제와 관련성이 있나요?'
            ].map((text, i) => `
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" ${content.reference?.checklist?.[i] ? 'checked' : ''} onchange="toggleChecklist(${content.id}, 'reference', ${i}, this.checked)" class="w-4 h-4 rounded border-botanical-stone">
                <span>${text}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <div class="border border-botanical-stone rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <tbody>
              ${(() => {
                const singleFields = [
                  ['url', '링크', 'url', '인스타 URL'],
                  ['title', '제목', 'text', ''],
                  ['hook', '3초 후킹', 'textarea', ''],
                ];
                const doubleFields = [
                  [['followers', '팔로워수', 'text', ''], ['views', '조회수', 'text', '']],
                  [['likes', '좋아요', 'text', ''], ['shares', '공유', 'text', '']],
                  [['comments', '댓글', 'text', ''], ['length', '영상 길이', 'text', '']],
                ];
                const lastField = ['reason', '잘 터진 이유 (정보 / 공감 / 유머 등)', 'textarea', ''];

                let html = '';

                // Single-column fields
                singleFields.forEach(([field, label, type, ph], i) => {
                  if (type === 'url') {
                    // URL 타입은 별도 3열 구조 (라벨 | URL | 버튼들)
                    html += `<tr class="border-b border-botanical-stone">
                      <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-cream/30 font-medium w-14 md:w-24 text-[10px] md:text-xs leading-tight md:leading-normal break-keep align-top">${label}</td>
                      <td class="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm" colspan="2">
                        <input type="text" value="${content.reference?.[field] ?? ''}" placeholder="${ph}" oninput="updateReference(${content.id}, '${field}', this.value)" class="w-full bg-transparent focus:outline-none truncate">
                      </td>
                      <td class="px-2 py-2 md:py-3 whitespace-nowrap">
                        <div class="flex items-center gap-1">
                          ${openLinkBtn(content.reference?.[field])}
                          ${copyLinkBtn(content.reference?.[field])}
                          ${scriptLinkBtn()}
                        </div>
                      </td>
                    </tr>`;
                  } else {
                    html += `<tr class="border-b border-botanical-stone">
                      <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-cream/30 font-medium w-14 md:w-24 text-[10px] md:text-xs leading-tight md:leading-normal break-keep align-top">${label}</td>
                      <td class="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm" colspan="3">${
                        type === 'textarea'
                          ? `<textarea rows="1" oninput="autoResize(this);updateReference(${content.id}, '${field}', this.value)" placeholder="${ph}" class="auto-grow unified-text w-full bg-transparent focus:outline-none resize-none overflow-hidden break-words" style="min-height: 24px; word-break: break-word;">${content.reference?.[field] ?? ''}</textarea>`
                          : `<input type="${type}" value="${content.reference?.[field] ?? ''}" placeholder="${ph}" oninput="updateReference(${content.id}, '${field}', this.value)" class="w-full bg-transparent focus:outline-none">`
                      }</td>
                    </tr>`;
                  }
                });

                // Double-column fields
                doubleFields.forEach(([[field1, label1, type1, ph1], [field2, label2, type2, ph2]], i) => {
                  html += `<tr class="border-b border-botanical-stone">
                    <td class="px-1 md:px-3 py-2 md:py-3 bg-botanical-cream/30 font-medium w-12 md:w-20 text-[10px] md:text-xs leading-tight md:leading-normal break-keep align-top">${label1}</td>
                    <td class="px-1 md:px-3 py-2 md:py-3 text-xs md:text-sm">
                      <input type="${type1}" value="${content.reference?.[field1] ?? ''}" placeholder="${ph1}" oninput="updateReference(${content.id}, '${field1}', this.value)" class="w-full bg-transparent focus:outline-none">
                    </td>
                    <td class="px-1 md:px-3 py-2 md:py-3 bg-botanical-cream/30 font-medium w-12 md:w-20 text-[10px] md:text-xs leading-tight md:leading-normal break-keep align-top">${label2}</td>
                    <td class="px-2 md:px-3 py-2 md:py-3 text-xs md:text-sm">
                      <input type="${type2}" value="${content.reference?.[field2] ?? ''}" placeholder="${ph2}" oninput="updateReference(${content.id}, '${field2}', this.value)" class="w-full bg-transparent focus:outline-none">
                    </td>
                  </tr>`;
                });

                // Last field
                const [field, label, type, ph] = lastField;
                html += `<tr>
                  <td class="px-2 md:px-4 py-2 md:py-3 bg-botanical-cream/30 font-medium w-14 md:w-24 text-[10px] md:text-xs leading-tight md:leading-normal break-keep align-top">${label}</td>
                  <td class="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm" colspan="3">
                    <textarea rows="1" oninput="autoResize(this);updateReference(${content.id}, '${field}', this.value)" placeholder="${ph}" class="auto-grow unified-text w-full bg-transparent focus:outline-none resize-none overflow-hidden break-words" style="min-height: 24px; word-break: break-word;">${content.reference?.[field] ?? ''}</textarea>
                  </td>
                </tr>`;

                return html;
              })()}
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
              <div class="flex gap-2 items-center">
                <input type="text" value="${link}" oninput="updateNotionLink(${content.id}, ${idx}, this.value)" placeholder="노션 링크 (분석 자료)" class="flex-1 min-w-0 px-3 md:px-4 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none focus:border-botanical-sage">
                ${openLinkBtn(link)}
                ${idx > 0 ? `<button onclick="removeNotionLink(${content.id}, ${idx})" class="shrink-0 px-2 py-1 text-xs text-red-400 border border-red-200 rounded-lg hover:bg-red-50 transition-all">삭제</button>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      `}

      <!-- 계획 상세 -->
      <div class="md:border md:border-botanical-stone md:rounded-xl p-0 md:p-5 mb-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-medium text-sm text-botanical-sage">작성 계획</h3>
          ${content.linkedPlanId ? `<span class="px-2 py-1 rounded-lg bg-botanical-cream text-xs text-botanical-sage">플래너 연동됨</span>` : ''}
        </div>
        <textarea
          rows="3"
          oninput="autoResize(this);updatePlanDetail(${content.id}, this.value)"
          placeholder="플래너에서 등록한 계획 상세 내용이 여기 표시됩니다"
          class="auto-grow unified-text w-full px-3 md:px-4 py-2 md:py-3 rounded-lg border border-botanical-stone focus:outline-none focus:border-botanical-sage resize-none overflow-hidden break-words"
          style="min-height: 60px; word-break: break-word;">${content.planDetail ? content.planDetail.split('\n').map(line => line.trim()).filter(line => line).join('\n') : ''}</textarea>
      </div>

      <!-- 2. 촬영 및 대본 -->
      <div class="md:border md:border-botanical-stone md:rounded-xl p-0 md:p-5">
        <h3 class="font-medium flex items-center gap-2 mb-4">
          <span class="w-6 h-6 rounded-full bg-botanical-sage/20 text-botanical-sage text-xs flex items-center justify-center">2</span>
          촬영 및 대본 (20초 미만~최대 30초)
        </h3>

        <!-- 기획 체크리스트 (모든 버전 공통) -->
        <div class="mb-5 p-4 bg-botanical-cream/50 rounded-lg">
          <p class="text-sm font-medium text-botanical-terracotta mb-3">기획 체크리스트 <span class="text-xs text-botanical-sage font-normal">(모든 버전 공통)</span></p>
          <div class="space-y-2">
            ${[
              '나만의 스토리가 포함되었나요?',
              '공유 또는 저장할 이유가 있나요?',
              '첫 3~5초 안에 주제 / 미끼를 드러냈나요?',
              '영상 길이가 30초 이내로 간결한가요?',
              '콘텐츠에서 다 못 알려준 정보는 본문에 상세히 풀었나요?',
              '레퍼런스 카피가 아닌지 냉정하게 판단해주세요.'
            ].map((text, i) => `
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" ${content.planChecklist?.[i] ? 'checked' : ''} onchange="toggleChecklist(${content.id}, 'plan', ${i}, this.checked)" class="w-4 h-4 rounded border-botanical-stone">
                <span>${text}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- 버전 선택 (썸네일/대본 바로 위) -->
        <div class="flex flex-wrap gap-2 items-center mb-4 pb-3 border-b border-botanical-stone relative">
          ${scriptVersions.map((_, i) => {
            const isActive = i === currentVer;
            const canDelete = scriptVersions.length > 1;
            return `
              <span class="inline-flex items-center rounded-full overflow-hidden border ${isActive ? 'border-botanical-sage' : 'border-botanical-stone'}">
                <button onclick="switchScriptVersion(${content.id}, ${i})" class="px-3 py-1 text-xs ${isActive ? 'bg-botanical-sage text-white' : 'hover:bg-botanical-cream transition-all'}">V${i+1}</button>
                ${canDelete ? `<button onclick="deleteScriptVersion(${content.id}, ${i})" title="V${i+1} 삭제" class="px-1.5 py-1 text-xs border-l ${isActive ? 'border-white/30 bg-botanical-sage text-white/70 hover:text-red-200' : 'border-botanical-stone text-botanical-sage/50 hover:text-red-500 hover:bg-red-50'}">×</button>` : ''}
              </span>
            `;
          }).join('')}
          <button onclick="toggleAddVersionMenu(${content.id})" class="px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">+ 버전</button>
          <div class="version-add-menu hidden" id="version-add-menu-${content.id}">
            <button onclick="addScriptVersion(${content.id});hideAddVersionMenu(${content.id})">✨ 신규 버전</button>
            ${scriptVersions.map((v, idx) => `
              <button onclick="addScriptVersionCopy(${content.id}, ${idx});hideAddVersionMenu(${content.id})">
                V${idx + 1}${v.title ? ` - ${v.title}` : ''} 복사
              </button>
            `).join('')}
          </div>
        </div>

        <div class="mb-4">
          <label class="text-sm font-medium mb-2 block">V${currentVer+1} 제목 <span class="text-xs text-botanical-sage font-normal block md:inline mt-0.5 md:mt-0">(최종 버전 제목이 목록·캘린더에 표시됨)</span></label>
          <input type="text" value="${scriptVersions[currentVer]?.title ?? content.title ?? ''}" oninput="updateContentTitle(${content.id}, this.value)" placeholder="영상 제목 또는 핵심 키워드 입력" class="w-full px-4 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none focus:border-botanical-sage">
        </div>

        <div class="mb-4">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-0 mb-3">
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium text-botanical-terracotta">대본 작성</p>
              ${(() => {
                const isFinal = (content.script?.finalVersion ?? 0) === currentVer;
                return `<button onclick="setFinalVersion(${content.id}, ${currentVer})" title="현재 V${currentVer+1}을 최종으로 지정 (목록·캘린더에 이 버전 제목 표시)" class="px-3 py-1 rounded-full text-xs transition-all ${isFinal ? 'bg-amber-400 text-white' : 'border border-botanical-stone text-botanical-sage hover:bg-amber-50 hover:text-amber-600'}">${isFinal ? '✓ 최종' : '최종'}</button>`;
              })()}
            </div>
            <div class="flex gap-2 flex-wrap md:justify-end">
              <button onclick="copyScript(${content.id}, 'dialogue')" class="px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">대사 복사</button>
              <button onclick="copyScriptForFeedback(${content.id})" class="px-3 py-1 rounded-full text-xs border border-botanical-terracotta text-botanical-terracotta font-bold hover:bg-botanical-terracotta hover:text-white transition-all">구간+대사 (피드백용)</button>
              <button onclick="copyScript(${content.id}, 'subtitle')" class="px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">자막 복사</button>
              <button onclick="copyScriptAll(${content.id})" class="px-3 py-1 rounded-full text-xs border border-botanical-sage bg-botanical-sage/10 text-botanical-sage hover:bg-botanical-sage hover:text-white transition-all">전체 복사</button>
            </div>
          </div>
          <div class="border border-botanical-stone rounded-lg overflow-x-auto">
            <table class="script-table text-xs md:text-sm min-w-[720px] md:min-w-0" data-content-id="${content.id}" style="table-layout: fixed; width: auto;">
              <colgroup>
                <col style="width: ${colSection}px">
                <col style="width: ${colDialogue}px">
                <col style="width: ${colSubtitle}px">
              </colgroup>
              <thead>
                <tr class="bg-botanical-cream/50">
                  <th class="col-resizable px-4 py-3 text-left font-medium" data-col="section">구간<span class="col-resize-handle"></span></th>
                  <th class="col-resizable px-4 py-3 text-left font-medium" data-col="dialogue">대사<span class="col-resize-handle"></span></th>
                  <th class="col-resizable px-4 py-3 text-left font-medium" data-col="subtitle">자막<span class="col-resize-handle"></span></th>
                </tr>
              </thead>
              <tbody id="script-tbody-${content.id}">
                ${scriptRows.map((row, idx) => `
                  <tr class="border-t border-botanical-stone group">
                    <td class="px-4 py-3 font-semibold">
                      <input type="text" value="${row.section || ''}" oninput="updateScriptRow(${content.id}, ${idx}, 'section', this.value)" class="section-input w-full bg-transparent focus:outline-none font-semibold" style="color: ${sectionColors[row.section] || '#8C9A84'};">
                      <button onclick="removeScriptRow(${content.id}, ${idx})" title="행 삭제" class="w-5 h-5 rounded text-xs text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-opacity mt-1">×</button>
                    </td>
                    <td class="px-4 py-3 border-l border-botanical-stone relative dialogue-cell" data-content-id="${content.id}" data-row-idx="${idx}">
                      <textarea rows="1" oninput="autoResize(this);updateScriptRow(${content.id}, ${idx}, 'dialogue', this.value)" class="script-cell w-full bg-transparent focus:outline-none resize-none overflow-hidden" ${row.section === 'HOOK' ? 'placeholder="궁금증, 호기심 자극"' : (row.section === 'INTRO' ? 'placeholder="주제+권위/타겟+이득"' : '')}>${row.dialogue || ''}</textarea>
                      <button class="dialogue-menu-btn" onclick="event.stopPropagation();toggleDialogueMenu(${content.id}, ${idx})">⋮</button>
                      <div class="dialogue-menu hidden" id="dialogue-menu-${content.id}-${idx}">
                        <button onclick="copyDialogueCell(${content.id}, ${idx})">복사</button>
                        <button onclick="clearDialogueCell(${content.id}, ${idx})">지우기</button>
                      </div>
                    </td>
                    <td class="px-4 py-3 border-l border-botanical-stone relative subtitle-cell" data-content-id="${content.id}" data-row-idx="${idx}">
                      <textarea rows="1" oninput="autoResize(this);updateScriptRow(${content.id}, ${idx}, 'subtitle', this.value)" class="script-cell w-full bg-transparent focus:outline-none resize-none overflow-hidden">${row.subtitle || ''}</textarea>
                      <button class="subtitle-menu-btn" onclick="event.stopPropagation();toggleSubtitleMenu(${content.id}, ${idx})">⋮</button>
                      <div class="subtitle-menu hidden" id="subtitle-menu-${content.id}-${idx}">
                        <button onclick="copySubtitleCell(${content.id}, ${idx})">복사</button>
                        <button onclick="clearSubtitleCell(${content.id}, ${idx})">지우기</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <button onclick="addScriptRow(${content.id})" class="mt-2 px-3 py-1.5 text-xs text-botanical-sage border border-botanical-stone rounded-lg hover:bg-botanical-cream transition-all">+ 행 추가</button>
        </div>
      </div>

      <!-- 3. 캡션 -->
      ${(() => {
        // 캡션 버전 구조 초기화/마이그레이션
        if (!content.captions) {
          content.captions = { versions: [{ text: content.caption || '' }], currentVersion: 0 };
        }
        const captionVersions = content.captions.versions || [{ text: '' }];
        const currentCaptionVer = Math.min(content.captions.currentVersion ?? 0, captionVersions.length - 1);
        const currentCaptionText = captionVersions[currentCaptionVer]?.text || '';

        return `
      <div class="md:border md:border-botanical-stone md:rounded-xl p-0 md:p-5">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-0 mb-4">
          <h3 class="font-medium flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-botanical-sage/20 text-botanical-sage text-xs flex items-center justify-center">3</span>
            캡션 작성
          </h3>
          <button onclick="copyCaption(${content.id})" class="self-start px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">캡션 복사</button>
        </div>

        <!-- 캡션 버전 탭 -->
        <div class="flex flex-wrap items-center gap-2 mb-3 relative">
          ${captionVersions.map((v, i) => {
            const isActive = i === currentCaptionVer;
            const canDelete = captionVersions.length > 1;
            return `
              <span class="inline-flex items-center rounded-full overflow-hidden border ${isActive ? 'border-botanical-sage' : 'border-botanical-stone'}">
                <button onclick="switchCaptionVersion(${content.id}, ${i})" class="px-3 py-1 text-xs ${isActive ? 'bg-botanical-sage text-white' : 'hover:bg-botanical-cream transition-all'}">V${i+1}</button>
                ${canDelete ? `<button onclick="deleteCaptionVersion(${content.id}, ${i})" title="V${i+1} 삭제" class="px-1.5 py-1 text-xs border-l ${isActive ? 'border-white/30 bg-botanical-sage text-white/70 hover:text-red-200' : 'border-botanical-stone text-botanical-sage/50 hover:text-red-500 hover:bg-red-50'}">×</button>` : ''}
              </span>
            `;
          }).join('')}
          <button onclick="addCaptionVersion(${content.id})" class="px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">+ 버전</button>
        </div>

        <textarea id="caption-${content.id}" rows="3" oninput="autoResize(this);updateCaptionText(${content.id}, this.value)" placeholder="인스타그램 캡션 입력..." class="auto-grow unified-text w-full px-3 py-2 rounded-lg border border-botanical-stone focus:outline-none focus:border-botanical-sage resize-none overflow-hidden">${currentCaptionText}</textarea>
      </div>`;
      })()}

      <!-- 4. 공유 링크 + DM 자동 답변 -->
      <div class="md:border md:border-botanical-stone md:rounded-xl p-0 md:p-5">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-0 mb-4">
          <h3 class="font-medium flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-botanical-sage/20 text-botanical-sage text-xs flex items-center justify-center">4</span>
            공유 링크 & DM 답변
          </h3>
          <div class="flex gap-2">
            <button onclick="copyShareLink(${content.id})" class="px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">링크 복사</button>
            <button onclick="copyDM(${content.id})" class="px-3 py-1 rounded-full text-xs border border-botanical-stone hover:bg-botanical-cream transition-all">DM 복사</button>
          </div>
        </div>
        <div class="mb-4 space-y-2">
          <div class="flex gap-2">
            <input id="sharelink-${content.id}" type="text" value="${content.shareLink || ''}" oninput="updateContentField(${content.id}, 'shareLink', this.value)" placeholder="팔로워 공유용 링크 1" class="flex-1 min-w-0 px-4 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none focus:border-botanical-sage">
            <button onclick="openShareLink(${content.id}, 1)" class="shrink-0 px-3 py-2 rounded-lg border border-botanical-stone text-sm text-botanical-sage hover:bg-botanical-cream hover:text-botanical-fg transition-all">열기</button>
          </div>
          <div id="sharelink2-row-${content.id}" class="flex gap-2 ${content.shareLink2 ? '' : 'hidden'}">
            <input id="sharelink2-${content.id}" type="text" value="${content.shareLink2 || ''}" oninput="updateContentField(${content.id}, 'shareLink2', this.value)" placeholder="팔로워 공유용 링크 2" class="flex-1 min-w-0 px-4 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none focus:border-botanical-sage">
            <button onclick="openShareLink(${content.id}, 2)" class="shrink-0 px-3 py-2 rounded-lg border border-botanical-stone text-sm text-botanical-sage hover:bg-botanical-cream hover:text-botanical-fg transition-all">열기</button>
          </div>
          <button id="add-sharelink-${content.id}" onclick="addShareLink2(${content.id})" class="${content.shareLink2 ? 'hidden' : ''} w-full text-xs text-botanical-sage hover:text-botanical-fg border border-dashed border-botanical-stone rounded-lg px-3 py-1.5 transition-all">+ 링크 추가 (최대 2개)</button>
        </div>
        <div>
          <label class="text-xs text-botanical-sage mb-2 block">DM 자동 답변</label>
          <textarea id="dm-${content.id}" rows="4" oninput="autoResize(this);updateContentField(${content.id}, 'dm', this.value)" class="auto-grow unified-text w-full px-3 py-2 rounded-lg border border-botanical-stone focus:outline-none focus:border-botanical-sage resize-none overflow-hidden">${content.dm || '안녕하세요 🙋‍♀️\n버튼 누르시면 👇🏻\n[ ]\n자료 확인하실 수 있어요'}</textarea>
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

  // '업로드완료' 마일스톤 변경 시 목록 '업로드' 열 국소 갱신
  if (status === '업로드완료') {
    const uploadCell = document.querySelector(`[data-upload-cell="${contentId}"]`);
    if (uploadCell) {
      uploadCell.textContent = date ? date.slice(5).replace('-', '/') : '-';
    }
    if (typeof renderPerformance === 'function') renderPerformance();
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
  const isOpening = !form.classList.contains('active');

  form.classList.toggle('active');
  arrow.style.transform = form.classList.contains('active') ? 'rotate(180deg)' : 'rotate(0deg)';

  // 열려있는 콘텐츠 ID 저장/제거 (위치 유지용)
  if (form.classList.contains('active')) {
    localStorage.setItem('yudit_openContentId', id);
    window.addEventListener('scroll', saveScrollPosition, { passive: true });
    requestAnimationFrame(() => { autoResizeAllScriptCells(); attachScriptCellObservers(); });
  } else {
    localStorage.removeItem('yudit_openContentId');
    localStorage.removeItem('yudit_scrollY');
    window.removeEventListener('scroll', saveScrollPosition);
  }
}

// ========== 자동 스냅샷 백업 ==========
// 1시간마다 자동 백업, 최근 5개만 유지
// 키 형식: backup_auto_YYYYMMDD_HH
async function maybeCreateHourlySnapshot(remote) {
  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const hour = String(now.getHours()).padStart(2, '0');
    const key = `backup_auto_${dateStr}_${hour}`;
    // 이미 이번 시간 스냅샷 있으면 스킵
    const existing = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=key&key=eq.${key}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await existing.json();
    if (rows.length > 0) return;
    // 스냅샷 저장
    await upsertToSupabase(key, {
      snapshotAt: now.toISOString(),
      calendar: remote.calendar,
      contents: remote.contents,
      performance: remote.performance,
      revenue: remote.revenue,
      memos: remote.memos,
      plans: remote.plans
    });
    console.log(`📸 자동 백업: ${key}`);
    // 최근 5개만 유지
    pruneAutoBackups();
  } catch (e) {
    console.warn('자동 백업 실패 (무시):', e);
  }
}

// 자동 백업 최근 5개만 유지
async function pruneAutoBackups() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=key&key=like.backup_auto_*&order=key.desc`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await res.json();
    // 5개 초과분 삭제
    const toDelete = rows.slice(5).map(r => r.key);
    for (const k of toDelete) {
      await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?key=eq.${k}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
    }
    if (toDelete.length > 0) console.log(`🗑️ 오래된 자동 백업 ${toDelete.length}개 삭제`);
  } catch (e) { console.warn('백업 정리 실패:', e); }
}

// 저장 + 백업 통합 버튼 (헤더)
async function saveAndBackup() {
  // 모든 데이터 dirty 표시 후 저장
  markDirty('calendar');
  markDirty('contents');
  markDirty('performance');
  markDirty('revenue');
  markDirty('memos');
  markDirty('plans');
  await saveAllData();
  // 백업도 함께
  await manualBackup();
}

// 수동 백업 버튼 (헤더) — 최근 5개만 유지
// 키 형식: backup_manual_YYYYMMDD_HHMMSS
async function manualBackup() {
  try {
    updateSaveStatus('saving');
    const now = new Date();
    const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '_');
    const key = `backup_manual_${ts}`;
    await upsertToSupabase(key, {
      snapshotAt: now.toISOString(),
      calendar: calendarData,
      contents: contentsData,
      performance: performanceData,
      revenue: revenueData,
      memos: memosData,
      plans: plansData
    });
    updateSaveStatus('saved');
    showMemoSaveToast('📸 수동 백업 완료');
    console.log(`📸 수동 백업: ${key}`);
    // 최근 5개만 유지
    pruneManualBackups();
  } catch (e) {
    updateSaveStatus('error');
    alert('백업 실패: ' + e.message);
  }
}

// 수동 백업 최근 5개만 유지
async function pruneManualBackups() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=key&key=like.backup_manual_*&order=key.desc`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await res.json();
    const toDelete = rows.slice(5).map(r => r.key);
    for (const k of toDelete) {
      await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?key=eq.${k}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
    }
    if (toDelete.length > 0) console.log(`🗑️ 오래된 수동 백업 ${toDelete.length}개 삭제`);
  } catch (e) { console.warn('수동 백업 정리 실패:', e); }
}

// JSON 다운로드 (수동 백업)
function exportBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    calendar: calendarData,
    contents: contentsData,
    performance: performanceData,
    revenue: revenueData,
    memos: memosData
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `yudit-studio-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// 과거 스냅샷 목록/복원 UI
async function showBackups() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=key,data&key=like.backup_*&order=key.desc`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await res.json();
    // backup_before_restore_ 제외
    const backups = rows.filter(r => !r.key.startsWith('backup_before_restore_'));
    if (backups.length === 0) { alert('저장된 백업이 없습니다'); return; }

    const lines = backups.map((r, i) => {
      const key = r.key;
      const contentsCount = r.data?.contents?.contents?.length || 0;
      const memosCount = r.data?.memos?.memos?.length || 0;
      const time = r.data?.snapshotAt ? new Date(r.data.snapshotAt).toLocaleString('ko') : '';
      let label = '';
      if (key.startsWith('backup_auto_')) {
        label = `[자동] ${time}`;
      } else if (key.startsWith('backup_manual_')) {
        label = `[수동] ${time}`;
      } else {
        // 레거시 형식 (backup_YYYYMMDD)
        const d = key.replace('backup_', '');
        label = `[구] ${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
      }
      return `${i + 1}. ${label} — 콘텐츠 ${contentsCount} / 메모 ${memosCount}`;
    }).join('\n');

    const choice = prompt(`📸 백업 목록 (자동 5개 / 수동 5개 유지)\n\n${lines}\n\n복원할 번호 입력 (1~${backups.length}). 취소하려면 빈 값.`);
    if (!choice) return;
    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= backups.length) { alert('잘못된 번호입니다'); return; }
    const target = backups[idx];
    const displayTime = target.data?.snapshotAt ? new Date(target.data.snapshotAt).toLocaleString('ko') : target.key;
    if (!confirm(`⚠️ "${displayTime}" 백업으로 되돌립니다.\n현재 데이터는 덮어써집니다. 계속?`)) return;

    calendarData = target.data.calendar || calendarData;
    contentsData = target.data.contents || contentsData;
    performanceData = target.data.performance || performanceData;
    revenueData = target.data.revenue || revenueData;
    memosData = target.data.memos || memosData;
    plansData = target.data.plans || plansData;
    markDirty('calendar'); markDirty('contents'); markDirty('performance'); markDirty('revenue'); markDirty('memos'); markDirty('plans');
    saveAllData();
    alert('✓ 복원 완료. 새로고침 됩니다.');
    setTimeout(() => location.reload(), 500);
  } catch (e) {
    alert('백업 조회 실패: ' + e.message);
  }
}

// 모바일에서 강제 새로고침 (캐시 우회 + Supabase 다시 fetch)
function forceRefresh() {
  // URL에 timestamp 쿼리 붙여서 브라우저 캐시 무효화 후 리로드
  const url = new URL(location.href);
  url.searchParams.set('_r', Date.now());
  location.replace(url.toString());
}

function collapseAllContentForms() {
  document.querySelectorAll('.production-form.active').forEach(form => {
    form.classList.remove('active');
    const id = form.id.replace('form-', '');
    const arrow = document.getElementById('arrow-' + id);
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  });
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
  // 최종 버전 지정 (기본 0번)
  if (content.script.finalVersion == null) content.script.finalVersion = 0;
  if (content.script.finalVersion >= content.script.versions.length) {
    content.script.finalVersion = 0;
  }
  // 각 버전에 title 필드 보장 — 레거시는 finalVersion에만 기존 title, 나머지는 ''
  content.script.versions.forEach((v, i) => {
    if (v.title == null) {
      v.title = (i === content.script.finalVersion) ? (content.title ?? '') : '';
    }
  });
}

function reopenForm(contentId) {
  const form = document.getElementById('form-' + contentId);
  if (form) form.classList.add('active');
  const arrow = document.getElementById('arrow-' + contentId);
  if (arrow) arrow.style.transform = 'rotate(180deg)';
  requestAnimationFrame(() => { autoResizeAllScriptCells(); attachScriptCellObservers(); });
}

function addScriptRow(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  ensureScript(content);
  const ver = content.script.currentVersion;
  if (!content.script.versions[ver].rows) content.script.versions[ver].rows = [];
  const rows = content.script.versions[ver].rows;

  // 다음 MAIN 번호 (기존 MAIN 1~N 중 최대 + 1)
  let maxMain = 0;
  rows.forEach(r => {
    const m = (r.section || '').match(/^MAIN\s*(\d+)/);
    if (m) maxMain = Math.max(maxMain, parseInt(m[1], 10));
  });
  const newRow = { section: `MAIN ${maxMain + 1}`, dialogue: '', subtitle: '', scene: '' };

  // OUTRO 앞에 삽입 (OUTRO 없으면 맨 끝)
  const outroIdx = rows.findIndex(r => r.section === 'OUTRO');
  if (outroIdx === -1) rows.push(newRow);
  else rows.splice(outroIdx, 0, newRow);

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
  document.querySelectorAll('.script-table textarea.script-cell, textarea.auto-grow').forEach(autoResize);
}

// 창 크기 줄어들면 셀 내용이 여러 줄로 감싸져서 짤림 → 리사이즈 시 높이 재계산
let _scriptResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_scriptResizeTimer);
  _scriptResizeTimer = setTimeout(autoResizeAllScriptCells, 80);
});

// 셀 폭이 변할 때도 높이 재계산 (다른 셀 타이핑으로 열 폭 밀려도 감지)
const _scriptCellObserver = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver((entries) => {
      entries.forEach(e => {
        const el = e.target;
        if (el.classList?.contains('script-cell')) autoResize(el);
      });
    })
  : null;

function attachScriptCellObservers() {
  if (!_scriptCellObserver) return;
  document.querySelectorAll('.script-table textarea.script-cell, textarea.auto-grow').forEach(el => {
    _scriptCellObserver.observe(el);
  });
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

function toggleAddVersionMenu(contentId) {
  const menu = document.getElementById(`version-add-menu-${contentId}`);
  if (!menu) return;

  // 다른 메뉴 닫기
  document.querySelectorAll('.version-add-menu').forEach(m => {
    if (m !== menu) m.classList.add('hidden');
  });

  menu.classList.toggle('hidden');
}

function hideAddVersionMenu(contentId) {
  const menu = document.getElementById(`version-add-menu-${contentId}`);
  if (menu) menu.classList.add('hidden');
}

function addScriptVersion(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  ensureScript(content);
  content.script.versions.push({ rows: DEFAULT_SCRIPT_ROWS(), title: '' });
  content.script.currentVersion = content.script.versions.length - 1;
  // 최종 버전은 기존대로 유지 (새 버전은 draft)
  saveAllData();
  renderContentList();
  reopenForm(contentId);
}

function addScriptVersionCopy(contentId, sourceIdx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content?.script?.versions?.[sourceIdx]) return;

  // 원본 버전 복사 (깊은 복사)
  const sourceVersion = content.script.versions[sourceIdx];
  const copiedRows = JSON.parse(JSON.stringify(sourceVersion.rows || DEFAULT_SCRIPT_ROWS()));
  const copiedTitle = sourceVersion.title ? `${sourceVersion.title} (복사)` : '';

  content.script.versions.push({ rows: copiedRows, title: copiedTitle });
  content.script.currentVersion = content.script.versions.length - 1;

  saveAllData();
  renderContentList();
  reopenForm(contentId);
}

function switchScriptVersion(contentId, versionIdx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content?.script?.versions?.[versionIdx]) return;
  content.script.currentVersion = versionIdx;
  // 활성 버전 전환만. 최종 버전은 별도로 ★ 버튼으로 지정
  saveAllData();
  renderContentList();
  reopenForm(contentId);
}

function deleteScriptVersion(contentId, versionIdx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content?.script?.versions) return;
  if (content.script.versions.length <= 1) return;
  const v = content.script.versions[versionIdx];
  const versionTitle = v.title || '(제목 없음)';
  const rowCount = (v.rows || []).filter(r => r.dialogue || r.subtitle || r.scene).length;
  const msg = rowCount > 0
    ? `⚠️ V${versionIdx + 1} "${versionTitle}"\n내용이 작성된 행 ${rowCount}개가 영구 삭제됩니다.\n\n정말 삭제할까요? (복구 불가 — 자동 백업은 로드 시점 기준)`
    : `V${versionIdx + 1} "${versionTitle}" 삭제할까요? (비어있음)`;
  if (!confirm(msg)) return;
  content.script.versions.splice(versionIdx, 1);
  // currentVersion 재조정
  if (content.script.currentVersion === versionIdx) {
    content.script.currentVersion = Math.max(0, versionIdx - 1);
  } else if (content.script.currentVersion > versionIdx) {
    content.script.currentVersion -= 1;
  }
  // finalVersion 재조정 — 삭제된 게 최종이었으면 V1(0)으로
  if (content.script.finalVersion === versionIdx) {
    content.script.finalVersion = 0;
    const newFinalTitle = content.script.versions[0].title ?? '';
    content.title = newFinalTitle;
    calendarData.items.forEach(item => {
      if (item.contentId === contentId) item.title = newFinalTitle;
    });
    ['ad', 'sales', 'sponsor'].forEach(t => {
      (revenueData.items?.[t] || []).forEach(item => {
        if (item.contentId === contentId) item.brand = newFinalTitle || '무제';
      });
    });
  } else if (content.script.finalVersion > versionIdx) {
    content.script.finalVersion -= 1;
  }
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

function copyScriptAll(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  const ver = content?.script?.currentVersion ?? 0;
  const rows = content?.script?.versions?.[ver]?.rows;
  if (!rows || rows.length === 0) { alert('복사할 내용이 없습니다'); return; }
  // 탭 구분 표 (스프레드시트/노션 표로 바로 붙여넣기 가능) + 가독용 제목
  const header = ['구간', '대사', '자막', '장면'];
  const lines = [header.join('\t')];
  rows.forEach(r => {
    lines.push([r.section || '', r.dialogue || '', r.subtitle || '', r.scene || ''].join('\t'));
  });
  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    alert('표 전체 복사됨 (탭 구분 — 표에 바로 붙여넣기 OK)');
  }).catch(() => alert('복사 실패'));
}

// 구간+대사만 (기획 ③ 피드백 붙여넣기용 — 어항처럼 칸칸이 피드백되게)
function copyScriptForFeedback(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  const ver = content?.script?.currentVersion ?? 0;
  const rows = content?.script?.versions?.[ver]?.rows;
  if (!rows || rows.length === 0) { alert('복사할 내용이 없습니다'); return; }
  const text = rows
    .filter(r => (r.dialogue || '').trim())
    .map(r => `[${r.section || ''}] ${r.dialogue.trim()}`)
    .join('\n');
  if (!text) { alert('복사할 대사가 없습니다'); return; }
  navigator.clipboard.writeText(text).then(() => {
    alert('구간+대사 복사됨 — 기획 ③ 피드백에 붙여넣으세요');
  }).catch(() => alert('복사 실패'));
}

// 대사 셀 메뉴 토글
function toggleDialogueMenu(contentId, idx) {
  const menu = document.getElementById(`dialogue-menu-${contentId}-${idx}`);
  const allMenus = document.querySelectorAll('.dialogue-menu');

  // 다른 메뉴 모두 닫기
  allMenus.forEach(m => {
    if (m !== menu) m.classList.add('hidden');
  });

  // 현재 메뉴 토글
  menu.classList.toggle('hidden');
}

// 대사 셀 복사
function copyDialogueCell(contentId, idx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  const ver = content?.script?.currentVersion ?? 0;
  const row = content?.script?.versions?.[ver]?.rows?.[idx];
  const text = row?.dialogue || '';

  if (!text.trim()) {
    alert('복사할 내용이 없습니다');
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    // 메뉴 닫기
    const menu = document.getElementById(`dialogue-menu-${contentId}-${idx}`);
    menu.classList.add('hidden');
  }).catch(() => alert('복사 실패'));
}

// 대사 셀 지우기
function clearDialogueCell(contentId, idx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  const ver = content?.script?.currentVersion ?? 0;
  const row = content?.script?.versions?.[ver]?.rows?.[idx];

  if (!row || !row.dialogue?.trim()) return;

  // 내용 지우기
  updateScriptRow(contentId, idx, 'dialogue', '');

  // 메뉴 닫기
  const menu = document.getElementById(`dialogue-menu-${contentId}-${idx}`);
  menu.classList.add('hidden');

  // UI 업데이트
  renderContentList();
  reopenForm(contentId);
}

// 자막 메뉴 토글
function toggleSubtitleMenu(contentId, idx) {
  const menu = document.getElementById(`subtitle-menu-${contentId}-${idx}`);
  const allMenus = document.querySelectorAll('.subtitle-menu, .dialogue-menu');
  allMenus.forEach(m => {
    if (m !== menu) m.classList.add('hidden');
  });
  menu.classList.toggle('hidden');
}

// 자막 셀 복사
function copySubtitleCell(contentId, idx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  const ver = content?.script?.currentVersion ?? 0;
  const row = content?.script?.versions?.[ver]?.rows?.[idx];
  const text = row?.subtitle || '';

  if (!text.trim()) {
    alert('복사할 내용이 없습니다');
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    const menu = document.getElementById(`subtitle-menu-${contentId}-${idx}`);
    menu.classList.add('hidden');
  }).catch(() => alert('복사 실패'));
}

// 자막 셀 지우기
function clearSubtitleCell(contentId, idx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  const ver = content?.script?.currentVersion ?? 0;
  const row = content?.script?.versions?.[ver]?.rows?.[idx];

  if (!row || !row.subtitle?.trim()) return;

  updateScriptRow(contentId, idx, 'subtitle', '');

  const menu = document.getElementById(`subtitle-menu-${contentId}-${idx}`);
  menu.classList.add('hidden');

  renderContentList();
  reopenForm(contentId);
}

function copyCaption(contentId) {
  const el = document.getElementById('caption-' + contentId);
  if (!el || !el.value.trim()) { alert('복사할 캡션이 없습니다'); return; }
  navigator.clipboard.writeText(el.value).then(() => alert('캡션 복사됨'));
}

// 캡션 버전 전환
function switchCaptionVersion(contentId, versionIdx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content || !content.captions) return;
  content.captions.currentVersion = versionIdx;
  saveAllData();
  renderContentList();
  reopenForm(contentId);
}

// 캡션 버전 추가
function addCaptionVersion(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.captions) {
    content.captions = { versions: [{ text: content.caption || '' }], currentVersion: 0 };
  }
  content.captions.versions.push({ text: '' });
  content.captions.currentVersion = content.captions.versions.length - 1;
  saveAllData();
  renderContentList();
  reopenForm(contentId);
}

// 캡션 버전 삭제
function deleteCaptionVersion(contentId, versionIdx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content || !content.captions || content.captions.versions.length <= 1) return;

  const versionText = content.captions.versions[versionIdx]?.text || '';
  const confirmMsg = versionText.trim()
    ? `V${versionIdx + 1} 캡션을 삭제할까요?\n\n"${versionText.slice(0, 50)}${versionText.length > 50 ? '...' : ''}"`
    : `V${versionIdx + 1} 캡션을 삭제할까요? (비어있음)`;

  if (!confirm(confirmMsg)) return;

  content.captions.versions.splice(versionIdx, 1);
  if (content.captions.currentVersion >= content.captions.versions.length) {
    content.captions.currentVersion = content.captions.versions.length - 1;
  }
  saveAllData();
  renderContentList();
  reopenForm(contentId);
}

// 캡션 텍스트 업데이트
function updateCaptionText(contentId, text) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.captions) {
    content.captions = { versions: [{ text: '' }], currentVersion: 0 };
  }
  const ver = content.captions.currentVersion ?? 0;
  if (!content.captions.versions[ver]) {
    content.captions.versions[ver] = { text: '' };
  }
  content.captions.versions[ver].text = text;
  // 하위 호환: 기존 caption 필드도 현재 버전으로 유지
  content.caption = text;
  saveAllData();
}

function copyDM(contentId) {
  const el = document.getElementById('dm-' + contentId);
  if (!el || !el.value.trim()) { alert('복사할 DM이 없습니다'); return; }
  navigator.clipboard.writeText(el.value).then(() => alert('DM 복사됨'));
}

function copyShareLink(contentId) {
  const el1 = document.getElementById('sharelink-' + contentId);
  const el2 = document.getElementById('sharelink2-' + contentId);
  const links = [el1?.value?.trim(), el2?.value?.trim()].filter(Boolean);
  if (!links.length) { alert('복사할 링크가 없습니다'); return; }
  navigator.clipboard.writeText(links.join('\n')).then(() => alert('링크 복사됨' + (links.length > 1 ? ' (2개)' : '')));
}

function openShareLink(contentId, n) {
  const el = document.getElementById((n === 2 ? 'sharelink2-' : 'sharelink-') + contentId);
  const url = el?.value?.trim();
  if (!url) { alert('열 링크가 없습니다'); return; }
  const safeUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  window.open(safeUrl, '_system') || window.open(safeUrl, '_blank');
}

function addShareLink2(contentId) {
  const row = document.getElementById('sharelink2-row-' + contentId);
  const btn = document.getElementById('add-sharelink-' + contentId);
  if (row) row.classList.remove('hidden');
  if (btn) btn.classList.add('hidden');
}

function copyMyInstaLink() {
  navigator.clipboard.writeText(MY_INSTA_URL).then(() => {
    showMemoSaveToast('내 인스타 링크 복사됨');
  }).catch(() => {
    alert('복사 실패. 직접 복사: ' + MY_INSTA_URL);
  });
}

// ========== 자주 쓰는 내용 (템플릿 그룹) ==========
let activeTemplateGroupId = null;
let draggedTemplateItemId = null;
let _tabLongpressTimer = null;
let _suppressTabClick = false;
let draggedReorderTabId = null;
let templateSectionOpen = false; // 리렌더 시 펼침 상태 보존

// 백업용 수동 저장
function manualSaveTemplates() {
  saveAllData();
  showMemoSaveToast('자주 쓰는 내용 저장됨');
}

// === 탭 longpress (모바일) / 우클릭 (PC) → 액션 메뉴 ===
function startTabLongpress(id) {
  cancelTabLongpress();
  _tabLongpressTimer = setTimeout(() => {
    _tabLongpressTimer = null;
    _suppressTabClick = true;
    showTabActionMenu(id);
  }, 500);
}
function cancelTabLongpress() {
  if (_tabLongpressTimer) {
    clearTimeout(_tabLongpressTimer);
    _tabLongpressTimer = null;
  }
}

function showTabActionMenu(id) {
  document.getElementById('tab-action-menu')?.remove();
  const tabEl = document.querySelector(`[data-template-tab="${id}"]`);
  const rect = tabEl?.getBoundingClientRect() || { left: 50, bottom: 50 };
  const popover = document.createElement('div');
  popover.id = 'tab-action-menu';
  popover.style.cssText = `position:fixed;top:${rect.bottom + 6}px;left:${rect.left}px;background:white;border:1px solid #E6E2DA;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,0.18);z-index:200;display:flex;flex-direction:column;min-width:170px;overflow:hidden;`;
  popover.innerHTML = `
    <button onclick="document.getElementById('tab-action-menu')?.remove(); openRenameTabModal(${id});" style="padding:10px 14px;text-align:left;font-size:13px;background:white;border:none;cursor:pointer;">✏️ 이름 변경</button>
    <button onclick="document.getElementById('tab-action-menu')?.remove(); openReorderTabModal();" style="padding:10px 14px;text-align:left;font-size:13px;background:white;border:none;border-top:1px solid #E6E2DA;cursor:pointer;">↕️ 순서 변경</button>
    <button onclick="document.getElementById('tab-action-menu')?.remove(); deleteTemplateGroup(${id});" style="padding:10px 14px;text-align:left;font-size:13px;background:white;border:none;border-top:1px solid #E6E2DA;color:#DC2626;cursor:pointer;">🗑 이 탭 삭제</button>
  `;
  document.body.appendChild(popover);
  setTimeout(() => {
    const closer = (e) => {
      if (!popover.contains(e.target)) {
        popover.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 50);
}

// === 이름 변경 모달 ===
function openRenameTabModal(id) {
  const g = memosData.templateGroups.find(x => x.id === id);
  if (!g) return;
  closeTabModal();
  const modal = document.createElement('div');
  modal.id = 'tab-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-end md:items-center justify-center';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/30" onclick="closeTabModal()"></div>
    <div class="relative bg-white rounded-t-2xl md:rounded-2xl shadow-xl w-full md:max-w-sm md:mx-4 p-5">
      <h3 class="text-base font-semibold mb-4">탭 이름 변경</h3>
      <input id="rename-tab-input" type="text" value="${escapeHtml(g.name)}" maxlength="20"
             class="w-full px-3 py-2 rounded-lg border border-botanical-stone focus:outline-none focus:border-botanical-sage mb-4"
             style="font-size: 16px;">
      <div class="flex justify-end gap-2">
        <button onclick="closeTabModal()" class="px-4 py-2 rounded-lg border border-botanical-stone text-sm text-botanical-sage hover:bg-botanical-cream/50">취소</button>
        <button onclick="confirmRenameTab(${id})" class="px-4 py-2 rounded-lg bg-botanical-fg text-white text-sm hover:opacity-90">저장</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => {
    const input = document.getElementById('rename-tab-input');
    input?.focus();
    input?.select();
  });
}

function confirmRenameTab(id) {
  const input = document.getElementById('rename-tab-input');
  const name = input?.value?.trim();
  if (!name) { alert('이름을 입력해 주세요.'); return; }
  const g = memosData.templateGroups.find(x => x.id === id);
  if (!g) { closeTabModal(); return; }
  g.name = name;
  saveAllData();
  closeTabModal();
  renderMemos();
}

function closeTabModal() {
  document.getElementById('tab-modal')?.remove();
}

// === 순서 변경 모달 (세로 드래그앤드롭) ===
let _reorderSnapshot = null;
function openReorderTabModal() {
  closeTabModal();
  _reorderSnapshot = JSON.parse(JSON.stringify(memosData.templateGroups));
  const modal = document.createElement('div');
  modal.id = 'tab-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-end md:items-center justify-center';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/30" onclick="cancelReorderTabs()"></div>
    <div class="relative bg-white rounded-t-2xl md:rounded-2xl shadow-xl w-full md:max-w-sm md:mx-4 p-5 max-h-[80vh] flex flex-col">
      <h3 class="text-base font-semibold mb-1">탭 순서 변경</h3>
      <p class="text-xs text-botanical-sage mb-3">≡ 잡고 위/아래로 드래그</p>
      <div id="reorder-tab-list" class="flex-1 overflow-y-auto -mx-1 px-1 space-y-2 mb-4"></div>
      <div class="flex justify-end gap-2">
        <button onclick="cancelReorderTabs()" class="px-4 py-2 rounded-lg border border-botanical-stone text-sm text-botanical-sage hover:bg-botanical-cream/50">취소</button>
        <button onclick="saveReorderTabs()" class="px-4 py-2 rounded-lg bg-botanical-fg text-white text-sm hover:opacity-90">저장</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  renderReorderTabList();
}

function renderReorderTabList() {
  const listEl = document.getElementById('reorder-tab-list');
  if (!listEl) return;
  const gripIconV = `<svg width="12" height="16" viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="3" r="1.1"/><circle cx="7" cy="3" r="1.1"/><circle cx="3" cy="7" r="1.1"/><circle cx="7" cy="7" r="1.1"/><circle cx="3" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>`;
  listEl.innerHTML = memosData.templateGroups.map(g => `
    <div data-reorder-tab="${g.id}"
         draggable="true"
         ondragstart="onReorderTabDragStart(event, ${g.id})"
         ondragend="onReorderTabDragEnd(event)"
         ondragover="onReorderTabDragOver(event, ${g.id})"
         ondragleave="onReorderTabDragLeave(event)"
         ondrop="onReorderTabDrop(event, ${g.id})"
         ontouchstart="onReorderTabTouchStart(event, ${g.id})"
         ontouchmove="onReorderTabTouchMove(event)"
         ontouchend="onReorderTabTouchEnd(event)"
         ontouchcancel="onReorderTabTouchEnd(event)"
         class="memo-item flex items-center gap-3 px-3 py-3 rounded-lg border border-botanical-stone bg-white cursor-grab active:cursor-grabbing select-none transition-opacity"
         style="touch-action: none;">
      <span class="text-botanical-sage/60">${gripIconV}</span>
      <span class="font-medium">${escapeHtml(g.name)}</span>
      <span class="ml-auto text-[10px] text-botanical-sage/70">${g.items.length}개</span>
    </div>
  `).join('');
}

function onReorderTabDragStart(e, id) {
  draggedReorderTabId = id;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(id)); } catch(_) {}
  const item = e.currentTarget;
  setTimeout(() => item.classList.add('opacity-40'), 0);
}
function onReorderTabDragOver(e, id) {
  if (draggedReorderTabId == null || draggedReorderTabId === id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const rect = e.currentTarget.getBoundingClientRect();
  const isAfter = (e.clientY - rect.top) > rect.height / 2;
  e.currentTarget.classList.remove('drop-before', 'drop-after');
  e.currentTarget.classList.add(isAfter ? 'drop-after' : 'drop-before');
}
function onReorderTabDragLeave(e) {
  e.currentTarget.classList.remove('drop-before', 'drop-after');
}
function onReorderTabDrop(e, targetId) {
  e.preventDefault();
  const wasAfter = e.currentTarget.classList.contains('drop-after');
  e.currentTarget.classList.remove('drop-before', 'drop-after');
  if (draggedReorderTabId == null || draggedReorderTabId === targetId) return;
  const arr = memosData.templateGroups;
  const fromIdx = arr.findIndex(g => g.id === draggedReorderTabId);
  if (fromIdx === -1) return;
  const [moved] = arr.splice(fromIdx, 1);
  let toIdx = arr.findIndex(g => g.id === targetId);
  if (toIdx === -1) { arr.splice(fromIdx, 0, moved); return; }
  if (wasAfter) toIdx += 1;
  arr.splice(toIdx, 0, moved);
  draggedReorderTabId = null;
  renderReorderTabList();
}
function onReorderTabDragEnd(e) {
  draggedReorderTabId = null;
  document.querySelectorAll('[data-reorder-tab]').forEach(el => {
    el.classList.remove('drop-before', 'drop-after', 'opacity-40');
  });
}

// === 모달 탭 순서 변경 — 터치 드래그 (iOS Safari 대응) ===
let _reorderTabTouchDrag = null;
function onReorderTabTouchStart(e, id) {
  if (!e.touches?.length) return;
  e.preventDefault();
  const itemEl = e.currentTarget.closest('[data-reorder-tab]');
  if (!itemEl) return;
  _reorderTabTouchDrag = { id, itemEl, targetEl: null, isAfter: false };
  itemEl.classList.add('opacity-40');
}
function onReorderTabTouchMove(e) {
  if (!_reorderTabTouchDrag || !e.touches?.length) return;
  e.preventDefault();
  const t = e.touches[0];
  const elBelow = document.elementFromPoint(t.clientX, t.clientY);
  const target = elBelow?.closest('[data-reorder-tab]');
  document.querySelectorAll('[data-reorder-tab]').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  if (target && target !== _reorderTabTouchDrag.itemEl) {
    const rect = target.getBoundingClientRect();
    const isAfter = (t.clientY - rect.top) > rect.height / 2;
    target.classList.add(isAfter ? 'drop-after' : 'drop-before');
    _reorderTabTouchDrag.targetEl = target;
    _reorderTabTouchDrag.isAfter = isAfter;
  } else {
    _reorderTabTouchDrag.targetEl = null;
  }
}
function onReorderTabTouchEnd(e) {
  if (!_reorderTabTouchDrag) return;
  const { id, itemEl, targetEl, isAfter } = _reorderTabTouchDrag;
  itemEl.classList.remove('opacity-40');
  document.querySelectorAll('[data-reorder-tab]').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  _reorderTabTouchDrag = null;
  if (!targetEl) return;
  const targetId = parseInt(targetEl.dataset.reorderTab);
  if (!targetId || targetId === id) return;
  const arr = memosData.templateGroups;
  const fromIdx = arr.findIndex(g => g.id === id);
  if (fromIdx === -1) return;
  const [moved] = arr.splice(fromIdx, 1);
  let toIdx = arr.findIndex(g => g.id === targetId);
  if (toIdx === -1) { arr.splice(fromIdx, 0, moved); return; }
  if (isAfter) toIdx += 1;
  arr.splice(toIdx, 0, moved);
  renderReorderTabList(); // 모달만 갱신, 저장은 [저장] 버튼 클릭 시
}

function cancelReorderTabs() {
  if (_reorderSnapshot) {
    memosData.templateGroups = _reorderSnapshot;
    _reorderSnapshot = null;
  }
  closeTabModal();
  renderMemos();
}

function saveReorderTabs() {
  _reorderSnapshot = null;
  saveAllData();
  closeTabModal();
  renderMemos();
}

// === 자주 쓰는 내용 탭 편집 모드 ===
function openTemplateTabEditMode() {
  closeTabModal();
  const modal = document.createElement('div');
  modal.id = 'tab-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-end md:items-center justify-center';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/30" onclick="closeTabModal(); renderMemos();"></div>
    <div class="relative bg-white rounded-t-2xl md:rounded-2xl shadow-xl w-full md:max-w-md md:mx-4 p-5 max-h-[80vh] overflow-y-auto">
      <h3 class="text-base font-semibold mb-4">탭 편집</h3>
      <div id="template-tab-edit-list" class="space-y-2 mb-4"></div>
      <button onclick="addTemplateGroup(); renderTemplateTabEditList();" class="w-full px-3 py-2 rounded-lg border border-dashed border-botanical-stone text-sm text-botanical-sage hover:bg-botanical-cream/50 transition-all mb-4">+ 탭 추가</button>
      <div class="flex justify-end">
        <button onclick="closeTabModal(); renderMemos();" class="px-4 py-2 rounded-lg bg-botanical-fg text-white text-sm hover:opacity-90">완료</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  renderTemplateTabEditList();
}

function renderTemplateTabEditList() {
  const listEl = document.getElementById('template-tab-edit-list');
  if (!listEl) return;
  const groups = memosData.templateGroups || [];
  listEl.innerHTML = groups.map((g, idx) => `
    <div class="flex items-center gap-1.5 px-2 py-2 rounded-lg border border-botanical-stone bg-white">
      <div class="flex flex-col shrink-0">
        <button onclick="moveTemplateTabUp(${g.id})" ${idx === 0 ? 'disabled' : ''} class="p-0.5 text-botanical-sage hover:text-botanical-fg disabled:opacity-30 disabled:cursor-not-allowed">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 15l-6-6-6 6"/></svg>
        </button>
        <button onclick="moveTemplateTabDown(${g.id})" ${idx === groups.length - 1 ? 'disabled' : ''} class="p-0.5 text-botanical-sage hover:text-botanical-fg disabled:opacity-30 disabled:cursor-not-allowed">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>
      <input type="text" value="${escapeHtml(g.name)}" maxlength="10"
             onchange="renameTemplateTabDirect(${g.id}, this.value)"
             class="flex-1 min-w-0 px-2 py-1 rounded border border-botanical-stone focus:outline-none focus:border-botanical-sage text-sm"
             style="font-size: 16px;">
      <span class="text-[10px] text-botanical-sage/70 shrink-0">${g.items.length}</span>
      <button onclick="deleteTemplateGroupFromEdit(${g.id})" title="삭제" class="p-1 text-botanical-sage hover:text-red-500 transition-all shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>
      </button>
    </div>
  `).join('');
}

function moveTemplateTabUp(id) {
  const arr = memosData.templateGroups;
  const idx = arr.findIndex(g => g.id === id);
  if (idx <= 0) return;
  [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
  saveAllData();
  renderTemplateTabEditList();
}

function moveTemplateTabDown(id) {
  const arr = memosData.templateGroups;
  const idx = arr.findIndex(g => g.id === id);
  if (idx < 0 || idx >= arr.length - 1) return;
  [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
  saveAllData();
  renderTemplateTabEditList();
}

function renameTemplateTabDirect(id, newName) {
  const g = memosData.templateGroups.find(x => x.id === id);
  if (!g || !newName.trim()) return;
  g.name = newName.trim();
  saveAllData();
}

function deleteTemplateGroupFromEdit(id) {
  const g = memosData.templateGroups.find(x => x.id === id);
  if (!g) return;
  if (g.items.length > 0) {
    if (!confirm(`"${g.name}" 탭에 ${g.items.length}개 항목이 있습니다. 삭제할까요?`)) return;
  }
  memosData.templateGroups = memosData.templateGroups.filter(x => x.id !== id);
  if (memosData.activeTemplateGroupId === id) {
    memosData.activeTemplateGroupId = memosData.templateGroups[0]?.id || null;
  }
  saveAllData();
  renderTemplateTabEditList();
}

// === 메모 탭 편집 모드 ===
function openMemoTabEditMode() {
  closeTabModal();
  const modal = document.createElement('div');
  modal.id = 'tab-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-end md:items-center justify-center';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/30" onclick="closeTabModal(); renderMemos();"></div>
    <div class="relative bg-white rounded-t-2xl md:rounded-2xl shadow-xl w-full md:max-w-md md:mx-4 p-5 max-h-[80vh] overflow-y-auto">
      <h3 class="text-base font-semibold mb-4">탭 편집</h3>
      <div id="memo-tab-edit-list" class="space-y-2 mb-4"></div>
      <button onclick="addMemoTab(); renderMemoTabEditList();" class="w-full px-3 py-2 rounded-lg border border-dashed border-botanical-stone text-sm text-botanical-sage hover:bg-botanical-cream/50 transition-all mb-4">+ 탭 추가</button>
      <div class="flex justify-end">
        <button onclick="closeTabModal(); renderMemos();" class="px-4 py-2 rounded-lg bg-botanical-fg text-white text-sm hover:opacity-90">완료</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  renderMemoTabEditList();
}

function renderMemoTabEditList() {
  const listEl = document.getElementById('memo-tab-edit-list');
  if (!listEl) return;
  const tabs = [...(memosData.tabs || [])].sort((a, b) => a.order - b.order);
  const memos = memosData.memos || [];
  listEl.innerHTML = tabs.map((tab, idx) => {
    const count = memos.filter(m => m.tabId === tab.id).length;
    return `
      <div class="flex items-center gap-1.5 px-2 py-2 rounded-lg border border-botanical-stone bg-white">
        <div class="flex flex-col shrink-0">
          <button onclick="moveMemoTabUp('${tab.id}')" ${idx === 0 ? 'disabled' : ''} class="p-0.5 text-botanical-sage hover:text-botanical-fg disabled:opacity-30 disabled:cursor-not-allowed">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 15l-6-6-6 6"/></svg>
          </button>
          <button onclick="moveMemoTabDown('${tab.id}')" ${idx === tabs.length - 1 ? 'disabled' : ''} class="p-0.5 text-botanical-sage hover:text-botanical-fg disabled:opacity-30 disabled:cursor-not-allowed">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
        <input type="text" value="${escapeHtml(tab.name)}" maxlength="10"
               onchange="renameMemoTabDirect('${tab.id}', this.value)"
               class="flex-1 min-w-0 px-2 py-1 rounded border border-botanical-stone focus:outline-none focus:border-botanical-sage text-sm"
               style="font-size: 16px;">
        <span class="text-[10px] text-botanical-sage/70 shrink-0">${count}</span>
        <button onclick="deleteMemoTabFromEdit('${tab.id}')" title="삭제" class="p-1 text-botanical-sage hover:text-red-500 transition-all shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>
        </button>
      </div>
    `;
  }).join('');
}

function moveMemoTabUp(id) {
  const tabs = memosData.tabs || [];
  const sorted = [...tabs].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex(t => t.id === id);
  if (idx <= 0) return;
  const prevOrder = sorted[idx - 1].order;
  sorted[idx - 1].order = sorted[idx].order;
  sorted[idx].order = prevOrder;
  saveAllData();
  renderMemoTabEditList();
}

function moveMemoTabDown(id) {
  const tabs = memosData.tabs || [];
  const sorted = [...tabs].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex(t => t.id === id);
  if (idx < 0 || idx >= sorted.length - 1) return;
  const nextOrder = sorted[idx + 1].order;
  sorted[idx + 1].order = sorted[idx].order;
  sorted[idx].order = nextOrder;
  saveAllData();
  renderMemoTabEditList();
}

function renameMemoTabDirect(id, newName) {
  const tab = (memosData.tabs || []).find(t => t.id === id);
  if (!tab || !newName.trim()) return;
  tab.name = newName.trim();
  saveAllData();
}

function deleteMemoTabFromEdit(id) {
  const tabs = memosData.tabs || [];
  if (tabs.length <= 1) {
    alert('최소 1개의 탭이 필요합니다.');
    return;
  }
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  const memos = (memosData.memos || []).filter(m => m.tabId === id);
  if (memos.length > 0) {
    if (!confirm(`"${tab.name}" 탭에 ${memos.length}개 메모가 있습니다. 삭제할까요?\n(메모도 함께 삭제됩니다)`)) return;
    memosData.memos = memosData.memos.filter(m => m.tabId !== id);
  }
  memosData.tabs = tabs.filter(t => t.id !== id);
  if (memosData.lastActiveTab === id) {
    memosData.lastActiveTab = memosData.tabs[0]?.id || 'tab_memo';
  }
  saveAllData();
  renderMemoTabEditList();
}

// === 항목 터치 드래그 (iOS Safari가 native HTML5 drag 미지원) ===
let _touchDrag = null;
function onTemplateItemTouchStart(e, id) {
  if (!e.touches?.length) return;
  e.preventDefault();
  const itemEl = e.currentTarget.closest('[data-template-item]');
  if (!itemEl) return;
  _touchDrag = { id, itemEl, targetEl: null, isAfter: false };
  itemEl.classList.add('opacity-40');
}
function onTemplateItemTouchMove(e) {
  if (!_touchDrag || !e.touches?.length) return;
  e.preventDefault();
  const t = e.touches[0];
  const elBelow = document.elementFromPoint(t.clientX, t.clientY);
  const target = elBelow?.closest('[data-template-item]');
  document.querySelectorAll('[data-template-item]').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  if (target && target !== _touchDrag.itemEl) {
    const rect = target.getBoundingClientRect();
    const isAfter = (t.clientY - rect.top) > rect.height / 2;
    target.classList.add(isAfter ? 'drop-after' : 'drop-before');
    _touchDrag.targetEl = target;
    _touchDrag.isAfter = isAfter;
  } else {
    _touchDrag.targetEl = null;
  }
}
function onTemplateItemTouchEnd(e) {
  if (!_touchDrag) return;
  const { id, itemEl, targetEl, isAfter } = _touchDrag;
  itemEl.classList.remove('opacity-40');
  document.querySelectorAll('[data-template-item]').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  _touchDrag = null;
  if (!targetEl) return;
  const targetId = parseInt(targetEl.dataset.templateItem);
  if (!targetId || targetId === id) return;
  const g = memosData.templateGroups.find(x => x.id === activeTemplateGroupId);
  if (!g) return;
  const arr = g.items;
  const fromIdx = arr.findIndex(i => i.id === id);
  if (fromIdx === -1) return;
  const [moved] = arr.splice(fromIdx, 1);
  let toIdx = arr.findIndex(i => i.id === targetId);
  if (toIdx === -1) { arr.splice(fromIdx, 0, moved); return; }
  if (isAfter) toIdx += 1;
  arr.splice(toIdx, 0, moved);
  saveAllData();
  renderMemos();
}

// === 항목 드래그 (PC HTML5) ===
function onTemplateItemDragStart(e, id) {
  draggedTemplateItemId = id;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(id)); } catch(_) {}
  const item = e.currentTarget.closest('[data-template-item]');
  if (item) setTimeout(() => item.classList.add('opacity-40'), 0);
  e.stopPropagation();
}
function onTemplateItemDragOver(e, id) {
  if (draggedTemplateItemId == null || draggedTemplateItemId === id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const rect = e.currentTarget.getBoundingClientRect();
  const isAfter = (e.clientY - rect.top) > rect.height / 2;
  e.currentTarget.classList.remove('drop-before', 'drop-after');
  e.currentTarget.classList.add(isAfter ? 'drop-after' : 'drop-before');
}
function onTemplateItemDragLeave(e) {
  e.currentTarget.classList.remove('drop-before', 'drop-after');
}
function onTemplateItemDrop(e, targetId) {
  e.preventDefault();
  const wasAfter = e.currentTarget.classList.contains('drop-after');
  e.currentTarget.classList.remove('drop-before', 'drop-after');
  if (draggedTemplateItemId == null || draggedTemplateItemId === targetId) return;
  const g = memosData.templateGroups.find(x => x.id === activeTemplateGroupId);
  if (!g) return;
  const arr = g.items;
  const fromIdx = arr.findIndex(i => i.id === draggedTemplateItemId);
  if (fromIdx === -1) return;
  const [moved] = arr.splice(fromIdx, 1);
  let toIdx = arr.findIndex(i => i.id === targetId);
  if (toIdx === -1) { arr.splice(fromIdx, 0, moved); return; }
  if (wasAfter) toIdx += 1;
  arr.splice(toIdx, 0, moved);
  draggedTemplateItemId = null;
  saveAllData();
  renderMemos();
}
function onTemplateItemDragEnd(e) {
  draggedTemplateItemId = null;
  document.querySelectorAll('[data-template-item]').forEach(el => {
    el.classList.remove('drop-before', 'drop-after', 'opacity-40');
  });
}

function ensureTemplateData() {
  if (!memosData) memosData = { memos: [] };
  if (!Array.isArray(memosData.templateGroups) || memosData.templateGroups.length === 0) {
    memosData.templateGroups = JSON.parse(JSON.stringify(TEMPLATE_GROUPS_SEED));
  }
  // type 필드 누락된 기존 데이터 호환
  memosData.templateGroups.forEach(g => {
    if (!g.type) g.type = 'text';
    if (!Array.isArray(g.items)) g.items = [];
  });
  if (!activeTemplateGroupId || !memosData.templateGroups.find(g => g.id === activeTemplateGroupId)) {
    activeTemplateGroupId = memosData.templateGroups[0]?.id || null;
  }
}

function nextTemplateGroupId() {
  const ids = memosData.templateGroups.map(g => g.id);
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

function nextTemplateItemId() {
  const all = memosData.templateGroups.flatMap(g => g.items.map(i => i.id));
  return (all.length ? Math.max(...all) : 1000) + 1;
}

function selectTemplateGroup(id) {
  if (_suppressTabClick) { _suppressTabClick = false; return; }
  activeTemplateGroupId = id;
  renderMemos();
}

function addTemplateGroup() {
  const name = prompt('새 탭 이름 (예: 답글, 링크, 광고):', '');
  if (!name?.trim()) return;
  const trimmed = name.trim();
  const typeChoice = confirm(`"${trimmed}" 탭의 형태?\n\n[확인] = 제목 + 내용  (예: 링크 아카이빙)\n[취소] = 텍스트만  (예: 답글)`);
  const type = typeChoice ? 'titled' : 'text';
  const newGroup = { id: nextTemplateGroupId(), name: trimmed, type, items: [] };
  memosData.templateGroups.push(newGroup);
  activeTemplateGroupId = newGroup.id;
  saveAllData();
  renderMemos();
}

function deleteTemplateGroup(id) {
  if (memosData.templateGroups.length <= 1) {
    alert('최소 1개 탭은 남겨야 해요.');
    return;
  }
  const g = memosData.templateGroups.find(x => x.id === id);
  if (!g) return;
  if (!confirm(`"${g.name}" 탭과 그 안의 ${g.items.length}개 항목을 삭제할까요?`)) return;
  memosData.templateGroups = memosData.templateGroups.filter(x => x.id !== id);
  if (activeTemplateGroupId === id) {
    activeTemplateGroupId = memosData.templateGroups[0]?.id || null;
  }
  saveAllData();
  renderMemos();
}

function addTemplateItem() {
  const g = memosData.templateGroups.find(x => x.id === activeTemplateGroupId);
  if (!g) return;
  const newItem = g.type === 'titled'
    ? { id: nextTemplateItemId(), title: '', text: '' }
    : { id: nextTemplateItemId(), text: '' };
  g.items.unshift(newItem); // 위로 추가
  saveAllData();
  renderMemos();
  requestAnimationFrame(() => {
    const firstInput = document.querySelector('[data-template-item-input]');
    firstInput?.focus();
  });
}

let _templateItemSaveTimer = null;
function updateTemplateItem(itemId, field, value) {
  for (const g of memosData.templateGroups) {
    const it = g.items.find(i => i.id === itemId);
    if (it) {
      it[field] = value;
      break;
    }
  }
  if (_templateItemSaveTimer) clearTimeout(_templateItemSaveTimer);
  _templateItemSaveTimer = setTimeout(() => {
    _templateItemSaveTimer = null;
    saveAllData();
  }, 400);
}

function deleteTemplateItem(itemId) {
  for (const g of memosData.templateGroups) {
    const idx = g.items.findIndex(i => i.id === itemId);
    if (idx >= 0) {
      if (!confirm('이 항목을 삭제할까요?')) return;
      g.items.splice(idx, 1);
      saveAllData();
      renderMemos();
      return;
    }
  }
}

function copyTemplateItem(itemId) {
  let text = '';
  for (const g of memosData.templateGroups) {
    const it = g.items.find(i => i.id === itemId);
    if (it) { text = it.text || ''; break; } // 제목 제외, text 만 복사
  }
  if (!text) { alert('내용이 비어 있어요.'); return; }
  navigator.clipboard.writeText(text).then(() => {
    showMemoSaveToast('복사됨');
  }).catch(() => alert('복사 실패. 직접 복사:\n' + text));
}

function renderTemplateSection() {
  ensureTemplateData();
  const groups = memosData.templateGroups;
  const active = groups.find(g => g.id === activeTemplateGroupId) || groups[0];

  // SVG 핸들 (항목용)
  const gripIconV = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="3" r="1.1"/><circle cx="7" cy="3" r="1.1"/><circle cx="3" cy="7" r="1.1"/><circle cx="7" cy="7" r="1.1"/><circle cx="3" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>`;
  const saveIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
  const trashIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>`;

  // 탭 (클릭=선택, 편집은 상단 연필 버튼)
  const tabsHtml = groups.map(g => {
    const isActive = g.id === active.id;
    return `
      <span data-template-tab="${g.id}"
            onclick="selectTemplateGroup(${g.id})"
            class="inline-flex items-center px-3 py-1.5 rounded-full text-xs md:text-sm cursor-pointer select-none ${isActive ? 'bg-botanical-fg text-white' : 'bg-botanical-cream/50 text-botanical-sage hover:text-botanical-fg'}">
        ${escapeHtml(g.name)}
      </span>
    `;
  }).join('');

  // 항목 (드래그 핸들 = 점 6개 grip)
  const isTitled = active.type === 'titled';
  const itemsHtml = active.items.length === 0
    ? `<p class="text-xs text-botanical-sage text-center py-4">항목이 없어요. 아래 + 버튼으로 추가.</p>`
    : active.items.map(it => `
        <div data-template-item="${it.id}"
             ondragover="onTemplateItemDragOver(event, ${it.id})"
             ondragleave="onTemplateItemDragLeave(event)"
             ondrop="onTemplateItemDrop(event, ${it.id})"
             class="memo-item flex items-start gap-1.5 px-2 py-2 rounded-lg border border-botanical-stone bg-botanical-cream/20 transition-opacity">
          <span draggable="true"
                ondragstart="onTemplateItemDragStart(event, ${it.id})"
                ondragend="onTemplateItemDragEnd(event)"
                ontouchstart="onTemplateItemTouchStart(event, ${it.id})"
                ontouchmove="onTemplateItemTouchMove(event)"
                ontouchend="onTemplateItemTouchEnd(event)"
                ontouchcancel="onTemplateItemTouchEnd(event)"
                title="드래그로 순서 변경"
                class="shrink-0 self-center text-botanical-sage/50 hover:text-botanical-sage cursor-grab active:cursor-grabbing px-0.5" style="touch-action: none;">${gripIconV}</span>
          ${isTitled ? `
            <input type="text" data-template-item-input value="${escapeHtml(it.title || '')}" maxlength="4"
                   oninput="updateTemplateItem(${it.id}, 'title', this.value)"
                   placeholder="제목"
                   class="unified-text shrink-0 bg-white border border-botanical-stone rounded px-1 py-0.5 text-center focus:outline-none focus:border-botanical-sage"
                   style="width: 4.75rem; min-width: 4.75rem; max-width: 4.75rem;">
          ` : ''}
          <textarea ${isTitled ? '' : 'data-template-item-input'} rows="1"
                 oninput="updateTemplateItem(${it.id}, 'text', this.value)"
                 placeholder="${isTitled ? '링크 또는 내용' : '내용 입력'}"
                 class="unified-text flex-1 min-w-0 bg-transparent focus:outline-none resize-none overflow-hidden whitespace-nowrap"
                 style="height: 1.6em;">${escapeHtml(it.text || '')}</textarea>
          ${isTitled && it.text?.startsWith('http') ? `<button onclick="window.open('${escapeHtml(it.text)}', '_system') || window.open('${escapeHtml(it.text)}', '_blank')" class="shrink-0 px-2 py-1 text-[11px] md:text-xs rounded border border-blue-300 text-blue-500 hover:bg-blue-50 transition-all">열기</button>` : ''}
          <button onclick="copyTemplateItem(${it.id})" class="shrink-0 px-2 py-1 text-[11px] md:text-xs rounded border border-botanical-stone text-botanical-sage hover:bg-botanical-cream hover:text-botanical-fg transition-all">복사</button>
          <button onclick="deleteTemplateItem(${it.id})" title="삭제" class="shrink-0 p-1 rounded text-botanical-sage/60 hover:text-red-500 transition-all">
            ${trashIcon}
          </button>
        </div>
      `).join('');

  return `
    <details class="mb-4 bg-white rounded-2xl shadow-sm border border-botanical-stone" ${templateSectionOpen ? 'open' : ''} ontoggle="templateSectionOpen = this.open; if (this.open) requestAnimationFrame(() => this.querySelectorAll('textarea.auto-grow').forEach(autoResize));">
      <summary class="list-none cursor-pointer flex items-center justify-between px-4 py-3 group">
        <span class="text-sm font-semibold text-botanical-fg flex items-center gap-2">
          📌 자주 쓰는 내용 <span class="text-xs text-botanical-sage font-normal">(${active.items.length})</span>
        </span>
        <div class="flex items-center gap-1">
          <button onclick="event.preventDefault(); event.stopPropagation(); openTemplateTabEditMode();" title="탭 편집" class="w-7 h-7 rounded-full border border-botanical-stone text-botanical-sage hover:text-botanical-fg hover:border-botanical-sage flex items-center justify-center transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button onclick="event.preventDefault(); event.stopPropagation(); manualSaveTemplates();" title="지금 저장 (백업용)" class="w-7 h-7 rounded-full border border-botanical-stone text-botanical-sage hover:text-botanical-fg hover:border-botanical-sage flex items-center justify-center transition-all">
            ${saveIcon}
          </button>
        </div>
      </summary>
      <div class="p-3">
        <div class="flex flex-wrap items-center gap-1.5 mb-3 pb-3 border-b border-botanical-stone">
          ${tabsHtml}
        </div>
        <button onclick="addTemplateItem()" class="mb-3 w-full px-3 py-2 rounded-lg border border-dashed border-botanical-stone text-xs text-botanical-sage hover:bg-botanical-cream/50 transition-all">+ 항목 추가 (위로)</button>
        <div class="space-y-2">${itemsHtml}</div>
      </div>
    </details>
  `;
}

function updateContentField(contentId, field, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  content[field] = value;
  markDirty('contents');
  saveAllData();
}

// 성과 입력 대기 알림 — 항목별 X로 끄기 (이후 그 콘텐츠는 알림 안 뜸)
function dismissPerfReminder(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  content.perfReminderDismissed = true;
  markDirty('contents');
  saveAllData();
  if (typeof renderPerformance === 'function') renderPerformance();
}

function toggleChecklist(contentId, kind, idx, checked) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (kind === 'reference') {
    if (!content.reference) content.reference = {};
    if (!content.reference.checklist) content.reference.checklist = [];
    content.reference.checklist[idx] = !!checked;
  } else if (kind === 'plan') {
    if (!content.planChecklist) content.planChecklist = [];
    content.planChecklist[idx] = !!checked;
  }
  saveAllData();
}

// 기본 정보 필드 자동 저장 (DOM input/change 이벤트 위임)
// input+change 둘 다 감지해서 type=date/number 에서도 안전하게 저장
function _topFieldAutoSave(e) {
  const el = e.target;
  if (!el?.dataset?.field) return;
  const container = el.closest('[id^="top-info-"]');
  if (!container) return;
  const contentId = parseInt(container.id.replace('top-info-', ''));
  if (!contentId) return;
  autoSaveTopField(el, contentId);
}
document.addEventListener('input', _topFieldAutoSave);
document.addEventListener('change', _topFieldAutoSave);

function autoSaveTopField(el, contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  const field = el.dataset.field;
  const val = el.value;
  if (field.startsWith('performance.')) {
    if (!content.performance) content.performance = {};
    const key = field.split('.')[1];
    const num = parseFloat(val);
    content.performance[key] = isNaN(num) ? 0 : num;
  } else if (field === 'status') {
    content.status = val;
    calendarData.items.forEach(item => {
      if (item.contentId === contentId) item.status = val;
    });
  } else if (field === 'category') {
    content.category = val;
    content.isRevenue = ['광고', '판매', '협찬'].includes(val);
    calendarData.items.forEach(item => {
      if (item.contentId === contentId) {
        item.category = val;
        item.type = content.isRevenue ? '광고' : '일반';
      }
    });
  } else {
    // 예정일(uploadDate) 포함 기타 단순 필드 — 어느 로직에도 연결 안 함 (메모성)
    content[field] = val;
  }
  // 성과분석 탭은 상태/카테고리/성과에 따라 내용 바뀌므로 갱신 (uploadDate는 제외 — 메모)
  if (['status', 'category'].includes(field) || field.startsWith('performance.')) {
    if (typeof renderPerformance === 'function') renderPerformance();
  }
  saveAllData();
}

// 성과분석 탭에서 성과 셀 입력 저장
// 특정 월의 성과 요약 재계산
function recalcMonthPerf(monthStr) {
  // 해당 월의 업로드 완료 콘텐츠
  const monthContents = contentsData.contents.filter(c =>
    c.status === '업로드완료' && getUploadDate(c).startsWith(monthStr)
  );

  if (monthContents.length === 0) {
    performanceData.monthly[monthStr] = null;
    return;
  }

  // 총 조회수, 저장수, 공유수 계산
  let totalViews = 0;
  let totalSaves = 0;
  let totalShares = 0;

  monthContents.forEach(c => {
    const views = c.performance?.views || 0;
    const saves = c.performance?.saves || 0;
    const shares = c.performance?.shares || 0;
    totalViews += views;
    totalSaves += saves;
    totalShares += shares;
  });

  // 평균 저장률 계산
  const avgSaveRate = totalViews > 0 ? ((totalSaves / totalViews) * 100).toFixed(1) : 0;

  // 월별 요약 업데이트
  if (!performanceData.monthly) performanceData.monthly = {};
  performanceData.monthly[monthStr] = {
    totalContents: monthContents.length,
    totalViews,
    totalSaves,
    totalShares,
    avgSaveRate: parseFloat(avgSaveRate)
  };
}

// 전체 월별 성과 재계산 (기존 데이터 마이그레이션용)
function recalcAllMonthPerf() {
  if (!performanceData) performanceData = { follower: { current: 0, history: { daily: [], monthly: [] } }, monthly: {} };

  // 업로드 완료된 모든 콘텐츠에서 월 추출
  const months = new Set();
  contentsData.contents.forEach(c => {
    if (c.status === '업로드완료') {
      const uploadDate = getUploadDate(c);
      if (uploadDate) {
        months.add(uploadDate.slice(0, 7)); // YYYY-MM
      }
    }
  });

  // 각 월별로 재계산
  months.forEach(monthStr => recalcMonthPerf(monthStr));
}

function savePerfCell(el, contentId, field) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.performance) content.performance = {};
  content.performance[field] = parseK(el.value);

  // 해당 콘텐츠가 속한 월의 요약 재계산
  const uploadDate = getUploadDate(content);
  if (uploadDate) {
    const monthStr = uploadDate.slice(0, 7); // YYYY-MM
    recalcMonthPerf(monthStr);
  }

  saveAllData();
  // 콘텐츠 상세 폼의 readonly 성과 블록 동기화
  renderContentList();
  // 성과분석 탭 갱신
  if (typeof renderPerformance === 'function') renderPerformance();
}

// 상단 기본 정보 섹션의 모든 필드를 DOM에서 읽어 일괄 저장 (버튼 수동 저장 + 재렌더)
function saveTopInfo(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  const container = document.getElementById('top-info-' + contentId);
  if (!container) return;

  if (!content.performance) content.performance = {};

  container.querySelectorAll('[data-field]').forEach(el => {
    const field = el.dataset.field;
    const val = el.value;
    if (field.startsWith('performance.')) {
      const key = field.split('.')[1];
      const num = parseFloat(val);
      content.performance[key] = isNaN(num) ? 0 : num;
    } else if (field === 'status') {
      content.status = val;
      calendarData.items.forEach(item => {
        if (item.contentId === contentId && !item.isMilestone) item.status = val;
      });
    } else if (field === 'category') {
      content.category = val;
      content.isRevenue = ['광고', '판매', '협찬'].includes(val);
      calendarData.items.forEach(item => {
        if (item.contentId === contentId) {
          item.category = val;
          item.type = content.isRevenue ? '광고' : '일반';
        }
      });
    } else {
      content[field] = val;
    }
  });

  // 버튼 피드백 (재렌더 전)
  const btn = container.querySelector('button');
  const origText = btn?.textContent;
  if (btn) {
    btn.textContent = '✓ 저장됨';
    btn.classList.add('bg-green-600');
  }

  saveAllData();
  // 카테고리 바뀌면 폼 내용(광고/판매/협찬 섹션) 달라지므로 재렌더
  renderContentList();
  renderCalendar();
  reopenForm(contentId);

  // 재렌더 후 다시 버튼 찾아 피드백 유지
  setTimeout(() => {
    const newBtn = document.getElementById('top-info-' + contentId)?.querySelector('button');
    if (newBtn) {
      newBtn.textContent = '✓ 저장됨';
      newBtn.classList.add('bg-green-600');
      setTimeout(() => {
        newBtn.textContent = '저장';
        newBtn.classList.remove('bg-green-600');
      }, 1200);
    }
  }, 0);
}

// 제목 변경 — 편집 중인 버전에 저장, 최종버전일 때만 목록/캘린더/수익 연동
function updateContentTitle(contentId, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  ensureScript(content);
  const ver = content.script.currentVersion ?? 0;
  const finalVer = content.script.finalVersion ?? 0;
  if (content.script.versions[ver]) content.script.versions[ver].title = value;
  // 편집 중인 버전이 '최종'이면 표시 타이틀 연동
  if (ver === finalVer) {
    content.title = value;
    calendarData.items.forEach(item => {
      if (item.contentId === contentId) item.title = value;
    });
    ['ad', 'sales', 'sponsor'].forEach(t => {
      (revenueData.items?.[t] || []).forEach(item => {
        if (item.contentId === contentId) item.brand = value || '무제';
      });
    });
    // 플래너 연동: 콘텐츠 제목 → 플래너 제목 동기화
    syncTitleToPlan(contentId, value);
    // 목록 헤더의 제목 스팬만 국소 업데이트 (re-render 없이 포커스 유지)
    const titleEl = document.querySelector(`[data-content-title="${contentId}"]`);
    if (titleEl) titleEl.textContent = value || '무제';
  }
  saveAllData();
}

// 최종 버전 지정
function setFinalVersion(contentId, versionIdx) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  ensureScript(content);
  if (!content.script.versions[versionIdx]) return;
  content.script.finalVersion = versionIdx;
  const verTitle = content.script.versions[versionIdx].title ?? '';
  content.title = verTitle;
  calendarData.items.forEach(item => {
    if (item.contentId === contentId) item.title = verTitle;
  });
  ['ad', 'sales', 'sponsor'].forEach(t => {
    (revenueData.items?.[t] || []).forEach(item => {
      if (item.contentId === contentId) item.brand = verTitle || '무제';
    });
  });
  // 플래너 연동
  syncTitleToPlan(contentId, verTitle);
  saveAllData();
  renderContentList();
  reopenForm(contentId);
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
  reopenForm(contentId);
}

function updateReference(contentId, field, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.reference) content.reference = {};
  content.reference[field] = value;
  saveAllData();
}

function updatePlanDetail(contentId, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  content.planDetail = value;

  // 연동된 플랜에도 동기화
  syncPlanDetailToPlan(contentId, value);

  saveAllData();
}

// 콘텐츠 작성계획 → 플랜 description 동기화
function syncPlanDetailToPlan(contentId, planDetail) {
  const content = contentsData?.contents?.find(c => c.id === contentId);
  if (!content?.linkedPlanId) return;

  const numPlanId = typeof content.linkedPlanId === 'string' ? parseInt(content.linkedPlanId) : content.linkedPlanId;

  for (const month of Object.keys(plansData || {})) {
    const plan = plansData[month]?.plans?.find(p => p.id === numPlanId || p.id === content.linkedPlanId);
    if (plan) {
      plan.description = planDetail;
      markDirty('plans');
      return;
    }
  }
}

function linkPlanToContent(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;

  // 콘텐츠의 업로드 날짜 또는 마일스톤 날짜로 월 추정
  const refDate = getContentRefDate(content);
  const monthStr = refDate ? refDate.slice(0, 7) : contentSelectedMonth;

  if (!plansData || !plansData[monthStr] || !plansData[monthStr].plans || plansData[monthStr].plans.length === 0) {
    alert('해당 월에 등록된 계획이 없습니다');
    return;
  }

  const monthPlans = plansData[monthStr].plans;

  const popup = document.getElementById('calendar-popup');
  const popupContent = document.getElementById('popup-content');

  popupContent.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-lg">계획 연동</h3>
      <button onclick="closeCalendarPopup()" class="text-botanical-sage hover:text-botanical-fg">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="space-y-2 max-h-[60vh] overflow-y-auto">
      ${monthPlans.map(plan => `
        <button data-plan-id="${plan.id}" data-month="${monthStr}" onclick="applyPlanToContent(${contentId}, this.dataset.planId, this.dataset.month)" class="w-full p-3 rounded-lg border border-botanical-stone hover:border-botanical-sage cursor-pointer transition-all text-left">
          <div class="flex items-start justify-between gap-2 mb-1 pointer-events-none">
            <span class="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-botanical-cream text-botanical-sage">${plan.category}</span>
            <span class="text-xs text-botanical-clay">${plan.week}주차</span>
          </div>
          <h4 class="text-sm font-semibold text-botanical-fg mb-1 pointer-events-none">${plan.title}</h4>
          ${plan.description ? `<p class="text-xs text-botanical-sage line-clamp-2 pointer-events-none">${plan.description.split('\n').slice(0, 2).join(' ')}</p>` : ''}
        </button>
      `).join('')}
    </div>
  `;

  popup.classList.remove('hidden');
}

function applyPlanToContent(contentId, planId, monthStr) {
  console.log('🔍 플래너 클릭:', { contentId, planId, monthStr });

  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) {
    console.error('❌ 콘텐츠를 찾을 수 없음:', contentId);
    return;
  }

  const plan = plansData[monthStr].plans.find(p => p.id === planId);
  if (!plan) {
    console.error('❌ 플랜을 찾을 수 없음:', planId, '월:', monthStr);
    console.log('사용 가능한 플랜:', plansData[monthStr]?.plans?.map(p => ({ id: p.id, title: p.title })));
    return;
  }

  console.log('✅ 연동:', plan.title, '→ 콘텐츠', content.id);

  // plan의 정보를 콘텐츠에 적용
  content.planDetail = plan.description || '';
  content.category = plan.category;

  // 현재 버전의 제목 업데이트
  ensureScript(content);
  const ver = content.script.currentVersion ?? 0;
  const finalVer = content.script.finalVersion ?? 0;

  content.script.versions[ver].title = plan.title;

  // 최종 버전이면 content.title과 캘린더도 동기화
  if (ver === finalVer) {
    content.title = plan.title;
    calendarData.items.forEach(item => {
      if (item.contentId === contentId) item.title = plan.title;
    });
  }

  saveAllData();
  closeCalendarPopup();
  renderContentList();

  // 해당 콘텐츠 폼 다시 열기
  setTimeout(() => {
    toggleContentForm(contentId);
  }, 100);
}

function updateClientNotion(contentId, value) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.adInfo) content.adInfo = {};
  content.adInfo.clientNotion = value;
  saveAllData();
  renderContentList();
  reopenForm(contentId);
}

// ========== 노션 링크 (일반 레퍼런스) ==========
function addNotionLink(contentId) {
  const content = contentsData.contents.find(c => c.id === contentId);
  if (!content) return;
  if (!content.notionLinks) content.notionLinks = [''];
  content.notionLinks.push('');
  saveAllData();
  renderContentList();
  reopenForm(contentId);
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
  reopenForm(contentId);
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
  const date = getUploadDate(content) || new Date().toISOString().slice(0, 10);
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
  // 항상 오늘 기준 올해를 연간으로 사용 (사용자가 선택한 월과 독립)
  const realNow = new Date();
  const realYear = realNow.getFullYear();
  const realMonth = realNow.getMonth() + 1;
  const currentMonthStr = `${realYear}-${String(realMonth).padStart(2, '0')}`;
  const yearStr = String(realYear);

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
        <label class="text-sm font-medium block mb-1">제목</label>
        <input type="text" id="new-content-title" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none" placeholder="콘텐츠 제목">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-sm font-medium block mb-1">카테고리</label>
          <select id="new-content-category" class="w-full px-3 py-2 rounded-xl border border-botanical-stone focus:outline-none">
            <option value="Career Guide">Career Guide</option>
            <option value="AI Work">AI Work</option>
            <option value="Money Log">Money Log</option>
            <option value="Life Style">Life Style</option>
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
    selectedStatus = document.getElementById('new-content-rev-status')?.value || '';
    selectedDate = document.getElementById('new-content-rev-date')?.value || '';
  } else {
    title = document.getElementById('new-content-title').value;
    category = document.getElementById('new-content-category').value;
    type = document.getElementById('new-content-type').value;
    selectedStatus = document.getElementById('new-content-status')?.value || '';
    selectedDate = document.getElementById('new-content-date')?.value || '';
  }

  if (!title) {
    alert(formType === 'revenue' ? '브랜드명을 입력하세요' : '제목을 입력하세요');
    return;
  }

  // 상태 + 날짜 둘 다 있으면 마일스톤으로 등록
  if (selectedStatus && selectedDate) {
    milestones.push({ status: selectedStatus, date: selectedDate });
  }

  // 현재 상태: 선택한 상태가 있으면 그것, 없으면 기본값
  const currentStatus = selectedStatus || (formType === 'revenue' ? '계약완료' : '기획중');

  const contentId = Date.now();
  const newContent = {
    id: contentId,
    title: title,
    type: type,
    category: category,
    status: currentStatus,
    uploadDate: '',
    isRevenue: formType === 'revenue',
    milestones: milestones,
    url: '',
    performance: { views: null, likes: null, shares: null, comments: null, saves: null },
    reference: { links: [], analysis: '' },
    planDetail: '',
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
// 시작월(2026-04)보다 과거 연도면 시작 연도로 클램프
let perfSelectedYear = (() => {
  const startY = parseInt(MONTH_SELECT_START.slice(0, 4));
  return Math.max(currentYear, startY);
})();
let followerViewMode = 'daily';
let perfSubTab = 'detail'; // 'detail' | 'compare' — 리렌더 후에도 보존

function renderPerformance() {
  // performanceData null check
  if (!performanceData) {
    performanceData = { follower: { current: 0, history: { daily: [], monthly: [] } }, monthly: {} };
  }

  // 기존 데이터 마이그레이션: 최초 1회만 전체 월별 성과 재계산
  if (!perfRecalculated) {
    recalcAllMonthPerf();
    perfRecalculated = true;
  }

  const monthPerf = performanceData.monthly?.[perfSelectedMonth] || {};
  const monthNum = parseInt(perfSelectedMonth.slice(5));

  // Get contents for selected month — 상태 '업로드완료' + 업로드완료 마일스톤 날짜가 해당 월
  const monthContents = contentsData.contents.filter(c =>
    c.status === '업로드완료' && getUploadDate(c).startsWith(perfSelectedMonth)
  );

  // 최신순 정렬 (업로드 날짜 기준 내림차순)
  monthContents.sort((a, b) => {
    const dateA = getUploadDate(a);
    const dateB = getUploadDate(b);
    return dateB.localeCompare(dateA);
  });

  // 성과 입력 대기 체크 (업로드 후 2주 지남 + 성과 데이터 없음) — 전체 콘텐츠 대상
  const nowDate = new Date();
  const needsPerfList = contentsData.contents.filter(c => {
    if (c.status !== '업로드완료') return false;
    if (c.perfReminderDismissed) return false;
    const d = getUploadDate(c);
    if (!d) return false;
    const uploadDate = new Date(d);
    const twoWeeksLater = new Date(uploadDate);
    twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);
    const hasPerf = c.performance && (c.performance.views || c.performance.likes || c.performance.saves);
    return nowDate >= twoWeeksLater && !hasPerf;
  });
  const needsPerfIds = new Set(needsPerfList.map(c => c.id));

  // Daily follower data
  const dailyData = performanceData.follower?.history?.daily || [];
  const maxDailyChange = dailyData.length > 0 ? Math.max(...dailyData.map(d => d.change)) : 0;

  // Monthly follower data
  const monthlyData = performanceData.follower?.history?.monthly || [];
  const maxMonthlyChange = monthlyData.length > 0 ? Math.max(...monthlyData.map(d => d.change)) : 0;

  const today = new Date().toISOString().slice(0, 10);

  // 현재 팔로워 / 오늘 증가 / 이번 주 증가 계산
  const sortedDailyAsc = [...dailyData].sort((a, b) => a.date.localeCompare(b.date));
  const latestFollowerEntry = sortedDailyAsc[sortedDailyAsc.length - 1];
  const currentFollowerCount = latestFollowerEntry?.count ?? performanceData.follower?.current ?? 0;
  const latestDateStr = latestFollowerEntry?.date ? latestFollowerEntry.date.slice(5).replace('-', '/') : '';
  const todayEntry = sortedDailyAsc.find(d => d.date === today);
  const todayChange = todayEntry ? todayEntry.change : 0;
  const todayHasEntry = !!todayEntry;
  const sevenDaysAgoDate = new Date();
  sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 6);
  const sevenDaysAgoStr = sevenDaysAgoDate.toISOString().slice(0, 10);
  const weekChange = sortedDailyAsc
    .filter(d => d.date >= sevenDaysAgoStr && d.date <= today)
    .reduce((sum, d) => sum + d.change, 0);

  document.getElementById('performance-content').innerHTML = `
    <div class="flex gap-5 mb-6 border-b border-botanical-stone/40">
      <button onclick="switchPerfTab('detail')" id="perf-tab-detail" class="perf-tab-btn pb-2 text-[13px] border-b-2 -mb-px ${perfSubTab === 'detail' ? 'border-botanical-terracotta text-botanical-terracotta font-bold' : 'border-transparent text-botanical-sage font-medium hover:text-botanical-fg'}">월 상세</button>
      <button onclick="switchPerfTab('compare')" id="perf-tab-compare" class="perf-tab-btn pb-2 text-[13px] border-b-2 -mb-px ${perfSubTab === 'compare' ? 'border-botanical-terracotta text-botanical-terracotta font-bold' : 'border-transparent text-botanical-sage font-medium hover:text-botanical-fg'}">월간 비교</button>
      <button onclick="switchPerfTab('mediakit')" id="perf-tab-mediakit" class="perf-tab-btn pb-2 text-[13px] border-b-2 -mb-px ${perfSubTab === 'mediakit' ? 'border-botanical-terracotta text-botanical-terracotta font-bold' : 'border-transparent text-botanical-sage font-medium hover:text-botanical-fg'}">미디어킷</button>
    </div>

    <div id="perf-detail" class="perf-section ${perfSubTab === 'detail' ? '' : 'hidden'}">
      <!-- Month Selector -->
      <div class="flex items-center gap-3 mb-6">
        ${renderMonthSelect('perf-month-select', perfSelectedMonth, 'changePerfMonth')}
      </div>

      <!-- Month Summary -->
      <div class="bg-white rounded-2xl p-6 shadow-sm mb-6">
        <h3 class="font-medium mb-4">${monthNum}월 성과 요약</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="text-center">
            <p class="text-xl font-semibold">${(monthPerf.totalContents || 0).toLocaleString()}</p>
            <p class="text-xs text-botanical-sage">총 콘텐츠</p>
          </div>
          <div class="text-center">
            <p class="text-xl font-semibold">${toK(monthPerf.totalViews, 0)}</p>
            <p class="text-xs text-botanical-sage">총 조회수</p>
          </div>
          <div class="text-center">
            <p class="text-xl font-semibold">${(monthPerf.totalSaves || 0).toLocaleString()}</p>
            <p class="text-xs text-botanical-sage">총 저장</p>
          </div>
          <div class="text-center">
            <p class="text-xl font-semibold">${Math.round(monthPerf.avgSaveRate || 0)}%</p>
            <p class="text-xs text-botanical-sage">평균 저장률</p>
          </div>
        </div>
      </div>

      <!-- 성과 입력 대기 알림 배너 -->
      ${needsPerfList.length > 0 ? `
      <div class="bg-botanical-terracotta/10 border border-botanical-terracotta/40 rounded-xl px-4 py-3 mb-4">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-lg leading-none">🔔</span>
          <p class="font-medium text-botanical-terracotta">성과 입력 대기 ${needsPerfList.length}건</p>
        </div>
        <p class="text-xs text-botanical-sage mb-2">업로드 후 2주 지난 콘텐츠의 성과를 입력해주세요.</p>
        <div class="space-y-1">
          ${needsPerfList.map(c => `
          <div class="flex items-center justify-between gap-2 bg-white/60 rounded-lg pl-3 pr-1.5 py-1.5">
            <span onclick="goToContentExpanded(${c.id})" class="text-xs text-botanical-fg cursor-pointer hover:text-botanical-terracotta hover:underline truncate">${c.title || '무제'}</span>
            <button onclick="dismissPerfReminder(${c.id})" title="이 항목 알림 끄기" class="shrink-0 w-5 h-5 rounded-full text-botanical-sage hover:bg-botanical-terracotta/20 hover:text-botanical-terracotta flex items-center justify-center text-xs leading-none transition-all">✕</button>
          </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Content Performance Input -->
      <div class="bg-white rounded-2xl p-6 shadow-sm mb-6">
        <h3 class="font-medium mb-4">콘텐츠별 성과 입력</h3>

        <!-- PC: 테이블 -->
        <div class="hidden md:block border border-botanical-stone rounded-xl overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="bg-botanical-cream/50">
                <th class="px-3 py-2 text-left font-medium whitespace-nowrap w-20">카테고리</th>
                <th class="px-3 py-2 text-left font-medium">제목</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-16">업로드일</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-16">조회</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-16">좋아요</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-14">공유</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-14">댓글</th>
                <th class="px-3 py-2 text-center font-medium whitespace-nowrap w-14">저장</th>
              </tr>
            </thead>
            <tbody>
              ${monthContents.length > 0 ? monthContents.map(c => {
                const catColor = categoryColors[c.category] || '#8C9A84';
                const needs = needsPerfIds.has(c.id);
                return `
                <tr data-perf-row="${c.id}" class="border-t border-botanical-stone hover:bg-botanical-cream/30 transition-all ${needs ? 'bg-botanical-terracotta/5' : ''}">
                  <td class="px-3 py-2">
                    <span class="flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full flex-shrink-0" style="background-color: ${catColor};"></span>
                      <span class="text-botanical-sage truncate">${c.category}</span>
                    </span>
                  </td>
                  <td class="px-3 py-2">
                    <span class="flex items-center gap-1.5 whitespace-nowrap">
                      ${needs ? '<span title="성과 입력 필요">🔔</span>' : ''}
                      <span onclick="goToContentExpanded(${c.id})" class="cursor-pointer hover:text-botanical-terracotta hover:underline">${c.title || '무제'}</span>
                    </span>
                  </td>
                  <td class="px-3 py-2 text-center text-botanical-sage">${getUploadDate(c) ? getUploadDate(c).slice(5).replace('-', '/') : '-'}</td>
                  <td class="px-3 py-2"><input type="text" onchange="savePerfCell(this, ${c.id}, 'views')" value="${c.performance.views ? c.performance.views.toLocaleString() : ''}" placeholder="-" class="w-full text-center bg-transparent border-b border-transparent hover:border-botanical-stone focus:border-botanical-sage focus:outline-none"></td>
                  <td class="px-3 py-2"><input type="text" onchange="savePerfCell(this, ${c.id}, 'likes')" value="${c.performance.likes ? c.performance.likes.toLocaleString() : ''}" placeholder="-" class="w-full text-center bg-transparent border-b border-transparent hover:border-botanical-stone focus:border-botanical-sage focus:outline-none"></td>
                  <td class="px-3 py-2"><input type="text" onchange="savePerfCell(this, ${c.id}, 'shares')" value="${c.performance.shares ? c.performance.shares.toLocaleString() : ''}" placeholder="-" class="w-full text-center bg-transparent border-b border-transparent hover:border-botanical-stone focus:border-botanical-sage focus:outline-none"></td>
                  <td class="px-3 py-2"><input type="text" onchange="savePerfCell(this, ${c.id}, 'comments')" value="${c.performance.comments ? c.performance.comments.toLocaleString() : ''}" placeholder="-" class="w-full text-center bg-transparent border-b border-transparent hover:border-botanical-stone focus:border-botanical-sage focus:outline-none"></td>
                  <td class="px-3 py-2"><input type="text" onchange="savePerfCell(this, ${c.id}, 'saves')" value="${c.performance.saves ? c.performance.saves.toLocaleString() : ''}" placeholder="-" class="w-full text-center bg-transparent border-b border-transparent hover:border-botanical-stone focus:border-botanical-sage focus:outline-none"></td>
                </tr>
              `;}).join('') : '<tr><td colspan="8" class="px-3 py-4 text-center text-botanical-sage">해당 월 콘텐츠 없음</td></tr>'}
            </tbody>
          </table>
        </div>

        <!-- 모바일: 2줄 카드 -->
        <div class="md:hidden space-y-3">
          ${monthContents.length > 0 ? monthContents.map(c => {
            const catColor = categoryColors[c.category] || '#8C9A84';
            const needs = needsPerfIds.has(c.id);
            return `
            <div data-perf-row="${c.id}" class="border border-botanical-stone rounded-xl p-3 ${needs ? 'bg-botanical-terracotta/5' : 'bg-white'}">
              <div class="flex items-center gap-2 mb-2 text-xs flex-wrap">
                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full flex-shrink-0" style="background-color: ${catColor};"></span><span class="text-botanical-sage">${c.category}</span></span>
                <span onclick="goToContentExpanded(${c.id})" class="font-medium flex-1 min-w-0 truncate cursor-pointer hover:text-botanical-terracotta hover:underline">${needs ? '🔔 ' : ''}${c.title || '무제'}</span>
                <span class="text-botanical-sage text-[10px]">${getUploadDate(c) ? getUploadDate(c).slice(5).replace('-', '/') : '-'}</span>
              </div>
              <div class="grid grid-cols-5 gap-1 text-center text-xs">
                <div><p class="text-[10px] text-botanical-sage mb-0.5">조회</p><input type="text" onchange="savePerfCell(this, ${c.id}, 'views')" value="${c.performance.views ? c.performance.views.toLocaleString() : ''}" placeholder="-" class="w-full text-center px-1 py-1 rounded border border-botanical-stone focus:border-botanical-sage focus:outline-none"></div>
                <div><p class="text-[10px] text-botanical-sage mb-0.5">좋아요</p><input type="text" onchange="savePerfCell(this, ${c.id}, 'likes')" value="${c.performance.likes ? c.performance.likes.toLocaleString() : ''}" placeholder="-" class="w-full text-center px-1 py-1 rounded border border-botanical-stone focus:border-botanical-sage focus:outline-none"></div>
                <div><p class="text-[10px] text-botanical-sage mb-0.5">공유</p><input type="text" onchange="savePerfCell(this, ${c.id}, 'shares')" value="${c.performance.shares ? c.performance.shares.toLocaleString() : ''}" placeholder="-" class="w-full text-center px-1 py-1 rounded border border-botanical-stone focus:border-botanical-sage focus:outline-none"></div>
                <div><p class="text-[10px] text-botanical-sage mb-0.5">댓글</p><input type="text" onchange="savePerfCell(this, ${c.id}, 'comments')" value="${c.performance.comments ? c.performance.comments.toLocaleString() : ''}" placeholder="-" class="w-full text-center px-1 py-1 rounded border border-botanical-stone focus:border-botanical-sage focus:outline-none"></div>
                <div><p class="text-[10px] text-botanical-sage mb-0.5">저장</p><input type="text" onchange="savePerfCell(this, ${c.id}, 'saves')" value="${c.performance.saves ? c.performance.saves.toLocaleString() : ''}" placeholder="-" class="w-full text-center px-1 py-1 rounded border border-botanical-stone focus:border-botanical-sage focus:outline-none"></div>
              </div>
            </div>
          `;}).join('') : '<p class="text-sm text-botanical-sage text-center py-4">해당 월 콘텐츠 없음</p>'}
        </div>
      </div>

      <!-- Follower Trend -->
      <div class="bg-white rounded-2xl p-6 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-medium">${monthNum}월 팔로워 추이</h3>
          <div class="flex gap-2 items-center">
            <button onclick="switchFollowerView('daily')" id="follower-view-daily" class="follower-view-btn px-3 py-1 rounded-full text-xs ${followerViewMode === 'daily' ? 'bg-botanical-sage text-white' : 'border border-botanical-stone hover:bg-botanical-cream'}">일간</button>
            <button onclick="switchFollowerView('weekly')" id="follower-view-weekly" class="follower-view-btn px-3 py-1 rounded-full text-xs ${followerViewMode === 'weekly' ? 'bg-botanical-sage text-white' : 'border border-botanical-stone hover:bg-botanical-cream'}">주간</button>
          </div>
        </div>

        <!-- 팔로워 입력 -->
        <div class="p-3 md:p-4 bg-botanical-cream/30 rounded-xl mb-4 border border-botanical-stone">
          <div class="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
            <div class="flex items-center gap-2 md:gap-4">
              <span class="text-sm font-medium whitespace-nowrap">팔로워 입력</span>
              <input type="date" id="follower-date" value="${today}" class="flex-1 md:flex-none px-3 py-1.5 rounded-lg border border-botanical-stone bg-white text-sm focus:outline-none focus:border-botanical-sage">
            </div>
            <div class="flex items-center gap-2">
              <input type="number" id="follower-count" placeholder="팔로워 수" class="flex-1 md:w-32 md:flex-none min-w-0 px-3 py-1.5 rounded-lg border border-botanical-stone bg-white text-sm focus:outline-none focus:border-botanical-sage">
              <button onclick="saveFollowerCount()" class="px-4 py-1.5 bg-botanical-sage text-white rounded-lg text-sm font-medium hover:bg-botanical-fg transition-all whitespace-nowrap shrink-0">저장</button>
            </div>
          </div>
        </div>

        <!-- Summary Cards: 오늘 증가 제거 -->
        ${(() => {
          // 이번 달 증가 계산 (선택된 월의 daily 데이터 합산)
          const monthChange = dailyData
            .filter(d => d.date.startsWith(perfSelectedMonth))
            .reduce((sum, d) => sum + (d.change || 0), 0);
          return `
            <div class="grid grid-cols-3 gap-4 mb-6">
              <div class="p-4 bg-botanical-sage/10 rounded-xl text-center">
                <p class="text-2xl font-semibold text-botanical-fg">${currentFollowerCount.toLocaleString()}</p>
                <p class="text-xs text-botanical-sage break-keep">현재 팔로워</p>
              </div>
              <div class="p-4 bg-botanical-cream/30 rounded-xl text-center">
                <p class="text-2xl font-semibold ${weekChange > 0 ? 'text-green-600' : (weekChange < 0 ? 'text-red-500' : 'text-botanical-sage')}">${weekChange > 0 ? '+' : ''}${weekChange.toLocaleString()}</p>
                <p class="text-xs text-botanical-sage">최근 7일 증가</p>
              </div>
              <div class="p-4 bg-botanical-cream/30 rounded-xl text-center">
                <p class="text-2xl font-semibold ${monthChange > 0 ? 'text-green-600' : (monthChange < 0 ? 'text-red-500' : 'text-botanical-sage')}">${monthChange > 0 ? '+' : ''}${monthChange.toLocaleString()}</p>
                <p class="text-xs text-botanical-sage">이번 달 증가</p>
              </div>
            </div>
          `;
        })()}

        <!-- Daily Graph — 최근 7일 데이터 표시 (월 상관없이) -->
        <div id="follower-graph-daily" class="${followerViewMode === 'daily' ? '' : 'hidden'}">
          <p class="text-xs text-botanical-sage mb-3">최근 7일 팔로워 추이</p>
          ${(() => {
            // 전체 일별 데이터를 날짜 맵으로
            const dateMap = {};
            dailyData.forEach(d => { dateMap[d.date] = d; });

            // 오늘 기준 최근 7일 날짜 생성 (로컬 시간 기준 — toISOString은 UTC라 새벽에 어제로 밀리는 버그)
            const fmtLocal = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            const today = new Date();
            const allDays = [];
            for (let i = 6; i >= 0; i--) {
              const d = new Date(today);
              d.setDate(d.getDate() - i);
              const dateStr = fmtLocal(d);
              const data = dateMap[dateStr];
              allDays.push({
                date: dateStr,
                count: data?.count ?? null,
                change: data?.change ?? 0
              });
            }

            const days = allDays;
            const validCounts = days.filter(d => d.count != null).map(d => d.count);
            const maxCount = Math.max(0, ...validCounts);
            const minCount = validCounts.length > 0 ? Math.min(...validCounts) : 0;
            const range = maxCount - minCount;
            const maxChange = Math.max(0, ...days.map(d => d.change ?? 0));
            return `
              <div class="grid grid-cols-7 gap-1 md:gap-3 px-1 md:px-4">
                ${days.map(d => {
                  // 막대 높이는 해당 날짜 팔로워 수 기준 (데이터 하나면 100%, 여러 개면 min~max 범위로)
                  const h = d.count == null ? 0 : (range === 0 ? 100 : 10 + ((d.count - minCount) / range) * 90);
                  const isMax = d.change > 0 && d.change === maxChange;
                  const color = d.count == null ? '#E5E7EB' : (isMax ? '#C27B66' : '#8C9A84');
                  const dateLabel = d.date.slice(5).replace('-', '/');
                  const countLabel = d.count == null ? '-' : d.count.toLocaleString();
                  const changeLabel = d.count == null ? '' : (d.change >= 0 ? `+${d.change}` : `${d.change}`);
                  // 막대와 라벨을 같은 그리드 칸에 — 줄이 달라서 어긋나던 정렬 문제 해결
                  return `
                    <div class="flex flex-col items-center min-w-0">
                      <div class="w-full flex items-end justify-center" style="height: 120px;">
                        <div class="rounded-t w-full max-w-[28px]" style="height: ${h}px; background-color: ${color};"></div>
                      </div>
                      <div class="text-center leading-tight mt-2 w-full min-w-0">
                        <div class="text-[10px] md:text-xs text-botanical-sage">${dateLabel}</div>
                        <div class="text-[10px] md:text-xs font-semibold text-botanical-fg">${countLabel}</div>
                        <div class="text-[10px] md:text-[11px] ${d.change > 0 ? (isMax ? 'text-botanical-terracotta' : 'text-green-600') : 'text-botanical-sage'}">${changeLabel}</div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          })()}
        </div>

        <!-- Weekly Graph -->
        <div id="follower-graph-weekly" class="${followerViewMode === 'weekly' ? '' : 'hidden'}">
          <p class="text-xs text-botanical-sage mb-3">${monthNum}월 주차별 팔로워 증가</p>
          ${(() => {
            // 선택된 월의 주차별 팔로워 증가 및 마지막 날 전체수 계산
            const weeklyChanges = [0, 0, 0, 0, 0]; // 최대 5주차까지
            const weeklyLastCount = [0, 0, 0, 0, 0]; // 주차별 마지막 날 전체 팔로워
            const monthDays = dailyData.filter(d => d.date.startsWith(perfSelectedMonth)).sort((a, b) => a.date.localeCompare(b.date));
            monthDays.forEach(d => {
              const day = parseInt(d.date.slice(8, 10));
              const weekIdx = Math.floor((day - 1) / 7); // 0-4
              if (weekIdx < 5) {
                weeklyChanges[weekIdx] += d.change || 0;
                weeklyLastCount[weekIdx] = d.count || 0; // 마지막 날짜로 업데이트
              }
            });
            const maxCount = Math.max(1, ...weeklyLastCount);
            return `
              <div class="flex items-end justify-between gap-4 px-4" style="height: 120px;">
                ${weeklyChanges.slice(0, 4).map((change, idx) => {
                  const count = weeklyLastCount[idx];
                  const height = count > 0 ? (count / maxCount * 100) : 0;
                  const color = count > 0 ? '#8C9A84' : '#E5E7EB';
                  return `
                    <div class="flex-1 flex flex-col items-center justify-end" style="height: 120px;">
                      <div class="w-full rounded-t" style="height: ${height}px; background-color: ${color};"></div>
                    </div>
                  `;
                }).join('')}
              </div>
              <div class="flex justify-between gap-4 px-4 mt-2">
                ${weeklyChanges.slice(0, 4).map((change, idx) => {
                  // 주차별 날짜 범위 계산
                  const startDay = idx * 7 + 1;
                  const endDay = Math.min((idx + 1) * 7, new Date(perfSelectedMonth.slice(0, 4), parseInt(perfSelectedMonth.slice(5)), 0).getDate());
                  const dateRange = `${monthNum}/${startDay}-${endDay}`;
                  const count = weeklyLastCount[idx];
                  const countLabel = count > 0 ? count.toLocaleString() : '-';
                  const changeLabel = change > 0 ? `+${change}` : (change < 0 ? `${change}` : '0');
                  return `
                    <div class="flex-1 text-center">
                      <span class="text-xs text-botanical-sage">${dateRange}</span><br>
                      <span class="text-xs font-semibold">${countLabel}</span><br>
                      <span class="text-xs ${change > 0 ? 'text-green-600' : (change < 0 ? 'text-red-500' : 'text-botanical-sage')}">${count > 0 ? changeLabel : ''}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          })()}
        </div>
      </div>
    </div>

    <div id="perf-compare" class="perf-section ${perfSubTab === 'compare' ? '' : 'hidden'}">
      <!-- Year Selector (시작월 2026-04 ~ 오늘 연도까지 동적 생성) -->
      <div class="flex items-center gap-3 mb-6">
        <select id="perf-year-select" onchange="changePerfYear(this.value)" class="px-4 py-2 pr-8 rounded-full border border-botanical-stone bg-white text-sm focus:outline-none appearance-none bg-no-repeat" style="background-image: url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%238C9A84%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E'); background-position: right 12px center;">
          ${getYearOptions().map(y => `<option value="${y}" ${perfSelectedYear === y ? 'selected' : ''}>${y}년</option>`).join('')}
        </select>
      </div>

      <!-- 월간 트렌드 (막대 그래프, 12개월 한눈에) -->
      <div class="bg-white rounded-2xl p-6 shadow-sm mb-6">
        <h3 class="font-medium mb-4">팔로워 월간 트렌드</h3>
        ${(() => {
          const yearStr = String(perfSelectedYear);
          const yearMonths = [];
          for (let m = 1; m <= 12; m++) {
            const monthKey = `${yearStr}-${String(m).padStart(2, '0')}`;
            const monthData = monthlyData.find(d => d.month === monthKey);
            const monthDailyData = dailyData.filter(d => d.date.startsWith(monthKey));
            const lastDay = monthDailyData.sort((a, b) => b.date.localeCompare(a.date))[0];
            const totalFollowers = lastDay?.count || 0;
            const change = monthData?.change || 0;
            const daysInMonth = new Date(perfSelectedYear, m, 0).getDate();
            const dailyAvg = change !== 0 ? Math.round(change / daysInMonth) : 0;
            yearMonths.push({ month: m, monthKey, totalFollowers, change, dailyAvg, hasData: totalFollowers > 0 || change !== 0 });
          }
          const hasAnyData = yearMonths.some(m => m.hasData);
          if (!hasAnyData) return `<p class="text-sm text-botanical-sage text-center py-8">팔로워 데이터가 없습니다</p>`;
          const maxFollowers = Math.max(...yearMonths.map(m => m.totalFollowers), 1);
          const isPC = window.innerWidth >= 768;
          const barMaxHeight = isPC ? 160 : 80;
          const fontSize = isPC ? '14px' : '10px';
          const smallFontSize = isPC ? '12px' : '9px';
          const barMaxWidth = isPC ? '40px' : '20px';
          return `
            <div style="display: grid; grid-template-columns: repeat(12, 1fr); gap: ${isPC ? '8px' : '4px'};">
              ${yearMonths.map(m => {
                const barHeight = m.hasData ? Math.max((m.totalFollowers / maxFollowers) * barMaxHeight, 8) : 0;
                const isCurrentMonth = m.monthKey === perfSelectedMonth;
                const barColor = isCurrentMonth ? '#C17F59' : '#8C9A84';
                return `
                  <div style="display: flex; flex-direction: column; align-items: center;">
                    <div style="width: 100%; height: ${barMaxHeight}px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 4px;">
                      ${m.hasData ? `<div style="width: 100%; max-width: ${barMaxWidth}; height: ${barHeight}px; background-color: ${barColor}; border-radius: 3px 3px 0 0;"></div>` : ''}
                    </div>
                    <div style="font-size: ${fontSize}; ${isCurrentMonth ? 'font-weight: 700; color: #2D3A31;' : 'color: #8C9A84;'}">${m.month}월</div>
                    ${m.hasData ? `
                      <div style="font-size: ${fontSize}; font-weight: 500; color: #2D3A31;">${(m.totalFollowers/1000).toFixed(1)}k</div>
                      <div style="font-size: ${smallFontSize}; color: ${m.change > 0 ? '#059669' : '#8C9A84'};">${m.change > 0 ? '+' : ''}${m.change.toLocaleString()}</div>
                    ` : `<div style="font-size: ${fontSize}; color: rgba(140,154,132,0.5);">-</div>`}
                  </div>
                `;
              }).join('')}
            </div>
          `;
        })()}
      </div>

      <!-- 월간 콘텐츠 성과 비교 -->
      <div class="bg-white rounded-2xl p-4 md:p-6 shadow-sm mb-6">
        <h3 class="font-medium mb-4">월간 콘텐츠 성과 비교</h3>
        <div class="border border-botanical-stone rounded-xl overflow-hidden">
          <table class="w-full text-xs md:text-base" style="table-layout: fixed;">
            <thead>
              <tr class="bg-botanical-cream/50">
                <th class="px-1 md:px-4 py-2 md:py-3 text-left font-medium" style="width: 13%;">월</th>
                <th class="px-1 md:px-4 py-2 md:py-3 text-center font-medium" style="width: 18%;">조회</th>
                <th class="px-1 md:px-4 py-2 md:py-3 text-center font-medium" style="width: 18%;">저장</th>
                <th class="px-1 md:px-4 py-2 md:py-3 text-center font-medium" style="width: 18%;">공유</th>
                <th class="px-1 md:px-4 py-2 md:py-3 text-center font-medium" style="width: 16%;">저장%</th>
                <th class="px-1 md:px-4 py-2 md:py-3 text-center font-medium" style="width: 17%;">공유%</th>
              </tr>
            </thead>
            <tbody>
              ${Object.keys(performanceData.monthly || {}).length > 0 ?
                Object.entries(performanceData.monthly).filter(([m]) => m.startsWith(String(perfSelectedYear))).reverse().map(([month, data], idx) => {
                  const totalViews = data.totalViews || 0;
                  const totalSaves = data.totalSaves || 0;
                  const totalShares = data.totalShares || 0;
                  const saveRate = totalViews > 0 ? ((totalSaves / totalViews) * 100).toFixed(1) : '-';
                  const shareRate = totalViews > 0 ? ((totalShares / totalViews) * 100).toFixed(1) : '-';
                  return `
                  <tr class="border-t border-botanical-stone ${idx === 0 ? 'bg-botanical-terracotta/5' : ''}">
                    <td class="px-1 md:px-4 py-2 md:py-4 font-semibold">${month.slice(5)}월</td>
                    <td class="px-1 md:px-4 py-2 md:py-4 text-center">${toK(totalViews)}</td>
                    <td class="px-1 md:px-4 py-2 md:py-4 text-center">${toK(totalSaves)}</td>
                    <td class="px-1 md:px-4 py-2 md:py-4 text-center">${toK(totalShares)}</td>
                    <td class="px-1 md:px-4 py-2 md:py-4 text-center">${saveRate !== '-' ? saveRate : '-'}</td>
                    <td class="px-1 md:px-4 py-2 md:py-4 text-center">${shareRate !== '-' ? shareRate : '-'}</td>
                  </tr>
                `;
                }).join('') :
                `<tr><td colspan="6" class="px-4 py-4 text-center text-botanical-sage">데이터가 없습니다</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Media Kit Sub-tab -->
    <div id="perf-mediakit" class="perf-section ${perfSubTab === 'mediakit' ? '' : 'hidden'}">
      <div class="bg-white rounded-2xl p-6 shadow-sm">
        <h3 class="font-medium mb-4">미디어킷</h3>
        <div class="grid md:grid-cols-2 gap-4">
          <div class="border border-botanical-stone rounded-xl p-5 bg-botanical-cream/30">
            <div class="flex items-center gap-2 mb-3 font-medium">🇰🇷 한국어 버전</div>
            <div class="flex flex-col gap-2 md:flex-row md:flex-wrap">
              <a href="mediakit/index.html" target="_blank" class="w-full md:w-auto text-center px-4 py-2 rounded-lg text-sm font-medium border border-botanical-sage text-botanical-fg hover:bg-botanical-cream transition-all">👁️ 미리보기</a>
              <button onclick="copyMediakitLink('ko')" class="w-full md:w-auto px-4 py-2 rounded-lg text-sm font-medium border-2 border-botanical-terracotta text-botanical-terracotta hover:bg-botanical-cream transition-all">🔗 링크 복사</button>
              <button onclick="downloadMediakitPdf('ko')" class="w-full md:w-auto px-4 py-2 rounded-lg text-sm font-medium bg-botanical-fg text-white hover:opacity-90 transition-all">⬇️ PDF 다운로드</button>
            </div>
          </div>
          <div class="border border-botanical-stone rounded-xl p-5 bg-botanical-cream/30">
            <div class="flex items-center gap-2 mb-3 font-medium">🇺🇸 영어 버전 <span class="text-xs text-botanical-sage font-normal">(페이지 내용만 영어)</span></div>
            <div class="flex flex-col gap-2 md:flex-row md:flex-wrap">
              <a href="mediakit/en.html" target="_blank" class="w-full md:w-auto text-center px-4 py-2 rounded-lg text-sm font-medium border border-botanical-sage text-botanical-fg hover:bg-botanical-cream transition-all">👁️ 미리보기</a>
              <button onclick="copyMediakitLink('en')" class="w-full md:w-auto px-4 py-2 rounded-lg text-sm font-medium border-2 border-botanical-terracotta text-botanical-terracotta hover:bg-botanical-cream transition-all">🔗 링크 복사</button>
              <button onclick="downloadMediakitPdf('en')" class="w-full md:w-auto px-4 py-2 rounded-lg text-sm font-medium bg-botanical-fg text-white hover:opacity-90 transition-all">⬇️ PDF 다운로드</button>
            </div>
          </div>
        </div>
      </div>
      <div id="mk-editor" class="mt-4"></div>
    </div>
  `;
}

// ===== 미디어킷 링크/PDF =====
// 브랜드 공유용 공개 주소 (Netlify — dadotbubu 노출 안 됨)
function mediakitUrl(lang) {
  return lang === 'en'
    ? 'https://yudit-mediakit.netlify.app/en.html'
    : 'https://yudit-mediakit.netlify.app/';
}
function copyMediakitLink(lang) {
  const url = mediakitUrl(lang);
  const ok = () => { if (typeof showMemoSaveToast === 'function') showMemoSaveToast('링크 복사됨 ✅'); else alert('링크 복사됨:\n' + url); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(ok).catch(() => prompt('아래 링크를 복사하세요', url));
  } else {
    prompt('아래 링크를 복사하세요', url);
  }
}
function downloadMediakitPdf(lang) {
  // 새 탭에서 열면서 인쇄 대화상자 자동 오픈 → 'PDF로 저장' 선택
  window.open(mediakitUrl(lang) + '?print=1', '_blank');
}

// ===================== 미디어킷 편집기 =====================
function mkKoNum(n){ n=Number(n)||0; if(n>=100000000){var e=Math.floor(n/10000000)/10;return (e%1===0?e:e.toFixed(1))+'억';} var m=Math.floor(n/1000)/10; return (m%1===0?m:m.toFixed(1))+'만'; }
function mkEnNum(n){ n=Number(n)||0; if(n>=1000000){return (n/1000000).toFixed(2).replace(/\.?0+$/,'')+'M';} if(n>=1000){return Math.floor(n/1000)+'K';} return String(n); }
function mkPrev(inp, id){ var el=document.getElementById(id); if(el) el.innerHTML='🇰🇷 '+mkKoNum(inp.value)+' · 🇺🇸 '+mkEnNum(inp.value); }
function mkAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function mkImgSrc(v){ if(!v) return ''; return v.indexOf('data:')===0 ? v : 'mediakit/'+v; }

function mkGet(path){ var o=window._mkEdit, p=path.split('.'); for(var i=0;i<p.length;i++){ var k=/^\d+$/.test(p[i])?+p[i]:p[i]; if(o==null) return undefined; o=o[k]; } return o; }
function mkSet(path, val, isNum){ var o=window._mkEdit, p=path.split('.'); for(var i=0;i<p.length-1;i++){ var k=/^\d+$/.test(p[i])?+p[i]:p[i]; o=o[k]; } var last=/^\d+$/.test(p[p.length-1])?+p[p.length-1]:p[p.length-1]; o[last]= isNum ? (val===''?0:Number(val)) : val; }
function mkSetLines(path, val){ mkSet(path, String(val).split('\n').map(function(s){return s;}).filter(function(s,i,a){return true;})); }
function mkSetCsv(path, val){ mkSet(path, String(val).split(',').map(function(s){return s.trim();}).filter(Boolean)); }
function mkClear(path){ mkSet(path, path.indexOf('images.headerBg')>=0 ? null : ''); renderMediakitEditor(); }

function mkResize(file, maxW, cb){ var rd=new FileReader(); rd.onload=function(){ var img=new Image(); img.onload=function(){ var sc=Math.min(1, maxW/img.width); var w=Math.round(img.width*sc), h=Math.round(img.height*sc); var c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); cb(c.toDataURL('image/jpeg',0.82)); }; img.src=rd.result; }; rd.readAsDataURL(file); }
function mkUpload(path, maxW){ var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=function(){ var f=inp.files&&inp.files[0]; if(!f) return; mkResize(f, maxW||900, function(url){ mkSet(path, url); renderMediakitEditor(); }); }; inp.click(); }

function mkAddTop(){ window._mkEdit.topContent.push({cat:'Career', views:100000, img:''}); renderMediakitEditor(); }
function mkDelTop(i){ window._mkEdit.topContent.splice(i,1); renderMediakitEditor(); }
function mkAddAd(){ if(!window._mkEdit.adCases) window._mkEdit.adCases=[]; window._mkEdit.adCases.push({views:100000, img:'', ko:{title:'',desc:''}, en:{title:'',desc:''}}); renderMediakitEditor(); }
function mkDelAd(i){ window._mkEdit.adCases.splice(i,1); renderMediakitEditor(); }
function mkAddBrand(){ if(!window._mkEdit.brands) window._mkEdit.brands=[]; window._mkEdit.brands.push({ko:'',en:''}); renderMediakitEditor(); }
function mkDelBrand(i){ window._mkEdit.brands.splice(i,1); renderMediakitEditor(); }

function mkFetch(){ return fetch(SUPABASE_URL+'/rest/v1/'+SUPABASE_TABLE+'?key=eq.mediakit&select=data,updated_at&order=updated_at.desc',{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY}}).then(function(r){return r.ok?r.json():[];}).then(function(rows){return rows[0]?rows[0].data:{};}).catch(function(){return {};}); }

async function renderMediakitEditor(reload){
  var root=document.getElementById('mk-editor'); if(!root) return;
  if(reload || !window._mkEdit){ root.innerHTML='<p class="text-sm text-botanical-sage p-4">불러오는 중…</p>'; window._mkEdit = await mkFetch(); mkEnsure(window._mkEdit); }
  root.innerHTML = mkFormHtml(window._mkEdit);
}
// 누락 필드 기본 채움
function mkEnsure(d){
  d.name=d.name||{ko:'유디트',en:'Yudit'}; d.email=d.email||'yudit_@naver.com'; d.ig=d.ig||'https://www.instagram.com/yudit_life/';
  d.images=d.images||{headerBg:null,avatar:'header.jpg'};
  d.tags=d.tags||{ko:[],en:[]}; d.bio=d.bio||{ko:['','',''],en:['','','']};
  d.stats=d.stats||{views30d:0,reach30d:0}; d.gender=d.gender||{female:50,male:50};
  d.age=d.age||[]; d.regions=d.regions||[]; d.topContent=d.topContent||[];
  if(!d.adCases){ d.adCases = d.adCase ? [d.adCase] : []; }
  d.brands=d.brands||[]; d.rates=d.rates||{noteKo:'3.3% 공제',noteEn:'USD',ko:[],en:[]};
}

function mkFormHtml(d){
  var I='class="w-full border border-botanical-stone rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-botanical-sage"';
  var LB='class="block text-xs font-medium text-botanical-sage mb-1 mt-3"';
  function sec(title, inner, open){ return '<details '+(open?'open':'')+' class="bg-white rounded-2xl shadow-sm mb-3 px-5 py-4"><summary class="font-medium cursor-pointer select-none">'+title+'</summary><div class="pt-2">'+inner+'</div></details>'; }
  function imgField(label, path, cur, note){ var src=mkImgSrc(cur); var thumb=src?'<div style="width:56px;height:56px;border-radius:10px;background:url(\''+src+'\') center/cover;border:1px solid #E6E2DA;flex:0 0 auto"></div>':'<div style="width:56px;height:56px;border-radius:10px;background:#F2F0EB;display:flex;align-items:center;justify-content:center;color:#b3afa4;font-size:10px;flex:0 0 auto">없음</div>'; return '<label '+LB+'>'+label+(note?' <span class="text-botanical-sage font-normal">'+note+'</span>':'')+'</label><div class="flex items-center gap-2">'+thumb+'<button onclick="mkUpload(\''+path+'\')" class="px-3 py-1.5 rounded-lg text-sm border border-botanical-sage text-botanical-fg">🖼️ '+(cur?'변경':'올리기')+'</button>'+(cur?'<button onclick="mkClear(\''+path+'\')" class="text-xs text-botanical-sage underline">제거</button>':'')+'</div>'; }

  // 이미지
  var imgSec = imgField('헤더 배경 (네모)', 'images.headerBg', d.images.headerBg, '· 안 올리면 세이지 색') + imgField('프로필 사진 (동그라미)', 'images.avatar', d.images.avatar);

  // 핵심 지표
  var stat =
    '<label '+LB+'>최근 30일 조회수</label><input type="number" '+I+' value="'+(d.stats.views30d||'')+'" oninput="mkPrev(this,\'mkpv-views\')" onchange="mkSet(\'stats.views30d\',this.value,true)"><div class="text-xs text-botanical-sage mt-1" id="mkpv-views">🇰🇷 '+mkKoNum(d.stats.views30d)+' · 🇺🇸 '+mkEnNum(d.stats.views30d)+'</div>' +
    '<label '+LB+'>도달 계정</label><input type="number" '+I+' value="'+(d.stats.reach30d||'')+'" oninput="mkPrev(this,\'mkpv-reach\')" onchange="mkSet(\'stats.reach30d\',this.value,true)"><div class="text-xs text-botanical-sage mt-1" id="mkpv-reach">🇰🇷 '+mkKoNum(d.stats.reach30d)+' · 🇺🇸 '+mkEnNum(d.stats.reach30d)+'</div>' +
    '<p class="text-xs text-botanical-sage mt-3">※ 팔로워는 성과 데이터에서 자동으로 들어가요 (여기서 안 넣어도 돼요)</p>';

  // 소개
  var intro =
    '<label '+LB+'>소개글 (3줄) 🇰🇷</label><textarea '+I+' style="height:78px" onchange="mkSetLines(\'bio.ko\',this.value)">'+mkAttr((d.bio.ko||[]).join('\n'))+'</textarea>' +
    '<label '+LB+'>소개글 🇺🇸 <span class="font-normal">· 강조는 |막대|로 감싸기</span></label><textarea '+I+' style="height:78px" onchange="mkSetLines(\'bio.en\',this.value)">'+mkAttr((d.bio.en||[]).join('\n'))+'</textarea>' +
    '<div class="grid grid-cols-2 gap-3"><div><label '+LB+'>태그 🇰🇷 <span class="font-normal">쉼표로</span></label><input '+I+' value="'+mkAttr((d.tags.ko||[]).join(', '))+'" onchange="mkSetCsv(\'tags.ko\',this.value)"></div><div><label '+LB+'>태그 🇺🇸</label><input '+I+' value="'+mkAttr((d.tags.en||[]).join(', '))+'" onchange="mkSetCsv(\'tags.en\',this.value)"></div></div>' +
    '<label '+LB+'>협업 문의 이메일</label><input '+I+' value="'+mkAttr(d.email)+'" onchange="mkSet(\'email\',this.value)">';

  // 분포
  var dist =
    '<label '+LB+'>여성 %</label><input type="number" step="0.1" '+I+' value="'+d.gender.female+'" onchange="mkSet(\'gender.female\',this.value,true);mkSet(\'gender.male\',(100-Number(this.value)).toFixed(1),true)"><p class="text-xs text-botanical-sage mt-1">남성은 자동 (100-여성)</p>' +
    '<label '+LB+'>연령대 %</label>' + d.age.map(function(a,i){ return '<div class="flex items-center gap-2 mb-1"><span class="text-sm w-16">'+mkAttr(a.label)+'</span><input type="number" step="0.1" '+I+' value="'+a.pct+'" onchange="mkSet(\'age.'+i+'.pct\',this.value,true)"></div>'; }).join('') +
    '<label '+LB+'>지역 (도시명 한/영 + %)</label>' + d.regions.map(function(r,i){ return '<div class="grid grid-cols-3 gap-2 mb-1"><input '+I+' value="'+mkAttr(r.ko)+'" placeholder="서울" onchange="mkSet(\'regions.'+i+'.ko\',this.value)"><input '+I+' value="'+mkAttr(r.en)+'" placeholder="Seoul" onchange="mkSet(\'regions.'+i+'.en\',this.value)"><input type="number" step="0.1" '+I+' value="'+r.pct+'" onchange="mkSet(\'regions.'+i+'.pct\',this.value,true)"></div>'; }).join('');

  // 대표 콘텐츠
  var top = d.topContent.map(function(c,i){ var src=mkImgSrc(c.img); var thumb=src?'background:url(\''+src+'\') center/cover':'background:#F2F0EB';
    return '<div class="border border-botanical-stone rounded-xl p-3 mb-2"><div class="flex items-center gap-3"><div style="width:48px;height:64px;border-radius:8px;'+thumb+';flex:0 0 auto"></div><div class="flex-1"><div class="flex gap-2"><input '+I+' value="'+mkAttr(c.cat)+'" placeholder="Career" onchange="mkSet(\'topContent.'+i+'.cat\',this.value)"><input type="number" '+I+' value="'+(c.views||'')+'" placeholder="조회수" oninput="mkPrev(this,\'mkpv-top'+i+'\')" onchange="mkSet(\'topContent.'+i+'.views\',this.value,true)"></div><div class="text-xs text-botanical-sage mt-1" id="mkpv-top'+i+'">🇰🇷 '+mkKoNum(c.views)+' · 🇺🇸 '+mkEnNum(c.views)+'</div></div></div><div class="flex items-center gap-2 mt-2"><button onclick="mkUpload(\'topContent.'+i+'.img\',700)" class="px-3 py-1 rounded-lg text-xs border border-botanical-sage text-botanical-fg">🖼️ 썸네일 '+(c.img?'변경':'올리기')+'</button><button onclick="mkDelTop('+i+')" class="text-xs text-botanical-terracotta underline ml-auto">삭제</button></div></div>'; }).join('') +
    '<button onclick="mkAddTop()" class="mt-1 px-3 py-2 rounded-lg text-sm border border-botanical-sage text-botanical-fg">＋ 릴스 추가</button>';

  // 광고 성과
  var ads = (d.adCases||[]).map(function(a,i){ var src=mkImgSrc(a.img); var thumb=src?'background:url(\''+src+'\') center/cover':'background:#F2F0EB';
    return '<div class="border border-botanical-stone rounded-xl p-3 mb-2"><div class="flex gap-3"><div style="width:48px;height:64px;border-radius:8px;'+thumb+';flex:0 0 auto"></div><div class="flex-1"><div class="grid grid-cols-2 gap-2"><input '+I+' value="'+mkAttr(a.ko&&a.ko.title)+'" placeholder="제목(한)" onchange="mkSet(\'adCases.'+i+'.ko.title\',this.value)"><input '+I+' value="'+mkAttr(a.en&&a.en.title)+'" placeholder="Title(en)" onchange="mkSet(\'adCases.'+i+'.en.title\',this.value)"><input '+I+' value="'+mkAttr(a.ko&&a.ko.desc)+'" placeholder="설명(한)" onchange="mkSet(\'adCases.'+i+'.ko.desc\',this.value)"><input '+I+' value="'+mkAttr(a.en&&a.en.desc)+'" placeholder="desc(en)" onchange="mkSet(\'adCases.'+i+'.en.desc\',this.value)"></div><input type="number" '+I+' style="margin-top:8px" value="'+(a.views||'')+'" placeholder="조회수" oninput="mkPrev(this,\'mkpv-ad'+i+'\')" onchange="mkSet(\'adCases.'+i+'.views\',this.value,true)"><div class="text-xs text-botanical-sage mt-1" id="mkpv-ad'+i+'">🇰🇷 '+mkKoNum(a.views)+' · 🇺🇸 '+mkEnNum(a.views)+'</div></div></div><div class="flex items-center gap-2 mt-2"><button onclick="mkUpload(\'adCases.'+i+'.img\',700)" class="px-3 py-1 rounded-lg text-xs border border-botanical-sage text-botanical-fg">🖼️ 이미지 '+(a.img?'변경':'올리기')+'</button><button onclick="mkDelAd('+i+')" class="text-xs text-botanical-terracotta underline ml-auto">삭제</button></div></div>'; }).join('') +
    '<p class="text-xs text-botanical-sage mb-2">비어있으면 미디어킷에서 자동 숨김돼요</p><button onclick="mkAddAd()" class="px-3 py-2 rounded-lg text-sm border border-botanical-sage text-botanical-fg">＋ 광고 사례 추가</button>';

  // 협업 브랜드
  var brands = (d.brands||[]).map(function(b,i){ return '<div class="grid grid-cols-2 gap-2 mb-1"><input '+I+' value="'+mkAttr(b.ko||'')+'" placeholder="브랜드(한)" onchange="mkSet(\'brands.'+i+'.ko\',this.value)"><div class="flex gap-2"><input '+I+' value="'+mkAttr(b.en||'')+'" placeholder="Brand(en)" onchange="mkSet(\'brands.'+i+'.en\',this.value)"><button onclick="mkDelBrand('+i+')" class="text-xs text-botanical-terracotta underline">삭제</button></div></div>'; }).join('') +
    '<p class="text-xs text-botanical-sage mb-2">비어있으면 미디어킷에서 자동 숨김돼요</p><button onclick="mkAddBrand()" class="px-3 py-2 rounded-lg text-sm border border-botanical-sage text-botanical-fg">＋ 브랜드 추가</button>';

  // 단가
  function rateRows(lang){ var arr=d.rates[lang]||[]; return arr.map(function(r,i){ return '<div class="grid grid-cols-2 gap-2 mb-1"><input '+I+' value="'+mkAttr(r.label)+'" onchange="mkSet(\'rates.'+lang+'.'+i+'.label\',this.value)"><input '+I+' value="'+mkAttr(r.amount)+'" onchange="mkSet(\'rates.'+lang+'.'+i+'.amount\',this.value)"></div>'; }).join(''); }
  var rate =
    '<label '+LB+'>🇰🇷 단가 (항목 / 금액)</label>'+rateRows('ko') +
    '<label '+LB+'>배지 문구 🇰🇷</label><input '+I+' value="'+mkAttr(d.rates.noteKo)+'" onchange="mkSet(\'rates.noteKo\',this.value)">' +
    '<label '+LB+'>🇺🇸 단가</label>'+rateRows('en') +
    '<label '+LB+'>배지 문구 🇺🇸</label><input '+I+' value="'+mkAttr(d.rates.noteEn)+'" onchange="mkSet(\'rates.noteEn\',this.value)">';

  return '<h3 class="font-medium mb-3 mt-2">미디어킷 업데이트</h3>' +
    sec('📊 핵심 지표', stat, true) +
    sec('✍️ 소개', intro, true) +
    sec('🖼️ 이미지 (헤더배경·프로필)', imgSec, false) +
    sec('👥 팔로워 분포', dist, false) +
    sec('🎬 대표 콘텐츠', top, false) +
    sec('📣 광고 성과 사례', ads, false) +
    sec('🏷️ 협업 브랜드', brands, false) +
    sec('💰 협업 단가', rate, false) +
    '<div class="flex justify-end sticky bottom-3 mt-3"><button onclick="saveMediakit()" class="bg-botanical-fg text-white font-semibold rounded-xl px-7 py-3 shadow-lg">💾 저장</button></div>';
}

async function saveMediakit(){
  try{
    if(typeof updateSaveStatus==='function') updateSaveStatus('saving');
    await upsertToSupabase('mediakit', window._mkEdit);
    if(typeof updateSaveStatus==='function') updateSaveStatus('saved');
    if(typeof showMemoSaveToast==='function') showMemoSaveToast('미디어킷 저장됨 ✅ (링크는 자동 최신)'); else alert('저장됐어요');
  }catch(e){ alert('저장 실패: '+e.message); if(typeof updateSaveStatus==='function') updateSaveStatus('error'); }
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

// 하위 탭 활성 스타일 토글 — 성과·기획 공통 (템플릿 활성 클래스와 동일하게 유지, 드리프트 방지)
function setSubTabActive(btn, on) {
  if (!btn) return;
  const active = ['border-botanical-terracotta', 'text-botanical-terracotta', 'font-bold'];
  const idle = ['border-transparent', 'text-botanical-sage', 'font-medium'];
  btn.classList.add(...(on ? active : idle));
  btn.classList.remove(...(on ? idle : active));
}

function switchPerfTab(tab) {
  perfSubTab = tab;
  document.querySelectorAll('.perf-tab-btn').forEach(btn => setSubTabActive(btn, btn.id === 'perf-tab-' + tab));
  document.querySelectorAll('.perf-section').forEach(s => s.classList.add('hidden'));
  document.getElementById('perf-' + tab).classList.remove('hidden');
  if (tab === 'mediakit') renderMediakitEditor(true);
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

  // at: 입력 시각 — 기기 간 병합 때 같은 날짜면 더 최근 입력이 이김
  const entry = { date, count, change, at: new Date().toISOString() };
  if (existingIdx >= 0) {
    // Update existing entry
    performanceData.follower.history.daily[existingIdx] = entry;
  } else {
    // Add new entry
    performanceData.follower.history.daily.push(entry);
  }

  // Update current follower count
  performanceData.follower.current = count;

  // Update monthly data
  const monthKey = date.slice(0, 7);
  const monthEntries = performanceData.follower.history.daily.filter(d => d.date.startsWith(monthKey));
  const monthChange = monthEntries.reduce((sum, d) => sum + d.change, 0);

  setMonthlyFollowerChange(performanceData, monthKey, monthChange);

  // Clear input
  document.getElementById('follower-count').value = '';

  markDirty('performance');   // ★ 성과 변경 표시 — 없으면 다른 테이블이 dirty일 때 팔로워가 저장에서 누락되어 사라짐
  saveAllData();
  renderPerformance();
}

// 강제 저장 — 디바운스·충돌검사 무시하고 서버에 즉시 push (팔로워 숫자 사라짐 방지용)
function forceSaveNow() {
  try {
    markDirty('performance'); // flush는 dirty 테이블만 보내므로 성과 데이터를 명시적으로 포함
    flushSaveImmediately();
    lastOwnSaveAt = Date.now();
    if (typeof showMemoSaveToast === 'function') showMemoSaveToast('서버에 강제 저장됨 ✅');
    else alert('서버에 강제 저장됨');
  } catch (e) {
    alert('강제 저장 실패: ' + e.message);
  }
}

// ========== Revenue ==========
function changeRevenueMonth(monthStr) {
  revenueSelectedMonth = monthStr;
  renderRevenue();
}

function renderRevenue() {
  const monthlyData = revenueData.monthly || [];
  const revenues = monthlyData.map(m => (m.ad || 0) + (m.sales || 0) + (m.sponsor || 0));
  const maxRevenue = revenues.length > 0 ? Math.max(...revenues) : 0;

  // 이번 달 카드: revenueSelectedMonth 기준
  const revMonth = revenueSelectedMonth;
  const revMonthNum = parseInt(revMonth.slice(5));
  const sumMonth = (type) => (revenueData.items?.[type] || [])
    .filter(i => i.date?.startsWith(revMonth))
    .reduce((s, i) => s + (i.amount || 0), 0);
  const adMonth = sumMonth('ad');
  const salesMonth = sumMonth('sales');
  const sponsorMonth = sumMonth('sponsor');
  const totalMonth = adMonth + salesMonth + sponsorMonth;

  // 연간 누적: 항상 오늘 기준 올해 (1~12월)
  const realYear = new Date().getFullYear();
  const yearStr = String(realYear);
  const sumYear = (type) => (revenueData.items?.[type] || [])
    .filter(i => i.date?.startsWith(yearStr))
    .reduce((s, i) => s + (i.amount || 0), 0);
  const adYear = sumYear('ad');
  const salesYear = sumYear('sales');
  const sponsorYear = sumYear('sponsor');
  const totalYear = adYear + salesYear + sponsorYear;

  document.getElementById('revenue-content').innerHTML = `
    <!-- 월 선택기 -->
    <div class="flex items-center gap-3 mb-6">
      ${renderMonthSelect('revenue-month-select', revenueSelectedMonth, 'changeRevenueMonth')}
      <span class="text-xs text-botanical-sage">${revMonthNum}월 기준 / 연간 누적은 ${realYear}년</span>
    </div>

    <div class="grid grid-cols-2 gap-4 mb-6">
      <div class="bg-white rounded-2xl p-4 shadow-sm border border-botanical-stone">
        <p class="text-sm text-botanical-sage font-medium uppercase mb-1">${revMonthNum}월</p>
        <p class="text-3xl font-semibold"><span class="font-serif">${fmt(totalMonth)}</span><span class="text-lg">원</span></p>
        <div class="flex flex-col md:flex-row gap-2 mt-3">
          <div class="flex-1 p-2 rounded-lg border-l-2 border-botanical-terracotta bg-botanical-cream/30">
            <p class="text-xs text-botanical-sage">광고</p>
            <p class="text-base font-semibold font-serif">${fmt(adMonth)}<span class="text-xs">원</span></p>
          </div>
          <div class="flex-1 p-2 rounded-lg border-l-2 border-botanical-sage bg-botanical-cream/30">
            <p class="text-xs text-botanical-sage">판매</p>
            <p class="text-base font-semibold font-serif">${fmt(salesMonth)}<span class="text-xs">원</span></p>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm border border-botanical-stone">
        <p class="text-sm text-botanical-sage font-medium uppercase mb-1">${realYear}년 누적</p>
        <p class="text-3xl font-semibold"><span class="font-serif">${fmt(totalYear)}</span><span class="text-lg">원</span></p>
        <div class="flex flex-col md:flex-row gap-2 mt-3">
          <div class="flex-1 p-2 rounded-lg border-l-2 border-botanical-terracotta bg-botanical-cream/30">
            <p class="text-xs text-botanical-sage">광고</p>
            <p class="text-base font-semibold font-serif">${fmt(adYear)}<span class="text-xs">원</span></p>
          </div>
          <div class="flex-1 p-2 rounded-lg border-l-2 border-botanical-sage bg-botanical-cream/30">
            <p class="text-xs text-botanical-sage">판매</p>
            <p class="text-base font-semibold font-serif">${fmt(salesYear)}<span class="text-xs">원</span></p>
          </div>
        </div>
      </div>
    </div>

    <!-- Revenue Trend (올해 1~12월) -->
    <div class="bg-white rounded-2xl p-5 shadow-sm mb-6">
      <h4 class="text-base font-semibold mb-4">${realYear}년 수익 <span class="font-serif italic">Trend</span></h4>
      <div class="flex items-end justify-between gap-1" style="height: 120px;">
        ${[1,2,3,4,5,6,7,8,9,10,11,12].map(month => {
          const mStr = `${realYear}-${pad2(month)}`;
          const total = ['ad','sales','sponsor'].reduce((s, t) =>
            s + (revenueData.items?.[t] || [])
              .filter(i => i.date?.startsWith(mStr))
              .reduce((a, i) => a + (i.amount || 0), 0), 0);
          const realNow = new Date();
          const realCurMonth = realNow.getMonth() + 1;
          const isSelectedMonth = realYear === parseInt(revMonth.slice(0,4)) && month === revMonthNum;
          const isFuture = month > realCurMonth;
          const maxRev = Math.max(maxRevenue, 1);
          const height = total > 0 ? Math.max((total / maxRev) * 100, 5) : 0;
          const bgColor = isFuture ? '#E6E2DA' : (isSelectedMonth ? '#C27B66' : 'rgba(193,114,93,0.6)');
          const textColor = isFuture ? 'text-botanical-clay' : (isSelectedMonth ? 'text-botanical-fg font-semibold' : 'text-botanical-sage');
          return `
            <div class="flex-1 flex flex-col items-center gap-1">
              <div class="w-full rounded-t" style="height: ${height}px; background-color: ${bgColor};"></div>
              <span class="text-[10px] ${textColor}">${month}</span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="mt-3 pt-3 border-t border-botanical-stone flex justify-between text-xs">
        <span class="text-botanical-sage">${realYear}년 누적 ${fmt(totalYear)}원</span>
        <span class="text-botanical-terracotta font-medium">기타소득 한도 ${fmt(7500000 - (revenueData.tax?.etc88 || 0))}원 여유</span>
      </div>
    </div>

    <div class="bg-white rounded-2xl p-5 shadow-sm mb-6">
      <p class="text-base font-semibold mb-3">세금 구분 (${realYear}년)</p>
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
  const monthStr = revenueSelectedMonth;
  const yearStr = String(new Date().getFullYear());
  const monthItems = items.filter(item => item.date.startsWith(monthStr));
  const yearItems = items.filter(item => item.date.startsWith(yearStr));

  const colorStyles = {
    'botanical-terracotta': { border: 'border-botanical-terracotta', text: '' },
    'botanical-sage': { border: 'border-botanical-sage', text: '' },
    'botanical-clay': { border: 'border-botanical-clay', text: 'style="color: #C8B6A6;"' }
  };
  const style = colorStyles[color] || colorStyles['botanical-sage'];

  const itemsHtml = items.map(item => {
    const isOld = !item.date.startsWith(monthStr);
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

// ========== Memos ==========
let draggedMemoId = null;
let mobileEditingMemoId = null; // 모바일 인라인 편집 대상

// === 메모 터치 드래그 (iOS Safari가 native HTML5 drag 미지원) ===
let _memoTouchDrag = null;
function onMemoTouchStart(e, id) {
  if (!e.touches?.length) return;
  // preventDefault 제거 - 롱프레스 메뉴 허용
  const itemEl = e.currentTarget.closest('[data-memo-id]');
  if (!itemEl) return;
  _memoTouchDrag = { id, itemEl, targetEl: null, isAfter: false };
  itemEl.classList.add('opacity-40');
}
function onMemoTouchMove(e) {
  if (!_memoTouchDrag || !e.touches?.length) return;
  e.preventDefault();
  const t = e.touches[0];
  const elBelow = document.elementFromPoint(t.clientX, t.clientY);
  const target = elBelow?.closest('[data-memo-id]');
  document.querySelectorAll('[data-memo-id]').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  if (target && target !== _memoTouchDrag.itemEl) {
    const rect = target.getBoundingClientRect();
    const isAfter = (t.clientY - rect.top) > rect.height / 2;
    target.classList.add(isAfter ? 'drop-after' : 'drop-before');
    _memoTouchDrag.targetEl = target;
    _memoTouchDrag.isAfter = isAfter;
  } else {
    _memoTouchDrag.targetEl = null;
  }
}
function onMemoTouchEnd(e) {
  if (!_memoTouchDrag) return;
  const { id, itemEl, targetEl, isAfter } = _memoTouchDrag;
  itemEl.classList.remove('opacity-40');
  document.querySelectorAll('[data-memo-id]').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  _memoTouchDrag = null;
  if (!targetEl) return;
  const targetId = parseInt(targetEl.dataset.memoId);
  if (!targetId || targetId === id) return;
  const arr = memosData.memos;
  const fromIdx = arr.findIndex(m => m.id === id);
  if (fromIdx === -1) return;
  const [moved] = arr.splice(fromIdx, 1);
  let toIdx = arr.findIndex(m => m.id === targetId);
  if (toIdx === -1) { arr.splice(fromIdx, 0, moved); return; }
  if (isAfter) toIdx += 1;
  arr.splice(toIdx, 0, moved);
  saveAllData();
  renderMemos();
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function renderMemos() {
  if (!memosData) memosData = { memos: [] };

  // 탭 초기화
  if (!memosData.tabs || memosData.tabs.length === 0) {
    memosData.tabs = [
      { id: 'tab_plan', name: '기획', order: 0 },
      { id: 'tab_hook', name: '후킹', order: 1 },
      { id: 'tab_memo', name: '노트', order: 2 }
    ];
  }
  if (!memosData.lastActiveTab) memosData.lastActiveTab = 'tab_memo';

  // 탭 정렬
  const sortedTabs = [...memosData.tabs].sort((a, b) => a.order - b.order);
  const activeTabId = memosData.lastActiveTab;

  // tabId 없는 메모는 기본 탭('tab_memo')으로 자동 할당
  const allMemos = memosData.memos || [];
  allMemos.forEach(m => {
    if (!m.tabId) m.tabId = 'tab_memo';
  });
  const memos = allMemos.filter(m => m.tabId === activeTabId);

  if (memos.length === 0) {
    selectedMemoId = null;
    mobileEditingMemoId = null;
  } else if (selectedMemoId != null && !memos.find(m => m.id === selectedMemoId)) {
    selectedMemoId = null;
  }

  // 배열 순서 = 사용자 지정 순서. 핀만 상단 그룹으로 분리
  const pinned = memos.filter(m => m.pinned);
  const unpinned = memos.filter(m => !m.pinned);

  const pinIconSolid = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 9V4l1-1V2H7v1l1 1v5l-2 2v2h5v7l1 1 1-1v-7h5v-2z"/></svg>`;
  const pinIconOutline = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 9V4l1-1V2H7v1l1 1v5l-2 2v2h5v7l1 1 1-1v-7h5v-2z"/></svg>`;
  const gripIcon = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="3" r="1.1"/><circle cx="7" cy="3" r="1.1"/><circle cx="3" cy="7" r="1.1"/><circle cx="7" cy="7" r="1.1"/><circle cx="3" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>`;
  const trashIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>`;

  // === 모바일 리스트 아이템: 클릭 시 인라인 편집으로 전환 ===
  const mobileListItem = (memo) => {
    const isEditing = mobileEditingMemoId === memo.id;
    const title = memo.title?.trim() || '제목 없음';
    const content = memo.content || '';
    const preview = content.split('\n').find(l => l.trim()) || '';
    if (isEditing) {
      return `
        <div class="memo-item relative p-3 rounded-lg bg-amber-100/40 border border-amber-200" data-memo-id="${memo.id}">
          <div class="flex items-center justify-between gap-2 mb-2">
            <button onclick="toggleMemoPin(${memo.id})" title="${memo.pinned ? '고정 해제' : '상단 고정'}" class="shrink-0 ${memo.pinned ? 'text-botanical-terracotta' : 'text-botanical-sage/60'} transition-colors">${memo.pinned ? pinIconSolid : pinIconOutline}</button>
            <div class="flex items-center gap-1">
              <button onclick="copyMemoAll(${memo.id})" class="px-2 py-1 text-xs rounded border border-botanical-stone text-botanical-sage">복사</button>
              <button onclick="moveMemoToTab(${memo.id})" class="px-2 py-1 text-xs rounded border border-botanical-stone text-botanical-sage">이동</button>
              <button onclick="mobileFinishEditMemo()" class="px-2 py-1 text-xs rounded bg-botanical-fg text-white">저장</button>
              <button onclick="deleteMemo(${memo.id})" title="삭제" class="p-1 rounded text-botanical-sage hover:text-red-400">${trashIcon}</button>
            </div>
          </div>
          <input type="text" value="${escapeHtml(memo.title || '')}" placeholder="제목"
                 oninput="onMemoInlineInput(${memo.id}, 'title', this.value)"
                 onpointerdown="onMobileMemoTitleTap(this, event)"
                 class="w-full font-semibold bg-transparent border-b border-botanical-stone focus:border-botanical-sage focus:outline-none pb-1 mb-2"
                 style="font-size: 16px;">
          <textarea placeholder="내용"
                    oninput="autoResize(this); onMemoInlineInput(${memo.id}, 'content', this.value)"
                    class="auto-grow unified-text w-full bg-transparent focus:outline-none resize-none overflow-hidden"
                    style="min-height: 160px;">${escapeHtml(memo.content || '')}</textarea>
          <p class="text-[10px] text-botanical-sage/70 mt-1">입력 중 자동 저장돼요</p>
        </div>
      `;
    }
    return `
      <div class="memo-item relative p-3 rounded-lg transition-colors hover:bg-botanical-cream/40" data-memo-id="${memo.id}">
        <div class="flex items-start gap-2">
          <span ondragstart="onMemoDragStart(event, ${memo.id})" ondragend="onMemoDragEnd(event)" draggable="true"
                ontouchstart="onMemoTouchStart(event, ${memo.id})" ontouchmove="onMemoTouchMove(event)" ontouchend="onMemoTouchEnd(event)" ontouchcancel="onMemoTouchEnd(event)"
                title="드래그로 순서 변경"
                class="shrink-0 self-center text-botanical-sage/40 cursor-grab active:cursor-grabbing px-0.5"
                style="touch-action: none;">${gripIcon}</span>
          <button onclick="event.stopPropagation(); toggleMemoPin(${memo.id})" title="${memo.pinned ? '고정 해제' : '상단 고정'}" class="shrink-0 py-0.5 ${memo.pinned ? 'text-botanical-terracotta' : 'text-botanical-sage/40'} transition-colors">${memo.pinned ? pinIconSolid : pinIconOutline}</button>
          <div class="flex-1 min-w-0 cursor-pointer" onclick="mobileStartEditMemo(${memo.id})">
            <p class="memo-title font-sans font-semibold text-sm truncate ${memo.title?.trim() ? 'text-botanical-fg' : 'text-botanical-sage/60'}">${escapeHtml(title)}</p>
            <p class="memo-preview text-xs text-botanical-sage truncate mt-0.5">${escapeHtml(preview)}</p>
          </div>
        </div>
      </div>
    `;
  };

  // === PC 리스트 아이템: 클릭 시 우측 패널 편집 ===
  const pcListItem = (memo) => {
    const isSel = memo.id === selectedMemoId;
    const title = memo.title?.trim() || '제목 없음';
    const content = memo.content || '';
    const preview = content.split('\n').find(l => l.trim()) || '';
    return `
      <div class="memo-item group relative px-2 py-2 rounded-lg transition-colors cursor-pointer ${isSel ? 'bg-amber-100/70' : 'hover:bg-botanical-cream/40'}"
           data-memo-id="${memo.id}"
           onclick="selectMemoForEdit(${memo.id})"
           ondragover="onMemoDragOver(event, ${memo.id})"
           ondragleave="onMemoDragLeave(event)"
           ondrop="onMemoDrop(event, ${memo.id})">
        <div class="flex items-start gap-1.5">
          <span class="memo-handle text-botanical-sage/40 hover:text-botanical-sage cursor-grab active:cursor-grabbing shrink-0 py-1"
                draggable="true"
                onclick="event.stopPropagation()"
                ondragstart="onMemoDragStart(event, ${memo.id})"
                ondragend="onMemoDragEnd(event)"
                ontouchstart="onMemoTouchStart(event, ${memo.id})"
                ontouchmove="onMemoTouchMove(event)"
                ontouchend="onMemoTouchEnd(event)"
                ontouchcancel="onMemoTouchEnd(event)"
                title="드래그로 순서 변경"
                style="touch-action: none;">${gripIcon}</span>
          <button onclick="event.stopPropagation(); toggleMemoPin(${memo.id})" title="${memo.pinned ? '고정 해제' : '상단 고정'}" class="shrink-0 py-0.5 ${memo.pinned ? 'text-botanical-terracotta' : 'text-botanical-sage/40 hover:text-botanical-sage'} transition-colors">
            ${memo.pinned ? pinIconSolid : pinIconOutline}
          </button>
          <div class="flex-1 min-w-0">
            <p class="memo-title font-sans font-semibold text-sm truncate ${memo.title?.trim() ? 'text-botanical-fg' : 'text-botanical-sage/60'}">${escapeHtml(title)}</p>
            <p class="memo-preview text-xs text-botanical-sage truncate mt-0.5">${escapeHtml(preview)}</p>
          </div>
        </div>
      </div>
    `;
  };

  const selected = memos.find(m => m.id === selectedMemoId);

  // 탭 바 (드래그로 순서 변경, 롱프레스로 수정/삭제)
  const tabBar = `
    <div class="flex items-center gap-1 px-3 py-2 border-b border-botanical-stone bg-botanical-cream/30 overflow-x-auto">
      ${sortedTabs.map(tab => `
        <button onclick="switchMemoTab('${tab.id}')"
                class="px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-all ${tab.id === activeTabId ? 'bg-botanical-fg text-white' : 'text-botanical-sage hover:bg-botanical-stone/30'}">
          ${escapeHtml(tab.name)}
        </button>
      `).join('')}
      <button onclick="openMemoTabEditMode()" title="탭 편집" class="p-1.5 text-botanical-sage hover:text-botanical-fg transition-all">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      </button>
    </div>
  `;

  // 공통 헤더 (카운트 + 새 메모)
  const header = `
    <div class="flex items-center justify-between px-3 py-2">
      <span class="text-sm font-semibold text-botanical-fg">${memos.length}개</span>
      <button onclick="addMemo()" title="새 메모" class="w-7 h-7 rounded-full bg-botanical-fg text-white flex items-center justify-center hover:opacity-90 transition-all">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </div>
  `;

  const emptyList = `
    <p class="text-sm text-botanical-sage px-3 py-6 text-center">아직 메모가 없어요.<br>우상단 + 버튼으로 시작.</p>
  `;

  // === 모바일: 단일 컬럼, 아이템 탭으로 인라인 편집 ===
  const mobileHTML = `
    <div class="md:hidden bg-white rounded-2xl shadow-sm border border-botanical-stone">
      ${tabBar}
      ${header}
      <div class="p-2 space-y-0.5">
        ${memos.length === 0 ? emptyList : `
          ${pinned.length > 0 ? `
            <div class="mb-2">
              <p class="text-xs font-semibold text-botanical-fg px-2 py-1">고정</p>
              <div class="space-y-0.5">${pinned.map(mobileListItem).join('')}</div>
            </div>
          ` : ''}
          ${unpinned.length > 0 ? `
            <div class="space-y-0.5">${unpinned.map(mobileListItem).join('')}</div>
          ` : ''}
        `}
      </div>
    </div>
  `;

  // === PC: 2패널 (좌측 목록 / 우측 편집) ===
  const pcHTML = `
    <div class="hidden md:flex gap-0 bg-white rounded-2xl shadow-sm border border-botanical-stone overflow-hidden" style="height: calc(100vh - 220px); min-height: 500px;">
      <aside class="shrink-0 border-r border-botanical-stone flex flex-col" style="width: 440px;">
        ${tabBar}
        ${header}
        <div class="flex-1 overflow-y-auto p-2">
          ${memos.length === 0 ? emptyList : `
            ${pinned.length > 0 ? `
              <div class="mb-3">
                <p class="text-xs font-semibold text-botanical-fg px-2 py-1">고정</p>
                <div class="space-y-0.5">${pinned.map(pcListItem).join('')}</div>
              </div>
            ` : ''}
            ${unpinned.length > 0 ? `
              <div class="space-y-0.5">${unpinned.map(pcListItem).join('')}</div>
            ` : ''}
          `}
        </div>
      </aside>

      <main class="flex-1 min-w-0 flex flex-col">
        ${!selected ? `
          <div class="flex-1 flex items-center justify-center text-botanical-sage text-sm px-8 text-center">왼쪽 메모를 클릭하면 여기서 바로 편집할 수 있어요</div>
        ` : `
          <div class="flex items-center justify-between px-6 py-3 border-b border-botanical-stone">
            <span class="text-xs text-botanical-sage">편집 중 · 자동 저장</span>
            <div class="flex gap-1">
              <button onclick="moveMemoToTab(${selected.id})" title="탭 이동" class="p-1.5 rounded text-botanical-sage hover:text-botanical-fg transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
              <button onclick="copyMemoAll(${selected.id})" title="전체 복사" class="p-1.5 rounded text-botanical-sage hover:text-botanical-fg transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
              </button>
              <button onclick="toggleMemoPin(${selected.id})" title="${selected.pinned ? '고정 해제' : '상단 고정'}" class="p-1.5 rounded ${selected.pinned ? 'text-botanical-terracotta' : 'text-botanical-sage hover:text-botanical-fg'} transition-all">
                ${selected.pinned ? pinIconSolid : pinIconOutline}
              </button>
              <button onclick="deleteMemo(${selected.id})" title="삭제" class="p-1.5 rounded text-botanical-sage hover:text-red-400 transition-all">
                ${trashIcon}
              </button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto px-6 py-5">
            <input type="text" value="${escapeHtml(selected.title || '')}" placeholder="제목" oninput="updateMemo(${selected.id}, 'title', this.value); updateMemoListItem(${selected.id})" class="w-full font-sans text-2xl font-semibold bg-transparent focus:outline-none mb-3">
            <textarea oninput="updateMemo(${selected.id}, 'content', this.value); updateMemoListItem(${selected.id})" placeholder="내용" class="unified-text w-full bg-transparent focus:outline-none resize-none" style="min-height: 400px;">${escapeHtml(selected.content || '')}</textarea>
          </div>
        `}
      </main>
    </div>
  `;

  document.getElementById('memos-content').innerHTML = renderTemplateSection() + mobileHTML + pcHTML;
  // 자주 쓰는 내용 textarea 자동 높이 (멀티라인 내용도 처음부터 전체 노출)
  requestAnimationFrame(() => {
    document.querySelectorAll('#memos-content textarea.auto-grow').forEach(autoResize);
  });
}

// === 모바일 인라인 편집 ===
let _memoInlineSaveTimer = null;
function mobileStartEditMemo(id) {
  mobileEditingMemoId = id;
  selectedMemoId = id;
  renderMemos();
  requestAnimationFrame(() => {
    const container = document.querySelector(`.md\\:hidden [data-memo-id="${id}"]`);
    const ta = container?.querySelector('textarea');
    if (ta) {
      autoResize(ta); // 진입 즉시 전체 내용 보이도록 높이 맞춤
      ta.focus();
    }
  });
}

function mobileFinishEditMemo() {
  mobileEditingMemoId = null;
  if (_memoInlineSaveTimer) {
    clearTimeout(_memoInlineSaveTimer);
    _memoInlineSaveTimer = null;
  }
  saveAllData(); // 항상 저장
  renderMemos();
}

// 펼친 메모의 제목을 두번째로 탭하면 접기 (첫 탭은 input 포커스)
function onMobileMemoTitleTap(input, e) {
  if (document.activeElement === input) {
    // 이미 포커스 → 접기
    e.preventDefault();
    input.blur();
    mobileFinishEditMemo();
  }
  // 첫 탭은 그냥 포커스 받게 둠
}

function onMemoInlineInput(id, field, value) {
  const memo = memosData?.memos?.find(m => m.id === id);
  if (!memo) return;
  memo[field] = value;
  memo.updatedAt = Date.now();
  // debounce 자동 저장
  if (_memoInlineSaveTimer) clearTimeout(_memoInlineSaveTimer);
  _memoInlineSaveTimer = setTimeout(() => {
    _memoInlineSaveTimer = null;
    saveAllData();
  }, 400);
}

// === PC: 목록 클릭 → 우측 편집 ===
function selectMemoForEdit(id) {
  selectedMemoId = id;
  renderMemos();
  requestAnimationFrame(() => {
    document.querySelector('#memos-content .hidden.md\\:flex main input[type="text"]')?.focus();
  });
}

function showMemoSaveToast(msg = '저장 완료') {
  let toast = document.getElementById('memo-save-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'memo-save-toast';
    toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-full bg-botanical-fg text-white text-sm shadow-lg transition-opacity';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(showMemoSaveToast._t);
  showMemoSaveToast._t = setTimeout(() => { toast.style.opacity = '0'; }, 1500);
}

// 하위 호환: 외부에서 editMemo 호출 가능성 대비
function editMemo(id) {
  if (isMobileViewport()) mobileStartEditMemo(id);
  else selectMemoForEdit(id);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function selectMemo(id) {
  selectedMemoId = id;
  renderMemos();
}

function addMemo() {
  if (!memosData) memosData = { memos: [] };
  if (!memosData.memos) memosData.memos = [];
  const activeTabId = memosData.lastActiveTab || 'tab_memo';
  const now = Date.now();
  const newMemo = { id: now, title: '', content: '', pinned: false, tabId: activeTabId, createdAt: now, updatedAt: now };
  memosData.memos.unshift(newMemo); // 새 메모는 맨 위로
  selectedMemoId = now;
  markDirty('memos');
  saveAllData();
  renderMemos();
  // 제목 input에 포커스
  requestAnimationFrame(() => {
    const input = document.querySelector('#memos-content main input[type="text"]');
    input?.focus();
  });
}

function updateMemo(id, field, value) {
  const memo = memosData?.memos?.find(m => m.id === id);
  if (!memo) return;
  memo[field] = value;
  memo.updatedAt = Date.now();
  markDirty('memos');
  saveAllData();
}

// 좌측 리스트 아이템만 갱신 (타이핑 중 전체 리렌더링 방지)
function updateMemoListItem(id) {
  const memo = memosData?.memos?.find(m => m.id === id);
  if (!memo) return;
  const item = document.querySelector(`[data-memo-id="${id}"]`);
  if (!item) return;
  const titleEl = item.querySelector('.memo-title');
  if (titleEl) {
    const hasTitle = !!memo.title?.trim();
    titleEl.textContent = hasTitle ? memo.title : '제목 없음';
    titleEl.classList.toggle('text-botanical-fg', hasTitle);
    titleEl.classList.toggle('text-botanical-sage/60', !hasTitle);
  }
  const previewEl = item.querySelector('.memo-preview');
  if (previewEl) {
    previewEl.textContent = (memo.content || '').split('\n').find(l => l.trim()) || '';
  }
  const fullEl = item.querySelector('.memo-fullcontent');
  if (fullEl) {
    fullEl.textContent = memo.content || '';
  }
}

// ========== Memo Drag & Drop ==========
function onMemoDragStart(e, id) {
  draggedMemoId = id;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(id)); } catch(_) {}
  const item = e.currentTarget.closest('.memo-item');
  if (item) {
    try { e.dataTransfer.setDragImage(item, 10, 10); } catch(_) {}
    setTimeout(() => item.classList.add('opacity-40'), 0);
  }
  e.stopPropagation();
}
function onMemoDragOver(e, id) {
  if (draggedMemoId == null || draggedMemoId === id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const rect = e.currentTarget.getBoundingClientRect();
  const isAfter = (e.clientY - rect.top) > rect.height / 2;
  e.currentTarget.classList.remove('drop-before', 'drop-after');
  e.currentTarget.classList.add(isAfter ? 'drop-after' : 'drop-before');
}
function onMemoDragLeave(e) {
  e.currentTarget.classList.remove('drop-before', 'drop-after');
}
function onMemoDrop(e, targetId) {
  e.preventDefault();
  const wasAfter = e.currentTarget.classList.contains('drop-after');
  e.currentTarget.classList.remove('drop-before', 'drop-after');
  if (draggedMemoId == null || draggedMemoId === targetId) return;
  const arr = memosData.memos;
  const fromIdx = arr.findIndex(m => m.id === draggedMemoId);
  if (fromIdx === -1) return;
  const [moved] = arr.splice(fromIdx, 1);
  let toIdx = arr.findIndex(m => m.id === targetId);
  if (toIdx === -1) { arr.splice(fromIdx, 0, moved); return; }
  if (wasAfter) toIdx += 1;
  arr.splice(toIdx, 0, moved);
  draggedMemoId = null;
  saveAllData();
  renderMemos();
}
function onMemoDragEnd(e) {
  draggedMemoId = null;
  document.querySelectorAll('.memo-item').forEach(el => {
    el.classList.remove('drop-before', 'drop-after', 'opacity-40');
  });
}

function toggleMemoPin(id) {
  const memo = memosData?.memos?.find(m => m.id === id);
  if (!memo) return;
  memo.pinned = !memo.pinned;
  memo.updatedAt = Date.now();
  saveAllData();
  renderMemos();
}

// === 메모 탭 관련 함수 ===
function switchMemoTab(tabId) {
  memosData.lastActiveTab = tabId;
  selectedMemoId = null;
  mobileEditingMemoId = null;
  saveAllData();
  renderMemos();
}

function addMemoTab() {
  const name = prompt('새 탭 이름을 입력하세요:');
  if (!name || !name.trim()) return;
  const maxOrder = Math.max(0, ...memosData.tabs.map(t => t.order));
  const newTab = { id: 'tab_' + Date.now(), name: name.trim(), order: maxOrder + 1 };
  memosData.tabs.push(newTab);
  memosData.lastActiveTab = newTab.id;
  saveAllData();
  renderMemos();
}

function editMemoTab(tabId) {
  const tab = memosData.tabs.find(t => t.id === tabId);
  if (!tab) return;

  const popup = document.createElement('div');
  popup.id = 'memo-tab-edit-popup';
  popup.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
  popup.innerHTML = `
    <div class="bg-white rounded-2xl p-4 mx-4 max-w-sm w-full shadow-xl">
      <p class="text-sm font-semibold text-botanical-fg mb-3">"${escapeHtml(tab.name)}" 탭 수정</p>
      <div class="space-y-2">
        <button onclick="renameMemoTab('${tabId}')" class="w-full px-4 py-3 rounded-lg bg-botanical-cream text-botanical-fg font-medium text-sm hover:bg-botanical-sage hover:text-white transition-all text-left">
          이름 변경
        </button>
        <button onclick="closeMemoTabEditPopup(); deleteMemoTab('${tabId}')" class="w-full px-4 py-3 rounded-lg bg-red-50 text-red-500 font-medium text-sm hover:bg-red-100 transition-all text-left">
          탭 삭제
        </button>
      </div>
      <button onclick="closeMemoTabEditPopup()" class="mt-3 w-full py-2 text-sm text-botanical-sage hover:text-botanical-fg transition-all">취소</button>
    </div>
  `;
  popup.onclick = (e) => { if (e.target === popup) closeMemoTabEditPopup(); };
  document.body.appendChild(popup);
}

function renameMemoTab(tabId) {
  closeMemoTabEditPopup();
  const tab = memosData.tabs.find(t => t.id === tabId);
  if (!tab) return;

  const newName = prompt('새 탭 이름:', tab.name);
  if (newName && newName.trim() && newName.trim() !== tab.name) {
    tab.name = newName.trim();
    saveAllData();
    renderMemos();
  }
}

function closeMemoTabEditPopup() {
  document.getElementById('memo-tab-edit-popup')?.remove();
}

function moveMemoToTab(memoId) {
  const memo = memosData.memos.find(m => m.id === memoId);
  if (!memo) return;

  const otherTabs = memosData.tabs.filter(t => t.id !== memo.tabId);

  if (otherTabs.length === 0) {
    alert('이동할 다른 탭이 없습니다.');
    return;
  }

  // 팝업 UI 생성
  const popup = document.createElement('div');
  popup.id = 'memo-move-popup';
  popup.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
  popup.innerHTML = `
    <div class="bg-white rounded-2xl p-4 mx-4 max-w-sm w-full shadow-xl">
      <p class="text-sm font-semibold text-botanical-fg mb-3">어디로 이동할까요?</p>
      <div class="flex flex-wrap gap-2">
        ${otherTabs.map(t => `
          <button onclick="confirmMoveMemoToTab(${memoId}, '${t.id}')" class="px-4 py-2 rounded-lg bg-botanical-cream text-botanical-fg font-medium text-sm hover:bg-botanical-sage hover:text-white transition-all">
            ${escapeHtml(t.name)}
          </button>
        `).join('')}
      </div>
      <button onclick="closeMemoMovePopup()" class="mt-3 w-full py-2 text-sm text-botanical-sage hover:text-botanical-fg transition-all">취소</button>
    </div>
  `;
  popup.onclick = (e) => { if (e.target === popup) closeMemoMovePopup(); };
  document.body.appendChild(popup);
}

function confirmMoveMemoToTab(memoId, targetTabId) {
  const memo = memosData.memos.find(m => m.id === memoId);
  const targetTab = memosData.tabs.find(t => t.id === targetTabId);
  if (!memo || !targetTab) return;

  memo.tabId = targetTabId;
  memo.updatedAt = Date.now();
  selectedMemoId = null;
  mobileEditingMemoId = null;
  closeMemoMovePopup();
  saveAllData();
  renderMemos();
  showMemoSaveToast(`"${targetTab.name}" 탭으로 이동됨`);
}

function closeMemoMovePopup() {
  document.getElementById('memo-move-popup')?.remove();
}

function deleteMemoTab(tabId) {
  if (memosData.tabs.length <= 1) {
    alert('최소 1개의 탭은 있어야 합니다.');
    return;
  }

  const tab = memosData.tabs.find(t => t.id === tabId);
  const memosInTab = memosData.memos.filter(m => m.tabId === tabId);
  const otherTabs = memosData.tabs.filter(t => t.id !== tabId);

  if (memosInTab.length > 0) {
    // 메모가 있으면 이동할 탭 선택 팝업
    const popup = document.createElement('div');
    popup.id = 'memo-tab-delete-popup';
    popup.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
    popup.innerHTML = `
      <div class="bg-white rounded-2xl p-4 mx-4 max-w-sm w-full shadow-xl">
        <p class="text-sm font-semibold text-botanical-fg mb-1">"${escapeHtml(tab.name)}" 탭 삭제</p>
        <p class="text-xs text-botanical-sage mb-3">메모 ${memosInTab.length}개를 어디로 이동할까요?</p>
        <div class="space-y-2">
          ${otherTabs.map(t => `
            <button onclick="confirmDeleteMemoTab('${tabId}', '${t.id}')" class="w-full px-4 py-2 rounded-lg bg-botanical-cream text-botanical-fg font-medium text-sm hover:bg-botanical-sage hover:text-white transition-all">
              ${escapeHtml(t.name)}으로 이동
            </button>
          `).join('')}
          <button onclick="confirmDeleteMemoTab('${tabId}', null)" class="w-full px-4 py-2 rounded-lg bg-red-50 text-red-500 font-medium text-sm hover:bg-red-100 transition-all">
            메모도 함께 삭제
          </button>
        </div>
        <button onclick="closeMemoTabDeletePopup()" class="mt-3 w-full py-2 text-sm text-botanical-sage hover:text-botanical-fg transition-all">취소</button>
      </div>
    `;
    popup.onclick = (e) => { if (e.target === popup) closeMemoTabDeletePopup(); };
    document.body.appendChild(popup);
    return;
  }

  // 메모가 없으면 바로 삭제
  memosData.tabs = memosData.tabs.filter(t => t.id !== tabId);
  if (memosData.lastActiveTab === tabId) {
    memosData.lastActiveTab = memosData.tabs[0]?.id;
  }
  saveAllData();
  renderMemos();
}

function confirmDeleteMemoTab(tabId, targetTabId) {
  closeMemoTabDeletePopup();
  const memosInTab = memosData.memos.filter(m => m.tabId === tabId);

  if (targetTabId) {
    // 다른 탭으로 이동
    memosInTab.forEach(m => m.tabId = targetTabId);
  } else {
    // 메모도 함께 삭제
    memosData.memos = memosData.memos.filter(m => m.tabId !== tabId);
  }

  memosData.tabs = memosData.tabs.filter(t => t.id !== tabId);
  if (memosData.lastActiveTab === tabId) {
    memosData.lastActiveTab = memosData.tabs[0]?.id;
  }
  saveAllData();
  renderMemos();
}

function closeMemoTabDeletePopup() {
  document.getElementById('memo-tab-delete-popup')?.remove();
}

// 탭 드래그 앤 드롭
let draggedTabId = null;
function onMemoTabDragStart(e, tabId) {
  draggedTabId = tabId;
  e.dataTransfer.effectAllowed = 'move';
}
function onMemoTabDragOver(e, tabId) {
  if (!draggedTabId || draggedTabId === tabId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}
function onMemoTabDrop(e, targetTabId) {
  e.preventDefault();
  if (!draggedTabId || draggedTabId === targetTabId) {
    draggedTabId = null;
    return;
  }

  const tabs = memosData.tabs;
  const fromIdx = tabs.findIndex(t => t.id === draggedTabId);
  const toIdx = tabs.findIndex(t => t.id === targetTabId);
  if (fromIdx === -1 || toIdx === -1) {
    draggedTabId = null;
    return;
  }

  // 순서 재배치
  const [moved] = tabs.splice(fromIdx, 1);
  tabs.splice(toIdx, 0, moved);
  tabs.forEach((t, i) => t.order = i);

  draggedTabId = null;
  saveAllData();
  renderMemos();
}

function copyMemoAll(id) {
  const memo = memosData.memos.find(m => m.id === id);
  if (!memo) return;
  // 본문만 복사 (제목 제외)
  const text = memo.content || '';
  navigator.clipboard.writeText(text).then(() => {
    showMemoSaveToast('복사됨');
  });
}

function deleteMemo(id) {
  if (!confirm('이 메모를 삭제할까요?')) return;
  memosData.memos = memosData.memos.filter(m => m.id !== id);
  if (selectedMemoId === id) selectedMemoId = null;
  saveAllData();
  renderMemos();
}

// ========== Dashboard Plan Functions ==========
function renderDashboardPlans(monthStr) {
  // calendarData.plans 초기화
  if (!calendarData.plans) calendarData.plans = [];

  // 이번 달 계획 필터링
  const thisMonthPlans = calendarData.plans.filter(p => p.date && p.date.startsWith(monthStr));

  return `
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-base font-semibold">이번 달 계획 (${thisMonthPlans.length}건)</h4>
    </div>
    <div class="space-y-2 mb-3" id="dashboard-plan-list">
      ${thisMonthPlans.length === 0 ? `
        <p class="text-sm text-botanical-sage text-center py-4">등록된 계획이 없습니다</p>
      ` : thisMonthPlans.sort((a, b) => a.date.localeCompare(b.date)).map(plan => {
        const dateStr = plan.date.slice(5).replace('-', '/');
        const color = categoryColors[plan.category] || '#8C9A84';
        return `
          <div class="flex items-center gap-2 p-2 rounded-lg hover:bg-botanical-cream/40 group transition-all">
            <span class="text-sm">📝</span>
            <span class="text-xs text-botanical-sage w-10 shrink-0">${dateStr}</span>
            <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${color};"></span>
            <span class="text-xs text-botanical-sage w-20 shrink-0 truncate">${plan.category}</span>
            <span class="text-sm flex-1 min-w-0 truncate">${plan.keyword}</span>
            <button onclick="deleteDashboardPlan(${plan.id})" class="opacity-0 group-hover:opacity-100 text-xs text-botanical-terracotta hover:text-red-600 transition-all">삭제</button>
          </div>
        `;
      }).join('')}
    </div>
    <button onclick="toggleDashboardPlanForm()" class="w-full py-2 border border-dashed border-botanical-stone rounded-lg text-botanical-sage hover:bg-botanical-cream/40 transition-all text-sm">
      + 새 콘텐츠 계획 추가
    </button>
    <div id="dashboard-plan-form" class="hidden mt-3 p-3 bg-botanical-cream/30 rounded-lg">
      <div class="grid grid-cols-1 md:grid-cols-12 gap-2">
        <input type="date" id="new-plan-date" class="md:col-span-3 px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
        <select id="new-plan-category" class="md:col-span-3 px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none bg-white">
          <option value="">카테고리 선택</option>
          <option value="Career Guide">Career Guide</option>
          <option value="AI Work">AI Work</option>
          <option value="Money Log">Money Log</option>
          <option value="Life Style">Life Style</option>
          <option value="광고">광고</option>
        </select>
        <input type="text" id="new-plan-keyword" placeholder="키워드 입력..." class="md:col-span-4 px-3 py-2 rounded-lg border border-botanical-stone text-sm focus:outline-none">
        <button onclick="saveDashboardPlan()" class="md:col-span-2 px-4 py-2 bg-botanical-fg text-white rounded-lg text-sm font-medium hover:bg-botanical-fg/90 transition-all">저장</button>
      </div>
    </div>
  `;
}

function toggleDashboardPlanForm() {
  const form = document.getElementById('dashboard-plan-form');
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) {
    // 폼 열릴 때 날짜 기본값 설정
    const dateInput = document.getElementById('new-plan-date');
    if (!dateInput.value) {
      dateInput.value = dashSelectedMonth + '-01';
    }
  }
}

function saveDashboardPlan() {
  const date = document.getElementById('new-plan-date').value;
  const category = document.getElementById('new-plan-category').value;
  const keyword = document.getElementById('new-plan-keyword').value.trim();

  if (!date || !category || !keyword) {
    alert('날짜, 카테고리, 키워드를 모두 입력해주세요.');
    return;
  }

  // calendarData.plans 초기화
  if (!calendarData.plans) calendarData.plans = [];

  // 새 계획 생성
  const newId = Math.max(...calendarData.plans.map(p => p.id), 0) + 1;
  const newPlan = {
    id: newId,
    date: date,
    category: category,
    keyword: keyword
  };

  calendarData.plans.push(newPlan);
  saveAllData();

  // 폼 초기화 및 닫기
  document.getElementById('new-plan-date').value = '';
  document.getElementById('new-plan-category').value = '';
  document.getElementById('new-plan-keyword').value = '';
  document.getElementById('dashboard-plan-form').classList.add('hidden');

  renderDashboard();
}

function deleteDashboardPlan(planId) {
  if (!confirm('이 계획을 삭제할까요?')) return;
  calendarData.plans = calendarData.plans.filter(p => p.id !== planId);
  saveAllData();
  renderDashboard();
}

// ========== Category Goals Edit ==========
function editTotalGoal() {
  const newGoal = prompt('월 총 목표 개수를 입력하세요', totalGoalConfig);
  if (newGoal === null) return;
  const num = parseInt(newGoal);
  if (isNaN(num) || num < 1 || num > 31) {
    alert('1~31 사이의 숫자를 입력하세요');
    return;
  }
  totalGoalConfig = num;
  localStorage.setItem('yudit_totalGoal', num);
  renderDashboard();
}

function editCategoryGoal(category) {
  const currentGoal = categoryGoalsConfig[category] || 0;
  const newGoal = prompt(`${category} 목표 개수를 입력하세요`, currentGoal);
  if (newGoal === null) return;
  const num = parseInt(newGoal);
  if (isNaN(num) || num < 0 || num > 31) {
    alert('0~31 사이의 숫자를 입력하세요');
    return;
  }
  categoryGoalsConfig[category] = num;
  localStorage.setItem('yudit_categoryGoals', JSON.stringify(categoryGoalsConfig));
  renderDashboard();
}

// ========== Planning Tab (기획) ==========
// 데이터: data/planning_data.js (PLANNING_DATA) — 레퍼 50개 분석 기반
let plSel = { len: '30초 내외', purpose: 'info', prod: 'speak', section: 'gen' };
let plCustomHooks = null; // Supabase에서 로드 (planning_hooks)
const PL_DRAFT_LS = 'yudit_planning_draft'; // localStorage 키 (기기별 자동저장)
const PL_DRAFT_CLOUD = 'planning_draft';    // Supabase 키 (기기 연동 임시저장)

// Supabase에서 key 하나의 최신 data를 로드 (planning 계열 공통 GET)
async function fetchCloudData(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?key=eq.${key}&select=data&order=updated_at.desc&limit=1`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.ok ? (await res.json())[0]?.data : null;
}

async function plLoadCustomHooks() {
  if (plCustomHooks !== null) return;
  try { plCustomHooks = (await fetchCloudData('planning_hooks'))?.hooks || []; }
  catch (e) { plCustomHooks = []; }
}

// 대사 피드백 보관함 (Supabase 키: planning_feedbacks) — 앤이 등록, 스튜디오에서 열람
let plFeedbacks = null;
async function plLoadFeedbacks(force = false) {
  if (plFeedbacks !== null && !force) return;
  try { plFeedbacks = (await fetchCloudData('planning_feedbacks'))?.items || []; }
  catch (e) { plFeedbacks = plFeedbacks || []; }
}

function renderPlanning() {
  // 데이터 파일이 아직 안 불려왔으면 (네트워크 실패 등) 재시도 안내 — 앱 전체엔 영향 없음
  if (typeof PLANNING_DATA === 'undefined') {
    document.getElementById('planning-content').innerHTML = `
      <div class="bg-white rounded-2xl p-8 shadow-sm text-center">
        <p class="text-sm text-botanical-sage mb-4">기획 데이터를 불러오지 못했어요</p>
        <button onclick="plRetryData()" class="px-5 py-2.5 bg-botanical-fg text-white rounded-xl text-sm font-bold">다시 불러오기</button>
      </div>`;
    return;
  }
  const D = PLANNING_DATA;
  document.getElementById('planning-content').innerHTML = `
    <div class="mb-4">
      <div class="flex gap-5 border-b border-botanical-stone/40">
        <button onclick="plSwitchSection('gen')" id="pl-nav-gen" class="pl-navbtn pb-2 text-[13px] border-b-2 -mb-px border-transparent text-botanical-sage font-medium hover:text-botanical-fg">생성기</button>
        <button onclick="plSwitchSection('idea')" id="pl-nav-idea" class="pl-navbtn pb-2 text-[13px] border-b-2 -mb-px border-transparent text-botanical-sage font-medium hover:text-botanical-fg">아이디어</button>
        <button onclick="plSwitchSection('lib')" id="pl-nav-lib" class="pl-navbtn pb-2 text-[13px] border-b-2 -mb-px border-transparent text-botanical-sage font-medium hover:text-botanical-fg">레퍼 보관함</button>
        <button onclick="plSwitchSection('kw')" id="pl-nav-kw" class="pl-navbtn pb-2 text-[13px] border-b-2 -mb-px border-transparent text-botanical-sage font-medium hover:text-botanical-fg">검색어</button>
      </div>
    </div>
    <div id="pl-sec-gen"></div>
    <div id="pl-sec-idea" class="hidden"></div>
    <div id="pl-sec-lib" class="hidden"></div>
    <div id="pl-sec-kw" class="hidden"></div>
  `;
  plRenderGen();
  plRenderIdeas();
  plRenderKw();
  Promise.all([plLoadCustomHooks(), plLoadFeedbacks()]).then(() => plRenderLib());
  plSwitchSection(plSel.section);
}

function plSwitchSection(sec) {
  plSel.section = sec;
  ['gen', 'idea', 'lib', 'kw'].forEach(s => {
    document.getElementById('pl-sec-' + s).classList.toggle('hidden', s !== sec);
    setSubTabActive(document.getElementById('pl-nav-' + s), s === sec);
  });
  // 보관함 열 때 피드백 로드 (캐시 있으면 즉시, 없을 때만 fetch — 참고 예시라 자주 안 바뀜)
  if (sec === 'lib') plLoadFeedbacks().then(() => { if (plSel.section === 'lib') plRenderLib(); });
}

// ---------- 아이디어 (플래너에서 이동) ----------
function plRenderIdeas() {
  const box = document.getElementById('pl-sec-idea');
  if (!box) return;
  const all = (plansData && plansData._ideas) || [];
  // 소스 필터: 오리지널(링크X) / 레퍼런스(링크O)
  let list = all;
  if (ideaSourceFilter === 'original') list = list.filter(i => !i.link);
  else if (ideaSourceFilter === 'reference') list = list.filter(i => i.link);
  // 카테고리 필터
  if (ideaCategoryFilter !== 'all') list = list.filter(i => i.category === ideaCategoryFilter);
  // 최신순
  list = [...list].sort((a, b) => (b.createdAt || b.id || '').localeCompare(a.createdAt || a.id || ''));
  const srcBtn = (val, label) => `<button onclick="switchIdeaSource('${val}')" class="px-3 py-1.5 rounded-lg text-xs font-medium ${ideaSourceFilter === val ? 'bg-botanical-terracotta text-white' : 'bg-botanical-stone text-botanical-sage hover:text-botanical-fg'}">${label}</button>`;
  const catBtn = (val, label) => `<button onclick="switchIdeaCategory('${val}')" class="px-3 py-1.5 rounded-lg text-xs font-medium ${ideaCategoryFilter === val ? 'bg-botanical-fg text-white' : 'bg-botanical-stone text-botanical-sage hover:text-botanical-fg'}">${label}</button>`;
  box.innerHTML = `
    <div class="flex items-center justify-between gap-2 mb-3">
      <div class="flex gap-1.5">${srcBtn('all', '전체')}${srcBtn('original', '오리지널')}${srcBtn('reference', '레퍼런스')}</div>
      <button onclick="addIdea()" class="px-3 py-1.5 rounded-lg bg-botanical-fg text-white text-xs font-medium hover:bg-opacity-90 transition-all shrink-0">+ 추가</button>
    </div>
    <div class="flex flex-wrap gap-1.5 mb-4">${catBtn('all', '전체')}${catBtn('Career Guide', 'Career')}${catBtn('Money Log', 'Money')}${catBtn('AI Work', 'AI')}${catBtn('Life Style', 'Life')}</div>
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      ${list.length > 0 ? `<div class="space-y-3">${list.map(idea => `
        <div class="p-3 rounded-lg border border-botanical-stone hover:border-botanical-sage transition-all">
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-1.5">
              <span class="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-botanical-cream text-botanical-sage whitespace-nowrap">${idea.category}</span>
              ${idea.link ? `<a href="${idea.link}" target="_blank" title="레퍼런스 열기" class="inline-block px-2 py-0.5 rounded-md text-xs font-medium hover:underline" style="background-color:#87948320;color:#879483;">레퍼 ↗</a>` : '<span class="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-botanical-stone text-botanical-sage">오리지널</span>'}
            </div>
            <div class="flex items-center gap-2">
              <button onclick="editIdea('${idea.id}')" class="text-xs text-botanical-sage hover:text-botanical-fg transition-all">수정</button>
              <span class="text-botanical-stone">|</span>
              <button onclick="plUseIdea('${idea.id}')" class="text-xs font-bold text-botanical-terracotta hover:text-botanical-terracotta/70 transition-all">기획</button>
              <span class="text-botanical-stone">|</span>
              <button onclick="moveIdeaToPlanner('${idea.id}')" class="text-xs text-blue-500 hover:text-blue-700 transition-all">이동</button>
              <span class="text-botanical-stone">|</span>
              <button onclick="deleteIdea('${idea.id}')" class="text-xs text-botanical-terracotta hover:text-red-600 transition-all">삭제</button>
            </div>
          </div>
          <h4 class="text-sm font-medium text-botanical-fg truncate">${idea.title}</h4>
          ${idea.description ? `<p class="text-xs text-botanical-sage truncate">${idea.description}</p>` : ''}
        </div>
      `).join('')}</div>` : `
        <div class="py-16 text-center text-botanical-sage">
          <p class="text-base mb-2">${ideaSourceFilter === 'reference' ? '레퍼런스(링크 있는) 아이디어가 없어요' : ideaSourceFilter === 'original' ? '오리지널 아이디어가 없어요' : '아직 아이디어가 없어요'}</p>
          <p class="text-sm">+ 추가 버튼으로 등록하세요</p>
        </div>`}
    </div>
  `;
}

// 아이디어 → 기획 생성기로 주제 자동 입력 + 점프
function plUseIdea(ideaId) {
  const idea = ((plansData && plansData._ideas) || []).find(i => i.id === ideaId);
  if (!idea) return;
  plSwitchSection('gen');
  const cat = document.getElementById('pl-cat');
  if (cat && idea.category && [...cat.options].some(o => o.value === idea.category || o.text === idea.category)) {
    cat.value = idea.category;
    plFillPreset();
  }
  const topic = document.getElementById('pl-topic');
  if (topic) {
    topic.value = idea.title + (idea.description ? '\n' + idea.description : '');
    plAutoGrow(topic);
  }
  plSaveState();
  if (typeof plSyncStep2 === 'function') plSyncStep2();
  const sec = document.getElementById('pl-sec-gen');
  if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- 생성기 ----------
const PL_INPUT_CLS = 'w-full px-3 py-2 border border-botanical-stone rounded-lg text-sm bg-white focus:outline-none focus:border-botanical-sage';
function plRenderGen() {
  const D = PLANNING_DATA;
  const outBlock = (n) => `
      <div class="relative mt-3">
        <button onclick="plCopy('pl-out${n}')" class="absolute top-2 right-2 z-10 px-2.5 py-1 rounded-lg text-[11px] border border-botanical-terracotta text-botanical-terracotta font-bold bg-white/90 backdrop-blur-sm hover:bg-white">📋 복사</button>
        <div id="pl-out${n}" class="whitespace-pre-wrap bg-botanical-cream/50 border border-botanical-stone rounded-xl p-4 pt-9 text-xs leading-relaxed max-h-[340px] overflow-auto"></div>
      </div>`;
  document.getElementById('pl-sec-gen').innerHTML = `
    <div class="flex gap-1.5 mb-4">
      <button onclick="plCloudSave()" class="flex-1 py-2 rounded-lg text-xs border border-botanical-sage text-botanical-sage hover:bg-botanical-sage/10">☁️ 임시저장 (기기 연동)</button>
      <button onclick="plCloudLoad()" class="flex-1 py-2 rounded-lg text-xs border border-botanical-sage text-botanical-sage hover:bg-botanical-sage/10">☁️ 불러오기</button>
    </div>
    <div class="bg-white rounded-2xl p-5 shadow-sm mb-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-medium text-sm">내 계정 프로필</h3>
        <button onclick="plResetProfile()" class="text-[11px] text-botanical-sage hover:text-botanical-terracotta">↺ 초기화</button>
      </div>
      <label class="block text-xs text-botanical-sage mb-1">카테고리</label>
      <select id="pl-cat" class="${PL_INPUT_CLS}" onchange="plFillPreset();plSaveState()">
        ${Object.keys(D.presets).map(c => `<option>${c}</option>`).join('')}<option>직접 입력</option>
      </select>
      <label class="block text-xs text-botanical-sage mb-1 mt-3">포지셔닝</label>
      <input type="text" id="pl-pos" class="${PL_INPUT_CLS}" oninput="plSaveState()">
      <label class="block text-xs text-botanical-sage mb-1 mt-3">타겟 독자</label>
      <input type="text" id="pl-tar" class="${PL_INPUT_CLS}" oninput="plSaveState()">
      <label class="block text-xs text-botanical-sage mb-1 mt-3">핵심 메시지</label>
      <input type="text" id="pl-msg" class="${PL_INPUT_CLS}" oninput="plSaveState()">
    </div>

    <div class="bg-white rounded-2xl p-5 shadow-sm mb-4">
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2"><span class="w-5 h-5 rounded-full bg-botanical-terracotta text-white text-[11px] font-bold flex items-center justify-center">1</span><h3 class="font-medium text-sm">훅 · 표지 뽑기</h3></div>
        <button onclick="plResetStep1()" class="text-[11px] text-botanical-sage hover:text-botanical-terracotta">↺ 초기화</button>
      </div>
      <label class="block text-xs text-botanical-sage mb-1 mt-2">목적</label>
      <div class="flex flex-wrap gap-1.5" id="pl-purpose">
        ${D.purposes.map(p => `<button onclick="plPick('purpose','${p.id}',this);plSaveState()" class="pl-pill-purpose px-3 py-1.5 rounded-full text-xs border ${p.id === plSel.purpose ? 'bg-botanical-terracotta border-botanical-terracotta text-white font-bold' : 'border-botanical-stone text-botanical-sage'}">${p.name}</button>`).join('')}
      </div>
      <label class="block text-xs text-botanical-sage mb-1 mt-3">주제</label>
      <textarea id="pl-topic" rows="2" class="${PL_INPUT_CLS}" style="resize:none;overflow:hidden" placeholder="내가 잘하는 것 + 사람들이 좋아하는 것&#10;예: 통장 쪼개기 / 신혼 가전 싸게 사는 법" oninput="plAutoGrow(this);plSaveState();plSyncStep2()"></textarea>
      <label class="block text-xs text-botanical-sage mb-1 mt-3">내 경험·에피소드 <span class="text-botanical-stone">(선택 — 있으면 훅이 더 세져요)</span></label>
      <textarea id="pl-exp" rows="2" class="${PL_INPUT_CLS}" style="resize:none;overflow:hidden" placeholder="상황+내 감정+얻은 인사이트  /  흔한 오해+사실은~&#10;예: 연 1억 모으는데 가계부 안 씀" oninput="plAutoGrow(this);plSaveState();plSyncStep2()"></textarea>
      <div class="flex gap-2 mt-4">
        <button onclick="plGenHook('code')" class="flex-1 py-3 bg-botanical-terracotta text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all">① 코드 프롬프트 (앤)</button>
        <button onclick="plGenHook('chat')" class="hidden flex-1 py-3 bg-botanical-fg text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all">① 채팅 프롬프트</button>
      </div>
      <div id="pl-out1-card" class="hidden">${outBlock(1)}</div>
    </div>

    <div class="bg-white rounded-2xl p-5 shadow-sm mb-4">
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2"><span class="w-5 h-5 rounded-full bg-botanical-terracotta text-white text-[11px] font-bold flex items-center justify-center">2</span><h3 class="font-medium text-sm">대본 뽑기</h3></div>
        <button onclick="plResetStep2()" class="text-[11px] text-botanical-sage hover:text-botanical-terracotta">↺ 초기화</button>
      </div>
      <div id="pl-step2-ctx" class="text-[11px] text-botanical-fg bg-botanical-cream/60 rounded-lg px-3 py-2 mb-3 mt-2"></div>
      <label class="block text-xs text-botanical-sage mb-1">확정 표지</label>
      <input type="text" id="pl-cover" class="${PL_INPUT_CLS}" placeholder="고른 표지 붙여넣기" oninput="plSaveState()">
      <label class="block text-xs text-botanical-sage mb-1 mt-3">확정 훅</label>
      <input type="text" id="pl-hook" class="${PL_INPUT_CLS}" placeholder="고른 훅 붙여넣기" oninput="plSaveState()">
      <label class="block text-xs text-botanical-sage mb-1 mt-3">골격 <span class="text-botanical-stone">(반전·금지·공감→주장 / 숫자·아이템→나열 / 의외고백→서사)</span></label>
      <select id="pl-skel" class="${PL_INPUT_CLS}" onchange="plSaveState()">
        <option value="">🎲 전체 랜덤</option>
        ${D.skeletons.map(s => `<option value="${s.id}">${s.name} — ${s.body}</option>`).join('')}
      </select>
      <label class="block text-xs text-botanical-sage mb-1 mt-3">길이</label>
      <div class="flex flex-wrap gap-1.5" id="pl-len">
        ${D.lengths.map(l => `<button onclick="plPick('len','${l}',this);plSaveState()" class="pl-pill-len px-3 py-1.5 rounded-full text-xs border ${l === plSel.len ? 'bg-botanical-terracotta border-botanical-terracotta text-white font-bold' : 'border-botanical-stone text-botanical-sage'}">${l}</button>`).join('')}
      </div>
      <label class="block text-xs text-botanical-sage mb-1 mt-3">연출 <span class="text-botanical-stone">(기본 발표형)</span></label>
      <div class="flex flex-wrap gap-1.5" id="pl-prod">
        ${D.productionOptions.map(p => `<button onclick="plPick('prod','${p.id}',this);plSaveState()" class="pl-pill-prod px-3 py-1.5 rounded-full text-xs border ${p.id === plSel.prod ? 'bg-botanical-terracotta border-botanical-terracotta text-white font-bold' : 'border-botanical-stone text-botanical-sage'}" title="${p.desc}">${p.name}</button>`).join('')}
      </div>
      <div class="flex gap-2 mt-4">
        <button onclick="plGenScript('code')" class="flex-1 py-3 bg-botanical-terracotta text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all">② 코드 프롬프트 (앤)</button>
        <button onclick="plGenScript('chat')" class="hidden flex-1 py-3 bg-botanical-fg text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all">② 채팅 프롬프트</button>
      </div>
      <div id="pl-out2-card" class="hidden">${outBlock(2)}</div>
    </div>

    <div class="bg-white rounded-2xl p-5 shadow-sm mb-4">
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2"><span class="w-5 h-5 rounded-full bg-botanical-terracotta text-white text-[11px] font-bold flex items-center justify-center">3</span><h3 class="font-medium text-sm">대사 피드백</h3></div>
        <button onclick="plResetPolish()" class="text-[11px] text-botanical-sage hover:text-botanical-terracotta">↺ 초기화</button>
      </div>
      <label class="block text-xs text-botanical-sage mb-1 mt-2">수정한 대사 붙여넣기 <span class="text-botanical-stone">(②로 뽑아 내가 고친 대본)</span></label>
      <textarea id="pl-polish" rows="6" class="${PL_INPUT_CLS}" style="resize:none;overflow:hidden;min-height:120px" placeholder="여기에 내가 수정한 대사를 통째로 붙여넣으세요" oninput="plAutoGrow(this);plSaveState()"></textarea>
      <div class="flex gap-2 mt-4">
        <button onclick="plGenPolish('code')" class="flex-1 py-3 bg-botanical-terracotta text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all">③ 코드 프롬프트 (앤)</button>
        <button onclick="plGenPolish('chat')" class="hidden flex-1 py-3 bg-botanical-fg text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all">③ 채팅 프롬프트</button>
      </div>
      <div id="pl-out3-card" class="hidden">${outBlock(3)}</div>
    </div>
  `;
  plFillPreset();
  plRestoreState();
  plSyncStep2();
}
function plFillPreset() {
  const p = PLANNING_DATA.presets[document.getElementById('pl-cat').value];
  document.getElementById('pl-pos').value = p ? p.positioning : '';
  document.getElementById('pl-tar').value = p ? p.target : '';
  document.getElementById('pl-msg').value = p ? p.message : '';
}
function plPick(kind, val, btn) {
  plSel[kind] = val;
  plPillSet(kind, btn.textContent);
}
// textarea 내용 길이에 맞춰 높이 자동 확장 (스크롤 대신)
function plAutoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
// ===== 1단계: 훅·표지 프롬프트 =====
function plBuildHookPrompt(mode = 'chat') {
  const D = PLANNING_DATA;
  const cat = document.getElementById('pl-cat').value;
  const pos = document.getElementById('pl-pos').value, tar = document.getElementById('pl-tar').value, msg = document.getElementById('pl-msg').value;
  const topic = (document.getElementById('pl-topic').value || '').trim() || '(주제 입력)';
  const exp = (document.getElementById('pl-exp') ? document.getElementById('pl-exp').value : '').trim();
  const purpDef = D.purposes.find(p => p.id === plSel.purpose);
  if (mode === 'code') return `앤, 너는 우리 채널(yudit_insta) 레퍼 수백 개와 터지는 릴스 공식을 머릿속에 가진 인플루언서다 — 어항처럼. 단순 지시 수행이 아니라 그 감각으로 직접 기획해. (필요하면 planning_data.js·세계관 문서·훅 13앵글을 직접 열어 참고할 것.)

그 감각으로 이 주제 훅·표지를 뽑아줘. 13앵글 순서대로 표지+훅 1세트씩(안 맞는 앵글은 생략), 차별점은 첫 문장에 하나만, 표지·훅 5요소(주제·권위/타겟·이득·창작·유디트화)는 속으로 점검해 통과한 것만(점검은 끝에 한 줄 요약).

[목적] ${purpDef.name}
[주제] ${topic}
[내 경험] ${exp || '(없음)'}`;
  // 같은 목적 레퍼 훅 5개 + 터진 이유 (원리 학습용)
  const exRefs = D.refs.filter(r => r.purpose === plSel.purpose && r.viral).sort(() => Math.random() - 0.5).slice(0, 5);
  const refEx = exRefs.map(r => {
    const why = (r.viral || '').split('\n').filter(Boolean)[0] || '';
    return `  · ${r.hook}${why ? '\n    → ' + why : ''}`;
  }).join('\n');
  const angles = D.hookAngles.map((a, i) => `${i + 1}. ${a.name} — ${a.desc}${a.pattern ? '\n   └ 공식: ' + a.pattern : ''}`).join('\n');
  const gateBody = plSel.purpose === 'empathy'
    ? '이 주제가 공감되고 곱씹게 만드나 (공감 상황 / 나만의 인사이트 / 솔직한 감정) — ○/△/✕ + 한 줄'
    : '이 주제가 저장될 무기가 있나 (실제 경험 / 남들 모르는 디테일 / 진짜 통증) — ○/△/✕ + 한 줄';
  return `너는 인스타그램 릴스 훅·표지 기획 에이전트다. 주어진 주제로 스크롤을 멈추게 하는 썸네일 표지와 첫 3초 훅을 앵글별로 창작하라.

[계정 컨텍스트]
- 카테고리: ${cat}
- 포지셔닝: ${pos}
- 핵심 메시지: ${msg}
- 타겟 독자: ${tar}

[주제] ${topic}
[목적] ${purpDef.name}
[내 경험·에피소드] ${exp || '(없음)'}${exp ? ' — 이 경험을 성과·숫자·의외 고백·반전 앵글의 훅 소재로 적극 활용하라' : ''}

[검증된 레퍼가 왜 터졌나 — 원리만 배워라, 문장은 베끼지 말 것]
${refEx}

[첫 문장 규칙 — 차별점은 하나만] 차별점은 사람·시간·방법·결과 중 하나다. 첫 문장에 딱 하나만 박아라. 다 넣으려 하지 마라 — 한 가지면 멈춘다.

[훅 앵글 — 아래 ${D.hookAngles.length}개 중 주제에 잘 맞는 것으로 창작 (공식 있으면 그 틀로)]
${angles}

[표지 vs 훅 — 둘 다 짧고 간결하게 (레퍼처럼)]
- 표지: 제목체(명사형 OK), 15자 이내. 알맹이 필수 — 결과·숫자·리스트·대상·효용 중 하나 이상. 막연한 호기심 금지.
- 훅: 대사체(구어체 ~해요/~거든요/~하세요/~하냐고요?), 한 호흡에 끝나는 짧은 한 문장(20자 내외). 설명·이유 붙이지 말고 임팩트만. 제목형·명사 종결 금지.
※ 레퍼처럼 짧게: "이거 사세요" "안 싸우냐고요?" "어떻게 5번이나 합격했을까?" "목걸이 샀더니 주식이 들어왔어요"
   ❌ "~인데요, 우연이라기엔 소름이지 않아요?" 처럼 길게 풀지 말 것. 부연·이유는 본문(2단계)에서.

[세트별 점검 기준 — 5개] 표지·훅 각각이 아래를 만족하는지 속으로 점검하고, 5개 다 통과한 세트만 출력하라. (세트 옆에 점검을 일일이 적지 말 것 — 뷰가 지저분해진다. 점검은 맨 끝에 한 줄로만 요약.)
- 주제: 무엇에 대한 얘긴지 한눈에 잡히나 (표지·훅 둘 다)
- 권위 or 타겟: 누가(경험·자격) 또는 누구한테(대상) 하는 말인지 드러나나 (표지·훅 둘 다)
- 이득: 보면 뭘 얻나. 호기심 형태로 가려도 OK, 단 '뭘 얻는지' 감은 필수 — 막연한 호기심 ✕ (표지·훅 둘 다)
- 창작: 참고 레퍼와 같은 소재면 치환 금지(카피)·반드시 새로 창작. 다른 소재면 구조 치환·창작 둘 다 OK
- 유디트화: 유디트 말투·경험이 묻어나나

[출력]
① 게이트 점검: ${gateBody}
② 위 훅 앵글을 1번부터 순서대로 훑으며, 각 앵글로 표지+훅 1세트씩 (앵글명 꼭 표시). 주제에 정말 안 맞는 앵글만 건너뛰고(괄호로 사유 한 줄), 나머지는 끝까지 다 낸다. 세트는 표지·훅만 깔끔하게 (점검은 적지 말 것):
   1. [앵글명] 표지: ___  /  훅: ___
   2. [앵글명] 표지: ___  /  훅: ___
   … 앵글 순서대로 끝까지
   ※ 각 세트는 속으로 5항목(주제·권위/타겟·이득·창작·유디트화)을 표지·훅 둘 다 점검해, 통과한 것만 낸다. 어느 쪽이든 ✕면 그 앵글은 다시 창작.
③ 맨 끝에 점검 요약 한 줄만: "낸 세트 전부 5항목(주제·권위/타겟·이득·창작·유디트화) 표지·훅 둘 다 통과" — 건너뛴 앵글이 있으면 여기 짧게 덧붙인다.
④ 마음에 안 들면 사용자가 "더" 또는 특정 앵글(예: "반전 더")을 말한다. 그때마다 앞서 낸 것과 겹치지 않게 계속 새로 창작하라.`;
}

// ===== 2단계: 대본 프롬프트 (확정 훅·표지 → 골격대로) =====
function plBuildScriptPrompt(mode = 'chat') {
  const D = PLANNING_DATA;
  const cat = document.getElementById('pl-cat').value;
  const pos = document.getElementById('pl-pos').value, tar = document.getElementById('pl-tar').value, msg = document.getElementById('pl-msg').value;
  const topic = (document.getElementById('pl-topic').value || '').trim() || '(주제)';
  const cover = (document.getElementById('pl-cover').value || '').trim();
  const hook = (document.getElementById('pl-hook').value || '').trim();
  const exp = (document.getElementById('pl-exp').value || '').trim();
  const rand = a => a[Math.floor(Math.random() * a.length)];
  const sSel = document.getElementById('pl-skel').value;
  const skel = sSel ? D.skeletons.find(s => s.id === sSel) : rand(D.skeletons);
  const curveDef = (skel.id === 'story' && skel.curves) ? rand(skel.curves) : null;
  const struct = curveDef ? curveDef.structure : skel.structure;
  const cta = plSel.purpose === 'info' ? '포함' : '미포함';
  const lenGuide = plSel.len === '15초 이내'
    ? '15초 이내 — 훅+핵심만, 군더더기 제거'
    : '30초 내외 — 30초 목표, 내용 많으면 40초까지 OK, 1분은 절대 넘기지 말 것';
  const ctaBlock = cta === '포함'
    ? '골격·목적에 맞는 CTA 1개를 설계하라. ★"자소서라고 댓글 남기면 보내드릴게요" 식 특정 단어·키워드 지정 절대 금지 — 인스타 자동화 블럭 이슈로 채널 금지 규칙 (레퍼에 있어도 따라하지 마라). 댓글→자료 CTA는 반드시 "아무 댓글 남기면 자료 드릴게요" 형태로. 정보 완결형은 저장 유도. 1차 행동은 단 하나만.'
    : '행동을 요구하지 말 것. 슬로건·선언 또는 정답 없는 질문으로 담백하게 마무리.';
  const prodBlock = plSel.prod === 'dialogue'
    ? '두 사람(부부/동료)이 주고받는 대화 장면으로 구성, 대사를 화자별로 분리. 진행자 얼굴 미노출 — 음성·자막·보조 화면.'
    : '진행자 얼굴 없이 음성 내레이션 + 화면(보조 영상·자막)으로 구성. 화면 메모 충실히.';
  if (mode === 'code') return `앤, 너는 우리 채널(yudit_insta) 레퍼 수백 개와 터지는 릴스 공식을 머릿속에 가진 인플루언서다 — 어항처럼. 그 감각으로 직접 기획해. (필요하면 planning_data.js·세계관 문서·골격을 직접 참고.)

확정 훅·표지로 [${skel.name}${curveDef ? ' · ' + curveDef.name : ''}] 골격 대본 써줘. 골격 구조·기획 원칙·인사이트(나만의 인사이트·인간미) 체크·연출 규칙은 네 감각으로.

[확정 표지] ${cover || '(1단계 표지)'}
[확정 훅] ${hook || '(1단계 훅)'}
[주제] ${topic}
[내 경험] ${exp || '(없음)'}
[길이] ${lenGuide}
[연출] ${plSel.prod === 'dialogue' ? '대화형(부부/동료, 얼굴 미노출)' : '발표형(보이스오버+자막, 얼굴 미노출)'}
[CTA — ${cta}] ${ctaBlock}`;
  const bodyLine = `[${struct.split(' → ').join('] → [')}]`;
  const exRefs = D.refs.filter(r => r.skeleton === skel.id).sort(() => Math.random() - 0.5).slice(0, 2);
  const refEx = exRefs.map(r => `  · ${r.hook}`).join('\n');
  return `너는 인스타그램 릴스 대본 작가다. 아래 [확정된 훅·표지]를 시작점으로, [이번 골격] 구조의 대본을 완성하라. 훅·표지는 이미 정해졌으니 바꾸지 말 것.

[계정 컨텍스트]
- 카테고리: ${cat}
- 포지셔닝: ${pos}
- 핵심 메시지: ${msg}
- 타겟 독자: ${tar}

[확정 — 변경 금지]
- 썸네일 표지: ${cover || '(1단계서 고른 표지 입력)'}
- 첫 3초 훅: ${hook || '(1단계서 고른 훅 입력)'}

[기획 원칙 — 절대 규칙]
${D.fixedRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

[이번 골격 — ${skel.name}${curveDef ? ' · ' + curveDef.name : ''}]
· 본문 전개: ${skel.body}
· 골격(이 순서 그대로): ${struct}
· 같은 골격 검증 사례 (구조 참고):
${refEx}

[CTA — ${cta}] ${ctaBlock}
[연출] ${prodBlock}
[길이] ${lenGuide}

[나만의 인사이트·인간미 — 이 대본의 힘은 여기서 나온다]
※ 공감형 레퍼 88%가 '관점 재정의'로 터졌다. 아래 중 최소 하나는 반드시 녹여라:
 ☑ 패턴A(감정·공감): 공감되는 어려운 상황 + 내가 겪고 얻은 인사이트 + 내 감정
 ☑ 패턴B(오해·반전): 다들 아는 흔한 오해·실수 + 내가 찾은 사실(사실은 ~)
 ☑ 나만의 인사이트: 일반론이 아니라 유디트만 할 수 있는 말인가 (내 경험·숫자·감정에서 나왔나)
 ☑ 인간미: 매끈한 정보가 아니라 솔직한 감정·실패·고백이 묻어나나
→ 하나도 안 걸리면 정보 나열에 그친다. 다시 써라.

[주제] ${topic}
[내 경험] ${exp || '(없음 — 경험이 들어가면 좋을 자리를 [경험 자리: ~~] 형태로 표시만, 억지로 지어내지 말 것)'}

[출력 — 이 순서로]
① 릴스 대본 — 확정 훅으로 시작, 위 골격 구조를 그대로 따라:
   ${bodyLine}
   각 단계마다 대사 + 화면·보조영상 메모${plSel.prod === 'dialogue' ? ' (화자별 대사 분리)' : ''}
② 캡션 초안: 본문 + 해시태그 5개
③ HUMAN CHECK: 유디트가 직접 확인·수정할 포인트 2~3개 (경험·숫자 자리, 사실 확인 필요)`;
}

function plGenHook(mode = 'chat') {
  document.getElementById('pl-out1-card').classList.remove('hidden');
  document.getElementById('pl-out1').textContent = plBuildHookPrompt(mode);
  plSaveState();
  document.getElementById('pl-out1-card').scrollIntoView({ behavior: 'smooth' });
}
function plGenScript(mode = 'chat') {
  document.getElementById('pl-out2-card').classList.remove('hidden');
  document.getElementById('pl-out2').textContent = plBuildScriptPrompt(mode);
  plSaveState();
  document.getElementById('pl-out2-card').scrollIntoView({ behavior: 'smooth' });
}

// ===== 3단계: 대사 피드백 프롬프트 =====
function plBuildPolishPrompt(mode = 'chat') {
  const cat = document.getElementById('pl-cat').value;
  const pos = document.getElementById('pl-pos').value, tar = document.getElementById('pl-tar').value, msg = document.getElementById('pl-msg').value;
  const topic = (document.getElementById('pl-topic').value || '').trim();
  const script = (document.getElementById('pl-polish').value || '').trim();
  if (mode === 'code') return `앤, 너는 yudit_insta 채널의 터지는 피드백 감각으로 직접 피드백하는 인플루언서다 — 어항 그 자체.
그 감각은 머릿속이 아니라 보관함에 있다. 피드백 전에 반드시 둘을 연다:
① 릴스기획/references/_어항피드백예시.md — 어항 실물 피드백 예시. 말투·강도·알맹이는 이대로 따라간다. 단 두 가지는 절대 따라가지 마라: 표 형식(아래 출력 형식 대신), 그리고 "댓글 남기면 ○○ 보내드릴게요" 식 CTA(아래 금지).
② 이 대사 카테고리(재테크&부동산/커리어&자기계발/AI/라이프)의 닮은 레퍼 2~3개 — _분석현황.md 카테고리 인덱스나 planning_data.js의 keywords로 골라 연다.

[출력 형식 — 표 절대 금지 (모바일에서 표는 못 본다), 구간마다 3줄 블록]
입력의 구간 순서 그대로, 각 구간을 아래 3줄로만 (앞뒤 머리말·분석·비교표 금지):
원본 대사: (입력 대사 그대로)
수정 대사: (바로 갈아끼울 대사, 유디트 목소리 — 멀쩡하면 "수정 없음", 빼야 할 줄이면 "삭제")
수정 이유: (→ 짧게 한 줄. "수정 없음"이면 이 줄 생략)
- 블록 사이 빈 줄 하나. 빠진 핵심을 새 단계로 세울 땐 원본 대사: (새 단계 추가)로.
- 근거·출처 쓰지 마라. 부연은 전체에서 한두 번, 친근하게.

[CTA — ★특정 단어 댓글 유도 절대 금지]
- "○○이라고 댓글 남기면 보내드릴게요/DM 드릴게요" 식 특정 단어·키워드 댓글 유도는 인스타 자동화 블럭 이슈로 우리 채널에서 금지다. 예시 파일이나 레퍼에 있어도 절대 제안하지 마라.
- 댓글→자료 CTA 자체는 OK, 단 반드시 "아무 댓글 남기면 자료 드릴게요" 형태로 (단어 지정 없이). 저장 유도·공유 명분·열린 질문도 좋다.

[고칠 때 — 편집이지 재작성 아님 / 매 문장 + 전체 흐름]
- 고친 대사는 원문 길이를 넘기지 마라. 통째로 새로 길게 ❌. 한 군데만 손대거나·서브자막만 얹거나·삭제로.
- 두 시점: 매 문장 보되 전체 흐름도. 흐름상 군더더기 단계는 통째로 삭제(번호 당김), 행 안 군더더기 문장도 삭제.
- 멀쩡한 줄·단계는 비워(=OK) 또는 그대로 OK.
- 빠진 핵심은 새 행으로 — 꼭 필요한 한 방만. 추가보다 압축, 30초 넘기지 마라.
- CTA·캡션 떡밥은 본문 한 단계로 끌어올려 풀고, CTA엔 떡밥만.

[숫자 — 최우선]
- ★가짜 숫자 금지: 유디트 실제 수치 아니면 지어내 단정 ❌. 모르면 n%·○○만원 + (여기 실제 숫자)로 비워 유디트가 채우게. 검증된 제도 팩트(ISA 400만원 비과세·9.9% 분리과세 등)만 OK, 개인 성과 숫자는 추정 금지.

[연출·서브자막·공유자료]
- 연출/자막 지시는 괄호·대괄호 인라인 ((지수 띄우기)·[소자막]·(캡쳐타임)).
- ⓢ서브자막은 해당 구간 블록에 인라인(별도 섹션 ❌), 숫자·권위 한 방.
- 공유자료 3개(저장↑·공유↑ 구분, ★최고추천)는 맨 끝에 한 줄씩 가볍게 (표 ❌).
- 참고: 스튜디오 기획탭 > 레퍼 보관함 > 피드백 탭에 어항 실물 피드백 3개(ISA·마일리지·통장5개)가 이 형식 그대로 들어 있다. _어항피드백예시.md와 함께 손맛 참고용.

[대사]
${script || '(대사 붙여넣기)'}`;
  return `너는 터지는 인스타그램 릴스를 수백 개 분석·기획해 본 릴스 기획자다. 아래 [대사]에 구간별로 피드백을 준다.
규칙: 인사·칭찬·격려 빼고 바로 본론. 각 구간을 어떻게 고칠지 ★고친 문장 예시까지 같이 보여줘라★ (방향만 말하면 안 와닿는다). 단 전체 대본을 통으로 새로 쓰진 말고 구간별로만. 좋은 문장은 "그대로 OK".
★★짧고 펀치 있게 (이게 제일 중요): 각 칸 1~2줄로 끝내라. 메커니즘·원리를 길게 설명하지 마라 — 근거는 한 마디면 충분("절세돼요" 정도). '왜' 칸에 잣대 번호(#1 등)나 학술 설명 쓰지 말고 짧은 일상말로. 틀린 숫자만 짧게 고치고, 금융 규제·표시 경고 같은 건 늘어놓지 마라. 고친 문장도 짧고 입에 붙게. (논문처럼 길어지면 실패다 — 친구가 빠르게 톡 던지듯)
★★전부 고치지 마라: 멀쩡한 문장은 손대지 말 것. 한 대본에서 정말 바꿔야 할 2~4군데만 골라 짚어라. 좋은 구간은 "그대로 OK" 한 줄로 묶거나 아예 표에서 빼라. (다 고치려 들면 어항이 아니다)
★★짧되 '알맹이'는 있어야 한다 (줄이는 게 목적이 아니다 — 제일 중요): 표현만 다듬지 말고, 그 주제에서 진짜 도움되는 정보·팁·주의점을 짧은 한 줄로 콕 더해라. 예: "국내주식은 ISA에서 사지 마세요, 절세 대상 아니에요" / "은행 말고 증권사여야 ETF 직접 살 수 있어요". 단 '왜 그런지' 원리는 길게 풀지 말고 결론 팁만. → 짧음 + 알맹이, 둘 다 잡아라 (어항은 짧으면서도 실제 유용한 정보가 들어 있다).
★★빠진 핵심은 기존 문장에 욱여넣지 말고 '새 행'으로 추가하라: 원본에 빠진 중요한 포인트(예: 국내주식은 ISA에서 사지 마세요)는 옆 문장에 끼워 약하게 만들지 말고, 독립 단계로 새 행을 세워야 힘이 산다.
★★삭제를 과감히: 멀쩡한 줄은 손대지 말되, "앱에서 계좌 만들기"처럼 누구나 아는 당연한 절차는 '그대로 OK'로 살리지 말고 "삭제"로 잘라라. (멀쩡한 척 살리지 마라)
★★★가짜 숫자 절대 금지 (최우선): 유디트 실제 수치가 아니면 지어내 단정하지 마라. 모르면 ○○만원 자리만 두고 (여기 실제 숫자)라고 표시해 유디트가 채우게 하라. ISA 400만원 비과세·9.9% 분리과세 같은 검증된 제도 팩트는 OK, 유디트 개인 성과 숫자(3년에 얼마 모았다 등)는 추정 금지.
★★★CTA에서 특정 단어 댓글 유도 절대 금지: "자소서라고 댓글 남기면 보내드릴게요" 식 특정 단어·키워드 지정은 인스타 자동화 블럭 이슈로 이 채널에서 금지다. 레퍼런스에 있어도 제안하지 마라. 댓글→자료 CTA 자체는 OK — 반드시 "아무 댓글 남기면 자료 드릴게요" 형태(단어 지정 없이)로. 저장 유도·공유 명분(남편/친구한테 공유)·열린 질문도 좋다.

[계정 정체성 — 여기에 정렬]
- 카테고리: ${cat}
- 포지셔닝: ${pos}
- 핵심 메시지: ${msg}
- 타겟 독자: ${tar}
${topic ? '- 이번 주제: ' + topic + '\n' : ''}- 톤: 유디트 말투(구어체 ~해요/~거든요), 얼굴 미노출(보이스오버+자막), 대기업 부부 페르소나

[피드백 잣대]
1. 첫 문장: 주제 + 내 권위 + 얻을 이득(+타겟)이 한 호흡에 드러나나. 첫 줄에 '이 사람 뭐 하지?' 궁금증. (단정·추상 ✕ → 질문·장면으로)
2. 구체 수치·결과로 (막연한 말 → 3억·400만원 같은 숫자, 서브자막으로 박기)
3. 군더더기·당연한 단계 삭제 (누구나 아는 절차·중복)
4. 즉각 실행·지름길로 보이게 (머리로 아는 추상 교훈 < 따라할 수 있는 구체 행동·루틴)
5. 핵심문장은 앞에, 디테일은 한 줄 또는 자막으로 (읽지 말고 빨리 넘어갈 것)
6. 톤: 자랑 다운 → 인간미 / 인사이트 한 줄 또렷이 (관점 재정의)
7. 모호·부정확 정보 수정 (틀린 숫자·애매한 표현)
8. ★훅 서브자막 (작성자가 자주 빠뜨리는 1순위 — 꼭 챙겨라): 서브자막은 표지와 별개로, 훅(첫 부분)을 보강하는 '강력한 한 문장'이다. (표지 문장이 와도 되지만, 보통은 핵심·숫자·결과·권위·반전을 화면에 한 번 더 박는 임팩트 한 줄.) 훅에 붙일 서브자막 1~2개를 따로 제안. (영상 내내 갈지 훅에서만 쓸지는 작성자가 판단하니 후보만 준다.)
9. 그 외 연출 (지수 띄우기·장면 메모·한 줄씩 등장 → 마지막에 한 번에=캡쳐타임). 더 좋은 레퍼 사례 있으면 벤치마크 제시

[대사 — 피드백 대상]
${script || '(수정한 대사 붙여넣기)'}

[출력 — 인사치레 없이. ★표(마크다운 테이블) 절대 금지 — 모바일에서 표는 못 본다]
※ ①②③만 출력하라. 그 앞에 계정 진단·카테고리 분석·숫자 팩트체크 같은 머리말 블록을 절대 만들지 마라(불필요). ①이 가장 중요하니 거기 공들이고, 정확성 문제는 해당 구간의 '수정 이유' 한 줄로만.

① 구간별 피드백 — 입력의 구간 순서 그대로, 각 구간을 아래 3줄 블록으로 (행 순서·구성 바꾸지 마라):
원본 대사: (입력 대사 그대로)
수정 대사: (바로 갈아끼울 대사를 그 자리에 직접 — 유디트 목소리, ~하세요!/~좋을 거 같아요!. 멀쩡하면 "수정 없음", 빼야 할 줄이면 "삭제")
수정 이유: (→ 짧게 한 줄. "수정 없음"이면 이 줄 생략)
- 블록 사이 빈 줄 하나. 메타 설명체 금지. 빠진 핵심은 욱여넣지 말고 새 블록으로 — 원본 대사: (새 단계 추가).
- 연출 지시는 괄호 인라인. 구간에 어울리는 서브자막 후보 있으면 수정 대사 줄에 'ⓢ ___'도 같이.

② ⓢ 훅 서브자막 — 한 줄씩 (표 ❌):
ⓢ (서브자막 후보) — (노린 것 한 마디)
→ ★구체적 수치로 혹하게 박아라 (대사 반복 ❌, 밋밋한 일반 훅 ❌). 숫자·결과 임팩트 한 방 — "3억 만들어준 1등 공신" "최대 400만원 절세"처럼 탁 꽂히게. 1~2개. 영상 내내 갈지 훅만 쓸지는 작성자 판단.

③ 마지막 공유 자료 제안 — 한 줄씩 가볍게 (표 ❌, 딱 3개):
(자료명·유형) — 저장↑ 또는 공유↑ — 한 줄 이유
→ 딱 3개만. 길게 설명하지 마라(헤비 ❌). 유형 섞어서 — 체크리스트/비교표/템플릿/앱정보. 맨 위 1개에 ★(제일 터질 것).
→ 저장↑(체크리스트·템플릿·정리표) / 공유↑(배우자·친구한테 보낼 것) 구분. 구체 도구명 모르면 흔히 쓰는 걸로.`;
}
function plGenPolish(mode = 'chat') {
  const txt = (document.getElementById('pl-polish').value || '').trim();
  if (!txt) { alert('수정한 대사를 먼저 붙여넣어주세요'); return; }
  document.getElementById('pl-out3-card').classList.remove('hidden');
  document.getElementById('pl-out3').textContent = plBuildPolishPrompt(mode);
  plSaveState();
  document.getElementById('pl-out3-card').scrollIntoView({ behavior: 'smooth' });
}
function plResetPolish() {
  const e = document.getElementById('pl-polish'); if (e) { e.value = ''; plAutoGrow(e); }
  document.getElementById('pl-out3-card').classList.add('hidden');
  document.getElementById('pl-out3').textContent = '';
  plSaveState(); plToast('3단계 초기화');
}
function plCopy(id) { navigator.clipboard.writeText(document.getElementById(id).textContent).then(() => plToast('복사 완료! AI에 붙여넣으세요')); }

// ---------- 임시저장 / 초기화 ----------
function plCollectState() {
  const g = id => { const e = document.getElementById(id); return e ? e.value : ''; };
  const o = id => { const e = document.getElementById(id); return e ? e.textContent : ''; };
  return {
    cat: g('pl-cat'), pos: g('pl-pos'), tar: g('pl-tar'), msg: g('pl-msg'),
    topic: g('pl-topic'), cover: g('pl-cover'), hook: g('pl-hook'), skel: g('pl-skel'), exp: g('pl-exp'),
    purpose: plSel.purpose, len: plSel.len, prod: plSel.prod,
    out1: o('pl-out1'), out2: o('pl-out2'),
    polish: g('pl-polish'), out3: o('pl-out3')
  };
}
// 자동저장 — 기기별 로컬 (즉시, 부담 0)
function plSaveState() {
  try { localStorage.setItem(PL_DRAFT_LS, JSON.stringify(plCollectState())); } catch (e) {}
}
// 임시저장 — 기기 연동 (PC/폰/태블릿 공유). 누를 때만 Supabase 저장
async function plCloudSave() {
  try { await upsertToSupabase(PL_DRAFT_CLOUD, plCollectState()); plToast('☁️ 기기 연동 저장 완료!'); }
  catch (e) { plToast('저장 실패 — 네트워크 확인'); }
}
async function plCloudLoad() {
  try {
    const st = await fetchCloudData(PL_DRAFT_CLOUD);
    if (!st) { plToast('기기 연동 저장본이 없어요'); return; }
    if (!confirm('기기 연동 저장본을 불러올까요? 지금 작성 중인 내용은 덮어써져요.')) return;
    localStorage.setItem(PL_DRAFT_LS, JSON.stringify(st));
    plRenderGen();
    plToast('☁️ 불러오기 완료!');
  } catch (e) { plToast('불러오기 실패 — 네트워크 확인'); }
}
function plRestoreState() {
  const D = PLANNING_DATA;
  let st;
  try { st = JSON.parse(localStorage.getItem(PL_DRAFT_LS) || 'null'); } catch (e) { st = null; }
  if (!st) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
  set('pl-cat', st.cat); set('pl-pos', st.pos); set('pl-tar', st.tar); set('pl-msg', st.msg);
  set('pl-topic', st.topic); set('pl-cover', st.cover); set('pl-hook', st.hook); set('pl-skel', st.skel); set('pl-exp', st.exp);
  set('pl-polish', st.polish);
  ['pl-topic', 'pl-exp', 'pl-polish'].forEach(id => plAutoGrow(document.getElementById(id))); // 복원된 긴 내용도 펼치기
  if (st.purpose) plSel.purpose = st.purpose;
  if (st.len && D.lengths.includes(st.len)) plSel.len = st.len; // 옛 길이값은 무시 → 기본 '30초 내외'
  if (st.prod) plSel.prod = st.prod;
  // 알약 활성 복원 (purpose/prod는 표시 이름으로 매칭)
  plPillSet('purpose', (D.purposes.find(p => p.id === plSel.purpose) || {}).name);
  plPillSet('len', plSel.len);
  plPillSet('prod', (D.productionOptions.find(p => p.id === plSel.prod) || {}).name);
  // 생성된 프롬프트 복원
  if (st.out1) { document.getElementById('pl-out1-card').classList.remove('hidden'); document.getElementById('pl-out1').textContent = st.out1; }
  if (st.out2) { document.getElementById('pl-out2-card').classList.remove('hidden'); document.getElementById('pl-out2').textContent = st.out2; }
  if (st.out3) { const c = document.getElementById('pl-out3-card'); if (c) { c.classList.remove('hidden'); document.getElementById('pl-out3').textContent = st.out3; } }
}
// 2단계 상단에 1단계 주제·경험 승계 표시
function plSyncStep2() {
  const box = document.getElementById('pl-step2-ctx'); if (!box) return;
  const tv = (document.getElementById('pl-topic') ? document.getElementById('pl-topic').value : '').trim();
  const ev = (document.getElementById('pl-exp') ? document.getElementById('pl-exp').value : '').trim();
  box.innerHTML = (tv || ev) ? `📌 1단계 주제·경험이 그대로 반영돼요 ✓` : `📌 주제는 1단계에 입력하세요`;
}
// 알약 활성 표시 갱신 헬퍼
function plPillSet(kind, label) {
  document.querySelectorAll('.pl-pill-' + kind).forEach(b => {
    const on = b.textContent === label;
    b.className = b.className.replace(/bg-botanical-terracotta border-botanical-terracotta text-white font-bold|border-botanical-stone text-botanical-sage/g, on ? 'bg-botanical-terracotta border-botanical-terracotta text-white font-bold' : 'border-botanical-stone text-botanical-sage');
  });
}
function plResetProfile() {
  ['pl-pos', 'pl-tar', 'pl-msg'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  plSaveState(); plToast('계정 프로필 초기화');
}
function plResetStep1() {
  const t = document.getElementById('pl-topic'); if (t) { t.value = ''; plAutoGrow(t); }
  const e = document.getElementById('pl-exp'); if (e) { e.value = ''; plAutoGrow(e); }
  plSel.purpose = 'info';
  plPillSet('purpose', (PLANNING_DATA.purposes.find(p => p.id === 'info') || {}).name);
  document.getElementById('pl-out1-card').classList.add('hidden');
  document.getElementById('pl-out1').textContent = '';
  plSyncStep2(); plSaveState(); plToast('1단계 초기화');
}
function plResetStep2() {
  ['pl-cover', 'pl-hook'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  document.getElementById('pl-skel').value = '';
  plSel.len = '30초 내외'; plSel.prod = 'speak';
  plPillSet('len', '30초 내외');
  plPillSet('prod', (PLANNING_DATA.productionOptions.find(p => p.id === 'speak') || {}).name);
  document.getElementById('pl-out2-card').classList.add('hidden');
  document.getElementById('pl-out2').textContent = '';
  plSaveState(); plToast('2단계 초기화');
}

// ---------- 레퍼 보관함 ----------
function plLibEntries() {
  const D = PLANNING_DATA;
  const skName = id => (D.skeletons.find(s => s.id === id) || {}).name || '';
  const refs = D.refs.map(r => ({ type: 'ref', no: r.no, hook: r.hook, cover: r.cover, cat: r.category, len: r.length, fmt: r.format, skel: r.skeleton, skelName: skName(r.skeleton), kw: r.keywords, own: r.own, sub: r.sub, script: r.script }));
  const hooks = D.hookBank.concat(plCustomHooks || []).map((h, i) => ({ type: 'hook', no: h.id, hNo: 'H' + (i + 1), hook: h.hook, cat: '', len: '', fmt: '', kw: [], pattern: h.pattern || '', template: h.template || '' }));
  const fbs = (plFeedbacks || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map(f => ({ type: 'fb', no: f.id, hook: f.topic || '(제목 없음)', cat: '', len: '', fmt: '', kw: [], date: f.date || '', script: f.body || '' }));
  return fbs.concat(hooks).concat(refs);
}
function plRenderLib() {
  const D = PLANNING_DATA;
  document.getElementById('pl-sec-lib').innerHTML = `
    <div class="bg-white rounded-2xl p-5 shadow-sm mb-4" id="pl-lib-list">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-medium text-sm">레퍼 보관함 <span class="text-botanical-sage font-normal">(${D.refs.length + D.hookBank.length + (plCustomHooks || []).length + (plFeedbacks || []).length})</span></h3>
        <button onclick="plShowAddHook()" class="px-3 py-1.5 rounded-full text-xs border border-botanical-terracotta text-botanical-terracotta font-bold">+ 훅 추가</button>
      </div>
      <div id="pl-addhook-row" class="hidden mb-3 flex gap-1.5">
        <input type="text" id="pl-addhook-input" class="${PL_INPUT_CLS}" placeholder="훅 문장 입력 (예: 대기업 가면 전부 해결될 줄 알았다)">
        <button onclick="plSaveHook()" class="px-4 py-2 bg-botanical-fg text-white rounded-lg text-xs font-bold whitespace-nowrap">저장</button>
        <button onclick="document.getElementById('pl-addhook-row').classList.add('hidden')" class="px-3 py-2 border border-botanical-stone rounded-lg text-xs text-botanical-sage whitespace-nowrap">취소</button>
      </div>
      <div class="flex gap-1 bg-botanical-cream p-1 rounded-full w-fit mb-3" id="pl-lib-view">
        <button onclick="plSetLibView('all',this)" class="pl-view-btn px-3 py-1 rounded-full text-xs font-medium bg-white text-botanical-fg shadow-sm" data-v="all">전체</button>
        <button onclick="plSetLibView('hook',this)" class="pl-view-btn px-3 py-1 rounded-full text-xs font-medium text-botanical-sage" data-v="hook">훅</button>
        <button onclick="plSetLibView('ref',this)" class="pl-view-btn px-3 py-1 rounded-full text-xs font-medium text-botanical-sage" data-v="ref">레퍼</button>
        <button onclick="plSetLibView('fb',this)" class="pl-view-btn px-3 py-1 rounded-full text-xs font-medium text-botanical-sage" data-v="fb">피드백</button>
      </div>
      <div class="flex flex-wrap gap-1.5 mb-3">
        <input type="text" id="pl-lib-q" class="flex-1 min-w-[130px] px-3 py-2 border border-botanical-stone rounded-lg text-sm bg-white" placeholder="키워드 검색" oninput="plLibList()">
        <select id="pl-lib-skel" class="px-2 py-2 border border-botanical-stone rounded-lg text-xs bg-white" onchange="plLibList()">
          <option value="">골격 전체</option>
          ${D.skeletons.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
        <select id="pl-lib-cat" class="px-2 py-2 border border-botanical-stone rounded-lg text-xs bg-white" onchange="plLibList()">
          <option value="">카테고리 전체</option>
          ${['커리어&자기계발', '재테크&부동산', 'AI', '라이프', '기타'].map(c => `<option>${c}</option>`).join('')}
        </select>
        <button onclick="plLibReset()" class="px-3 py-2 border border-botanical-stone rounded-lg text-xs text-botanical-sage hover:text-botanical-fg" title="검색 초기화">↺ 초기화</button>
      </div>
      <div id="pl-lib-items" class="divide-y divide-botanical-stone"></div>
    </div>
    <div class="bg-white rounded-2xl p-5 shadow-sm mb-4 hidden" id="pl-lib-detail"></div>
  `;
  plLibList();
}
function plSetLibView(v, btn) {
  plSel.libView = v;
  document.querySelectorAll('.pl-view-btn').forEach(b => {
    if (b.dataset.v === v) { b.classList.add('bg-white', 'text-botanical-fg', 'shadow-sm'); b.classList.remove('text-botanical-sage'); }
    else { b.classList.remove('bg-white', 'text-botanical-fg', 'shadow-sm'); b.classList.add('text-botanical-sage'); }
  });
  // 훅·피드백 뷰에서는 포맷·카테고리 필터 숨김 (해당 없음)
  const hide = v === 'hook' || v === 'fb';
  document.getElementById('pl-lib-skel').classList.toggle('hidden', hide);
  document.getElementById('pl-lib-cat').classList.toggle('hidden', hide);
  plLibList();
}
function plLibReset() {
  document.getElementById('pl-lib-q').value = '';
  document.getElementById('pl-lib-skel').value = '';
  document.getElementById('pl-lib-cat').value = '';
  plLibList();
}
function plLibList() {
  const D = PLANNING_DATA;
  const q = document.getElementById('pl-lib-q').value.trim();
  const skel = document.getElementById('pl-lib-skel').value;
  const cat = document.getElementById('pl-lib-cat').value;
  const view = plSel.libView || 'all';
  let list = plLibEntries();
  if (view !== 'all') list = list.filter(e => e.type === view); // view 값이 곧 entry.type (hook/ref/fb)
  if (view === 'all' || view === 'ref') {
    if (skel) list = list.filter(e => e.type === 'ref' && e.skel === skel);
    if (cat) list = list.filter(e => e.type !== 'ref' || e.cat === cat);
  }
  if (q) list = list.filter(e => e.hook.includes(q) || (e.kw || []).some(k => k.includes(q)) || (e.script || '').includes(q));
  const tag = (txt, cls) => `<span class="inline-block whitespace-nowrap shrink-0 px-2 py-0.5 rounded-full bg-botanical-cream border border-botanical-stone text-[10px] ${cls || 'text-botanical-sage'} mr-1">${txt}</span>`;
  document.getElementById('pl-lib-items').innerHTML = list.map(e => `
    <div class="py-3 cursor-pointer hover:bg-botanical-cream/40 transition-all" onclick="plOpenDetail('${e.type}','${e.no}')">
      <div class="flex items-center gap-1 mb-0.5">
        ${e.type === 'hook' ? tag('훅만', 'text-botanical-terracotta font-bold')
          : e.type === 'fb' ? tag('피드백', 'text-botanical-fg font-bold')
          : tag(e.cat) + (e.own ? tag('★유디트', 'text-botanical-terracotta font-bold') : '') + (e.sub ? tag('자막만') : '')}
        ${e.type === 'ref'
          ? (e.cover ? `<span class="text-xs text-botanical-sage truncate min-w-0">표지 · ${e.cover}</span>` : '')
          : `<span class="text-sm leading-snug truncate min-w-0">${e.hook}</span>`}
      </div>
      ${e.type === 'ref' ? `<div class="text-sm leading-snug truncate">훅 · ${e.hook}</div>` : ''}
    </div>`).join('') || '<div class="py-8 text-center text-sm text-botanical-sage">검색 결과 없음</div>';
}
// 피드백 본문을 구간별 카드로 렌더 — 원본(연한 줄) / 수정(진한 배경 줄) / 이유(작은 줄)
function plFeedbackBodyHtml(body) {
  const blocks = (body || '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  let html = '';
  blocks.forEach(block => {
    if (block.startsWith('[어항 예시]')) return; // 제목은 위 h3에 이미 있음
    if (block.startsWith('[포인트]')) {
      html += `<div class="mt-3 text-xs text-botanical-sage bg-botanical-cream rounded-lg p-3 leading-relaxed">👉 ${block.replace('[포인트]', '').trim()}</div>`;
      return;
    }
    let rows = '';
    block.split('\n').forEach(line => {
      const m = line.match(/^(원본 대사|수정 대사|수정 이유)\s*:\s*(.*)$/);
      if (!m) { rows += `<div class="px-3 py-1.5 text-sm text-botanical-fg leading-relaxed">${line}</div>`; return; }
      const label = m[1], val = m[2] || '—';
      if (label === '원본 대사') {
        rows += `<div class="px-3 py-2 text-sm leading-relaxed"><span class="inline-block text-[10px] font-bold text-botanical-sage border border-botanical-stone rounded px-1.5 py-0.5 mr-1.5">원본</span><span class="text-botanical-sage">${val}</span></div>`;
      } else if (label === '수정 대사') {
        rows += `<div class="px-3 py-2.5 text-sm leading-relaxed" style="background:#B9C9AC;border-left:4px solid #C27B66"><span class="inline-block text-[10px] font-bold text-white rounded px-1.5 py-0.5 mr-1.5" style="background:#C27B66">수정</span><span class="font-semibold text-botanical-fg">${val}</span></div>`;
      } else {
        rows += `<div class="px-3 py-1.5 text-xs text-botanical-sage border-t border-dashed border-botanical-stone">${val}</div>`;
      }
    });
    html += `<div class="rounded-xl border border-botanical-stone overflow-hidden mb-2.5">${rows}</div>`;
  });
  return html || '<div class="text-sm text-botanical-sage">(내용 없음)</div>';
}

function plOpenDetail(type, no) {
  const D = PLANNING_DATA;
  const el = document.getElementById('pl-lib-detail');
  document.getElementById('pl-lib-list').classList.add('hidden');
  el.classList.remove('hidden');
  const sect = (title, body) => body ? `<div class="mt-4"><p class="text-[11px] font-bold text-botanical-sage tracking-wide mb-1.5">${title}</p><div class="text-sm leading-relaxed whitespace-pre-wrap bg-botanical-cream/50 rounded-xl p-3">${body}</div></div>` : '';
  if (type === 'fb') {
    const f = (plFeedbacks || []).find(x => String(x.id) === String(no));
    if (!f) { plCloseDetail(); return; }
    el.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xs text-botanical-terracotta cursor-pointer" onclick="plCloseDetail()">← 목록으로</span>
        <button onclick="plDeleteFeedback('${f.id}')" class="px-3 py-1 rounded-full text-xs border border-botanical-stone text-botanical-sage hover:text-red-500 hover:border-red-300">삭제</button>
      </div>
      <h3 class="font-medium text-base mt-3">${f.topic || '(제목 없음)'}</h3>
      <div class="mt-1"><span class="inline-block px-2 py-0.5 rounded-full bg-botanical-cream border border-botanical-stone text-[10px] text-botanical-fg font-bold">어항 예시 (참고용)</span></div>
      <div class="mt-4">${plFeedbackBodyHtml(f.body)}</div>`;
    return;
  }
  if (type === 'hook') {
    const all = PLANNING_DATA.hookBank.concat(plCustomHooks || []);
    const idx = all.findIndex(x => String(x.id) === String(no));
    const h = all[idx];
    el.innerHTML = `
      <span class="text-xs text-botanical-terracotta cursor-pointer" onclick="plCloseDetail()">← 목록으로</span>
      <h3 class="font-medium text-base mt-3">${h.hook}</h3>
      <div class="mt-1"><span class="inline-block px-2 py-0.5 rounded-full bg-botanical-cream border border-botanical-stone text-[10px] text-botanical-terracotta font-bold">훅만 (대본 없음)</span></div>
      ${sect('훅 응용 템플릿', h.template)}
      ${sect('훅 패턴', h.pattern)}
      ${(!h.template && !h.pattern) ? '<p class="text-xs text-botanical-sage mt-4">아직 태깅 전이에요 — 앤한테 「훅 태깅해줘」 하면 패턴·템플릿이 채워져요</p>' : ''}`;
    return;
  }
  const r = D.refs.find(x => x.no === +no);
  el.innerHTML = `
    <span class="text-xs text-botanical-terracotta cursor-pointer" onclick="plCloseDetail()">← 목록으로</span>
    <h3 class="font-medium text-base mt-3">${r.no}. ${r.title}</h3>
    <div class="mt-1.5 mb-2">
      <span class="inline-block px-2 py-0.5 rounded-full bg-botanical-cream border border-botanical-stone text-[10px] text-botanical-sage mr-1">${r.category}</span>
      <span class="inline-block px-2 py-0.5 rounded-full bg-botanical-cream border border-botanical-stone text-[10px] text-botanical-sage mr-1">${r.length}</span>
      <span class="inline-block px-2 py-0.5 rounded-full bg-botanical-cream border border-botanical-stone text-[10px] text-botanical-sage">${r.hookType}</span>
    </div>
    ${r.link ? `<a href="${r.link}" target="_blank" class="inline-block px-4 py-2 bg-botanical-terracotta text-white rounded-full text-xs font-bold">▶ 원본 릴스 보기</a>` : ''}
    ${sect('표지 카피 (썸네일)', r.cover)}
    ${sect('훅 응용 템플릿', r.template + (r.templateEx ? '\n→ 예: ' + r.templateEx : ''))}
    ${sect('훅 패턴', r.hookPattern || r.hookType)}
    ${sect('터진 이유', r.viral)}
    ${sect('원본 대본', r.script)}`;
}
function plCloseDetail() {
  document.getElementById('pl-lib-detail').classList.add('hidden');
  document.getElementById('pl-lib-list').classList.remove('hidden');
}
function plShowAddHook() {
  document.getElementById('pl-addhook-row').classList.remove('hidden');
  document.getElementById('pl-addhook-input').focus();
}
// 피드백 삭제 (보관함 상세에서)
async function plDeleteFeedback(id) {
  if (!confirm('이 피드백을 삭제할까요?')) return;
  plFeedbacks = (plFeedbacks || []).filter(f => String(f.id) !== String(id));
  try { await upsertToSupabase('planning_feedbacks', { items: plFeedbacks }); plToast('피드백 삭제됨'); }
  catch (e) { plToast('삭제 실패 — 네트워크 확인'); }
  plCloseDetail();
  plLibList();
}

async function plSaveHook() {
  const input = document.getElementById('pl-addhook-input');
  const hook = (input.value || '').trim();
  if (!hook) return;
  plCustomHooks = plCustomHooks || [];
  plCustomHooks.push({ id: 'C' + Date.now(), hook, pattern: '', template: '' });
  try { await upsertToSupabase('planning_hooks', { hooks: plCustomHooks }); plToast('훅 저장 완료!'); }
  catch (e) { plToast('저장 실패 — 네트워크 확인'); }
  input.value = '';
  document.getElementById('pl-addhook-row').classList.add('hidden');
  plLibList();
}

// ---------- 검색어 추천 ----------
function plRenderKw() {
  const D = PLANNING_DATA;
  document.getElementById('pl-sec-kw').innerHTML = `
    <div class="bg-white rounded-2xl p-5 shadow-sm mb-4">
      <h3 class="font-medium text-sm mb-1">검색어 추천</h3>
      <p class="text-[11px] text-botanical-sage mb-4">탭하면 복사돼요 — 인스타 검색 → 인기 탭에서 베스트 레퍼 찾기</p>
      ${Object.entries(D.keywords).map(([cat, kws]) => `
        <div class="mb-4">
          <p class="text-xs font-bold mb-2">${cat}</p>
          <div class="flex flex-wrap gap-1.5">
            ${kws.map(k => `<button onclick="plCopyKw('${k}')" class="px-3 py-1.5 rounded-full text-xs border border-botanical-stone bg-white text-botanical-fg hover:border-botanical-sage transition-all">${k}</button>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}
function plCopyKw(k) { navigator.clipboard.writeText(k).then(() => plToast(`"${k}" 복사!`)); }

// ---------- 공통 유틸 ----------
// 외부 링크 열기 — PWA에서 외부 Safari/앱으로 (기존 열기 버튼들과 동일 패턴)
function plOpenExt(url) {
  window.open(url, '_system') || window.open(url, '_blank');
}
// 기획 데이터 재시도 로드
function plRetryData() {
  const s = document.createElement('script');
  s.src = 'data/planning_data.js?t=' + Date.now();
  s.onload = () => renderPlanning();
  s.onerror = () => plToast('로딩 실패 — 네트워크 확인 후 다시 시도해주세요');
  document.body.appendChild(s);
}
function plToast(msg) {
  let t = document.getElementById('pl-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'pl-toast';
    t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-botanical-fg text-white px-5 py-2.5 rounded-full text-sm z-50 transition-opacity duration-300 pointer-events-none';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 1500);
}

// ========== Init ==========
loadData();
