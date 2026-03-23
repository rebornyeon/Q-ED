# Q:ED — AI-Powered Math Exam Preparation Engine

> **Start with scores. End with mastery.**

수학 문제집/시험지 PDF를 업로드하면 AI가 문제를 분석하고, 단계별 힌트(Cue)로 사고 과정을 유도하며, 실수 패턴을 추적해 약점을 교정하는 적응형 학습 플랫폼.

---

## 핵심 기능

### 📄 PDF 업로드 & AI 분석
- 수학 교재, 문제집, 기출문제 PDF 업로드
- Google Gemini가 문제·개념·난이도·출제 가능성 자동 추출
- 보충 자료(교수 노트, 기출, 요약본) 업로드 시 출제 패턴 반영

### 💡 4단계 Cue 시스템
풀기 전에 정답을 보는 대신, 단계적으로 힌트를 공개해 사고 과정을 유도

| Cue 타입 | 역할 |
|----------|------|
| **Kill Shot** | 문제를 푸는 핵심 인사이트 |
| **Trap** | 흔히 빠지는 실수 경고 |
| **Pattern** | 문제 유형 구조 인식 |
| **Speed** | 시험에서 빠르게 푸는 전략 |

### 📊 Score & Thinking Radar
5개 축으로 실력을 실시간 추적: **정확도 · 속도 · 패턴 인식 · 함정 회피 · 사고 깊이**

### 🤖 AI 수학 튜터
풀이 중 막힌 부분을 채팅으로 질문 → LaTeX 수식 포함 단계별 설명 (Gemini 2.5 Flash + thinking)

### 📝 학습 노트
세션 중 개념 정리 및 AI 자동 요약 노트 생성

### 🔁 문제 재추출 & 유사 문제 생성
- 잘못 파싱된 문제를 원본 PDF에서 재추출 (Regen)
- 비슷한 유형의 새 문제 AI 생성

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Framework | Next.js 15 (App Router, Node.js runtime) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 + shadcn/ui |
| AI | Google Gemini 2.5 Flash |
| Backend / DB | Supabase (PostgreSQL + Auth + Storage) |
| State | Zustand |
| Math 렌더링 | KaTeX |
| i18n | next-intl (한국어 / English) |
| Charts | Recharts |
| PDF | pdf-lib |
| Package Manager | pnpm |

---

## 로컬 실행

### 사전 준비
- Node.js 18+
- pnpm
- Supabase 프로젝트
- Google AI API 키 (Gemini)

### 설치

```bash
git clone https://github.com/rebornyeon/Q-ED.git
cd Q-ED
pnpm install
```

### 환경 변수

`.env.local` 파일 생성:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
GEMINI_API_KEY=your_google_ai_api_key
```

### 개발 서버 실행

```bash
pnpm dev
```

[http://localhost:3000](http://localhost:3000) 접속

---

## DB 스키마 (Supabase)

```sql
-- 사용자 프로필
profiles (id, display_name, locale, created_at)

-- 업로드 PDF 문서
documents (id, user_id, title, file_path, analysis jsonb, created_at)

-- 학습 세션
study_sessions (id, user_id, document_id, name, status, score_data jsonb, created_at)

-- 추출된 문제
problems (id, session_id, document_id, content, problem_type,
          difficulty, concepts text[], section, page, problem_number,
          exam_likelihood, is_exam_overlap, created_at)

-- 단계별 Cue (힌트)
cues (id, problem_id, cue_type, cue_level, content, why_explanation, created_at)

-- 풀이 기록
attempt_logs (id, problem_id, user_id, is_correct, time_spent,
              cues_used, mistake_type, feedback, created_at)

-- 보충 자료 (기출, 교수 노트 등)
supplementary_documents (id, document_id, user_id, title, file_path,
                         insights jsonb, problems jsonb, created_at)

-- 학습 노트
study_notes (id, session_id, problem_id, user_id, title, content,
             summary, user_note, created_at)
```

Storage bucket: `pdfs` (RLS 적용)

---

## API 라우트

| 엔드포인트 | 메서드 | 역할 |
|-----------|--------|------|
| `/api/analyze` | POST | PDF 분석 및 문제 추출 |
| `/api/session` | POST | 학습 세션 생성 |
| `/api/session/[sessionId]` | GET | 세션 조회 |
| `/api/cue` | POST | 문제별 Cue 생성/조회 |
| `/api/ask-question` | POST | AI 튜터 질의응답 |
| `/api/feedback` | POST | 풀이 결과 기록 + Score 업데이트 |
| `/api/regenerate-problem` | POST | 문제 재추출 (PDF 원본 참조) |
| `/api/generate-similar` | POST | 유사 문제 생성 |
| `/api/supplementary` | POST/GET | 보충 자료 업로드/조회 |
| `/api/notes` | GET/POST | 학습 노트 목록/생성 |
| `/api/notes/[noteId]` | PATCH/DELETE | 노트 수정/삭제 |
| `/api/notes/generate` | POST | AI 노트 자동 생성 |

---

## 프로젝트 구조

```
src/
├── app/
│   ├── [locale]/             # 로케일별 페이지
│   │   ├── page.tsx          # 랜딩
│   │   ├── dashboard/        # 대시보드
│   │   ├── upload/           # PDF 업로드
│   │   └── study/
│   │       └── [sessionId]/  # 학습 세션 (메인 UI)
│   └── api/                  # API 라우트
├── components/
│   ├── math-content.tsx      # LaTeX 수식 렌더러
│   ├── cue-card.tsx          # Cue 카드 UI
│   ├── score-radar.tsx       # 레이더 차트
│   ├── study-notes-panel.tsx
│   └── ui/                   # shadcn/ui 컴포넌트
├── lib/
│   ├── gemini.ts             # Gemini API 래퍼
│   └── supabase/             # Supabase 클라이언트
├── stores/
│   ├── study-store.ts        # 학습 세션 상태 (Zustand)
│   └── cue-store.ts          # Cue 상태 (Zustand)
├── types/index.ts            # TypeScript 타입 정의
└── messages/
    ├── ko.json               # 한국어
    └── en.json               # English
```

---

## 라이선스

Private — All rights reserved.
