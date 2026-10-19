/*
 * 자가견적 완성본 (2026-10-19 A팀 김개발): 요금 숫자·할인 규칙·계산 함수는 최종안과 같음.
 * - 변경: 사업장 추천 구성 실제 자동 선택, 고객용 문구 정리, 상담 접수(consult-service.js, 기존 Firebase 9필드) 연결
 * - 이 파일은 네트워크·브라우저 저장소를 직접 쓰지 않는다. 접수와 쿨다운 시간 저장은 consult-service.js가 담당
 * - 금액: 2026-10-18 요금표(토리가 고객 요금만 추출한 값)만 사용. 없는 행은 '상담 확인'
 * - 판매행 조회만 한다. 비례 계산·행 간 차액·TV 금액 재합산 금지(TV 행은 인터넷 포함 전체 금액). 모든 행 수량은 1
 */
(() => {
  'use strict';

  const PRICE_VERSION = '2026-10-18 요금';
  const RATE_NOTE = '2026-10-18 요금표 기준 · VAT 포함 여부/약정·설치 조건 상담 확인';

  // CCTV: VAT 포함, 36개월 할부 구매. monthly가 없으면 금액 미확정
  const CCTV_ROWS = [
    { id: 'cctv_2', label: '2대', monthly: 33000, months: 36 },
    { id: 'cctv_3', label: '3대', monthly: 38500, months: 36 },
    { id: 'cctv_4', label: '4대', monthly: 44000, months: 36 },
    { id: 'cctv_5p', label: '5대 이상(상담 확인 필요)', name: '5대 이상' },
    { id: 'cctv_unknown', label: '잘 모르겠어요' }
  ];
  const CARRIERS = [
    { id: 'kt', label: 'KT', tv: 'OTV 베이직' },
    { id: 'sk', label: 'SK', tv: '이코노미' },
    { id: 'lgu', label: 'LG U+ 일반', tv: '실속형' },
    { id: 'lgu_soho', label: 'LG U+ 우리가게패키지(SOHO)', short: 'LG U+ SOHO', tv: '실속형' }
  ];
  const SPEEDS = [{ id: '100M', label: '100M' }, { id: '500M', label: '500M' }];
  const AI = [{ id: 'no', label: '추가 안 함' }, { id: 'yes', label: '추가' }];
  // 인터넷 조합 행(월 원, Wi-Fi 포함 일반 대표 요금). TV 행은 인터넷 포함 전체 금액. SOHO 행에는 CCTV 미포함
  const NET_ROWS = {
    kt:       { none: { '100M': 23100, '500M': 34100 }, tv: { '100M': 38500, '500M': 44000 } },
    sk:       { none: { '100M': 23100, '500M': 34100 }, tv: { '100M': 36300, '500M': 42900 } },
    lgu:      { none: { '100M': 22000, '500M': 33000 }, tv: { '100M': 39600, '500M': 45100 } },
    lgu_soho: {
      none:    { '100M': 22000, '500M': 33000 },
      none_ai: { '100M': 31900, '500M': 37400 },
      tv:      { '100M': 39600, '500M': 45100 },
      tv_ai:   { '100M': 49500, '500M': 52800 }
    }
  };
  const tvOptions = (carrier) => [{ id: 'none', label: '없음' }, { id: 'tv', label: carrier ? byId(CARRIERS, carrier).tv : '대표 TV' }];
  // 정수기 더퓨어 나노 S 정상 렌탈료(월 원)
  const WATER_TYPES = [{ id: 'counter', label: '카운터형' }, { id: 'stand', label: '스탠드형' }];
  const WATER_MONTHS = [{ id: '36', label: '36개월' }, { id: '60', label: '60개월' }, { id: '72', label: '72개월' }];
  const WATER_ROWS = {
    counter: { 36: 23900, 60: 22900, 72: 20900 },
    stand:   { 36: 24900, 60: 23900, 72: 21900 }
  };
  // 제휴카드 청구할인(대표 제공 조건). CCTV 줄에만 적용, 카드는 하나만
  const CARDS = [
    { id: 'none', label: '선택 안 함' },
    { id: 'hyundai', label: '현대카드', short: '현대카드', discount: 18000, max: false,
      cond: '현대큐밍 현대카드 · 전월 40만원 이상 사용 시 월 18,000원 청구할인 · 2026년 10월 안내 기준 프로모션 60개월 · 세부 조건 상담 확인' },
    { id: 'lotte', label: '롯데카드(최대 할인)', short: '롯데카드', discount: 25000, max: true,
      cond: 'LOCA X 현대큐밍 · 전월 150만원 이상 · 직전 6개월 롯데 신용카드 무실적 · 10월 대상 고객 · 60개월 · 최대 월 25,000원 청구할인 적용 시 예상 · 2026년 10월 안내 기준, 세부 조건 상담 확인' }
  ];
  const CARD_NOTICE = '카드사 청구할인으로 실제 청구금액·적용 여부가 달라질 수 있음';
  const CARD_NA = 'CCTV 금액 상담 후 카드 적용 계산 (인터넷·TV·정수기에는 카드 할인을 적용하지 않습니다)';
  const SITE_NET = [{ id: 'yes', label: '있음' }, { id: 'no', label: '없음' }, { id: 'unknown', label: '잘 모르겠어요' }];
  // 사업장 추천 구성 (첫 화면 '이 구성으로 계산하기'). 금액은 위 표에서만 조회. 카드·설치 장소 인터넷 선택은 바꾸지 않는다
  const PRESETS = {
    soho: { cctv: 'cctv_4', net: { carrier: 'lgu_soho', speed: '500M', tv: 'none', ai: 'yes' }, water: { type: 'counter', months: '60' } }
  };
  const PRIVACY_VERSION = '2026-10-19';
  const CUST_TYPES = { personal: '개인', business: '사업자' };

  // 메모리 상태 (개인정보 없음)
  const state = {
    cctv: null,
    net: { carrier: null, speed: null, tv: null, ai: null },
    water: { type: null, months: null },
    card: 'none',
    siteNet: null,
    pushed: false,
    formStarted: false
  };

  const $ = (id) => document.getElementById(id);
  const won = (n) => n.toLocaleString('ko-KR') + '원';
  const byId = (list, id) => list.find((o) => o.id === id) || null;

  /* ---------- 칩(라디오) ---------- */
  function renderChips(container, name, options, getValue, onChange, cols3) {
    container.textContent = '';
    if (cols3) container.classList.add('chips--3');
    options.forEach((opt) => {
      const label = document.createElement('label');
      label.className = 'chip';
      label.dataset.value = opt.id;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = opt.id;
      input.checked = getValue() === opt.id;
      input.addEventListener('change', () => { onChange(opt.id); });
      const span = document.createElement('span');
      span.textContent = opt.label;
      label.append(input, span);
      container.append(label);
    });
  }
  function syncChecked(container, value) {
    container.querySelectorAll('input').forEach((i) => { i.checked = i.value === value; });
  }

  /* ---------- 견적 줄 ---------- */
  function buildLines() {
    const lines = [];
    if (state.cctv) {
      const row = byId(CCTV_ROWS, state.cctv);
      const priced = typeof row.monthly === 'number';
      lines.push({
        key: 'cctv',
        name: row.id === 'cctv_unknown' ? 'CCTV (대수 상담)' : `CCTV ${row.name || row.label}`,
        badge: ['inst', '할부 구매형'],
        meta: priced ? '36개월 · VAT 포함' : '36개월',
        amount: priced ? row.monthly : null,
        pendingText: '상담 확인'
      });
    }
    const n = state.net;
    if (n.carrier) {
      const c = byId(CARRIERS, n.carrier);
      const soho = n.carrier === 'lgu_soho';
      let name = `인터넷 ${c.short || c.label}`;
      if (n.speed) name += ` ${n.speed}`;
      if (soho && n.ai === 'yes') name += ' + AI전화';
      if (n.tv === 'tv') name += ` + ${c.tv} TV`;
      let amount = null;
      if (n.speed && n.tv) {
        const key = n.tv === 'tv' ? 'tv' : 'none';
        const rowKey = soho && n.ai === 'yes' ? key + '_ai' : key;
        const row = NET_ROWS[n.carrier][rowKey];
        amount = row ? row[n.speed] : null;
      }
      const metas = [];
      if (soho) metas.push('사업자 대상');
      metas.push('Wi-Fi 포함');
      if (!n.speed) metas.push('속도 선택 필요');
      metas.push(RATE_NOTE);
      lines.push({ key: 'net', name, badge: ['comm', '약정형'], meta: metas.join(' · '), amount, pendingText: '선택 필요 / 상담 확인', noteVat: true });
    }
    const w = state.water;
    if (w.type || w.months) {
      const amount = w.type && w.months ? WATER_ROWS[w.type][w.months] : null;
      const metas = [w.months ? `렌탈 기간 ${w.months}개월` : '렌탈 기간 선택 필요'];
      if (!w.type) metas.push('형태 선택 필요');
      metas.push('4개월 주기 관리', RATE_NOTE);
      lines.push({
        key: 'water',
        name: `정수기 더퓨어 나노 S${w.type ? ' ' + byId(WATER_TYPES, w.type).label : ''}`,
        badge: ['rent', '렌탈 관리형'],
        meta: metas.join(' · '),
        amount: typeof amount === 'number' ? amount : null,
        pendingText: '선택 필요 / 상담 확인',
        noteVat: true
      });
    }
    return lines;
  }
  const shortName = (l) => ({ cctv: 'CCTV', net: '인터넷', water: '정수기' }[l.key]);
  const periodOf = (l) => {
    if (l.key === 'cctv') return '36개월 할부 구매';
    if (l.key === 'net') return '약정 기간 상담 확인';
    return state.water.months ? `렌탈 기간 ${state.water.months}개월` : '렌탈 기간 선택 필요';
  };

  /* ---------- 합계·카드 계산 (CCTV에만 할인) ---------- */
  function computeQuote(lines) {
    const confirmed = lines.filter((l) => l.amount != null);
    const pending = lines.filter((l) => l.amount == null);
    const subtotal = confirmed.reduce((s, l) => s + l.amount, 0);
    const cctv = lines.find((l) => l.key === 'cctv');
    const card = byId(CARDS, state.card);
    const selected = card.id !== 'none';
    const cardApplied = selected && !!cctv && cctv.amount != null && cctv.amount > card.discount;
    const discount = cardApplied ? card.discount : 0;
    return {
      lines, confirmed, pending, subtotal, cctv, card, cardApplied, discount,
      cardNotApplied: selected && !cardApplied,
      after: subtotal - discount,
      cctvAfter: cardApplied ? cctv.amount - discount : null
    };
  }
  function labels(q) {
    const partial = q.pending.length > 0;
    const c = q.card;
    return {
      base: partial ? '확인된 항목 월요금 소계' : '기본 월 납부 합계',
      disc: c.discount ? `조건부 카드 청구할인 (${c.short}${c.max ? ', 최대' : ''})` : '',
      after: (c.max ? '최대 할인 적용 시 ' : '할인 적용 시 ') + (partial ? '확인된 항목 예상 부담 소계' : '예상 부담 합계')
    };
  }
  function renderCardCalc(q) {
    const box = $('card-calc');
    const c = q.card;
    if (c.id === 'none') {
      box.innerHTML = '<p class="hint">카드를 고르면 CCTV 예상 부담액을 단계별로 보여 드립니다.</p>';
      return;
    }
    if (!q.cardApplied) {
      box.innerHTML = `<p class="card-calc__na">${CARD_NA}</p><p class="card-calc__cond">${c.cond}<br>${CARD_NOTICE}</p>`;
      return;
    }
    box.innerHTML = `
      <ol class="card-calc__steps">
        <li><span>CCTV 기본 월요금</span><strong>${won(q.cctv.amount)}</strong></li>
        <li><span>${c.max ? '조건 충족 시 최대 카드 청구할인' : '조건 충족 시 카드 청구할인'}</span><strong>${won(q.discount)}</strong></li>
        <li class="is-result"><span>${c.max ? '최대 할인 적용 시 예상 CCTV 부담액' : '할인 적용 후 예상 CCTV 부담액'}</span><strong>${won(q.cctvAfter)}</strong></li>
      </ol>
      <p class="card-calc__cond">${c.cond}<br>${CARD_NOTICE}<br>36회 납부 합계는 기본 월요금 기준입니다.</p>`;
  }
  // 폼 선택 요약과 복사 내용에 같은 문장을 쓴다 (이름·연락처·지역 미포함)
  function quoteText(q, forCopy) {
    const L = labels(q);
    const out = [];
    if (forCopy) out.push(`[현대렌탈케어 CCTV 셀프견적 요약 · 판매·설치 상담 유나정보통신 1522-1606]`);
    if (!q.lines.length) out.push('· 선택 상품 없음 (상담 시 확인)');
    q.lines.forEach((l) => out.push(`· ${l.name} — ${l.badge[1]}, ${periodOf(l)}, ${l.amount == null ? l.pendingText : '월 ' + won(l.amount)}`));
    out.push(q.card.id === 'none' ? '· 제휴카드: 선택 안 함' : `· 제휴카드: ${q.card.label} — ${q.card.cond}`);
    if (q.confirmed.length) out.push(`· ${L.base}: ${won(q.subtotal)}`);
    if (q.cardApplied) {
      out.push(`· ${L.disc}: ${won(q.discount)}`);
      out.push(`· ${L.after}: ${won(q.after)}`);
    }
    if (q.cardNotApplied) out.push(`· ${CARD_NA}`);
    if (q.pending.length) out.push(`· 제외(상담 확인): ${q.pending.map(shortName).join(', ')}`);
    if (q.confirmed.some((l) => l.noteVat)) out.push(`· 인터넷·TV·정수기: ${RATE_NOTE}`);
    if (q.card.id !== 'none') out.push(`· ${CARD_NOTICE}`);
    out.push('· 예상 금액이며 최종 금액은 상담 후 확정됩니다.');
    out.push(`· 가격 기준: ${PRICE_VERSION}`);
    return out.join('\n');
  }

  /* ---------- 렌더 ---------- */
  // 2026-10-19 최종안: 하단 바·폼 금액 요약·카드 접힘 요약. 모두 computeQuote 결과(q)와 labels(q)만 사용하고 요금 상수는 복제하지 않는다
  const VAT_TERM_NOTE = '인터넷·정수기 VAT 포함 여부와 약정·설치 조건은 상담 확인';
  // 하단 바 윗줄: 기본 합계(미확정이 있으면 확인된 항목 소계)를 고정. 카드 할인 후 금액은 넣지 않는다
  function barText(q) {
    const n = q.pending.length;
    if (!q.lines.length) return { long: 'CCTV 대수를 먼저 선택', short: 'CCTV 대수 선택' };
    if (!q.confirmed.length) return { long: `금액 상담 확인 ${n}개`, short: `상담 확인 ${n}개` };
    if (!n) return { long: `기본 월 합계 ${won(q.subtotal)}`, short: `기본 월 ${won(q.subtotal)}` };
    return { long: `확인 소계 ${won(q.subtotal)} · 상담 확인 ${n}개`, short: `소계 ${won(q.subtotal)} · 확인 ${n}` };
  }
  // 카드 접힘 요약의 선택 상태 줄
  function cardStateText(q) {
    const c = q.card;
    if (c.id === 'none') return '선택 안 함';
    if (!q.cardApplied) return `선택: ${c.short} · ${q.cctv ? 'CCTV 금액 상담 후 계산' : 'CCTV 대수 선택 후 계산'}`;
    return `선택: ${c.short} · ${c.max ? '최대 할인 시' : '조건 충족 시'} CCTV 예상 월 ${won(q.cctvAfter)}`;
  }
  // 폼 위 항상 보이는 금액 요약 (상품·기본합계/소계·카드 조건부 예상액·미확정 상품)
  function formSumHtml(q) {
    if (!q.lines.length) return '<p class="form-sum__empty">아직 선택한 상품이 없습니다. CCTV 대수를 고르면 금액이 표시됩니다.</p>';
    const L = labels(q);
    const rows = q.lines.map((l) => `<li><span>${l.name}</span><strong${l.amount == null ? ' class="is-pending"' : ''}>${l.amount == null ? l.pendingText : '월 ' + won(l.amount)}</strong></li>`).join('');
    const total = q.confirmed.length ? `<p class="form-sum__total"><span>${L.base}</span><strong>${won(q.subtotal)}</strong></p>` : '';
    const vat = q.lines.some((l) => l.noteVat) ? `<p class="form-sum__note">${VAT_TERM_NOTE}</p>` : '';
    const card = q.cardApplied
      ? `<p class="form-sum__card"><span>${L.after}</span><strong>${won(q.after)}</strong></p><p class="form-sum__note">${q.card.short} 실적 등 조건 충족 시 · CCTV에만 적용</p>`
      : (q.cardNotApplied ? `<p class="form-sum__note">${CARD_NA}</p>` : '');
    const pend = q.pending.length ? `<p class="form-sum__pend">금액 상담 확인: ${q.pending.map(shortName).join(', ')}</p>` : '';
    return `<ul class="form-sum__lines">${rows}</ul>${total}${vat}${card}${pend}`;
  }

  // 추천 구성을 state에 그대로 반영 (여러 번 눌러도 같은 결과). card·siteNet은 유지
  function applyPresetState(id) {
    const p = PRESETS[id];
    if (!p) return false;
    state.cctv = p.cctv;
    state.net = { ...p.net };
    state.water = { ...p.water };
    return true;
  }
  // 첫 화면 안내 합계: 현재 선택을 바꾸지 않고 추천 구성의 기본 합계(카드 미적용)만 계산
  function quoteForPreset(id) {
    const saved = { cctv: state.cctv, net: state.net, water: state.water, card: state.card };
    applyPresetState(id);
    state.card = 'none';
    const q = computeQuote(buildLines());
    Object.assign(state, saved);
    return q;
  }
  function cameraCountText() {
    if (!state.cctv) return '미선택';
    const row = byId(CCTV_ROWS, state.cctv);
    return row.name || row.label;
  }
  // 접수 message: 개인정보 없이 선택 내용만, 항상 같은 순서로 구성. 길이 초과 시 자르지 않고 서비스 검증에서 거부
  function consultMessage(q, extra) {
    const L = labels(q);
    const out = [`[셀프견적 · 예상 견적이며 최종 금액 아님 · ${PRICE_VERSION} 기준]`];
    if (!q.lines.length) out.push('선택 상품: 없음');
    q.lines.forEach((l) => out.push(`${l.name}: ${l.amount == null ? '상담 확인' : '월 ' + won(l.amount)} (${periodOf(l)})`));
    out.push(q.card.id === 'none' ? '제휴카드: 선택 안 함' : `제휴카드: ${q.card.short} 조건부 ${q.card.max ? '최대 ' : ''}월 ${won(q.card.discount)} 청구할인`);
    if (q.confirmed.length) out.push(`${L.base}: ${won(q.subtotal)}`);
    if (q.cardApplied) out.push(`${L.after}: ${won(q.after)}`);
    if (q.cardNotApplied) out.push('카드 할인: CCTV 금액 상담 후 계산');
    if (q.pending.length) out.push(`금액 상담 확인: ${q.pending.map(shortName).join(', ')}`);
    if (extra && extra.custType && CUST_TYPES[extra.custType]) out.push(`SOHO 가입 구분: ${CUST_TYPES[extra.custType]}`);
    if (extra && extra.siteNet && byId(SITE_NET, extra.siteNet)) out.push(`설치 장소 인터넷: ${byId(SITE_NET, extra.siteNet).label}`);
    out.push(`개인정보 동의안: ${PRIVACY_VERSION}`);
    return out.join('\n');
  }

  function renderCctvCard() {
    const card = $('cctv-card');
    if (!state.cctv) { card.hidden = true; card.textContent = ''; return; }
    const row = byId(CCTV_ROWS, state.cctv);
    const priced = typeof row.monthly === 'number';
    const title = row.id === 'cctv_unknown' ? 'CCTV 대수 상담' : `CCTV ${row.name || row.label} 구성`;
    const wasOpen = !!card.querySelector('details[open]');
    // 기본 조건 요약은 접힘 밖에 항상 표시
    const brief = (priced ? 'VAT 포함 · ' : '이 구성의 월 납부금은 상담에서 확인 · ')
      + '렌탈이 아닌 36개월 할부 구매 · 36회 납부 완료 후 소유권 이전 · 기본 설치비 0원(특수 공사 별도 안내)';
    card.innerHTML = `
      <div class="cctv-card__top">
        <span class="cctv-card__name">${title} <span class="badge badge--inst">36개월 할부 구매형</span></span>
        <span class="cctv-card__amt${priced ? '' : ' is-pending'}">${priced ? '월 ' + won(row.monthly) : '상담 확인'}</span>
      </div>
      <p class="cctv-card__brief">${brief}</p>
      ${priced ? `<p class="ref">가격 기준: ${PRICE_VERSION}</p>` : ''}
      <details${wasOpen ? ' open' : ''}>
        <summary>상세 조건 보기</summary>
        <dl>
          ${priced ? `<dt>VAT</dt><dd>포함</dd>
          <dt>36회 납부 합계</dt><dd>${won(row.monthly * row.months)} <span class="muted">(CCTV ${row.label} 구성에 한함)</span></dd>` : ''}
          <dt>계약</dt><dd>렌탈이 아닌 36개월 할부 구매형</dd>
          <dt>소유</dt><dd>36회 납부 완료 후 소유권 이전</dd>
          <dt>설치비</dt><dd>기본 설치 환경 기준 0원 · 고소·장거리 배선 등 특수 공사 별도 안내</dd>
        </dl>
      </details>`;
    card.hidden = false;
  }

  function renderResult() {
    const lines = buildLines();
    const ul = $('lines');
    ul.textContent = '';
    if (!lines.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'CCTV 대수를 선택하면 결과가 여기에 표시됩니다.';
      ul.append(li);
    }
    lines.forEach((l) => {
      const li = document.createElement('li');
      li.dataset.key = l.key;
      li.innerHTML = `
        <span class="l-name">${l.name}</span>
        <span class="l-amt${l.amount == null ? ' is-pending' : ''}">${l.amount == null ? l.pendingText : '월 ' + won(l.amount)}</span>
        <span class="l-meta"><span class="badge badge--${l.badge[0]}">${l.badge[1]}</span>${l.meta}</span>`;
      ul.append(li);
    });

    const q = computeQuote(lines);
    const { confirmed, pending, subtotal, card, cardApplied, discount, after } = q;
    const sum = $('sum');
    const exNames = pending.map(shortName).join(', ');
    // CCTV 외 상품(인터넷·정수기)이 선택되면 VAT·약정 미확인 고지를 합계 바로 아래에 둔다
    const vatNote = lines.some((l) => l.noteVat)
      ? `<p class="sum__note sum__note--vat">${VAT_TERM_NOTE}</p>` : '';
    const L = labels(q);
    const cardRows = cardApplied ? `
        <div class="sum__row sum__row--disc"><span>${L.disc}</span><strong>${won(discount)}</strong></div>
        <div class="sum__row sum__row--after"><span>${L.after}</span><strong>${won(after)}</strong></div>
        <p class="sum__note">${card.cond} · ${CARD_NOTICE}</p>` : '';
    const cardNA = q.cardNotApplied ? `<p class="sum__note sum__note--warn">${CARD_NA}</p>` : '';

    if (!lines.length) {
      sum.innerHTML = cardNA;
    } else if (confirmed.length) {
      sum.innerHTML = `
        <div class="sum__box"><p class="sum__label">${L.base}</p><p class="sum__val">${won(subtotal)}</p>${vatNote}${cardRows}${cardNA}</div>
        ${pending.length ? `<div class="sum__box sum__box--ex"><p class="sum__label">제외 (상담 확인)</p><p class="sum__val">${exNames}</p></div>` : ''}`;
    } else {
      sum.innerHTML = `<div class="sum__box sum__box--ex"><p class="sum__label">금액 상담 확인</p><p class="sum__ex">선택하신 상품(${exNames})은 상담에서 금액을 확인해 드립니다.</p>${vatNote}${cardNA}</div>`;
    }

    renderCardCalc(q);
    $('card-fold-state').textContent = cardStateText(q);

    // 하단 바 윗줄 (결과 이동). 320px에서는 짧은 문구
    const bt = barText(q);
    $('bar-sum').innerHTML = `<span class="bar__txt"><span class="s-long">${bt.long}</span><span class="s-short">${bt.short}</span></span><span class="bar__more">내역</span>`;

    // 폼 위 금액 요약 + 접힌 전체 상세·복사 내용 (같은 q·quoteText, 개인정보 없음)
    $('form-sum-body').innerHTML = formSumHtml(q);
    const site = state.siteNet ? `\n· 설치 장소 인터넷: ${byId(SITE_NET, state.siteNet).label}` : '';
    $('f-summary').textContent = quoteText(q) + site;
    if (!$('copy-fallback').hidden) $('copy-text').value = quoteText(q, true);

    // 추가 상품 상태 문구
    $('net-state').textContent = state.net.carrier ? '추가됨' : '추가 안 함';
    $('addon-net').classList.toggle('is-on', !!state.net.carrier);
    const waterOn = !!(state.water.type || state.water.months);
    $('water-state').textContent = waterOn ? '추가됨' : '추가 안 함';
    $('addon-water').classList.toggle('is-on', waterOn);

    // SOHO 관련 표시
    const soho = state.net.carrier === 'lgu_soho';
    $('ai-set').hidden = !soho;
    $('f-custtype').hidden = !soho;

    renderSteps();
  }

  function renderSteps() {
    const cur = !state.cctv ? 1 : (state.formStarted ? 3 : 2);
    document.querySelectorAll('.steps li').forEach((li) => {
      const s = Number(li.dataset.step);
      if (s === cur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.classList.toggle('is-done', s < cur);
    });
  }

  function update() { renderCctvCard(); renderResult(); measureBar(); }
  // state → 모든 칩 checked 동기화 (setupAddons에서 renderTv·gateNet과 함께 채움)
  let syncSelections = () => {};

  /* ---------- 제휴카드 선택 / 해제 ---------- */
  function setupCardSelection() {
    const options = $('card-chips');
    syncChecked(options, state.card);
    options.querySelectorAll('input[name="card"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked || !byId(CARDS, input.value)) return;
        state.card = input.value;
        syncChecked(options, state.card);
        update();
      });
    });
    $('card-clear').addEventListener('click', () => {
      state.card = 'none';
      syncChecked(options, state.card);
      update();
    });
  }

  /* ---------- 추가 상품 ---------- */
  function setupAddons() {
    renderChips($('cctv-chips'), 'cctv', CCTV_ROWS, () => state.cctv, (v) => { state.cctv = v; update(); }, true);
    const renderTv = () => renderChips($('net-tv'), 'tv', tvOptions(state.net.carrier), () => state.net.tv, (v) => { state.net.tv = v; update(); });
    // 통신사 변경 시 유효하지 않은 선택을 정규화한다
    const normalizeNet = () => {
      const n = state.net;
      if (!SPEEDS.some((s) => s.id === n.speed)) n.speed = null;
      if (n.tv !== 'none' && n.tv !== 'tv') n.tv = n.carrier ? 'none' : null;
      if (n.carrier === 'lgu_soho') { if (n.ai !== 'yes' && n.ai !== 'no') n.ai = 'no'; } else n.ai = null;
      syncChecked($('net-speed'), n.speed);
      renderTv();
      syncChecked($('net-ai'), n.ai);
    };
    renderChips($('net-carrier'), 'carrier', CARRIERS, () => state.net.carrier, (v) => {
      state.net.carrier = v;
      normalizeNet();
      gateNet();
      update();
    });
    renderChips($('net-speed'), 'speed', SPEEDS, () => state.net.speed, (v) => { state.net.speed = v; update(); });
    renderTv();
    renderChips($('net-ai'), 'ai', AI, () => state.net.ai, (v) => { state.net.ai = v; update(); });
    renderChips($('water-type'), 'wtype', WATER_TYPES, () => state.water.type, (v) => { state.water.type = v; update(); });
    renderChips($('water-months'), 'wmonths', WATER_MONTHS, () => state.water.months, (v) => { state.water.months = v; update(); }, true);
    renderChips($('site-net'), 'sitenet', SITE_NET, () => state.siteNet, (v) => { state.siteNet = v; update(); }, true);
    setupCardSelection();

    // 견적 내용 복사: 누를 때만, 공개 견적 요약만. 실패하면 직접 복사 영역
    $('copy-btn').addEventListener('click', () => {
      const text = quoteText(computeQuote(buildLines()), true);
      const status = $('copy-status');
      const fallback = () => {
        $('copy-fallback').hidden = false;
        $('copy-text').value = text;
        status.textContent = '자동 복사를 할 수 없었습니다. 아래 내용을 직접 선택해 복사해 주세요.';
        $('copy-text').focus();
        $('copy-text').select();
      };
      status.textContent = '';
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
          $('copy-fallback').hidden = true;
          status.textContent = '견적 내용을 복사했습니다. 원하는 곳에 붙여 넣으세요.';
        }, fallback);
      } else {
        fallback();
      }
    });

    // 속도·TV는 통신사 선택 전에는 비활성
    function gateNet() {
      const off = !state.net.carrier;
      ['net-speed', 'net-tv'].forEach((id) => $(id).querySelectorAll('input').forEach((i) => { i.disabled = off; }));
    }
    gateNet();
    const gateWater = () => {};
    syncSelections = () => {
      syncChecked($('cctv-chips'), state.cctv);
      syncChecked($('net-carrier'), state.net.carrier);
      syncChecked($('net-speed'), state.net.speed);
      renderTv();
      syncChecked($('net-ai'), state.net.ai);
      syncChecked($('water-type'), state.water.type);
      syncChecked($('water-months'), state.water.months);
      gateNet();
    };

    document.querySelectorAll('.addon__toggle').forEach((btn) => {
      btn.addEventListener('click', () => togglePanel(btn));
    });
    document.querySelectorAll('[data-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.clear === 'net') {
          state.net = { carrier: null, speed: null, tv: null, ai: null };
          ['net-carrier', 'net-speed', 'net-ai'].forEach((id) => syncChecked($(id), null));
          renderTv();
          gateNet();
          $('net-toggle').focus();
        } else {
          state.water = { type: null, months: null };
          ['water-type', 'water-months'].forEach((id) => syncChecked($(id), null));
          gateWater();
          $('water-toggle').focus();
        }
        update();
      });
    });
  }
  function togglePanel(btn, force) {
    const open = typeof force === 'boolean' ? force : btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    $(btn.getAttribute('aria-controls')).hidden = !open;
  }

  /* ---------- 화면 전환·뒤로가기 ---------- */
  function showView(view, focus) {
    const quote = view === 'quote';
    $('intro').hidden = quote;
    $('quote').hidden = !quote;
    $('bar-intro').hidden = quote;
    $('bar-quote').hidden = !quote;
    window.scrollTo(0, 0);
    if (focus) (quote ? $('quote-title') : $('intro-cta')).focus({ preventScroll: true });
    measureBar();
  }
  // 추천 구성 실제 선택: state → 칩 checked → 패널 펼침 → 합계·폼 요약(update) 순서로 같은 상태를 맞춘다
  function applyPreset(id) {
    if (!applyPresetState(id)) return;
    syncSelections();
    togglePanel($('net-toggle'), true);
    togglePanel($('water-toggle'), true);
    $('preset-note').hidden = false;
    update();
  }
  // 일반 계산 버튼(preset 없음)은 현재 선택을 그대로 둔다
  function goQuote(preset) {
    if (preset) applyPreset(preset);
    if ($('quote').hidden) {
      if (location.hash !== '#quote') {
        try { history.pushState({ v: 'quote' }, '', '#quote'); } catch { location.hash = 'quote'; }
        state.pushed = true;
      }
      showView('quote', true);
    }
  }
  function syncFromLocation() {
    showView(location.hash === '#quote' ? 'quote' : 'intro', true);
  }

  function setupNav() {
    document.querySelectorAll('[data-go-quote]').forEach((el) => {
      el.addEventListener('click', (e) => { e.preventDefault(); goQuote(el.dataset.preset); });
    });
    $('back-btn').addEventListener('click', () => {
      if (state.pushed) { history.back(); return; }
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* file:// 제한 */ }
      showView('intro', true);
    });
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
    $('to-form').addEventListener('click', toForm);
    const jumpTo = (sectionId, titleId) => {
      $(sectionId).scrollIntoView({ block: 'start' });
      $(titleId).focus({ preventScroll: true });
    };
    $('bar-sum').addEventListener('click', () => jumpTo('result', 'result-title'));   // 윗줄: 내역(결과)
    $('bar-consult').addEventListener('click', toForm);                                // 아랫줄: 상담 폼
    document.querySelectorAll('[data-jump]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.jump === 'addons') jumpTo('addons', 'addons-title');
        else jumpTo('result', 'result-title');
      });
    });
    $('again').addEventListener('click', () => {
      $('done').hidden = true;
      $('consult-form').hidden = false;
      state.formStarted = false;
      renderSteps();
      $('quote-title').focus();
      window.scrollTo(0, 0);
    });
  }
  function toForm() {
    state.formStarted = true;
    renderSteps();
    $('consult').scrollIntoView({ block: 'start' });
    // 최종안: 입력칸 대신 제목에 포커스 → 이동 직후 키보드가 금액 요약을 가리지 않게 함 (실기기 OS 키보드는 미검증)
    $('consult-title').focus({ preventScroll: true });
  }

  /* ---------- 하단 고정 바 ---------- */
  // 바가 숨겨져도 본문 하단 여백은 유지해 레이아웃이 흔들리지 않게 한다
  function measureBar() {
    const bar = $('bar');
    const shown = getComputedStyle(bar).display !== 'none';
    document.documentElement.style.setProperty('--bar-h', shown ? bar.offsetHeight + 'px' : '0px');
  }
  const barState = { focus: false, visible: new Set() };
  function applyBar() {
    $('bar').classList.toggle('is-hidden', barState.focus || barState.visible.size > 0);
    measureBar();
  }
  function setupBar() {
    const form = $('consult-form');
    form.addEventListener('focusin', (e) => {
      if (e.target.matches('input, textarea, select')) { barState.focus = true; applyBar(); }
      if (!state.formStarted) { state.formStarted = true; renderSteps(); }
    });
    form.addEventListener('focusout', () => {
      setTimeout(() => {
        const a = document.activeElement;
        barState.focus = !!(a && form.contains(a) && a.matches('input, textarea, select'));
        applyBar();
      }, 0);
    });
    // 폼의 실제 입력·제출 영역 또는 완료 영역이 화면에 보이면 숨김 (폼 상단 여백·제목만 보일 때는 유지)
    // 모바일 개편: 첫화면 주 CTA(#intro-cta)가 보이는 동안에도 숨겨 같은 행동 버튼이 두 개 경쟁하지 않게 한다
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) barState.visible.add(en.target); else barState.visible.delete(en.target);
        });
        applyBar();
      }, { threshold: 0 });
      document.querySelectorAll('#intro-cta, #consult-form .field, #consult-form button[type="submit"], #form-status, #done')
        .forEach((el) => io.observe(el));
    }
    window.addEventListener('resize', measureBar);
  }

  /* ---------- 상담 신청 (검증·접수는 consult-service.js) ---------- */
  function setErr(input, errId, msg) {
    const p = $(errId);
    if (msg) {
      p.textContent = msg; p.hidden = false;
      if (input) input.setAttribute('aria-invalid', 'true');
    } else {
      p.textContent = ''; p.hidden = true;
      if (input) input.removeAttribute('aria-invalid');
    }
  }
  // 서비스 검증 필드 → 화면 입력칸·오류칸
  const FIELD_UI = {
    phone: ['f-phone', 'e-phone'], location: ['f-region', 'e-region'], placeType: ['f-place', 'e-place'],
    name: ['f-name', 'e-name'], privacyAgreed: ['f-privacy', 'e-privacy']
  };
  function setupForm() {
    const form = $('consult-form');
    const btn = $('submit-btn');
    const btnLabel = btn.textContent;
    const svc = window.YunaConsult;
    const submitter = svc ? svc.createSubmitter({ transport: svc.createFirestoreTransport(svc.loadFirebaseSdk) }) : null;

    const showStatus = (msg, type, withAlt) => {
      const box = $('form-status');
      box.hidden = false;
      box.className = 'form-status is-' + type;
      $('form-status-text').textContent = msg;
      $('form-alt').hidden = !withAlt;
    };
    const clearStatus = () => { $('form-status').hidden = true; $('form-alt').hidden = true; };

    const ui = {
      setBusy(on) {
        btn.disabled = on;
        btn.textContent = on ? '신청 중...' : btnLabel;
        if (on) { form.setAttribute('aria-busy', 'true'); showStatus('상담 신청을 접수하고 있습니다. 잠시 기다려 주세요.', 'info', false); }
        else form.removeAttribute('aria-busy');
      },
      // 저장 성공 응답을 받은 뒤에만 호출된다. summary는 그 요청을 제출한 시점에 고정한 견적 요약
      onSuccess(summary) {
        $('done-summary').textContent = summary;
        form.reset();
        Object.values(FIELD_UI).forEach(([inp, err]) => setErr($(inp), err));
        $('e-form').hidden = true;
        clearStatus();
        form.hidden = true;
        $('done').hidden = false;
        $('done').focus();
      },
      // 실패: 입력·동의는 그대로 두고 이유와 대안을 보여 준다
      onFail(res) {
        if (res.status === 'invalid') {
          const shown = [];
          Object.values(FIELD_UI).forEach(([inp, err]) => setErr($(inp), err));
          res.errors.forEach((er) => {
            const map = FIELD_UI[er.field];
            if (map) { setErr($(map[0]), map[1], er.message); shown.push($(map[0])); }
          });
          const other = res.errors.filter((er) => !FIELD_UI[er.field]);
          const ef = $('e-form');
          ef.textContent = `입력 내용을 확인해 주세요 (${res.errors.length}개 항목).`;
          ef.hidden = false;
          if (other.length) showStatus(other[0].message, 'error', true); else clearStatus();
          if (shown[0]) shown[0].focus();
          return;
        }
        $('e-form').hidden = true;
        if (res.status === 'cooldown') showStatus(`이미 접수되었습니다. 추가 신청은 약 ${res.seconds}초 후 가능합니다.`, 'info', false);
        else if (res.status === 'blocked') showStatus('정상적인 방법으로 다시 신청해 주세요.', 'error', true);
        else if (res.status === 'offline') showStatus('인터넷 연결을 확인한 뒤 다시 신청해 주세요. 입력 내용은 유지됩니다. 급하시면 전화나 카카오톡으로 문의해 주세요.', 'error', true);
        else {
          // 고객 정보·payload는 기록하지 않고 오류 코드만 남긴다
          console.error('상담 접수 실패:', res.code || 'unknown');
          showStatus('접수를 완료하지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 다시 시도하거나 전화·카카오톡으로 문의해 주세요.', 'error', true);
        }
      }
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!submitter) { showStatus('지금은 온라인 접수를 할 수 없습니다. 전화나 카카오톡으로 문의해 주세요.', 'error', true); return; }
      if (submitter.busy) return;   // 처리 중 들어온 중복 이벤트는 진행 중인 요청의 스냅샷을 건드리지 않는다
      const q = computeQuote(buildLines());
      // 이 요청의 견적 요약을 지금 고정 (개인정보 없음). 저장을 기다리는 동안 선택을 바꿔도 완료 화면은 실제로 보낸 내용
      const summary = quoteText(q) + (state.siteNet ? `\n· 설치 장소 인터넷: ${byId(SITE_NET, state.siteNet).label}` : '');
      const custEl = form.querySelector('input[name="custType"]:checked');
      const input = {
        phone: $('f-phone').value,
        location: $('f-region').value,
        placeType: $('f-place').value,
        name: $('f-name').value,
        cameraCount: cameraCountText(),
        message: consultMessage(q, { custType: state.net.carrier === 'lgu_soho' && custEl ? custEl.value : null, siteNet: state.siteNet }),
        privacyAgreed: $('f-privacy').checked === true,
        honeypot: $('f-website').value
      };
      await svc.runSubmit(submitter, input, { ...ui, onSuccess: () => ui.onSuccess(summary) });
    });

    // 입력 중 오류 해제
    ['f-phone', 'f-region', 'f-name'].forEach((id) => {
      $(id).addEventListener('input', () => { if ($(id).getAttribute('aria-invalid')) setErr($(id), 'e-' + id.slice(2)); });
    });
    $('f-place').addEventListener('change', () => { if ($('f-place').value) setErr($('f-place'), 'e-place'); });
    $('f-privacy').addEventListener('change', () => { if ($('f-privacy').checked) setErr($('f-privacy'), 'e-privacy'); });
  }

  /* ---------- 시작 ---------- */
  setupAddons();
  setupNav();
  setupBar();
  setupForm();
  update();
  $('preset-total').textContent = won(quoteForPreset('soho').subtotal);   // 첫 화면 안내 합계도 같은 계산에서
  if (location.hash === '#quote') showView('quote', false); else measureBar();
})();
