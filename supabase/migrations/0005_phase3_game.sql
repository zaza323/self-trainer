-- ============================================================================
-- المرحلة 3: الغلاف اللعبي
-- achievements (تربوية عامة من content/ + خاصة من المربي في المرحلة 5)، profile_achievements،
-- collectibles (المرحلة 1–2 فقط)، avatar_stage_max (لا تتراجع المساحة)، game_intensity المحسوبة للعرض.
-- الكتابة من service_role فقط؛ المتصفح يقرأ.
-- ============================================================================

alter table public.profiles add column avatar_stage_max smallint not null default 1 check (avatar_stage_max between 1 and 6);

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name_by_mode jsonb not null,
  description_by_mode jsonb not null default '{}'::jsonb,
  rule jsonb not null default '{}'::jsonb,
  owner_profile_id uuid references public.profiles (id) on delete cascade,  -- null = تربوي عام
  created_by uuid references auth.users (id) on delete set null,
  icon text not null default '★',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index achievements_general_code on public.achievements (code) where owner_profile_id is null;

create table public.profile_achievements (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id uuid not null references public.achievements (id) on delete cascade,
  tier smallint not null default 1,
  earned_at timestamptz not null default now(),
  source_key text not null default '',   -- مثلًا القدرة في "طبقتَ في سياق جديد" (مرة لكل قدرة)
  source_id text,                         -- المهمة التي أطلقته (للاحتفال)
  primary key (profile_id, achievement_id, tier, source_key)
);

create table public.collectibles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  mission_id uuid not null unique references public.missions (id) on delete cascade,
  kind text not null,
  icon text not null,
  earned_at timestamptz not null default now()
);

alter table public.achievements enable row level security;
alter table public.profile_achievements enable row level security;
alter table public.collectibles enable row level security;

create policy "achievements read" on public.achievements for select to authenticated
  using (owner_profile_id is null or app.is_profile_owner(owner_profile_id) or app.has_permission(owner_profile_id, 'view_progress'));
create policy "profile_achievements read" on public.profile_achievements for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress'));
create policy "collectibles read" on public.collectibles for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress'));

grant select on public.achievements, public.profile_achievements, public.collectibles to authenticated;
