-- ============================================================================
-- المرحلة 1: الغاية والمهمة
-- شجرة الغايات (GOAL-1، GOAL-5)، مكتبة القوالب (LIB-1، LIB-3)، آلة حالات المهمة (MIS-1)،
-- التخطيط (MIS-3)، المشتت (MIS-5)، التوقف (MIS-6)، التلميح (MIS-11)، التأمل بأسئلة ثابتة.
-- القوالب تُملأ من content/templates/*.json عبر `pnpm content:sync`.
-- ============================================================================

-- حدود تقنية تُقرأ من config/limits.json عبر config:sync
alter table public.config_meta add column limits jsonb not null default '{}'::jsonb;

create type public.goal_status as enum ('active', 'completed', 'archived');
create type public.training_level as enum ('simulated', 'guided_real', 'independent_real', 'transfer');
create type public.completion_check as enum ('self_report', 'timer', 'checklist', 'guardian_confirm', 'photo');
create type public.template_status as enum ('draft', 'active', 'retired');
create type public.mission_status as enum ('suggested', 'chosen', 'planned', 'in_progress', 'interrupted', 'completed', 'abandoned', 'reflected', 'transferred');
create type public.mission_source as enum ('engine', 'self', 'guardian', 'guardian_recurring');

-- ----------------------------------------------------------------------------
-- الغايات (4.2)
-- ----------------------------------------------------------------------------
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  parent_goal_id uuid references public.goals (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  why text,
  status public.goal_status not null default 'active',
  proposed_by text not null default 'player' check (proposed_by in ('player', 'guardian')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_profile_idx on public.goals (profile_id, status);
create index goals_parent_idx on public.goals (parent_goal_id);

-- عمق السلسلة (عدد الحلقات من الغاية إلى الجذر، الجذر = 1)
create or replace function app.goal_depth(p_goal_id uuid)
returns int language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_goal_id, 1 as depth from public.goals where id = p_goal_id
    union all
    select g.id, g.parent_goal_id, up.depth + 1 from public.goals g join up on g.id = up.parent_goal_id where up.depth < 64
  )
  select max(depth) from up;
$$;

-- أقصى عمق للشجرة الفرعية تحت غاية (لحساب العمق بعد النقل)
create or replace function app.goal_subtree_height(p_goal_id uuid)
returns int language sql stable security definer set search_path = public as $$
  with recursive down as (
    select id, 1 as h from public.goals where id = p_goal_id
    union all
    select g.id, down.h + 1 from public.goals g join down on g.parent_goal_id = down.id where down.h < 64
  )
  select max(h) from down;
$$;

-- GOAL-1: منع الدورات وحد العمق (12) في الخادم؛ الحد يُقرأ من config_meta.goal_max_depth
create or replace function app.goals_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_max int := (select (limits ->> 'goal_max_depth')::int from public.config_meta where id = 1);
  v_parent_profile uuid;
  v_depth int;
begin
  new.updated_at := now();
  if v_max is null then raise exception 'config_meta.limits.goal_max_depth missing: run config:sync' using errcode = '23514'; end if;
  if new.parent_goal_id is null then return new; end if;
  if new.parent_goal_id = new.id then raise exception 'goal cannot be its own parent' using errcode = '23514'; end if;
  select profile_id into v_parent_profile from public.goals where id = new.parent_goal_id;
  if v_parent_profile is distinct from new.profile_id then
    raise exception 'parent goal belongs to another profile' using errcode = '23514';
  end if;
  -- دورة: الأب الجديد موجود داخل الشجرة الفرعية للغاية نفسها
  if tg_op = 'UPDATE' and exists (
    with recursive down as (
      select id from public.goals where id = new.id
      union all
      select g.id from public.goals g join down on g.parent_goal_id = down.id
    ) select 1 from down where id = new.parent_goal_id
  ) then
    raise exception 'goal cycle detected' using errcode = '23514';
  end if;
  v_depth := app.goal_depth(new.parent_goal_id) + coalesce(app.goal_subtree_height(new.id), 1);
  if v_depth > v_max then
    raise exception 'goal chain depth exceeds %', v_max using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger goals_guard_trg before insert or update on public.goals for each row execute function app.goals_guard();

-- GOAL-5: إدراج حلقة فوق الجذر أو بين حلقتين دون فقدان المهام
-- p_child: الغاية التي تصبح ابنة الحلقة الجديدة. تُنشأ الحلقة الجديدة بأب = أب p_child السابق.
create or replace function app.insert_goal_above(p_child uuid, p_title text, p_why text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_child public.goals%rowtype;
  v_new uuid;
begin
  select * into v_child from public.goals where id = p_child;
  if not found then raise exception 'goal not found' using errcode = '23514'; end if;
  if not app.is_profile_owner(v_child.profile_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.goals (profile_id, parent_goal_id, title, why)
  values (v_child.profile_id, v_child.parent_goal_id, p_title, p_why) returning id into v_new;
  update public.goals set parent_goal_id = v_new where id = p_child;
  return v_new;
end;
$$;
grant execute on function app.insert_goal_above(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- مكتبة القوالب (4.4) — تُدار من المشرف؛ المحتوى من content/templates
-- ----------------------------------------------------------------------------
create table public.mission_templates (
  id text not null,
  version int not null default 1,
  mechanic_id text not null references public.mechanics (id),
  training_level public.training_level not null,
  difficulty smallint not null check (difficulty between 1 and 5),
  age_modes public.age_mode[] not null,
  title_by_mode jsonb not null,
  situation_by_mode jsonb not null,
  variable_defaults jsonb not null default '{}'::jsonb,
  strategies jsonb not null,                 -- [{id, text_by_mode|text, fit, outcome_hint}]
  prediction_prompt jsonb,                   -- نص أو {by_mode}
  reflection_prompts jsonb not null,         -- [نص أو {by_mode}]
  hints_by_level jsonb not null default '{}'::jsonb,
  evidence_rules jsonb not null default '[]'::jsonb,
  completion_check public.completion_check not null,
  checklist jsonb,                           -- لـ checklist فقط
  min_duration int not null,
  max_duration int not null,
  distraction_config jsonb,
  status public.template_status not null default 'active',
  origin text not null default 'human' check (origin in ('human', 'ai_draft')),
  created_at timestamptz not null default now(),
  primary key (id, version)
);

create table public.template_capabilities (
  template_id text not null,
  template_version int not null,
  capability_id text not null references public.capabilities (id),
  weight numeric not null check (weight > 0 and weight <= 1),
  primary key (template_id, template_version, capability_id),
  foreign key (template_id, template_version) references public.mission_templates (id, version) on delete cascade
);

-- ----------------------------------------------------------------------------
-- المهام (4.5) وآلة الحالات (MIS-1)
-- ----------------------------------------------------------------------------
create table public.missions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  template_id text not null,
  template_version int not null,
  goal_id uuid references public.goals (id) on delete set null,
  status public.mission_status not null default 'suggested',
  difficulty smallint not null check (difficulty between 1 and 5),
  support_level text not null check (support_level in ('L0_instruct', 'L1_hint', 'L2_ask', 'L3_free')),
  variables jsonb not null default '{}'::jsonb,
  strategy_chosen text,
  custom_strategy text,
  custom_strategy_label text,
  time_estimate int check (time_estimate is null or time_estimate > 0),
  prediction jsonb,
  actual_duration_min int,
  hints_used int not null default 0,
  distraction_log jsonb not null default '[]'::jsonb,     -- [{at, choice}]
  interruption_reasons jsonb not null default '[]'::jsonb, -- [{at, reason}]
  checklist_done jsonb not null default '[]'::jsonb,
  gate1 boolean,
  gate2 text check (gate2 in ('shown', 'partial', 'not_yet')),
  gate2_score numeric,
  started_at timestamptz,
  completed_at timestamptz,
  context_tag text,
  source public.mission_source not null default 'engine',
  approved_by uuid references auth.users (id) on delete set null,
  schedule_id uuid,
  suggested_for date not null default current_date,
  dismissed boolean not null default false,          -- استبدال اقتراح (5.2 خطوة 2) دون حذف السجل
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (template_id, template_version) references public.mission_templates (id, version)
);
create index missions_profile_idx on public.missions (profile_id, status, suggested_for desc);

create table public.mission_transitions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  from_status public.mission_status,
  to_status public.mission_status not null,
  at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);
create index mission_transitions_mission_idx on public.mission_transitions (mission_id, at);

create table public.reflections (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null unique references public.missions (id) on delete cascade,
  prompts_and_answers jsonb not null,  -- [{prompt, answer}]
  summary text,
  created_at timestamptz not null default now()
);

-- الانتقالات المسموحة (4.5) — المصدر الوحيد للحقيقة في قاعدة البيانات؛ مرآتها في TypeScript modules/missions/state-machine.ts
create or replace function app.mission_transition_allowed(p_from public.mission_status, p_to public.mission_status)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('suggested', 'chosen'),
    ('chosen', 'planned'),
    ('planned', 'in_progress'),
    ('in_progress', 'interrupted'),
    ('interrupted', 'in_progress'),
    ('in_progress', 'completed'),
    ('in_progress', 'abandoned'),
    ('interrupted', 'abandoned'),
    ('completed', 'reflected'),
    ('abandoned', 'reflected'),
    ('reflected', 'transferred')
  );
$$;

-- كل انتقال يُتحقق منه ويُسجَّل بوقته (MIS-1)؛ البوابة الأولى تُحسم عند completed/abandoned (GATE-1)
create or replace function app.missions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb := coalesce(nullif(current_setting('app.transition_meta', true), '')::jsonb, '{}'::jsonb);
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then return new; end if;
  if new.status <> old.status then
    if not app.mission_transition_allowed(old.status, new.status) then
      raise exception 'mission transition % -> % not allowed', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'in_progress' and old.status = 'planned' then new.started_at := coalesce(new.started_at, now()); end if;
    if new.status in ('completed', 'abandoned') then
      new.completed_at := coalesce(new.completed_at, now());
      new.gate1 := (new.status = 'completed');
      if new.actual_duration_min is null and new.started_at is not null then
        new.actual_duration_min := greatest(1, round(extract(epoch from (new.completed_at - new.started_at)) / 60)::int);
      end if;
    end if;
    if new.status = 'reflected' and not exists (select 1 from public.reflections r where r.mission_id = new.id) then
      raise exception 'reflection required before reflected' using errcode = '23514';
    end if;
    insert into public.mission_transitions (mission_id, from_status, to_status, meta) values (new.id, old.status, new.status, v_meta);
  end if;
  -- حقول محمية: لا تُغيَّر بعد الحسم
  if old.status in ('completed', 'abandoned', 'reflected', 'transferred') and (new.hints_used <> old.hints_used or new.distraction_log <> old.distraction_log or new.strategy_chosen is distinct from old.strategy_chosen or new.prediction is distinct from old.prediction) then
    raise exception 'mission facts are frozen after completion' using errcode = '23514';
  end if;
  if new.dismissed and not old.dismissed and old.status <> 'suggested' then
    raise exception 'only suggested missions can be dismissed' using errcode = '23514';
  end if;
  if new.gate2 is distinct from old.gate2 and auth.uid() is not null then
    raise exception 'gate2 is computed by the engine only' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger missions_guard_trg before insert or update on public.missions for each row execute function app.missions_guard();

-- الانتقال الأول (null → الحالة الابتدائية) يُسجَّل بعد وجود الصف
create or replace function app.missions_log_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.mission_transitions (mission_id, from_status, to_status, meta)
  values (new.id, null, new.status, coalesce(nullif(current_setting('app.transition_meta', true), '')::jsonb, '{}'::jsonb));
  return new;
end;
$$;
create trigger missions_log_insert_trg after insert on public.missions for each row execute function app.missions_log_insert();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.goals enable row level security;
alter table public.mission_templates enable row level security;
alter table public.template_capabilities enable row level security;
alter table public.missions enable row level security;
alter table public.mission_transitions enable row level security;
alter table public.reflections enable row level security;

create policy "goals select" on public.goals for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress') or app.is_admin());
create policy "goals insert" on public.goals for insert to authenticated
  with check (app.is_profile_owner(profile_id) and proposed_by = 'player');
create policy "goals update" on public.goals for update to authenticated
  using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));
create policy "goals delete" on public.goals for delete to authenticated
  using (app.is_profile_owner(profile_id));

create policy "templates read" on public.mission_templates for select to authenticated using (status = 'active' or app.is_admin());
create policy "template caps read" on public.template_capabilities for select to authenticated using (true);

create policy "missions select" on public.missions for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress') or app.is_admin());
create policy "missions insert" on public.missions for insert to authenticated
  with check (app.is_profile_owner(profile_id) and source in ('engine', 'self') and status = 'suggested' and gate2 is null);
create policy "missions update" on public.missions for update to authenticated
  using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));

create policy "transitions select" on public.mission_transitions for select to authenticated
  using (exists (select 1 from public.missions m where m.id = mission_id and (app.is_profile_owner(m.profile_id) or app.has_permission(m.profile_id, 'view_progress'))));

create policy "reflections select" on public.reflections for select to authenticated
  using (exists (select 1 from public.missions m where m.id = mission_id and (app.is_profile_owner(m.profile_id) or app.has_permission(m.profile_id, 'view_progress'))));
create policy "reflections insert" on public.reflections for insert to authenticated
  with check (exists (select 1 from public.missions m where m.id = mission_id and app.is_profile_owner(m.profile_id) and m.status in ('completed', 'abandoned')));

grant select, insert, update, delete on public.goals to authenticated;
grant select on public.mission_templates, public.template_capabilities, public.mission_transitions to authenticated;
grant select, insert, update on public.missions to authenticated;
grant select, insert on public.reflections to authenticated;

-- غلاف public
create or replace function public.insert_goal_above(p_child uuid, p_title text, p_why text)
returns uuid language sql security definer set search_path = public as $$ select app.insert_goal_above(p_child, p_title, p_why); $$;
grant execute on function public.insert_goal_above(uuid, text, text) to authenticated;

-- انتقال حالة مع بيانات وصفية (meta) تُسجَّل في mission_transitions. المالك فقط.
create or replace function app.transition_mission(p_mission_id uuid, p_to public.mission_status, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_profile uuid;
begin
  select profile_id into v_profile from public.missions where id = p_mission_id;
  if not found then raise exception 'mission not found' using errcode = '23514'; end if;
  if not app.is_profile_owner(v_profile) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('app.transition_meta', coalesce(p_meta, '{}'::jsonb)::text, true);
  update public.missions set status = p_to where id = p_mission_id;
end;
$$;
grant execute on function app.transition_mission(uuid, public.mission_status, jsonb) to authenticated;
create or replace function public.transition_mission(p_mission_id uuid, p_to public.mission_status, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$ select app.transition_mission(p_mission_id, p_to, p_meta); $$;
grant execute on function public.transition_mission(uuid, public.mission_status, jsonb) to authenticated;
