-- المرحلة 9 (0.4 الجزء ب): أساس المخطط «أدواتي». الجداول، RLS (المالك أو مربٍ نشط بصلاحية view_planner)، الصلاحية العاشرة view_planner،
-- عمق المهام الفرعية 1، الجسر مع missions/evidence_events (أعمدة فقط؛ المنطق في المرحلة 11). لا قيم هنا: الحدود من config/planner.json.

create type public.planner_priority as enum ('high', 'medium', 'low', 'none');
create type public.planner_task_status as enum ('open', 'done', 'cancelled');
create type public.planner_created_via as enum ('manual', 'nlp', 'voice', 'guardian', 'ai_breakdown');
create type public.planner_recur_from as enum ('schedule', 'completion');
create type public.planner_reminder_kind as enum ('absolute', 'relative', 'place');

-- ب.12: صلاحية view_planner — الافتراضي للمنشئ في child مفعّلة؛ teen/adult معطلة إلا بمنح صريح؛ teen→adult تعود معطلة.
create or replace function app.create_child_profile(
  p_child_user_id uuid, p_guardian_user_id uuid, p_display_name text, p_login_code text,
  p_relation public.guardian_relation, p_policy_version text, p_timezone text default 'Asia/Amman'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid;
  v_all jsonb := '{"view_progress":true,"view_chat":true,"intervene_chat":true,"add_missions":true,"receive_alerts":true,"manage_guardians":true,"add_rewards":true,"manage_settings":true,"approve_suggestions":true,"view_planner":true}'::jsonb;
begin
  if not exists (select 1 from public.profiles where user_id = p_guardian_user_id) then
    raise exception 'guardian must have a profile' using errcode = '23514';
  end if;
  insert into public.profiles (user_id, kind, display_name, age_mode, timezone, login_code, created_by)
  values (p_child_user_id, 'player', p_display_name, 'child', p_timezone, p_login_code, p_guardian_user_id)
  returning id into v_profile_id;

  insert into public.guardian_links (guardian_id, player_id, relation, is_creator, permissions, status, invited_by)
  values (p_guardian_user_id, v_profile_id, p_relation, true, v_all, 'active', p_guardian_user_id);

  insert into public.consents (profile_id, guardian_id, policy_version)
  values (v_profile_id, p_guardian_user_id, p_policy_version);

  insert into public.audit_log (actor_id, action, target)
  values (p_guardian_user_id, 'child_profile_created', v_profile_id::text);
  return v_profile_id;
end;
$$;

create or replace function app.transition_age_mode(p_profile_id uuid, p_new_mode public.age_mode)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old public.age_mode;
  v_safety jsonb;
  v_view_only jsonb := '{"view_progress":true,"view_chat":false,"intervene_chat":false,"add_missions":false,"receive_alerts":false,"manage_guardians":false,"add_rewards":false,"manage_settings":false,"approve_suggestions":false,"view_planner":false}'::jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select age_mode into v_old from public.profiles where id = p_profile_id and kind = 'player';
  if not found then raise exception 'player profile not found' using errcode = '23514'; end if;
  if v_old = p_new_mode then return; end if;
  if p_new_mode = 'child' then
    raise exception 'cannot transition into child mode' using errcode = '23514';
  end if;
  if v_old = 'child' then
    if not app.is_creator_guardian(p_profile_id) then raise exception 'only the creator guardian can change a child mode' using errcode = '42501'; end if;
  else
    if not app.is_profile_owner(p_profile_id) then raise exception 'only the player can change their mode' using errcode = '42501'; end if;
  end if;

  perform set_config('app.audit_source', 'age_transition', true);

  if v_old = 'child' and p_new_mode = 'teen' then
    select coalesce(edit_rules -> 'teen' -> 'lockable_keys_override', '[]'::jsonb) into v_safety from public.config_meta where id = 1;
    update public.settings set locked = false, locked_by_user_id = null
      where profile_id = p_profile_id and locked and not (v_safety ? key);
  end if;

  if p_new_mode = 'adult' then
    update public.guardian_links set permissions = v_view_only
      where player_id = p_profile_id and status = 'active';
  end if;

  update public.profiles set age_mode = p_new_mode where id = p_profile_id;
  insert into public.audit_log (actor_id, action, target, meta)
  values (auth.uid(), 'age_mode_transition', p_profile_id::text, jsonb_build_object('from', v_old, 'to', p_new_mode));
end;
$$;

grant execute on function app.transition_age_mode(uuid, public.age_mode) to authenticated;

-- أعلى مستوى أدوات انفتح للمتدرب (never_lock_after_unlock)
alter table public.profiles add column if not exists planner_tier_max smallint not null default 0 check (planner_tier_max between 0 and 2);

create table public.planner_projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  color text,
  context_tag text,                       -- ب.11: سياق المشروع يُورَّث للأدلة
  archived boolean not null default false,
  "order" int not null default 0,
  created_at timestamptz not null default now()
);
create index planner_projects_profile_idx on public.planner_projects (profile_id, archived, "order");

create table public.planner_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.planner_projects (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  "order" int not null default 0
);

create table public.planner_tags (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  color text,
  unique (profile_id, name)
);

create table public.planner_tasks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.planner_projects (id) on delete set null,
  section_id uuid references public.planner_sections (id) on delete set null,
  parent_task_id uuid references public.planner_tasks (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  notes text,
  priority public.planner_priority not null default 'none',
  due_date date,
  due_time time,
  estimate_min int check (estimate_min is null or estimate_min > 0),
  actual_min int check (actual_min is null or actual_min >= 0),
  status public.planner_task_status not null default 'open',
  completed_at timestamptz,
  cancel_reason text,
  recurrence_rrule text,
  recur_from public.planner_recur_from not null default 'schedule',
  important boolean not null default false,
  urgent boolean not null default false,
  kanban_column text,
  postpone_count int not null default 0,
  postpone_prompted boolean not null default false,   -- ب.8: سؤال «شو اللي عم يأخّر هالمهمة؟» مرة واحدة
  created_via public.planner_created_via not null default 'manual',
  created_by uuid references auth.users (id) on delete set null,
  auto_rescheduled boolean not null default false,
  linked_goal_id uuid references public.goals (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index planner_tasks_profile_due_idx on public.planner_tasks (profile_id, status, due_date);
create index planner_tasks_parent_idx on public.planner_tasks (parent_task_id);

-- ب.3: مهام فرعية بعمق 1 فقط، والفرعية تتبع ملف الأب
create or replace function app.planner_task_guard() returns trigger language plpgsql as $$
declare v_parent public.planner_tasks%rowtype;
begin
  if new.parent_task_id is not null then
    if new.parent_task_id = new.id then raise exception 'task cannot be its own parent' using errcode = '23514'; end if;
    select * into v_parent from public.planner_tasks where id = new.parent_task_id;
    if not found then raise exception 'parent task not found' using errcode = '23514'; end if;
    if v_parent.parent_task_id is not null then raise exception 'subtasks are limited to depth 1' using errcode = '23514'; end if;
    if v_parent.profile_id <> new.profile_id then raise exception 'subtask must belong to the same profile' using errcode = '23514'; end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'done' and old.status <> 'done' and new.completed_at is null then new.completed_at := now(); end if;
  if new.status <> 'done' then new.completed_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger planner_task_guard_trg before insert or update on public.planner_tasks for each row execute function app.planner_task_guard();

create table public.planner_task_tags (
  task_id uuid not null references public.planner_tasks (id) on delete cascade,
  tag_id uuid not null references public.planner_tags (id) on delete cascade,
  primary key (task_id, tag_id)
);

create table public.planner_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.planner_tasks (id) on delete cascade,
  text text not null check (length(btrim(text)) between 1 and 200),
  done boolean not null default false,
  "order" int not null default 0
);

-- أماكن يدخلها المستخدم يدويًا لتذكير «عند فتح التطبيق قرب المكان» (ب.5، أولوية C). لا سجل مواقع.
create table public.planner_places (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 80),
  lat double precision not null,
  lng double precision not null,
  radius_m int not null check (radius_m > 0)
);

create table public.planner_reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.planner_tasks (id) on delete cascade,
  kind public.planner_reminder_kind not null,
  at timestamptz,                 -- absolute: الوقت نفسه؛ relative: يُحسب من موعد المهمة ناقص offset_min ويُخزَّن هنا
  offset_min int check (offset_min is null or offset_min >= 0),
  place_id uuid references public.planner_places (id) on delete cascade,
  important boolean not null default false,   -- ب.5: المهم يتجاوز ساعات الهدوء
  snoozed_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'place' and place_id is not null) or (kind <> 'place' and at is not null))
);
create index planner_reminders_due_idx on public.planner_reminders (sent_at, at) where sent_at is null;

create table public.planner_time_blocks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  task_id uuid references public.planner_tasks (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  kept boolean
);
create index planner_time_blocks_profile_idx on public.planner_time_blocks (profile_id, starts_at);

create table public.planner_focus_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  task_id uuid references public.planner_tasks (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  minutes int not null default 0 check (minutes >= 0),
  completed boolean not null default false,
  distraction_count int not null default 0,
  returned_after_distraction boolean
);

create table public.planner_habits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  schedule jsonb not null default '{"kind":"daily"}'::jsonb,
  capability_id text references public.capabilities (id),
  flex_days_per_week int not null default 1 check (flex_days_per_week between 0 and 7),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.planner_habit_checkins (
  habit_id uuid not null references public.planner_habits (id) on delete cascade,
  date date not null,
  done boolean not null default true,
  flex_used boolean not null default false,
  primary key (habit_id, date)
);

create table public.planner_saved_filters (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  query jsonb not null default '{}'::jsonb
);

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  done_summary text,
  postponed_summary text,
  next_priorities jsonb not null default '[]'::jsonb,
  session_id uuid references public.companion_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (profile_id, week_start)
);

-- الجسر (ب.11): أعمدة فقط هنا؛ منطق الأدلة والتحويل في المرحلة 11
alter table public.missions add column if not exists planner_task_id uuid references public.planner_tasks (id) on delete set null;
alter table public.evidence_events add column if not exists planner_task_id uuid references public.planner_tasks (id) on delete cascade;
create unique index if not exists evidence_unique_per_planner_task on public.evidence_events (planner_task_id, capability_id, type) where planner_task_id is not null;

-- ----------------------------------------------------------------------------
-- RLS (ب.12): القراءة للمالك أو المشرف أو مربٍ نشط يملك view_planner؛ الكتابة للمالك،
-- والمربي بـ add_missions يضيف مهامًا في مخطط المتدرب (created_via = guardian) ويعدّل ما أضافه هو.
-- ----------------------------------------------------------------------------
create or replace function app.can_view_planner(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app.is_profile_owner(p_profile_id) or app.is_admin() or app.has_permission(p_profile_id, 'view_planner');
$$;
grant execute on function app.can_view_planner(uuid) to authenticated;

create or replace function app.planner_task_profile(p_task_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select profile_id from public.planner_tasks where id = p_task_id;
$$;
grant execute on function app.planner_task_profile(uuid) to authenticated;
create or replace function app.planner_project_profile(p_project_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select profile_id from public.planner_projects where id = p_project_id;
$$;
grant execute on function app.planner_project_profile(uuid) to authenticated;
create or replace function app.planner_habit_profile(p_habit_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select profile_id from public.planner_habits where id = p_habit_id;
$$;
grant execute on function app.planner_habit_profile(uuid) to authenticated;

alter table public.planner_projects enable row level security;
alter table public.planner_sections enable row level security;
alter table public.planner_tags enable row level security;
alter table public.planner_tasks enable row level security;
alter table public.planner_task_tags enable row level security;
alter table public.planner_checklist_items enable row level security;
alter table public.planner_places enable row level security;
alter table public.planner_reminders enable row level security;
alter table public.planner_time_blocks enable row level security;
alter table public.planner_focus_sessions enable row level security;
alter table public.planner_habits enable row level security;
alter table public.planner_habit_checkins enable row level security;
alter table public.planner_saved_filters enable row level security;
alter table public.weekly_reviews enable row level security;

-- جداول بعمود profile_id مباشر
create policy "planner_projects read" on public.planner_projects for select to authenticated using (app.can_view_planner(profile_id));
create policy "planner_projects write" on public.planner_projects for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "planner_tags read" on public.planner_tags for select to authenticated using (app.can_view_planner(profile_id));
create policy "planner_tags write" on public.planner_tags for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "planner_saved_filters read" on public.planner_saved_filters for select to authenticated using (app.can_view_planner(profile_id));
create policy "planner_saved_filters write" on public.planner_saved_filters for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "planner_time_blocks read" on public.planner_time_blocks for select to authenticated using (app.can_view_planner(profile_id));
create policy "planner_time_blocks write" on public.planner_time_blocks for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "planner_focus_sessions read" on public.planner_focus_sessions for select to authenticated using (app.can_view_planner(profile_id));
create policy "planner_focus_sessions write" on public.planner_focus_sessions for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "planner_habits read" on public.planner_habits for select to authenticated using (app.can_view_planner(profile_id));
create policy "planner_habits write" on public.planner_habits for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "weekly_reviews read" on public.weekly_reviews for select to authenticated using (app.can_view_planner(profile_id));
create policy "weekly_reviews write" on public.weekly_reviews for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
-- الأماكن: المالك وحده (خصوصية؛ قرار موثّق في VERIFY-LATER)
create policy "planner_places owner" on public.planner_places for all to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));

-- المهام: المالك يكتب كل شيء؛ المربي بـ add_missions يضيف (created_via = guardian) ويعدّل/يحذف ما أضافه هو
create policy "planner_tasks read" on public.planner_tasks for select to authenticated using (app.can_view_planner(profile_id));
create policy "planner_tasks owner insert" on public.planner_tasks for insert to authenticated with check (app.is_profile_owner(profile_id) and created_via <> 'guardian');
create policy "planner_tasks guardian insert" on public.planner_tasks for insert to authenticated
  with check (created_via = 'guardian' and created_by = auth.uid() and app.has_permission(profile_id, 'add_missions'));
create policy "planner_tasks owner update" on public.planner_tasks for update to authenticated using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "planner_tasks guardian update" on public.planner_tasks for update to authenticated
  using (created_via = 'guardian' and created_by = auth.uid() and app.has_permission(profile_id, 'add_missions'))
  with check (created_via = 'guardian' and created_by = auth.uid() and app.has_permission(profile_id, 'add_missions'));
create policy "planner_tasks owner delete" on public.planner_tasks for delete to authenticated using (app.is_profile_owner(profile_id));
create policy "planner_tasks guardian delete" on public.planner_tasks for delete to authenticated using (created_via = 'guardian' and created_by = auth.uid() and app.has_permission(profile_id, 'add_missions'));

-- جداول تابعة لمهمة/مشروع/عادة: نفس قاعدة الأب
create policy "planner_sections read" on public.planner_sections for select to authenticated using (app.can_view_planner(app.planner_project_profile(project_id)));
create policy "planner_sections write" on public.planner_sections for all to authenticated using (app.is_profile_owner(app.planner_project_profile(project_id))) with check (app.is_profile_owner(app.planner_project_profile(project_id)));
create policy "planner_task_tags read" on public.planner_task_tags for select to authenticated using (app.can_view_planner(app.planner_task_profile(task_id)));
create policy "planner_task_tags write" on public.planner_task_tags for all to authenticated using (app.is_profile_owner(app.planner_task_profile(task_id))) with check (app.is_profile_owner(app.planner_task_profile(task_id)));
create policy "planner_checklist read" on public.planner_checklist_items for select to authenticated using (app.can_view_planner(app.planner_task_profile(task_id)));
create policy "planner_checklist write" on public.planner_checklist_items for all to authenticated using (app.is_profile_owner(app.planner_task_profile(task_id))) with check (app.is_profile_owner(app.planner_task_profile(task_id)));
create policy "planner_reminders read" on public.planner_reminders for select to authenticated using (app.can_view_planner(app.planner_task_profile(task_id)));
create policy "planner_reminders write" on public.planner_reminders for all to authenticated using (app.is_profile_owner(app.planner_task_profile(task_id))) with check (app.is_profile_owner(app.planner_task_profile(task_id)));
create policy "planner_habit_checkins read" on public.planner_habit_checkins for select to authenticated using (app.can_view_planner(app.planner_habit_profile(habit_id)));
create policy "planner_habit_checkins write" on public.planner_habit_checkins for all to authenticated using (app.is_profile_owner(app.planner_habit_profile(habit_id))) with check (app.is_profile_owner(app.planner_habit_profile(habit_id)));

grant select, insert, update, delete on public.planner_projects, public.planner_sections, public.planner_tags, public.planner_tasks, public.planner_task_tags,
  public.planner_checklist_items, public.planner_places, public.planner_reminders, public.planner_time_blocks, public.planner_focus_sessions,
  public.planner_habits, public.planner_habit_checkins, public.planner_saved_filters, public.weekly_reviews to authenticated;

-- ب.2 never_lock_after_unlock: تثبيت أعلى مستوى انفتح (يرتفع فقط). المالك أو مربٍ نشط أو المشرف.
create or replace function app.planner_record_tier(p_profile_id uuid, p_tier int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (app.is_profile_owner(p_profile_id) or app.is_active_guardian(p_profile_id) or app.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.profiles set planner_tier_max = greatest(planner_tier_max, least(2, greatest(0, p_tier))) where id = p_profile_id;
end;
$$;
grant execute on function app.planner_record_tier(uuid, int) to authenticated;
create or replace function public.planner_record_tier(p_profile_id uuid, p_tier int) returns void language sql security definer set search_path = public as $$ select app.planner_record_tier(p_profile_id, p_tier); $$;
grant execute on function public.planner_record_tier(uuid, int) to authenticated;
