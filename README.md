# 현대렌탈케어 CCTV 셀프견적 (비교용 프로젝트)

기존 운영 사이트와 별개로 운영하는 독립 셀프견적 비교 프로젝트입니다. 기존 사이트의 파일·도메인과 연결되어 있지 않습니다.

## 구성
- 정적 HTML·CSS·JS 파일만 사용합니다(`index.html`, `privacy.html`, `styles.css`, `app.js`, `consult-service.js`, `assets/`).
- 빌드 과정이 없고 외부 패키지를 설치하지 않습니다.

## Vercel 설정
- Framework Preset: Other
- Build Command: 없음 / Install Command: 없음
- Output Directory: 저장소 루트

## 상담 접수 (Firebase)
- 기존 Firebase 프로젝트의 상담 컬렉션에 9개 필드(name, phone, placeType, location, cameraCount, message, privacyAgreed, status, createdAt)를 저장합니다.
- Firestore Rules의 필드 조건과 대조는 마쳤지만, 실제 저장은 아직 검증하지 않았습니다.
- 코드에 들어 있는 Firebase 브라우저 설정값은 공개용이며 비밀키가 아닙니다. 접근 보안은 Firestore Rules로 관리합니다.

## 포함하지 않은 정보
- 실제 고객 개인정보와 내부 단가는 들어 있지 않습니다.
