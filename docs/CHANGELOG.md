# 변경 이력

## 2026-02-28 — 아이템 아이콘 로컬 호스팅

### 아이콘 엑박 수정

- Blizzard CDN(`render.worldofwarcraft.com`)이 403 Forbidden을 반환하여 아이콘 깨짐 발생
- Blizzard API에서 아이콘 이름만 추출 → Wowhead CDN에서 이미지 다운로드 → `icons/` 디렉토리에 저장
- 프론트엔드에서 로컬 경로(`icons/{icon_name}.jpg`)로 참조하여 자체 서빙
- 706개 고유 아이콘, 총 0.7MB
- `_icon_cache.json` 형식 변경: `{item_id: blizzard_url}` → `{item_id: icon_name}`
- `fetch_incremental.py`에도 아이콘 해결 로직 추가
- GitHub Actions 워크플로우에서 `icons/` 디렉토리도 커밋하도록 수정

---

## 2026-02-28 — 상세 페이지 개선 (v2)

### 아이템 아이콘 + 마법부여/보석 표시

- 장비 아이템에 36x36 아이콘 이미지 표시
- 아이콘 테두리가 아이템 품질에 따라 색상 변경 (일반/고급/희귀/영웅/전설)
- 마법부여(PERMANENT)를 초록색 텍스트로 표시
- 보석(GEM)을 파란색 텍스트로 보석 이름과 함께 표시
- 아이콘 캐시 시스템 도입: `data/_icon_cache.json`에 아이템ID→아이콘이름 매핑 저장, 중복 API 호출 방지

### 이중특성(Dual Spec) 지원

- `specialization_groups`의 모든 그룹 저장 (활성 + 비활성)
- 상세 페이지에서 "활성 특성" / "이중 특성" 탭으로 전환 가능
- 기존 `talents` 필드와 새 `spec_groups` 필드 하위 호환 처리

### 섹션 순서 변경

- 변경 전: 아바타+카드 → 특성 → 장비 → 차트 → 이력
- 변경 후: 아바타+카드 → **차트** → **이력** → **장비** → **특성**

### 증분 데이터 수집 (`fetch_incremental.py`)

- 이슈로 길드/캐릭터 추가 시 전체 재스캔 대신 새로 추가된 항목만 조회
- `process_submission.py`가 추가된 항목을 `config/_added.json`에 기록
- `process-submission.yml`이 `fetch_incremental.py`를 호출하여 새 항목만 조회 후 기존 데이터에 병합
- 6시간 주기 전체 스캔(`fetch_leaderboard.py`)은 그대로 유지

---

## 2026-02-28 — 상세 페이지 특성/장비 추가 (v1)

### 특성(Talents) 표시

- Battle.net API `/specializations` 엔드포인트에서 특성 트리 데이터 수집
- 트리별 이름, 투자 포인트, 포인트 비율 바, 개별 특성 목록 렌더링
- 포인트가 0인 트리는 자동 생략

### 장비(Equipment) 표시

- Battle.net API `/equipment` 엔드포인트에서 장착 아이템 수집
- 슬롯별 아이템명과 품질 색상(일반/고급/희귀/영웅/전설) 표시
- 셔츠/휘장 슬롯 제외

### 캐릭터 아바타

- `/character-media` 엔드포인트에서 아바타 이미지 URL 수집
- 상세 페이지 좌상단에 캐릭터 아바타 표시

---

## 2026-02-27 — 캐시 버스팅

- 프론트엔드 JSON `fetch` 요청에 `?_t=Date.now()` 파라미터 추가
- 브라우저 캐시로 인한 구 데이터 표시 문제 해결

---

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
