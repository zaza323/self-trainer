-- ============================================================================
-- المرحلة 5: الواقع والمربي والمرونة
-- قوالب مخصصة لمهام الواقع (LIFE-3، MIS-2، MIS-10)، جداول التكرار، موافقة المربي على مهام الطفل،
-- تقارير النقل (LIFE-2)، ملاحظات المربي (GUARD-3)، المكافآت الواقعية (REWARD-1..8)، الإنجازات الخاصة (GAME-10)،
-- سياق الحياة (ADAPT-1)، الدعم المؤقت من المربي (GUARD-9). الحواجز والمحفزات الممنوعة تُفرض في قاعدة البيانات.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- قوالب مخصصة: مهمة واقعية يكتبها المربي أو المتدرب تصبح قالبًا مملوكًا للملف (لا يراه غيره)
-- ----------------------------------------------------------------------------
alter table public.mission_templates add column owner_profile_id uuid references public.profiles (id) on delete cascade;
alter table public.mission_templates add column created_by uuid references auth.users (id) on delete set null;
create index mission_templates_owner_idx on public.mission_templates (owner_profile_id);

drop policy "templates read" on public.mission_templates;
create policy "templates read" on public.mission_templates for select to authenticated
  using ((status = 'active' and owner_profile_id is null) or app.is_admin()
         or (owner_profile_id is not null and (app.is_profile_owner(owner_profile_id) or app.is_active_guardian(owner_profile_id))));

-- MIS-10: مهام واقعية متكررة (يوم/أيام في الأسبوع ووقت)
create table public.mission_schedules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  template_id text not null,
  template_version int not null,
  days_of_week int[] not null check (array_length(days_of_week, 1) between 1 and 7),
  time_local text check (time_local is null or time_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (template_id, template_version) references public.mission_templates (id, version)
);
alter table public.mission_schedules enable row level security;
create policy "schedules select" on public.mission_schedules for select to authenticated
  using (app.is_profile_owner(profile_id) or app.is_active_guardian(profile_id));
create policy "schedules insert" on public.mission_schedules for insert to authenticated
  with check (created_by = auth.uid() and (app.has_permission(profile_id, 'add_missions') or app.is_profile_owner(profile_id)));
create policy "schedules update" on public.mission_schedules for update to authenticated
  using (app.has_permission(profile_id, 'add_missions') or app.is_profile_owner(profile_id));
grant select, insert, update on public.mission_schedules to authenticated;

-- المهام: الموافقة (MIS-2 في child) وإدراج المربي (LIFE-3)
alter table public.missions add column needs_approval boolean not null default false;
alter table public.missions add column created_by uuid references auth.users (id) on delete set null;

drop policy "missions insert" on public.missions;
create policy "missions insert" on public.missions for insert to authenticated
  with check (
    status = 'suggested' and gate2 is null and (
      (app.is_profile_owner(profile_id) and source in ('engine', 'self'))
      or (app.has_permission(profile_id, 'add_missions') and source in ('guardian', 'guardian_recurring') and needs_approval = false)
    )
  );

-- اعتماد مهمة كتبها الطفل (MIS-2): المربي صاحب add_missions
create or replace function app.approve_mission(p_mission_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_profile uuid;
begin
  select profile_id into v_profile from public.missions where id = p_mission_id and needs_approval;
  if not found then raise exception 'mission not pending approval' using errcode = '23514'; end if;
  if not app.has_permission(v_profile, 'add_missions') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.missions set needs_approval = false, approved_by = auth.uid() where id = p_mission_id;
  insert into public.notifications (profile_id, type, payload) values (v_profile, 'mission_approved', jsonb_build_object('mission_id', p_mission_id));
end;
$$;
grant execute on function app.approve_mission(uuid) to authenticated;
create or replace function public.approve_mission(p_mission_id uuid) returns void language sql security definer set search_path = public as $$ select app.approve_mission(p_mission_id); $$;
grant execute on function public.approve_mission(uuid) to authenticated;

-- المهمة التي تنتظر الموافقة لا تنتقل إلى chosen
create or replace function app.missions_approval_guard()
returns trigger language plpgsql as $$
begin
  if new.status <> old.status and old.status = 'suggested' and new.needs_approval then
    raise exception 'mission awaits guardian approval' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger missions_approval_guard_trg before update on public.missions for each row execute function app.missions_approval_guard();

-- ----------------------------------------------------------------------------
-- تقارير النقل (LIFE-2): المتدرب يبلّغ؛ المربي (view_progress) يؤكد
-- ----------------------------------------------------------------------------
alter table public.transfer_reports add column confirmed_by uuid references auth.users (id) on delete set null;
alter table public.transfer_reports add column confirmed_at timestamptz;
create policy "transfer insert" on public.transfer_reports for insert to authenticated
  with check (app.is_profile_owner(profile_id));
create policy "transfer confirm" on public.transfer_reports for update to authenticated
  using (app.has_permission(profile_id, 'view_progress')) with check (app.has_permission(profile_id, 'view_progress'));
grant insert, update on public.transfer_reports to authenticated;

-- ----------------------------------------------------------------------------
-- ملاحظات المربي بصيغة محددة (GUARD-3) → دليل guardian_observation (يكتبه الخادم)
-- ----------------------------------------------------------------------------
create table public.guardian_observations (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  capability_id text not null references public.capabilities (id),
  observation_type text not null,
  note_short text check (note_short is null or char_length(note_short) <= 200),
  context_tag text not null default 'home',
  created_at timestamptz not null default now()
);
alter table public.guardian_observations enable row level security;
create policy "observations select" on public.guardian_observations for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress'));
create policy "observations insert" on public.guardian_observations for insert to authenticated
  with check (guardian_id = auth.uid() and app.has_permission(profile_id, 'view_progress'));
grant select, insert on public.guardian_observations to authenticated;

-- ----------------------------------------------------------------------------
-- المكافآت الواقعية (4.12): المحفزات المسموحة فقط، الدورة مسجّلة، لا أثر رجعي، حد 10 نشطة
-- ----------------------------------------------------------------------------
create type public.reward_status as enum ('draft', 'active', 'earned', 'delivered', 'acknowledged', 'cancelled');

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  icon text not null default '🎁',
  trigger_type text not null,
  trigger_params jsonb not null default '{}'::jsonb,
  status public.reward_status not null default 'draft',
  activated_at timestamptz,
  earned_at timestamptz,
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rewards_profile_idx on public.rewards (profile_id, status);

create table public.reward_events (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.rewards (id) on delete cascade,
  from_status public.reward_status,
  to_status public.reward_status not null,
  actor_id uuid,
  at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

-- الإنجازات الخاصة (GAME-10): المحفزات نفسها عدا surprise
alter table public.achievements add column trigger_type text;
alter table public.achievements add column trigger_params jsonb not null default '{}'::jsonb;

-- كتالوج المحفزات (من config/customization.json.real_rewards عبر config:sync)
alter table public.config_meta add column rewards jsonb not null default '{}'::jsonb;

-- REWARD-2: الخادم يقبل المحفزات المسموحة فقط ويرفض الممنوعة برسالة تشرح السبب (4.12.2)
create or replace function app.validate_reward_trigger(p_type text, p_params jsonb, p_allow_surprise boolean)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg jsonb;
  v_allowed jsonb;
  v_forbidden jsonb;
  v_spec jsonb;
  v_count numeric;
begin
  select rewards into v_cfg from public.config_meta where id = 1;
  if v_cfg is null or v_cfg = '{}'::jsonb then raise exception 'config_meta.rewards missing: run config:sync' using errcode = '23514'; end if;
  v_allowed := v_cfg -> 'allowed_triggers';
  v_forbidden := v_cfg -> 'forbidden_triggers';
  if v_forbidden ? p_type then
    raise exception 'forbidden_trigger: % — يكافئ النشاط أو العملة أو السلسلة أو وقت الاستخدام لا التعلم (4.12.2)', p_type using errcode = '23514';
  end if;
  if not (v_allowed ? p_type) then
    raise exception 'unknown_trigger: %', p_type using errcode = '23514';
  end if;
  if p_type = 'surprise' and not p_allow_surprise then
    raise exception 'surprise_not_allowed_here' using errcode = '23514';
  end if;
  v_spec := v_allowed -> p_type -> 'params';
  if v_spec ? 'capability_id' and not exists (select 1 from public.capabilities where id = p_params ->> 'capability_id') then
    raise exception 'invalid_params: capability_id' using errcode = '23514';
  end if;
  if v_spec ? 'count' then
    v_count := (p_params ->> 'count')::numeric;
    if v_count is null or v_count < (v_spec -> 'count' ->> 'min')::numeric or v_count > (v_spec -> 'count' ->> 'max')::numeric then
      raise exception 'invalid_params: count' using errcode = '23514';
    end if;
  end if;
  if v_spec ? 'min_distinct_contexts' then
    v_count := coalesce((p_params ->> 'min_distinct_contexts')::numeric, (v_spec -> 'min_distinct_contexts' ->> 'min')::numeric);
    if v_count < (v_spec -> 'min_distinct_contexts' ->> 'min')::numeric or v_count > (v_spec -> 'min_distinct_contexts' ->> 'max')::numeric then
      raise exception 'invalid_params: min_distinct_contexts' using errcode = '23514';
    end if;
  end if;
  if v_spec ? 'level' and not (v_spec -> 'level' ? (p_params ->> 'level')) then
    raise exception 'invalid_params: level' using errcode = '23514';
  end if;
  if v_spec ? 'achievement_code' and not exists (select 1 from public.achievements where code = p_params ->> 'achievement_code') then
    raise exception 'invalid_params: achievement_code' using errcode = '23514';
  end if;
  if v_spec ? 'goal_id' and (p_params ->> 'goal_id') is null then
    raise exception 'invalid_params: goal_id' using errcode = '23514';
  end if;
end;
$$;

create or replace function app.rewards_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_max int; v_active int;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.trigger_type is distinct from old.trigger_type or new.trigger_params is distinct from old.trigger_params then
    perform app.validate_reward_trigger(new.trigger_type, new.trigger_params, true);
  end if;
  if tg_op = 'INSERT' then
    -- المفاجأة لا تمر بـ active: تُنشأ earned مباشرة (4.12.3)
    if new.trigger_type = 'surprise' then new.status := 'earned'; new.earned_at := now(); new.activated_at := now(); end if;
    if new.status = 'active' then
      select (rewards ->> 'max_active_per_player')::int into v_max from public.config_meta where id = 1;
      select count(*) into v_active from public.rewards where profile_id = new.profile_id and status = 'active';
      if v_active >= v_max then raise exception 'max_active_rewards_reached (%)', v_max using errcode = '23514'; end if;
      new.activated_at := coalesce(new.activated_at, now());
    end if;
    return new;
  end if;
  if new.status <> old.status then
    if not ((old.status, new.status) in (('draft','active'), ('active','earned'), ('earned','delivered'), ('delivered','acknowledged'), ('draft','cancelled'), ('active','cancelled'))) then
      raise exception 'reward transition % -> % not allowed', old.status, new.status using errcode = '23514';
    end if;
    -- المتدرب (غير المنشئ) يؤكد الاستلام فقط؛ المربي يسلّم ويعلن ويلغي (5.7)
    if auth.uid() is not null and app.is_profile_owner(new.profile_id) and new.created_by <> auth.uid() and new.status <> 'acknowledged' then
      raise exception 'player may only acknowledge: transition % -> % not allowed', old.status, new.status using errcode = '42501';
    end if;
    if new.status = 'active' then
      select (rewards ->> 'max_active_per_player')::int into v_max from public.config_meta where id = 1;
      select count(*) into v_active from public.rewards where profile_id = new.profile_id and status = 'active' and id <> new.id;
      if v_active >= v_max then raise exception 'max_active_rewards_reached (%)', v_max using errcode = '23514'; end if;
      new.activated_at := now();
    end if;
    if new.status = 'earned' then new.earned_at := now(); end if;
    if new.status = 'delivered' then new.delivered_at := now(); end if;
    if new.status = 'acknowledged' then new.acknowledged_at := now(); end if;
    if new.status = 'cancelled' then new.cancelled_at := now(); end if;
    insert into public.reward_events (reward_id, from_status, to_status, actor_id) values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;
create trigger rewards_guard_trg before insert or update on public.rewards for each row execute function app.rewards_guard();

create or replace function app.rewards_log_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.reward_events (reward_id, from_status, to_status, actor_id) values (new.id, null, new.status, auth.uid());
  return new;
end;
$$;
create trigger rewards_log_insert_trg after insert on public.rewards for each row execute function app.rewards_log_insert();

-- الإنجازات الخاصة: التحقق نفسه بلا surprise
create or replace function app.achievements_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_profile_id is not null then
    if new.trigger_type is null then raise exception 'custom achievement needs a trigger' using errcode = '23514'; end if;
    perform app.validate_reward_trigger(new.trigger_type, new.trigger_params, false);
  end if;
  return new;
end;
$$;
create trigger achievements_guard_trg before insert or update on public.achievements for each row execute function app.achievements_guard();

alter table public.rewards enable row level security;
alter table public.reward_events enable row level security;
-- المتدرب يرى عهوده؛ المربي صاحب add_rewards ينشئ ويسلّم؛ البالغ لنفسه (adult_self_rewards)
create policy "rewards select" on public.rewards for select to authenticated
  using ((app.is_profile_owner(profile_id) and status <> 'draft') or app.has_permission(profile_id, 'add_rewards') or (app.is_profile_owner(profile_id) and created_by = auth.uid()));
-- صلاحية مربٍ صريحة (بلا اختصار صاحب الحساب): المتدرب لا يمنح نفسه مكافأة إلا إن كان بالغًا (adult_self_rewards)
create or replace function app.guardian_has_permission(p_profile_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guardian_links l
    where l.player_id = p_profile_id and l.guardian_id = auth.uid() and l.status = 'active'
      and (l.is_creator or coalesce((l.permissions ->> p_permission)::boolean, false))
  );
$$;
grant execute on function app.guardian_has_permission(uuid, text) to authenticated;

create policy "rewards insert" on public.rewards for insert to authenticated
  with check (created_by = auth.uid() and (app.guardian_has_permission(profile_id, 'add_rewards') or (app.is_profile_owner(profile_id) and app.profile_age_mode(profile_id) = 'adult')));
create policy "rewards update" on public.rewards for update to authenticated
  using (app.has_permission(profile_id, 'add_rewards') or app.is_profile_owner(profile_id))
  with check (app.has_permission(profile_id, 'add_rewards') or app.is_profile_owner(profile_id));
create policy "reward_events select" on public.reward_events for select to authenticated
  using (exists (select 1 from public.rewards r where r.id = reward_id and (app.is_profile_owner(r.profile_id) or app.has_permission(r.profile_id, 'add_rewards'))));
grant select, insert, update on public.rewards to authenticated;
grant select on public.reward_events to authenticated;

-- الإنجازات الخاصة: إنشاء وتعطيل من المربي صاحب add_rewards أو البالغ لنفسه
create policy "achievements insert custom" on public.achievements for insert to authenticated
  with check (owner_profile_id is not null and created_by = auth.uid() and (app.guardian_has_permission(owner_profile_id, 'add_rewards') or (app.is_profile_owner(owner_profile_id) and app.profile_age_mode(owner_profile_id) = 'adult')));
create policy "achievements update custom" on public.achievements for update to authenticated
  using (owner_profile_id is not null and (app.has_permission(owner_profile_id, 'add_rewards') or app.is_profile_owner(owner_profile_id)));
grant insert, update on public.achievements to authenticated;

-- ----------------------------------------------------------------------------
-- سياق الحياة (4.13.1): يكتبه المتدرب (والمربي في child)؛ لا يُحفظ إلا بفعل صريح
-- ----------------------------------------------------------------------------
create table public.personal_context (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  interests jsonb not null default '[]'::jsonb,
  routine jsonb not null default '[]'::jsonb,
  free_windows jsonb not null default '[]'::jsonb,
  contexts jsonb not null default '[]'::jsonb,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.personal_context enable row level security;
create policy "pc select" on public.personal_context for select to authenticated
  using (app.is_profile_owner(profile_id) or (app.profile_age_mode(profile_id) = 'child' and app.is_active_guardian(profile_id)) or app.has_permission(profile_id, 'view_progress'));
create policy "pc write" on public.personal_context for insert to authenticated
  with check (app.is_profile_owner(profile_id) or (app.profile_age_mode(profile_id) = 'child' and app.has_permission(profile_id, 'manage_settings')));
create policy "pc update" on public.personal_context for update to authenticated
  using (app.is_profile_owner(profile_id) or (app.profile_age_mode(profile_id) = 'child' and app.has_permission(profile_id, 'manage_settings')));
grant select, insert, update on public.personal_context to authenticated;

-- ----------------------------------------------------------------------------
-- GUARD-9: "دعم أكثر" مؤقت لقدرة (خفض درجة واحدة لمدة محددة) — لا رفع يدوي أبدًا (4.11.3)
-- ----------------------------------------------------------------------------
create or replace function app.request_more_support(p_profile_id uuid, p_capability_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; v_level text; v_idx int; v_new text; v_until timestamptz;
  v_levels text[] := array['L0_instruct','L1_hint','L2_ask','L3_free'];
begin
  select edit_rules -> '_guardian_temporary_support' into v_cfg from public.config_meta where id = 1;
  if v_cfg is null then raise exception 'config_meta.guardian_temporary_support missing: run config:sync' using errcode = '23514'; end if;
  if not app.has_permission(p_profile_id, v_cfg ->> 'requires_permission') then raise exception 'not allowed' using errcode = '42501'; end if;
  select support_level into v_level from public.capability_states where profile_id = p_profile_id and capability_id = p_capability_id;
  if v_level is null then raise exception 'capability state not found' using errcode = '23514'; end if;
  v_idx := array_position(v_levels, v_level) - 1;
  v_new := v_levels[greatest(1, v_idx - (v_cfg ->> 'levels')::int + 1)];
  v_until := now() + make_interval(days => (v_cfg ->> 'duration_days')::int);
  update public.capability_states set support_temp_override = jsonb_build_object('level', v_new, 'until', v_until, 'by', auth.uid()), updated_at = now()
    where profile_id = p_profile_id and capability_id = p_capability_id;
  insert into public.audit_log (actor_id, action, target, meta) values (auth.uid(), 'guardian_temporary_support', p_profile_id::text, jsonb_build_object('capability', p_capability_id, 'level', v_new, 'until', v_until));
  return jsonb_build_object('level', v_new, 'until', v_until);
end;
$$;
grant execute on function app.request_more_support(uuid, text) to authenticated;
create or replace function public.request_more_support(p_profile_id uuid, p_capability_id text) returns jsonb language sql security definer set search_path = public as $$ select app.request_more_support(p_profile_id, p_capability_id); $$;
grant execute on function public.request_more_support(uuid, text) to authenticated;
