# 설치 및 설정 가이드

## 사전 요구사항

- Python 3.12+
- Git
- Battle.net Developer 계정 ([https://develop.battle.net](https://develop.battle.net))
- Supabase 프로젝트 ([https://supabase.com](https://supabase.com))
- GitHub 저장소 (GitHub Pages 활성화)

---

## 1. 로컬 환경 설정

```bash
git clone https://github.com/kenziedev/wowtbc_arena_anni.git
cd wowtbc_arena_anni
pip install -r scripts/requirements.txt
```

---

## 2. Battle.net API 키 발급

1. [https://develop.battle.net](https://develop.battle.net) 접속 및 로그인
2. API Access → Create Client
3. Client ID와 Client Secret 확보

---

## 3. Supabase 설정

### 3-1. 프로젝트 생성

1. [https://supabase.com](https://supabase.com) 에서 프로젝트 생성
2. Settings → API 에서 확인:
   - **Project URL**: `https://xxxx.supabase.co`
   - **anon key**: 공개용 읽기 전용 키
   - **service_role key**: 서버측 쓰기용 키 (비공개)

### 3-2. 스키마 생성

Supabase Dashboard → SQL Editor에서 `supabase/schema.sql` 내용을 실행합니다.

```sql
-- supabase/schema.sql 파일의 전체 내용을 복사하여 실행
```

### 3-3. 프론트엔드 설정

`config/supabase.json`에 URL과 anon key를 설정합니다:

```json
{
  "url": "https://your-project.supabase.co",
  "anon_key": "your-anon-key-here"
}
```

---

## 4. GitHub Secrets 등록

GitHub 저장소 → Settings → Secrets and variables → Actions → **Repository secrets**에 등록:

| Secret 이름 | 값 |
|---|---|
| `BLIZZARD_CLIENT_ID` | Battle.net Client ID |
| `BLIZZARD_CLIENT_SECRET` | Battle.net Client Secret |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key |

> **주의**: "Repository secrets"에 등록해야 합니다. "Environment secrets"는 특정 환경에서만 접근 가능합니다.

---

## 5. GitHub Pages 활성화

1. 저장소 → Settings → Pages
2. Source → **GitHub Actions** 선택
3. 저장

`main` 브랜치에 push가 발생하면 자동으로 배포됩니다.

---

## 6. 로컬 테스트

### 전체 데이터 수집 테스트

```bash
export BLIZZARD_CLIENT_ID="your-id"
export BLIZZARD_CLIENT_SECRET="your-secret"
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-key"

python scripts/fetch_leaderboard.py
```

수집되는 데이터: PvP 레이팅, 특성(이중특성, spell_id, 아이콘), 장비(아이콘/마법부여/보석), 캐릭터 아바타

### 특성 트리 정의 생성

특성 트리 시각화에 필요한 정의 파일을 생성합니다 (최초 1회 또는 데이터 갱신 시):

```bash
python scripts/build_talent_defs.py
```

생성 결과: `data/talent_defs.json` (9직업 × 3트리 특성 정의) 및 특성 아이콘 다운로드

### 증분 데이터 수집 테스트

이슈로 새 길드/캐릭터를 추가한 후 해당 항목만 수집할 때:

```bash
# config/_added.json에 추가 항목이 있어야 함
python scripts/fetch_incremental.py
```

### 웹 서버 실행

```bash
python -m http.server 8080
```

브라우저에서 `http://localhost:8080` 접속

---

## 7. 수집 대상 관리

### 방법 1: `sources.json` 직접 수정

```json
{
  "realms": ["fengus-ferocity", "moldars-moxie"],
  "guilds": [
    { "name": "길드명", "realm": "fengus-ferocity" }
  ],
  "characters": [
    { "name": "캐릭터명", "realm": "fengus-ferocity" }
  ]
}
```

### 방법 2: GitHub Issue로 추가 요청

이슈 제목을 `[추가]`로 시작하면 자동 처리됩니다.

```
제목: [추가] 길드: 길드이름

길드:
- 길드A
- 길드B / 펜구스의 흉포

캐릭터:
- 캐릭터1
- 캐릭터2 / 몰다르의 투지
```

- 존재하지 않는 길드/캐릭터는 자동으로 스킵됩니다
- 이미 등록된 항목은 중복 추가되지 않습니다
- 서버를 지정하지 않으면 기본값은 `펜구스의 흉포`입니다

### 방법 3: 웹사이트 "추가" 버튼

리더보드 페이지의 `+ 추가` 버튼을 클릭하면 GitHub Issue 작성 페이지로 이동합니다.
