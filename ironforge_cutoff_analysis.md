# Ironforge.pro PvP Cutoff 배지 분석 보고서

## 1. 스크린샷

![Ironforge Leaderboard Screenshot](../captured_screenshots/ironforge_cutoff_badges.png)

## 2. 시각적 관찰 내용

### 배지 레이아웃
페이지 상단에 5개의 컷오프 배지가 수평으로 배치되어 있습니다:

1. **2265 - Infernal Gladiator** (주황색/오렌지)
   - Rank ~29
   
2. **2101 - Gladiator** (보라색/퍼플)
   - Ranks ~167-170

3. **1820 - Duelist** (파란색/블루)
   - Ranks ~1041-1047

4. **1584 - Rival** (녹색/그린)
   - Ranks ~3916-3937

5. **1462 - Challenger** (회색)

### 시각적 스타일
- 각 배지는 어두운 배경(검은색 또는 짙은 회색)에 밝은 텍스트로 표시됩니다
- 레이팅 숫자가 상단에 크게 표시되며, 색상으로 등급을 구분합니다
- 등급 이름(Infernal Gladiator, Gladiator 등)이 레이팅 아래에 표시됩니다
- Rank 범위 정보가 작은 텍스트로 추가로 표시됩니다
- 배지들 사이에 적절한 간격이 있습니다
- 전체적으로 깔끔하고 현대적인 카드 형태의 UI 디자인입니다

### 색상 구분
- **Infernal Gladiator**: 주황색 (#FF8C00 ~ #FFA500 계열)
- **Gladiator**: 보라색 (#9B59B6 ~ #8E44AD 계열)
- **Duelist**: 파란색 (#3498DB ~ #2980B9 계열)
- **Rival**: 녹색 (#27AE60 ~ #2ECC71 계열)
- **Challenger**: 회색 (#95A5A6 계열)

## 3. HTML 구조 추정

스냅샷 로그에서 확인한 요소들:
- heading level 5 태그 사용 (h5)
- 각 컷오프는 개별 헤딩 요소로 구성됨
- 레퍼런스: e933 (2265), e934 (2101), e935 (1820), e936 (1584), e937 (1462)

```html
<h5>2265</h5>  <!-- Infernal Gladiator -->
<h5>2101</h5>  <!-- Gladiator -->
<h5>1820</h5>  <!-- Duelist -->
<h5>1584</h5>  <!-- Rival -->
<h5>1462</h5>  <!-- Challenger -->
```

아래에 "Cutoffs and estimated placement requirements updated at March 5 • 01:04" 텍스트가 표시됩니다.

## 4. 추정되는 CSS 클래스 및 구조

Ironforge.pro는 아마도 다음과 같은 CSS 클래스를 사용할 것으로 추정됩니다:

```css
.cutoff-container {
  display: flex;
  justify-content: space-around;
  gap: 20px;
  padding: 20px;
}

.cutoff-badge {
  background-color: #2c3e50;
  padding: 15px 20px;
  border-radius: 8px;
  text-align: center;
  min-width: 120px;
}

.cutoff-rating {
  font-size: 32px;
  font-weight: bold;
  margin-bottom: 5px;
}

.cutoff-rating.infernal-gladiator {
  color: #ff8c00;
}

.cutoff-rating.gladiator {
  color: #9b59b6;
}

.cutoff-rating.duelist {
  color: #3498db;
}

.cutoff-rating.rival {
  color: #27ae60;
}

.cutoff-rating.challenger {
  color: #95a5a6;
}

.cutoff-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 3px;
}

.cutoff-rank {
  font-size: 11px;
  color: #95a5a6;
}
```

## 5. 아이콘 정보

스크린샷을 보면 각 배지에는 별도의 아이콘 이미지가 표시되지 않는 것으로 보입니다.
대신 텍스트의 색상으로 등급을 구분하고 있습니다.

만약 아이콘을 사용한다면, WoW의 PvP 등급 아이콘을 사용할 것으로 예상됩니다:
- 아이콘은 일반적으로 방패나 배지 형태
- 각 등급마다 고유한 디자인
- PNG 또는 SVG 포맷

## 6. 구현 권장사항

우리 프로젝트에서 유사한 디자인을 구현할 때:

1. **컨테이너 레이아웃**: Flexbox 또는 CSS Grid 사용
2. **반응형 디자인**: 모바일에서는 세로로 쌓이도록 설정
3. **색상 일관성**: WoW의 공식 PvP 등급 색상 사용
4. **타이포그래피**: 큰 레이팅 숫자와 작은 설명 텍스트로 계층 구조 명확히
5. **간격 및 패딩**: 읽기 쉽도록 충분한 공간 확보
6. **다크 테마**: 어두운 배경에 밝은 텍스트로 가독성 향상
7. **업데이트 타임스탬프**: 컷오프 업데이트 시간 명시

## 7. 다음 단계

- [ ] 실제 Ironforge.pro HTML 소스 확인 (개발자 도구 필요)
- [ ] CSS 파일 다운로드 및 분석
- [ ] PvP 등급 아이콘 이미지 URL 확인
- [ ] 애니메이션 효과 확인 (hover, transition 등)
