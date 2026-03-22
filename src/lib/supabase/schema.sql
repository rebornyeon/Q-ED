-- Q:ED Supabase 스키마
-- Supabase Dashboard > SQL Editor에서 실행하세요

-- 사용자 프로필 (auth.users와 연결)
create table if not exists profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  display_name text,
  locale text default 'ko',
  created_at timestamptz default now()
);

-- 프로필 자동 생성 트리거
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, locale)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.email),
    coalesce(new.raw_user_meta_data->>'locale', 'ko')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- 학습 문서 (PDF)
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  title text not null,
  file_path text not null,
  analysis jsonb,
  created_at timestamptz default now()
);

-- 학습 세션
create table if not exists study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  document_id uuid references documents(id) on delete cascade not null,
  status text default 'active' check (status in ('active', 'completed')),
  score_data jsonb,
  created_at timestamptz default now()
);

-- 문제
create table if not exists problems (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references study_sessions(id) on delete cascade not null,
  document_id uuid references documents(id) on delete cascade not null,
  content text not null,
  problem_type text,
  difficulty int check (difficulty between 1 and 5),
  concepts text[] default '{}',
  created_at timestamptz default now()
);

-- Cue (단서)
create table if not exists cues (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid references problems(id) on delete cascade not null,
  cue_type text not null check (cue_type in ('kill_shot', 'trap', 'pattern', 'speed')),
  cue_level int not null check (cue_level between 1 and 4),
  content text not null,
  why_explanation text,
  created_at timestamptz default now()
);

-- 학습 기록 (실수 패턴 추적)
create table if not exists attempt_logs (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid references problems(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  is_correct boolean not null,
  time_spent int not null default 0,
  cues_used int not null default 0,
  mistake_type text,
  feedback text,
  created_at timestamptz default now()
);

-- RLS 정책
alter table profiles enable row level security;
alter table documents enable row level security;
alter table study_sessions enable row level security;
alter table problems enable row level security;
alter table cues enable row level security;
alter table attempt_logs enable row level security;

-- profiles: 본인만 접근
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- documents: 본인만 CRUD
create policy "Users can manage own documents" on documents for all using (auth.uid() = user_id);

-- study_sessions: 본인만 CRUD
create policy "Users can manage own sessions" on study_sessions for all using (auth.uid() = user_id);

-- problems: 세션 소유자만
create policy "Users can manage own problems" on problems for all
  using (exists (select 1 from study_sessions where id = problems.session_id and user_id = auth.uid()));

-- cues: 문제 접근 가능한 사용자
create policy "Users can view own cues" on cues for all
  using (exists (
    select 1 from problems p
    join study_sessions s on s.id = p.session_id
    where p.id = cues.problem_id and s.user_id = auth.uid()
  ));

-- attempt_logs: 본인만
create policy "Users can manage own attempts" on attempt_logs for all using (auth.uid() = user_id);

-- Storage bucket (PDF 파일용)
-- Supabase Dashboard > Storage에서 'pdfs' bucket을 생성하고 아래 정책을 적용하세요
-- insert into storage.buckets (id, name, public) values ('pdfs', 'pdfs', false);
