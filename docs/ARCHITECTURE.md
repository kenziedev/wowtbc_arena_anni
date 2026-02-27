# 프로젝트 아키텍처

## 개요

WoW Classic TBC 20주년 기념서버 투기장(Arena) 리더보드 웹 애플리케이션.  
Battle.net API로 캐릭터별 PvP 데이터를 수집하고, GitHub Pages 정적 사이트로 제공합니다.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Vanilla HTML/CSS/JS, Tailwind CSS (CDN), Chart.js |
| 백엔드 스크립트 | Python 3.12, requests |
| 데이터베이스 | Supabase (PostgreSQL) |
| 외부 API | Battle.net Game Data / Profile API |
| 배포 | GitHub Pages |
| 자동화 | GitHub Actions |

---

## 디렉토리 구조

```
wowtbc_arena_anni/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   └── add-source.md          # 길드/캐릭터 추가 요청 이슈 템플릿
│   └── workflows/
│       ├── deploy-pages.yml       # GitHub Pages 배포
│       ├── fetch-leaderboard.yml  # 리더보드 데이터 자동 수집 (6시간 주기)
│       └── process-submission.yml # 이슈 기반 소스 추가 처리
├── config/
│   ├── sources.json               # 수집 대상 길드/캐릭터 목록
│   └── supabase.json              # Supabase 클라이언트 설정 (URL, anon key)
├── data/
│   ├── 2v2.json                   # 2v2 리더보드
│   ├── 3v3.json                   # 3v3 리더보드
│   ├── 5v5.json                   # 5v5 리더보드
│   ├── all_characters.json        # 전체 캐릭터 PvP 데이터
│   └── meta.json                  # 수집 메타데이터 (시간, 통계)
├── docs/
│   └── ARCHITECTURE.md            # 이 문서
├── scripts/
│   ├── fetch_leaderboard.py       # 데이터 수집 메인 스크립트
│   ├── process_submission.py      # 이슈 파싱 및 소스 추가 스크립트
│   └── requirements.txt           # Python 의존성
├── supabase/
│   └── schema.sql                 # DB 스키마 (테이블, RLS, 뷰)
├── index.html                     # 리더보드 메인 페이지
├── app.js                         # 메인 페이지 로직
├── detail.html                    # 캐릭터 상세 페이지
├── detail.js                      # 상세 페이지 로직
├── style.css                      # 전역 스타일 (다크 테마)
└── .gitignore
```

---

## 데이터 흐름

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│ Battle.net  │────▶│ fetch_       │────▶│ data/*.json │
│ API         │     │ leaderboard  │     │ (정적 파일) │
└─────────────┘     │ .py          │     └──────┬─────┘
                    │              │            │
                    │  (병렬 10워커) │     ┌──────▼─────┐
                    │              │────▶│ Supabase   │
                    └──────────────┘     │ (히스토리)  │
                                         └──────┬─────┘
                                                │
┌─────────────┐     ┌──────────────┐     ┌──────▼─────┐
│ GitHub      │────▶│ GitHub       │────▶│ 웹 브라우저 │
│ Actions     │     │ Pages        │     │ (사용자)    │
└─────────────┘     └──────────────┘     └────────────┘
```

---

## GitHub Actions 워크플로우

### 1. Fetch Arena Leaderboard (`fetch-leaderboard.yml`)

- **트리거**: 6시간 주기 cron (`0 */6 * * *`) 또는 수동 실행
- **동작**: `fetch_leaderboard.py` 실행 → `data/` 커밋 → 자동 Pages 배포
- **동시성**: `data-update` 그룹으로 중복 실행 방지

### 2. Process Submission (`process-submission.yml`)

- **트리거**: 이슈 생성 시 제목이 `[추가]`로 시작하거나, `add-source` 라벨 추가 시
- **동작**:
  1. `process_submission.py`로 이슈 본문 파싱
  2. Battle.net API로 길드/캐릭터 존재 여부 검증 (병렬 20워커)
  3. 존재하는 항목만 `config/sources.json`에 추가
  4. `fetch_leaderboard.py` 실행하여 즉시 데이터 수집
  5. 이슈 자동 닫기 + 결과 코멘트
- **동시성**: `data-update` 그룹 (Fetch와 동일, 순차 실행 보장)

### 3. Deploy to GitHub Pages (`deploy-pages.yml`)

- **트리거**: `main` 브랜치 push
- **동작**: 전체 저장소를 GitHub Pages artifact로 업로드 및 배포

---

## Battle.net API 사용

### 인증

OAuth2 Client Credentials Flow (`https://oauth.battle.net/token`)

### 네임스페이스

| 용도 | 네임스페이스 |
|---|---|
| 캐릭터 프로필, PvP 데이터 | `profile-classicann-kr` |
| 서버/길드 동적 데이터 | `dynamic-classicann-kr` |

### 주요 엔드포인트

| API | 용도 |
|---|---|
| `/data/wow/guild/{realm}/{guild}/roster` | 길드 멤버 목록 조회 |
| `/profile/wow/character/{realm}/{name}` | 캐릭터 프로필 |
| `/profile/wow/character/{realm}/{name}/pvp-bracket/{bracket}` | 브라켓별 PvP 데이터 |

### 제한 사항

- 20주년 기념서버는 집계형 PvP 리더보드 API가 제공되지 않음
- 개별 캐릭터 조회만 가능하여, 길드 로스터 기반 "상향식 수집" 방식 사용
- 70레벨 미만 캐릭터는 투기장 이용 불가이므로 스캔 제외

---

## Supabase 스키마

### 테이블

**characters**
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK) | 자동 생성 |
| name | text | 캐릭터명 |
| realm | text | 서버 slug |
| class | text | 직업 |
| race | text | 종족 |
| faction | text | 진영 (HORDE/ALLIANCE) |
| guild | text | 소속 길드 |
| updated_at | timestamptz | 마지막 업데이트 |

- UNIQUE 제약: `(name, realm)`

**rating_snapshots**
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK) | 자동 생성 |
| character_id | uuid (FK) | characters 참조 |
| bracket | text | 2v2, 3v3, 5v5 |
| rating | integer | 레이팅 |
| won | integer | 승수 |
| lost | integer | 패수 |
| played | integer | 총 경기수 |
| recorded_at | timestamptz | 기록 시점 |

### RLS 정책

- `anon` 역할: 읽기 전용 (SELECT)
- `service_role` 역할: 쓰기 가능 (INSERT, UPDATE)

### 스냅샷 기록 정책

- 이전 스냅샷과 비교하여 **레이팅, 승, 패 중 하나라도 변경된 경우에만** 새 기록 생성
- 동일한 데이터의 중복 저장 방지

---

## 성능 최적화

| 영역 | 최적화 |
|---|---|
| 데이터 수집 | ThreadPoolExecutor 10워커 병렬 처리 |
| 이슈 검증 | ThreadPoolExecutor 20워커 병렬 검증 |
| HTTP 연결 | `requests.Session` 재사용 (커넥션 풀링) |
| 스냅샷 저장 | 변동분만 저장 (중복 방지) |
| 중복 필터 | API 호출 전 로컬에서 기존 등록 여부 확인 |

---

## 환경 변수 (GitHub Secrets)

| 이름 | 용도 | 사용처 |
|---|---|---|
| `BLIZZARD_CLIENT_ID` | Battle.net API 인증 | fetch, process |
| `BLIZZARD_CLIENT_SECRET` | Battle.net API 인증 | fetch, process |
| `SUPABASE_URL` | Supabase 프로젝트 URL | fetch |
| `SUPABASE_SERVICE_KEY` | Supabase 서비스 키 (쓰기 권한) | fetch |

`config/supabase.json`에는 공개 가능한 `anon_key`만 포함 (읽기 전용).

---

## 프론트엔드 페이지

### 리더보드 (`index.html`)

- 2v2 / 3v3 / 5v5 탭 전환
- 캐릭터명 검색
- 컬럼 클릭 정렬 (레이팅, 승률 등)
- 캐릭터명 클릭 → 상세 페이지 이동
- "추가" 버튼 → GitHub Issue 생성 (길드/캐릭터 추가 요청)

### 상세 페이지 (`detail.html`)

- 캐릭터 기본 정보 (이름, 종족, 직업, 길드, 진영)
- 브라켓별 레이팅 카드
- Chart.js 레이팅 변화 그래프 (Supabase 히스토리 기반)
- 기록 이력 테이블 (시간별 레이팅 변동)
