/*
 * 상담 접수 서비스 (자가견적 완성본, 2026-10-19 A팀 김개발)
 * - 기존 공개 랜딩 접수 방식 재사용: Firebase Web SDK 12.19.0(gstatic) · 기존 공개 웹 설정 · consultations 컬렉션 · (default) DB
 * - 저장 필드는 기존 firestore.rules와 같은 9개: name, phone, placeType, location, cameraCount, message, privacyAgreed, status, createdAt
 * - SDK는 제출할 때만 불러온다. 개인정보는 로그·브라우저 저장소에 남기지 않는다(쿨다운은 시간 숫자만 저장)
 * - 테스트용 플래그·우회 경로 없음. 테스트는 createSubmitter/createFirestoreTransport에 stub을 주입해 격리한다
 */
(function (root) {
  'use strict';

  const PLACES = ['매장', '사무실', '공장', '창고', '주택', '기타'];
  const FIELDS = ['name', 'phone', 'placeType', 'location', 'cameraCount', 'message', 'privacyAgreed', 'status', 'createdAt'];
  const COOLDOWN_MS = 60000;
  const MESSAGE_MAX = 1000;
  const STORAGE_KEY = 'hyundai_cctv_last_consultation_at';   // 기존 랜딩과 같은 키. 값은 접수 시각(ms) 숫자만
  const SDK_BASE = 'https://www.gstatic.com/firebasejs/12.19.0/';
  // 기존 운영 랜딩에 이미 공개된 Firebase 웹 설정(비밀값 아님). 접근 통제는 Firestore Rules가 담당
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyB07_zG3sMTzeBHzfrG_TaEkmawRxdiRPI',
    authDomain: 'hyundai-cctv-24280.firebaseapp.com',
    projectId: 'hyundai-cctv-24280',
    storageBucket: 'hyundai-cctv-24280.firebasestorage.app',
    messagingSenderId: '326842548906',
    appId: '1:326842548906:web:74c3acb4d6d17de1fd06d3'
  };

  const normalizePhone = (v) => String(v == null ? '' : v).replace(/[\s().-]/g, '');

  // 입력 검증 (기존 Rules 조건 + 기존 랜딩 검증과 같은 기준). 메시지를 몰래 자르지 않고 초과 시 거부한다
  function validate(input) {
    const errors = [];
    const phone = normalizePhone(input.phone);
    if (!phone) errors.push({ field: 'phone', message: '연락처를 입력해 주세요.' });
    else if (!/^0[0-9]{1,2}[0-9]{3,4}[0-9]{4}$/.test(phone)) errors.push({ field: 'phone', message: '연락처 형식을 확인해 주세요. 예: 010-1234-5678' });
    const location = String(input.location || '').trim();
    if (!location) errors.push({ field: 'location', message: '설치 지역을 입력해 주세요.' });
    else if (location.length > 100) errors.push({ field: 'location', message: '설치 지역은 100자 이내로 입력해 주세요.' });
    if (!PLACES.includes(input.placeType)) errors.push({ field: 'placeType', message: '설치 장소를 선택해 주세요.' });
    if (String(input.name || '').trim().length > 30) errors.push({ field: 'name', message: '이름은 30자 이내로 입력해 주세요.' });
    const count = String(input.cameraCount || '');
    if (count.length < 1 || count.length > 30) errors.push({ field: 'cameraCount', message: '카메라 대수를 다시 선택해 주세요.' });
    if (typeof input.message !== 'string' || input.message.length > MESSAGE_MAX) errors.push({ field: 'message', message: '선택 내용이 너무 길어 접수할 수 없습니다. 전화로 문의해 주세요.' });
    if (input.privacyAgreed !== true) errors.push({ field: 'privacyAgreed', message: '개인정보 수집·이용에 동의해 주세요.' });
    return errors;
  }

  // createdAt을 뺀 8개 필드. createdAt은 transport가 serverTimestamp로 붙인다
  function buildPayload(input) {
    return {
      name: String(input.name || '').trim() || '미입력',
      phone: normalizePhone(input.phone),
      placeType: input.placeType,
      location: String(input.location || '').trim(),
      cameraCount: String(input.cameraCount),
      message: input.message,
      privacyAgreed: input.privacyAgreed === true,
      status: '신규'
    };
  }

  // 기본 SDK 로더: 제출 시점에만 동적 import. 실패하면 캐시를 비워 재시도 가능하게 한다
  let sdkPromise;
  function loadFirebaseSdk() {
    if (!sdkPromise) {
      sdkPromise = Promise.all([
        import(SDK_BASE + 'firebase-app.js'),
        import(SDK_BASE + 'firebase-firestore.js')
      ]).then(([appSDK, fs]) => {
        const app = appSDK.getApps().find((a) => a.options.projectId === FIREBASE_CONFIG.projectId && a.options.appId === FIREBASE_CONFIG.appId)
          || appSDK.initializeApp(FIREBASE_CONFIG, 'hyundai-cctv-consultations');
        return { db: fs.getFirestore(app), collection: fs.collection, addDoc: fs.addDoc, serverTimestamp: fs.serverTimestamp };
      }).catch((err) => { sdkPromise = undefined; throw err; });
    }
    return sdkPromise;
  }

  function createFirestoreTransport(loadSdk) {
    return {
      async write(payload) {
        const { db, collection, addDoc, serverTimestamp } = await loadSdk();
        await addDoc(collection(db, 'consultations'), { ...payload, createdAt: serverTimestamp() });
      }
    };
  }

  function browserStorage() {
    try { return root.localStorage || null; } catch { return null; }
  }
  function readLast(storage) {
    try { return Number(storage && storage.getItem(STORAGE_KEY)) || 0; } catch { return 0; }
  }
  function writeLast(storage, t) {
    try { if (storage) storage.setItem(STORAGE_KEY, String(t)); } catch { /* 쿨다운 저장 실패는 접수 결과에 영향 없음 */ }
  }

  // 접수 1건 처리: 잠금 → 허니팟 → 검증 → 쿨다운 → 온라인 → 쓰기(await) → 결과
  function createSubmitter(deps) {
    const transport = deps.transport;
    const now = deps.now || (() => Date.now());
    const storage = deps.storage === undefined ? browserStorage() : deps.storage;
    const isOnline = deps.isOnline || (() => !(root.navigator && root.navigator.onLine === false));
    let busy = false;
    let last = readLast(storage);
    return {
      get busy() { return busy; },
      async submit(input) {
        if (busy) return { status: 'busy' };
        if (String(input.honeypot || '').trim()) return { status: 'blocked' };
        const errors = validate(input);
        if (errors.length) return { status: 'invalid', errors };
        const remaining = COOLDOWN_MS - (now() - last);
        if (last && remaining > 0) return { status: 'cooldown', seconds: Math.ceil(remaining / 1000) };
        if (!isOnline()) return { status: 'offline' };
        busy = true;
        try {
          await transport.write(buildPayload(input));
          last = now();
          writeLast(storage, last);
          return { status: 'ok' };
        } catch (err) {
          return { status: 'error', code: (err && (err.code || err.name)) || 'unknown' };
        } finally {
          busy = false;
        }
      }
    };
  }

  // 화면 처리 순서: 성공 응답을 받은 뒤에만 ui.onSuccess(완료 표시·입력 초기화). 실패 시 ui.onFail만 호출(입력 보존)
  async function runSubmit(submitter, input, ui) {
    if (submitter.busy) return { status: 'busy' };
    ui.setBusy(true);
    let res;
    try {
      res = await submitter.submit(input);
    } catch (err) {
      res = { status: 'error', code: (err && (err.code || err.name)) || 'unknown' };
    } finally {
      ui.setBusy(false);
    }
    if (res.status === 'ok') ui.onSuccess(res); else if (res.status !== 'busy') ui.onFail(res);
    return res;
  }

  root.YunaConsult = Object.freeze({
    PLACES, FIELDS, COOLDOWN_MS, MESSAGE_MAX, STORAGE_KEY,
    normalizePhone, validate, buildPayload, loadFirebaseSdk, createFirestoreTransport, createSubmitter, runSubmit
  });
})(typeof window !== 'undefined' ? window : globalThis);
