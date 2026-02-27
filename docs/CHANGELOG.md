# 변경 이력

## 2026-02-27 — 초기 구축

### 프로젝트 생성

- WoW Classic TBC 20주년 기념서버 투기장 리더보드 프로젝트 시작
- GitHub Pages 정적 사이트 기반 아키텍처 결정

### Battle.net API 연동

- OAuth2 Client Credentials 인증 구현
- 20주년 기념서버(`classicann`) 네임스페이스 확인
- 집계형 리더보드 API 미지원 확인 → 개별 캐릭터 조회 방식 채택
- 길드 로스터 API로 멤버 목록 수집 후 개별 PvP 브라켓 조회

### 프론트엔드

- 리더보드 메인 페이지 (`index.html`, `app.js`)
  - 2v2 / 3v3 / 5v5 탭 전환
  - 검색 및 정렬 기능
  - 직업, 길드 컬럼 추가
  - 캐릭터 클릭 시 상세 페이지 이동
- 캐릭터 상세 페이지 (`detail.html`, `detail.js`)
  - 캐릭터 기본 정보 표시
  - 브라켓별 레이팅 카드
  - Chart.js 레이팅 변화 그래프
  - 기록 이력 테이블
- 다크 테마 UI (`style.css`)

### Supabase 연동

- `characters`, `rating_snapshots` 테이블 스키마 설계
- RLS 정책 (anon: 읽기, service_role: 쓰기)
- 변동분만 기록하는 스냅샷 정책 (중복 저장 방지)
- 프론트엔드에서 anon key로 히스토리 조회

### GitHub Actions 자동화

- 리더보드 자동 수집 (`fetch-leaderboard.yml`): 6시간 주기 + 수동 실행
- 이슈 기반 소스 추가 (`process-submission.yml`): `[추가]` 제목 또는 `add-source` 라벨
- GitHub Pages 자동 배포 (`deploy-pages.yml`): main push 시
- 동시성 그룹(`data-update`)으로 워크플로우 충돌 방지
- push 실패 시 최대 3회 재시도 로직

### 성능 최적화

- `fetch_leaderboard.py`: ThreadPoolExecutor 10워커 병렬 수집
- `process_submission.py`: ThreadPoolExecutor 20워커 병렬 검증
- `requests.Session` 재사용으로 HTTP 커넥션 풀링
- 길드 로스터에서 70레벨 미만 캐릭터 스캔 제외

### 이슈 처리 검증

- 캐릭터/길드 추가 요청 시 Battle.net API로 존재 여부 확인
- 존재하지 않는 항목 자동 스킵
- 이미 등록된 중복 항목 자동 스킵
- 이슈 닫기 시 성공/실패 결과 코멘트 표시

### 데이터

- 초기 시드 길드 3개 (Balance, Unreal, 불타는성전)
- 이슈 #7을 통해 2,635명 대량 등록
- 총 6개 길드, 2,638명 캐릭터 수집 대상 등록
