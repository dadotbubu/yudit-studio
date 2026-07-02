/* 미디어킷 데이터 렌더 엔진 (한/영 공용)
 * - 페이지가 window.MK_LANG = 'ko' | 'en' 설정 후 이 파일 로드
 * - Supabase 'mediakit'(편집값) + 'performance'(팔로워 자동) 읽어 .phone 렌더
 * - 데이터 없거나 로드 실패 시 정적 HTML(폴백) 그대로 유지
 * - 숫자는 raw 저장 → 언어별 자동 포맷 (1.2만 / 12K)
 */
(function () {
  var LANG = window.MK_LANG === 'en' ? 'en' : 'ko';
  var SUPABASE_URL = 'https://vihrydqudawrlwddffwa.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaHJ5ZHF1ZGF3cmx3ZGRmZndhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTcxNjIsImV4cCI6MjA5MTgzMzE2Mn0.5QkOjtl25PgbCDenWNgyqelbgPeerg6sqROQa624G9A';
  var TABLE = 'studio_data';

  // ===== 기본값 (폴백 + 시드) — 현재 미디어킷 값 =====
  var DEFAULT = {
    name: { ko: '유디트', en: 'Yudit' },
    ig: 'https://www.instagram.com/yudit_life/',
    email: 'yudit_@naver.com',
    images: { headerBg: null, avatar: 'header.jpg' }, // headerBg 없으면 세이지 색
    tags: {
      ko: ['재테크', '자기계발', '대기업 라이프', 'AI'],
      en: ['Finance', 'Self-growth', 'Couple Life', 'AI']
    },
    bio: {
      ko: ['대기업 7관왕 부부 🕶️', '억대연봉 찍은 |커리어 만렙| ✨', '취미는 잘 모으고 잘 쓰는 법 공유하기 ✌🏻'],
      en: ['A big-tech couple · 7 offers combined 🕶️', '|Six-figure| earning couple ✨', 'Sharing how to save & spend smart ✌🏻']
    },
    stats: { views30d: 1008506, reach30d: 670461 }, // 팔로워는 performance에서 자동
    gender: { female: 51.5, male: 48.5 },
    age: [
      { label: '18-24', pct: 24.7 }, { label: '25-34', pct: 42.3 },
      { label: '35-44', pct: 17.6 }, { label: '45-54', pct: 8.1 }
    ],
    regions: [
      { ko: '서울', en: 'Seoul', pct: 24.2 },
      { ko: '인천', en: 'Incheon', pct: 5.4 },
      { ko: '부산', en: 'Busan', pct: 5.2 }
    ],
    topContent: [
      { cat: 'Career', views: 1039000, img: 'reel1.png' },
      { cat: 'Career', views: 612000, img: 'reel2.png' },
      { cat: 'Life', views: 343000, img: 'reel3.png' },
      { cat: 'Money', views: 152000, img: 'reel4.png' }
    ],
    adCase: {
      views: 506000, img: 'ad1.png',
      ko: { title: '스펙 안 좋아도 서류 합격하는 특징', desc: '포폴 템플릿 협업' },
      en: { title: 'What gets you past resume screening', desc: 'Portfolio template collab' }
    },
    brands: [], // 비면 섹션 숨김
    rates: {
      noteKo: '3.3% 공제', noteEn: 'USD',
      ko: [
        { label: '릴스 제작 + 업로드', amount: '700,000원' },
        { label: '카드뉴스 제작 + 업로드', amount: '500,000원' },
        { label: '2차 활용', amount: '50,000원 / 월' }
      ],
      en: [
        { label: 'Reel (produce + post)', amount: '$650' },
        { label: 'Card-news (produce + post)', amount: '$450' },
        { label: 'Usage rights', amount: '$50 / mo' }
      ]
    }
  };

  // ===== 숫자 포맷 =====
  function fmtKo(n) {
    if (n == null || isNaN(n)) return '';
    n = Number(n);
    if (n >= 100000000) { var e = Math.floor(n / 10000000) / 10; return (e % 1 === 0 ? e : e.toFixed(1)) + '억'; }
    var m = Math.floor(n / 1000) / 10; // 만, 소수 1자리 (내림)
    return (m % 1 === 0 ? m : m.toFixed(1)) + '만';
  }
  function fmtEn(n) {
    if (n == null || isNaN(n)) return '';
    n = Number(n);
    if (n >= 1000000) { var m = (n / 1000000).toFixed(2).replace(/\.?0+$/, ''); return m + 'M'; }
    if (n >= 1000) return Math.floor(n / 1000) + 'K';
    return String(n);
  }
  function fmtNum(n) { return LANG === 'en' ? fmtEn(n) : fmtKo(n); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function em(line) { // |강조| → <span class="em">강조</span>
    return esc(line).replace(/\|([^|]+)\|/g, '<span class="em">$1</span>');
  }

  // ===== 렌더 =====
  function render(d) {
    var L = LANG;
    var T = {
      ig: L === 'en' ? '📷 Visit Instagram' : '📷 인스타그램 바로가기',
      followers: L === 'en' ? 'Followers' : '팔로워',
      views: L === 'en' ? 'Views · Last 30 days' : '최근 30일 조회수',
      dist: L === 'en' ? 'Audience' : '팔로워 분포',
      gender: L === 'en' ? 'Gender' : '성별',
      female: L === 'en' ? 'Female' : '여성',
      male: L === 'en' ? 'Male' : '남성',
      age: L === 'en' ? 'Age' : '연령대',
      region: L === 'en' ? 'Location' : '지역',
      top: L === 'en' ? 'Top Content' : '대표 콘텐츠',
      adcase: L === 'en' ? 'Sponsored Results' : '광고 성과 사례',
      brands: L === 'en' ? 'Brands' : '협업 브랜드',
      rate: L === 'en' ? 'Rate Card' : '콘텐츠 협업 단가',
      rateH: L === 'en' ? '💲 Rate Card' : '💲 협업 단가',
      contact: L === 'en' ? '📩 Contact for collab' : '📩 협업 문의하기',
      foot: L === 'en' ? '© Yudit · yudit_life — Open for collaborations' : '© 유디트 · yudit_life — 협업 문의 환영합니다',
      collab: L === 'en' ? '📩 Collab : ' : '📩 협업 문의 : ',
      viewsWord: L === 'en' ? 'views' : '조회'
    };
    var name = (d.name && d.name[L]) || DEFAULT.name[L];
    var tags = (d.tags && d.tags[L]) || DEFAULT.tags[L];
    var bioLines = (d.bio && d.bio[L]) || DEFAULT.bio[L];
    var email = d.email || DEFAULT.email;
    var followers = d._followers; // performance에서 주입
    var reachStr = L === 'en'
      ? '🎯 Reached <b>' + fmtNum(d.stats.reach30d) + ' accounts</b> in the last 30 days'
      : '🎯 최근 30일 <b>' + fmtNum(d.stats.reach30d) + ' 계정</b>에 도달';

    var bioHtml = bioLines.map(function (l) { return em(l); }).join('<br>') +
      '<br><span class="em">' + T.collab + esc(email) + '</span>';

    var tagHtml = tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');

    // 연령 바 (최대값 기준 높이)
    var maxAge = Math.max.apply(null, d.age.map(function (a) { return a.pct; }).concat([1]));
    var ageHtml = d.age.map(function (a) {
      var h = Math.max(6, Math.round(a.pct / maxAge * 100));
      return '<div class="bar-col"><div class="bar" style="height:' + h + '%"></div><div class="bar-lab">' + esc(a.label) + '<br><b>' + a.pct + '%</b></div></div>';
    }).join('');

    var genderPct = d.gender.female;
    var geoHtml = d.regions.map(function (r) {
      return '<div class="geo"><span>📍 ' + esc(r[L] || r.ko) + '</span><span class="v">' + r.pct + '%</span></div>';
    }).join('');

    var reelsHtml = d.topContent.map(function (c) {
      return '<div class="reel"><div class="thumb" style="background:url(\'' + esc(c.img) + '\') center 18%/cover"></div>' +
        '<div class="meta"><span class="cat">' + esc(c.cat) + '</span><span class="view">👁️ ' + fmtNum(c.views) + '</span></div></div>';
    }).join('');

    // 광고 성과 (여러 개 · 비면 숨김)
    var adList = (d.adCases || (d.adCase ? [d.adCase] : [])).filter(function (a) { return a && a[L] && a[L].title; });
    var adHtml = '';
    if (adList.length) {
      adHtml = '<h2>' + T.adcase + '</h2>' + adList.map(function (a) {
        var ac = a[L];
        return '<div class="panel"><div class="case">' +
          '<div class="pic" style="background:url(\'' + esc(a.img) + '\') center 20%/cover"></div>' +
          '<div><div class="nm">' + esc(ac.title) + '</div><div class="vw">👁️ ' + fmtNum(a.views) + ' ' + T.viewsWord + ' · ' + esc(ac.desc) + '</div></div></div></div>';
      }).join('');
    }

    // 협업 브랜드 (비면 숨김)
    var brandHtml = '';
    if (d.brands && d.brands.length) {
      brandHtml = '<h2>' + T.brands + '</h2><div class="brands">' +
        d.brands.map(function (b) { var nm = typeof b === 'string' ? b : (b[L] || b.ko || b.en || ''); return '<span class="brand"><span class="b"></span>' + esc(nm) + '</span>'; }).join('') +
        '</div>';
    }

    var rates = (d.rates && d.rates[L]) || DEFAULT.rates[L];
    var note = L === 'en' ? (d.rates && d.rates.noteEn || 'USD') : (d.rates && d.rates.noteKo || '3.3% 공제');
    var rateRows = rates.map(function (r) {
      return '<div class="prow"><span>' + esc(r.label) + '</span><span class="amt">' + esc(r.amount) + '</span></div>';
    }).join('');

    var mailHref = 'mailto:' + email + '?subject=' + encodeURIComponent(L === 'en' ? '[Collab] Yudit channel' : '[협업 문의] 유디트 채널 협업 제안');

    var avatarUrl = (d.images && d.images.avatar) || 'header.jpg';
    var head =
      '<div class="ava" style="background:url(\'' + avatarUrl + '\') center 60%/cover"></div>' +
      '<div class="name">' + esc(name) + '</div>' +
      '<a class="iglink" href="' + esc(d.ig || DEFAULT.ig) + '" target="_blank" rel="noopener">' + T.ig + '</a>' +
      '<div class="tags">' + tagHtml + '</div>' +
      '<div class="bio">' + bioHtml + '</div>';

    var body =
      '<div class="stat-row">' +
        '<div class="stat"><div class="ic">👥</div><div class="num">' + fmtNum(followers) + '</div><div class="lab">' + T.followers + '</div></div>' +
        '<div class="stat"><div class="ic">👁️</div><div class="num">' + fmtNum(d.stats.views30d) + '</div><div class="lab">' + T.views + '</div></div>' +
      '</div>' +
      '<div class="reach">' + reachStr + '</div>' +
      '<h2>' + T.dist + '</h2>' +
      '<div class="panel"><div class="ttl">' + T.gender + '</div><div class="donut-wrap">' +
        '<div class="donut" style="background:conic-gradient(var(--accent) 0 ' + genderPct + '%,#8C9A84 ' + genderPct + '% 100%)"></div>' +
        '<ul class="legend">' +
          '<li><span class="dot" style="background:var(--accent)"></span> ' + T.female + ' <b style="margin-left:4px">' + d.gender.female + '%</b></li>' +
          '<li><span class="dot" style="background:#8C9A84"></span> ' + T.male + ' <b style="margin-left:4px">' + d.gender.male + '%</b></li>' +
        '</ul></div></div>' +
      '<div class="panel"><div class="ttl">' + T.age + '</div><div class="bars">' + ageHtml + '</div></div>' +
      '<div class="panel"><div class="ttl">' + T.region + '</div>' + geoHtml + '</div>' +
      '<h2>' + T.top + '</h2><div class="reels">' + reelsHtml + '</div>' +
      adHtml +
      brandHtml +
      '<h2>' + T.rate + '</h2><div class="price"><div class="ph"><span class="h">' + T.rateH + '</span><span class="vat">' + esc(note) + '</span></div>' + rateRows + '</div>' +
      '<a class="contact" href="' + mailHref + '">' + T.contact + '</a>' +
      '<div class="contact-mail">📧 ' + esc(email) + '</div>' +
      '<div class="foot">' + T.foot + '</div>';

    var headBgStyle = (d.images && d.images.headerBg)
      ? ' style="background:linear-gradient(180deg,rgba(30,40,34,.12),rgba(38,50,43,.55)),url(\'' + d.images.headerBg + '\') center/cover"'
      : '';
    var phone = document.querySelector('.phone');
    if (phone) phone.innerHTML = '<div class="head"' + headBgStyle + '>' + head + '</div><div class="body">' + body + '</div>';
  }

  // ===== 로드 =====
  function fetchKey(key) {
    return fetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?key=eq.' + key + '&select=data,updated_at&order=updated_at.desc', {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) { return rows[0] ? rows[0].data : null; }).catch(function () { return null; });
  }

  function boot() {
    Promise.all([fetchKey('mediakit'), fetchKey('performance')]).then(function (res) {
      var mk = res[0], perf = res[1];
      var d = mergeDefault(mk || {});
      // 팔로워 자동: performance 우선
      var f = null;
      if (perf && perf.follower) {
        if (perf.follower.current) f = perf.follower.current;
        else if (perf.follower.history && perf.follower.history.daily && perf.follower.history.daily.length) {
          var daily = perf.follower.history.daily.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
          f = daily[0].count;
        }
      }
      if (f == null && mk && mk.stats && mk.stats.followers) f = mk.stats.followers;
      if (f == null) f = 12517;
      d._followers = f;
      try { render(d); } catch (e) { console.warn('미디어킷 렌더 실패, 정적 유지:', e); }
    });
  }

  // 얕은 병합 (섹션 단위로 기본값 채움)
  function mergeDefault(mk) {
    var d = JSON.parse(JSON.stringify(DEFAULT));
    Object.keys(mk).forEach(function (k) { if (mk[k] != null) d[k] = mk[k]; });
    return d;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
