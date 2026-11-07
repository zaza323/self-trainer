-- المرحلة 10 (0.4): لحظات اليوم (ج)، الحين والتالي (د)، الراحة المجدِّدة (هـ)، التفاعل والإشعارات المتكيّفة (و)،
-- محاسبة النفس (ز)، مرآة الواقع يدويًا (ط)، وفتح التطبيق (للنشاط والغياب). لا قيم هنا؛ الحدود من config/planner.json.
-- قيم enum الجديدة في نهاية الملف لأن PostgreSQL لا يسمح باستعمالها في المعاملة نفسها.

-- فتح التطبيق: يوم نشاط (للحالات و.2 والغياب و.3). لا تتبع أدق من "فُتح اليوم".
create table public.app_opens (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  opens int not null default 1,
  primary key (profile_id, local_date)
);

-- (ج) لحظات اليوم
create table public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  moment text not null check (moment in ('morning_plan', 'midday_check', 'evening_review', 'night_plan', 'muhasaba')),
  status text not null default 'shown' check (status in ('shown', 'dismissed', 'answered')),
  shown_at timestamptz not null default now(),
  answered_at timestamptz,
  top_priorities jsonb not null default '[]'::jsonb,   -- [{task_id|null, text}]
  session_id uuid references public.companion_sessions (id) on delete set null,
  unique (profile_id, local_date, moment)
);
alter table public.companion_sessions add column if not exists daily_moment text;

-- (د) المتابعة والانتقال
create table public.planner_followups (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  item_kind text not null check (item_kind in ('task', 'block', 'habit', 'mission')),
  item_id uuid not null,
  occurrence_date date not null,
  scheduled_end timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'partial', 'missed', 'postponed', 'snoozed')),
  snooze_count int not null default 0,
  duration_feel text check (duration_feel in ('less', 'about', 'more')),
  answered_at timestamptz,
  device_id text,
  created_at timestamptz not null default now(),
  unique (item_kind, item_id, occurrence_date)
);
create index planner_followups_profile_idx on public.planner_followups (profile_id, status, scheduled_end);
create table public.planner_transitions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  from_followup_id uuid references public.planner_followups (id) on delete set null,
  next_kind text not null check (next_kind in ('task', 'block', 'habit', 'mission', 'rest')),
  next_item_id uuid,
  suggested_by text not null check (suggested_by in ('app', 'user')),
  started_at timestamptz,
  created_at timestamptz not null default now()
);

-- (هـ) الراحة المجدِّدة — لا بيانات صحية، لا تتبع نوم
create table public.custom_rest_activities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 80),
  default_min int not null check (default_min > 0),
  created_by uuid references auth.users (id) on delete set null,
  active boolean not null default true
);
create table public.rest_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  activity_key text not null,
  custom_activity_id uuid references public.custom_rest_activities (id) on delete set null,
  planned_min int not null check (planned_min >= 0),
  actual_min int check (actual_min is null or actual_min >= 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  source text not null check (source in ('next', 'free_gap', 'pomodoro', 'priorities_done', 'wind_down', 'manual')),
  feel_after text check (feel_after in ('more', 'same', 'less')),
  transition_id uuid references public.planner_transitions (id) on delete set null
);
create index rest_sessions_profile_idx on public.rest_sessions (profile_id, started_at desc);
create table public.rest_outcomes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  activity_key text not null,
  uses int not null default 0,
  felt_more_count int not null default 0,
  last_used_at timestamptz,
  primary key (profile_id, activity_key)
);

-- (و) التفاعل والإشعارات المتكيّفة
create table public.engagement_states (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  state text not null check (state in ('momentum', 'steady', 'low', 'away')),
  follow_through numeric,
  active_days_7 int not null default 0,
  notif_response_rate numeric,
  computed_at timestamptz not null default now(),
  primary key (profile_id, date)
);
create table public.busy_windows (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour smallint not null check (end_hour between 1 and 24),
  source text not null check (source in ('learned', 'manual')),
  evidence_count int not null default 0,
  active boolean not null default true,
  unique (profile_id, weekday, start_hour)
);
create table public.dnd_periods (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  kind text not null check (kind in ('1h', '2h', 'until_task', 'until_tomorrow'))
);
create table public.retro_completions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  approx_at timestamptz not null,
  created_at timestamptz not null default now(),
  linked_task_id uuid references public.planner_tasks (id) on delete set null
);
alter table public.notifications
  add column if not exists state_at_send text,
  add column if not exists budget_slot int,
  add column if not exists bundled_ids uuid[] not null default '{}',
  add column if not exists ignored boolean;

-- (ز) محاسبة النفس
create table public.muhasaba_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  achieved jsonb not null default '[]'::jsonb,
  shortfalls jsonb not null default '[]'::jsonb,     -- حتى 3: {text, reason, task_id}
  next_steps jsonb not null default '[]'::jsonb,
  rest_day boolean not null default false,
  completed boolean not null default false,
  session_id uuid references public.companion_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (profile_id, local_date)
);

-- (ط) مرآة الواقع — إعادة البناء خاصة بالمتدرب؛ المربي يرى المرآة المجمّعة فقط
create table public.day_reconstructions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  source text not null check (source in ('muhasaba', 'onboarding', 'manual')),
  completed boolean not null default false,
  unknown_minutes int not null default 0,
  screen_estimate_min int,
  created_at timestamptz not null default now(),
  unique (profile_id, local_date)
);
create table public.time_blocks_actual (
  id uuid primary key default gen_random_uuid(),
  reconstruction_id uuid not null references public.day_reconstructions (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  category text not null,
  label text,
  energy text check (energy in ('high', 'normal', 'low')),
  origin text not null check (origin in ('prefilled', 'chat', 'manual', 'ai_parsed')),
  was_planned boolean not null default false
);
create index time_blocks_actual_rec_idx on public.time_blocks_actual (reconstruction_id, starts_at);
create table public.mirror_reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  days_count int not null,
  distribution jsonb not null default '{}'::jsonb,
  predictions jsonb not null default '[]'::jsonb,
  goal_alignment jsonb not null default '[]'::jsonb,
  patterns jsonb not null default '[]'::jsonb,
  user_noticed text,
  chosen_change_increment_id uuid,
  chosen_change_text text,
  created_at timestamptz not null default now()
);
create table public.reconstruction_categories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  key text not null,
  label text not null,
  is_default boolean not null default false,
  active boolean not null default true,
  unique (profile_id, key)
);
-- الانضمام من الواقع (ط.2): اختيار المتدرب
alter table public.profiles add column if not exists onboarding_path text check (onboarding_path in ('reality', 'goals'));

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
create or replace function app.followup_profile(p_id uuid) returns uuid language sql stable security definer set search_path = public as $$ select profile_id from public.planner_followups where id = p_id; $$;
create or replace function app.reconstruction_profile(p_id uuid) returns uuid language sql stable security definer set search_path = public as $$ select profile_id from public.day_reconstructions where id = p_id; $$;
grant execute on function app.followup_profile(uuid), app.reconstruction_profile(uuid) to authenticated;

alter table public.app_opens enable row level security;
alter table public.daily_checkins enable row level security;
alter table public.planner_followups enable row level security;
alter table public.planner_transitions enable row level security;
alter table public.custom_rest_activities enable row level security;
alter table public.rest_sessions enable row level security;
alter table public.rest_outcomes enable row level security;
alter table public.engagement_states enable row level security;
alter table public.busy_windows enable row level security;
alter table public.dnd_periods enable row level security;
alter table public.retro_completions enable row level security;
alter table public.muhasaba_entries enable row level security;
alter table public.day_reconstructions enable row level security;
alter table public.time_blocks_actual enable row level security;
alter table public.mirror_reports enable row level security;
alter table public.reconstruction_categories enable row level security;

-- المالك يكتب؛ القراءة: المالك، أو مربٍ بـ view_planner لما يخص المخطط (ردود «تمّت؟»، اللحظات، المحاسبة، المرآة المجمّعة)
create policy "app_opens owner" on public.app_opens for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "daily_checkins read" on public.daily_checkins for select to authenticated using (app.can_view_planner(profile_id));
create policy "daily_checkins write" on public.daily_checkins for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "followups read" on public.planner_followups for select to authenticated using (app.can_view_planner(profile_id));
create policy "followups write" on public.planner_followups for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "transitions owner" on public.planner_transitions for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
-- أنشطة الراحة المخصصة: المالك، والمربي المنشئ/بـ manage_settings يضيف للطفل
create policy "custom_rest read" on public.custom_rest_activities for select to authenticated using (app.can_view_planner(profile_id));
create policy "custom_rest owner" on public.custom_rest_activities for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "custom_rest guardian" on public.custom_rest_activities for insert to authenticated with check (created_by = auth.uid() and app.has_permission(profile_id, 'manage_settings'));
create policy "custom_rest guardian update" on public.custom_rest_activities for update to authenticated using (created_by = auth.uid() and app.has_permission(profile_id, 'manage_settings'));
create policy "rest_sessions owner" on public.rest_sessions for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "rest_outcomes owner" on public.rest_outcomes for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
-- حالة التفاعل: لا تظهر للمستخدم كتصنيف؛ القراءة للمالك (شاشة الإعدادات بلغة بسيطة) والمشرف
create policy "engagement owner read" on public.engagement_states for select to authenticated using (app.is_profile_owner(profile_id) or app.is_admin());
create policy "busy_windows owner" on public.busy_windows for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "dnd owner" on public.dnd_periods for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "retro read" on public.retro_completions for select to authenticated using (app.can_view_planner(profile_id));
create policy "retro write" on public.retro_completions for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "muhasaba read" on public.muhasaba_entries for select to authenticated using (app.can_view_planner(profile_id));
create policy "muhasaba write" on public.muhasaba_entries for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
-- ط.9: تفاصيل إعادة البناء للمتدرب وحده في كل الأوضاع؛ المرآة المجمّعة لمن يملك view_planner
create policy "reconstructions owner" on public.day_reconstructions for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "time_blocks_actual owner" on public.time_blocks_actual for all to authenticated using (app.is_profile_owner(app.reconstruction_profile(reconstruction_id))) with check (app.is_profile_owner(app.reconstruction_profile(reconstruction_id)));
create policy "mirror read" on public.mirror_reports for select to authenticated using (app.can_view_planner(profile_id));
create policy "mirror write" on public.mirror_reports for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "recon_categories owner" on public.reconstruction_categories for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));

grant select, insert, update, delete on public.app_opens, public.daily_checkins, public.planner_followups, public.planner_transitions, public.custom_rest_activities,
  public.rest_sessions, public.rest_outcomes, public.busy_windows, public.dnd_periods, public.retro_completions, public.muhasaba_entries,
  public.day_reconstructions, public.time_blocks_actual, public.mirror_reports, public.reconstruction_categories to authenticated;
grant select on public.engagement_states to authenticated;

-- أنواع الجلسة الجديدة (لا تُستعمل في هذا الملف)
alter type public.companion_mode add value if not exists 'daily_moment';
alter type public.companion_mode add value if not exists 'mirror';
alter type public.companion_mode add value if not exists 'weekly_review';
