'use strict';
/**
 * 사주팔자(四柱八字) 계산기
 * - 연주/월주: 태양 황경으로 절기(입춘 등)를 계산해 결정
 * - 일주: 1900-01-01 = 甲戌일 기준
 * - 시주: 일간 기준 오자둔(五子遁)
 * 입력 시각은 한국 표준시(UTC+9)로 간주. 서머타임·진태양시 보정은 하지 않음.
 */
(function (root) {
  const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const STEMS_KO = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
  const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  const BRANCHES_KO = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
  const ANIMALS = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
  const ELEMENTS = ['목', '화', '토', '금', '수'];
  const STEM_EL = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
  const BRANCH_EL = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];
  const YIN_YANG = (i) => (i % 2 === 0 ? '양' : '음');

  const DAY_MASTER = [
    { name: '갑목(甲木)', image: '큰 나무', desc: '곧게 뻗어 오르는 큰 나무처럼 진취적이고 리더십이 있으며, 원칙과 자존심을 중시합니다.' },
    { name: '을목(乙木)', image: '풀·덩굴', desc: '유연하고 적응력이 뛰어나며, 부드러움 속에 끈질긴 생명력과 친화력을 지녔습니다.' },
    { name: '병화(丙火)', image: '태양', desc: '밝고 열정적이며 숨김없이 솔직합니다. 주변을 환하게 만드는 표현력과 추진력이 있습니다.' },
    { name: '정화(丁火)', image: '촛불·등불', desc: '따뜻하고 섬세하며 집중력이 좋습니다. 조용히 주변을 밝히는 헌신과 통찰이 있습니다.' },
    { name: '무토(戊土)', image: '큰 산', desc: '듬직하고 포용력이 크며 신뢰를 줍니다. 쉽게 흔들리지 않는 중심과 책임감이 있습니다.' },
    { name: '기토(己土)', image: '논밭·정원', desc: '세심하고 실용적이며 사람과 일을 길러내는 능력이 있습니다. 현실 감각과 배려심이 강점입니다.' },
    { name: '경금(庚金)', image: '바위·원석', desc: '결단력과 의리가 있고 강직합니다. 맺고 끊음이 분명하며 개혁과 실행에 강합니다.' },
    { name: '신금(辛金)', image: '보석', desc: '예리하고 섬세하며 완성도를 추구합니다. 감각이 뛰어나고 자기만의 기준이 뚜렷합니다.' },
    { name: '임수(壬水)', image: '바다·큰 강', desc: '스케일이 크고 지혜로우며 포용력이 있습니다. 자유로운 사고와 기획력이 돋보입니다.' },
    { name: '계수(癸水)', image: '비·이슬', desc: '총명하고 감수성이 풍부하며 직관이 좋습니다. 조용히 스며드는 영향력과 인내가 있습니다.' },
  ];
  const ELEMENT_TIP = {
    목: '성장·계획·배움 (산책, 새로운 공부, 초록색, 아침 활동)',
    화: '열정·표현·관계 (운동으로 땀 내기, 사람 만나기, 발표/표현)',
    토: '안정·신뢰·루틴 (규칙적인 생활, 정리정돈, 식사 리듬)',
    금: '결단·정리·원칙 (우선순위 정하기, 버리기, 체계 만들기)',
    수: '지혜·휴식·유연함 (충분한 수면, 명상, 독서, 수분 섭취)',
  };

  const rad = (d) => (d * Math.PI) / 180;
  const norm = (d) => ((d % 360) + 360) % 360;

  // 태양 겉보기 황경 (정밀도 약 0.01°)
  function sunLongitude(jd) {
    const T = (jd - 2451545.0) / 36525;
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(rad(M)) +
      (0.019993 - 0.000101 * T) * Math.sin(rad(2 * M)) + 0.000289 * Math.sin(rad(3 * M));
    const omega = 125.04 - 1934.136 * T;
    return norm(L0 + C - 0.00569 - 0.00478 * Math.sin(rad(omega)));
  }
  const jdFromUtcMs = (ms) => ms / 86400000 + 2440587.5;

  const mod = (n, m) => ((n % m) + m) % m;
  const pillar = (stem, branch) => ({
    stem, branch,
    hanja: STEMS[stem] + BRANCHES[branch],
    hangul: STEMS_KO[stem] + BRANCHES_KO[branch],
  });

  /**
   * @param {string} date  'YYYY-MM-DD'
   * @param {string} [time] 'HH:MM' (모르면 생략)
   */
  function calculate(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
    const [y, m, d] = date.split('-').map(Number);
    const hasTime = /^\d{2}:\d{2}$/.test(time || '');
    const [hh, mm] = hasTime ? time.split(':').map(Number) : [12, 0];
    const utcMs = Date.UTC(y, m - 1, d, hh - 9, mm);
    const lon = sunLongitude(jdFromUtcMs(utcMs));

    // 월지: 입춘(315°)부터 30°마다. k=0 寅월 ... k=11 丑월
    const k = Math.floor(norm(lon - 315) / 30);
    // 연주: 입춘 전(1~2월의 子·丑월)이면 전년도
    const sajuYear = m <= 2 && k >= 10 ? y - 1 : y;
    const yIdx = mod(sajuYear - 4, 60);
    const yearP = pillar(yIdx % 10, yIdx % 12);

    const monthP = pillar(mod(yearP.stem * 2 + 2 + k, 10), (2 + k) % 12);

    const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 1)) / 86400000);
    const dIdx = mod(10 + days, 60);
    const dayP = pillar(dIdx % 10, dIdx % 12);

    let hourP = null;
    if (hasTime) {
      const hb = Math.floor((hh + 1) / 2) % 12;
      hourP = pillar(mod(dayP.stem * 2 + hb, 10), hb);
    }

    const pillars = [yearP, monthP, dayP, hourP].filter(Boolean);
    const counts = [0, 0, 0, 0, 0];
    pillars.forEach((p) => { counts[STEM_EL[p.stem]]++; counts[BRANCH_EL[p.branch]]++; });
    const elements = ELEMENTS.map((name, i) => ({ name, count: counts[i] }));
    const max = Math.max(...counts);
    const strong = elements.filter((e) => e.count === max).map((e) => e.name);
    const lacking = elements.filter((e) => e.count === 0).map((e) => e.name);

    return {
      year: yearP, month: monthP, day: dayP, hour: hourP,
      animal: ANIMALS[yearP.branch],
      dayMaster: { ...DAY_MASTER[dayP.stem], element: ELEMENTS[STEM_EL[dayP.stem]], yinYang: YIN_YANG(dayP.stem) },
      elements, strong, lacking,
      tips: (lacking.length ? lacking : ELEMENTS.filter((e) => !strong.includes(e)).slice(0, 1))
        .map((e) => ({ element: e, tip: ELEMENT_TIP[e] })),
      stemElement: (i) => ELEMENTS[STEM_EL[i]],
      branchElement: (i) => ELEMENTS[BRANCH_EL[i]],
      nearTermBoundary: Math.min(norm(lon - 315) % 30, 30 - (norm(lon - 315) % 30)) < 0.6,
    };
  }

  const api = { calculate, sunLongitude, ELEMENTS, STEMS, BRANCHES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Saju = api;
})(typeof window !== 'undefined' ? window : globalThis);
