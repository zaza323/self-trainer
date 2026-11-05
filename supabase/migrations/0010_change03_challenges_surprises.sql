-- تعديل 0.3: التحديات العادلة (§2)، المفاجآت العشوائية (§3). نقاط الخطوات (§1) تُكتب في xp_events بقيدها الفريد الموجود.
-- القيم في config/game.json (challenges، surprises) وتُزامن إلى config_meta.edit_rules._challenges للفحص داخل SQL.

create type public.challenge_status as enum ('open', 'active', 'finished', 'cancelled');

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  template_id text not null,
  template_version int not null,
  difficulty smallint not null,
  capability_id text not null references public.capabilities (id),
  training_level public.training_level not null,
  age_mode public.age_mode not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  join_until timestamptz not null,
  status public.challenge_status not null default 'open',
  created_by uuid not null references auth.users (id) on delete cascade,
  invite_code text not null unique,
  created_at timestamptz not null default now(),
  foreign key (template_id, template_version) references public.mission_templates (id, version)
);

create table public.challenge_participants (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  display_name text not null,
  support_level_at_join text not null,
  score_start int not null default 50,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  approved_by_guardian_id uuid references auth.users (id) on delete set null,
  requires_approval boolean not null default false,   -- child: لا يُعد مشاركًا قبل الموافقة
  primary key (challenge_id, profile_id)
);
create index challenge_participants_profile_idx on public.challenge_participants (profile_id);

create table public.challenge_scores (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  attempts_pts int not null default 0,
  shown_pts int not null default 0,
  transfer_pts int not null default 0,
  improvement_pts int not null default 0,
  total int not null default 0,
  rank int not null default 1,
  badges text[] not null default '{}',
  reflected_count int not null default 0,
  computed_at timestamptz not null default now(),
  primary key (challenge_id, profile_id)
);

create table public.surprise_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  mission_id uuid not null unique references public.missions (id) on delete cascade,
  kind text not null check (kind in ('cosmetic', 'xp_bonus', 'encouragement')),
  payload jsonb not null default '{}'::jsonb,
  rng_seed text not null,
  created_at timestamptz not null default now()
);
create index surprise_events_profile_idx on public.surprise_events (profile_id, created_at desc);
-- append-only
create or replace function app.deny_mutation() returns trigger language plpgsql as $$ begin raise exception 'append-only' using errcode = '42501'; end; $$;
create trigger surprise_events_append_only before update or delete on public.surprise_events for each row execute function app.deny_mutation();

-- المشارك الفعّال: انضم ولم ينسحب، وإن كان يحتاج موافقة فقد وافق مربٍ.
create or replace function app.challenge_member(p_challenge uuid, p_profile uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge and cp.profile_id = p_profile and cp.left_at is null and (not cp.requires_approval or cp.approved_by_guardian_id is not null));
$$;
-- من يرى التحدي: أي مشارك (حتى المعلق يرى طلبه) أو مربي مشارك أو المشرف
create or replace function app.can_see_challenge(p_challenge uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.is_admin() or exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge and (app.is_profile_owner(cp.profile_id) or app.is_active_guardian(cp.profile_id)));
$$;
grant execute on function app.challenge_member(uuid, uuid), app.can_see_challenge(uuid) to authenticated;

alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.challenge_scores enable row level security;
alter table public.surprise_events enable row level security;
create policy "challenges select" on public.challenges for select to authenticated using (app.can_see_challenge(id));
create policy "participants select" on public.challenge_participants for select to authenticated using (app.can_see_challenge(challenge_id));
create policy "scores select" on public.challenge_scores for select to authenticated using (app.can_see_challenge(challenge_id) and app.challenge_member(challenge_id, profile_id));
create policy "surprises select" on public.surprise_events for select to authenticated using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress'));
grant select on public.challenges, public.challenge_participants, public.challenge_scores, public.surprise_events to authenticated;

-- القدرة الأساسية للقالب = أعلى وزن
create or replace function app.template_primary_capability(p_template text, p_version int) returns text language sql stable set search_path = public as $$
  select capability_id from public.template_capabilities where template_id = p_template and template_version = p_version order by weight desc, capability_id limit 1;
$$;

-- فحص التكافؤ (يرفض الخادم عند الإخلال): يعيد null إن جاز الانضمام وإلا سبب الرفض.
create or replace function app.challenge_fairness_check(p_challenge uuid, p_profile uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare c public.challenges%rowtype; v_cfg jsonb; v_mode public.age_mode; v_state record; v_gap int; v_n int;
  v_levels text[] := array['L0_instruct','L1_hint','L2_ask','L3_free'];
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then return 'not_found'; end if;
  select edit_rules -> '_challenges' into v_cfg from public.config_meta where id = 1;
  if v_cfg is null then raise exception 'config_meta._challenges missing: run config:sync' using errcode = '23514'; end if;
  if c.status not in ('open', 'active') then return 'window_closed'; end if;
  if now() > c.join_until then return 'window_closed'; end if;
  if exists (select 1 from public.challenge_participants where challenge_id = p_challenge and profile_id = p_profile and left_at is null) then return 'already'; end if;
  select count(*) into v_n from public.challenge_participants where challenge_id = p_challenge and left_at is null;
  if v_n >= (v_cfg ->> 'max_participants')::int then return 'full'; end if;
  v_mode := app.profile_age_mode(p_profile);
  if (v_cfg -> 'fairness' ->> 'same_age_mode')::boolean and v_mode is distinct from c.age_mode then return 'age_mode'; end if;
  select support_level, training_level into v_state from public.capability_states where profile_id = p_profile and capability_id = c.capability_id;
  if not found then return 'no_state'; end if;
  if (v_cfg -> 'fairness' ->> 'same_training_level')::boolean and v_state.training_level <> c.training_level then return 'training_level'; end if;
  select coalesce(max(abs(array_position(v_levels, cp.support_level_at_join) - array_position(v_levels, v_state.support_level::text))), 0) into v_gap
    from public.challenge_participants cp where cp.challenge_id = p_challenge and cp.left_at is null;
  if v_gap > (v_cfg -> 'fairness' ->> 'max_support_level_gap')::int then return 'support_gap'; end if;
  return null;
end;
$$;
grant execute on function app.challenge_fairness_check(uuid, uuid) to authenticated;

create or replace function app.random_invite_code() returns text language sql volatile as $$
  select upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
$$;

-- إنشاء تحدٍّ: المالك (teen/adult)، الإعداد مفعّل، الكثافة كافية؛ الصعوبة مثبتة من القالب؛ المنشئ أول مشارك.
create or replace function app.create_challenge(p_profile_id uuid, p_template_id text, p_version int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; v_prof record; v_cap text; v_state record; v_id uuid; v_tpl record; v_code text; v_enabled boolean; v_intensity int;
begin
  if not app.is_profile_owner(p_profile_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  select edit_rules -> '_challenges' into v_cfg from public.config_meta where id = 1;
  select age_mode, display_name, game_intensity into v_prof from public.profiles where id = p_profile_id;
  if v_prof.age_mode = 'child' then raise exception 'child_invite_only' using errcode = '23514'; end if;
  v_enabled := (app.setting_effective(p_profile_id, 'challenges_enabled') #>> '{}')::boolean;
  if not coalesce(v_enabled, false) then raise exception 'disabled' using errcode = '23514'; end if;
  v_intensity := coalesce(v_prof.game_intensity, 0);
  if v_intensity < (v_cfg ->> 'min_intensity')::int then raise exception 'intensity' using errcode = '23514'; end if;
  select difficulty into v_tpl from public.mission_templates where id = p_template_id and version = p_version and status = 'active';
  if not found then raise exception 'template not found' using errcode = '23514'; end if;
  v_cap := app.template_primary_capability(p_template_id, p_version);
  select support_level, training_level into v_state from public.capability_states where profile_id = p_profile_id and capability_id = v_cap;
  if not found then raise exception 'no_state' using errcode = '23514'; end if;
  loop
    v_code := app.random_invite_code();
    exit when not exists (select 1 from public.challenges where invite_code = v_code);
  end loop;
  insert into public.challenges (template_id, template_version, difficulty, capability_id, training_level, age_mode, ends_at, join_until, created_by, invite_code)
  values (p_template_id, p_version, v_tpl.difficulty, v_cap, v_state.training_level, v_prof.age_mode, now() + make_interval(days => (v_cfg ->> 'duration_days')::int), now() + make_interval(hours => (v_cfg ->> 'start_window_hours')::int), auth.uid(), v_code)
  returning id into v_id;
  insert into public.challenge_participants (challenge_id, profile_id, display_name, support_level_at_join, score_start)
  values (v_id, p_profile_id, v_prof.display_name, v_state.support_level, coalesce((select score from public.capability_snapshots where profile_id = p_profile_id and capability_id = v_cap order by date desc limit 1), 50));
  return v_id;
end;
$$;

-- الانضمام (بالمعرّف أو بالرمز): اختياري دائمًا؛ الخادم يرفض عند الإخلال بالتكافؤ؛ child → معلق حتى موافقة المربي.
create or replace function app.join_challenge(p_profile_id uuid, p_challenge uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_reason text; c public.challenges%rowtype; v_prof record; v_state record; v_cfg jsonb; v_child boolean;
begin
  if not app.is_profile_owner(p_profile_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  select edit_rules -> '_challenges' into v_cfg from public.config_meta where id = 1;
  select age_mode, display_name, game_intensity into v_prof from public.profiles where id = p_profile_id;
  if not coalesce((app.setting_effective(p_profile_id, 'challenges_enabled') #>> '{}')::boolean, false) then raise exception 'disabled' using errcode = '23514'; end if;
  if coalesce(v_prof.game_intensity, 0) < (v_cfg ->> 'min_intensity')::int then raise exception 'intensity' using errcode = '23514'; end if;
  v_reason := app.challenge_fairness_check(p_challenge, p_profile_id);
  if v_reason is not null then raise exception '%', v_reason using errcode = '23514'; end if;
  select * into c from public.challenges where id = p_challenge;
  select support_level into v_state from public.capability_states where profile_id = p_profile_id and capability_id = c.capability_id;
  v_child := v_prof.age_mode = 'child' and (v_cfg ->> 'child_requires_guardian_approval')::boolean;
  insert into public.challenge_participants (challenge_id, profile_id, display_name, support_level_at_join, score_start, requires_approval)
  values (p_challenge, p_profile_id, v_prof.display_name, v_state.support_level, coalesce((select score from public.capability_snapshots where profile_id = p_profile_id and capability_id = c.capability_id order by date desc limit 1), 50), v_child)
  on conflict (challenge_id, profile_id) do update set left_at = null, joined_at = now(), support_level_at_join = excluded.support_level_at_join, requires_approval = excluded.requires_approval, approved_by_guardian_id = null;
  if c.status = 'open' and (select count(*) from public.challenge_participants where challenge_id = p_challenge and left_at is null and (not requires_approval or approved_by_guardian_id is not null)) >= (v_cfg ->> 'min_participants')::int then
    update public.challenges set status = 'active' where id = p_challenge;
  end if;
  return case when v_child then 'pending' else 'joined' end;
end;
$$;
create or replace function app.join_challenge_by_code(p_profile_id uuid, p_code text) returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.challenges where invite_code = upper(trim(p_code));
  if v_id is null then raise exception 'not_found' using errcode = '23514'; end if;
  return app.join_challenge(p_profile_id, v_id);
end;
$$;

-- موافقة المربي (G13): المنشئ أو manage_settings؛ التكافؤ يُفحص ثانية لحظة الموافقة.
create or replace function app.approve_challenge_participant(p_challenge uuid, p_profile_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; v_reason text;
begin
  if not (app.is_creator_guardian(p_profile_id) or app.guardian_has_permission(p_profile_id, 'manage_settings')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.challenge_participants where challenge_id = p_challenge and profile_id = p_profile_id and requires_approval and approved_by_guardian_id is null and left_at is null) then raise exception 'not pending' using errcode = '23514'; end if;
  -- التكافؤ ضد بقية المشاركين (باستثناء الطفل نفسه)
  update public.challenge_participants set left_at = now() where challenge_id = p_challenge and profile_id = p_profile_id;
  v_reason := app.challenge_fairness_check(p_challenge, p_profile_id);
  update public.challenge_participants set left_at = null where challenge_id = p_challenge and profile_id = p_profile_id;
  if v_reason is not null then raise exception '%', v_reason using errcode = '23514'; end if;
  select edit_rules -> '_challenges' into v_cfg from public.config_meta where id = 1;
  update public.challenge_participants set approved_by_guardian_id = auth.uid() where challenge_id = p_challenge and profile_id = p_profile_id;
  if (select count(*) from public.challenge_participants where challenge_id = p_challenge and left_at is null and (not requires_approval or approved_by_guardian_id is not null)) >= (v_cfg ->> 'min_participants')::int then
    update public.challenges set status = 'active' where id = p_challenge and status = 'open';
  end if;
  insert into public.audit_log (actor_id, action, target, meta) values (auth.uid(), 'challenge_child_approved', p_challenge::text, jsonb_build_object('profile_id', p_profile_id));
end;
$$;

-- الانسحاب بلا عقوبة
create or replace function app.leave_challenge(p_profile_id uuid, p_challenge uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.is_profile_owner(p_profile_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.challenge_participants set left_at = now() where challenge_id = p_challenge and profile_id = p_profile_id and left_at is null;
end;
$$;

grant execute on function app.create_challenge(uuid, text, int), app.join_challenge(uuid, uuid), app.join_challenge_by_code(uuid, text), app.approve_challenge_participant(uuid, uuid), app.leave_challenge(uuid, uuid) to authenticated;
create or replace function public.create_challenge(p_profile_id uuid, p_template_id text, p_version int) returns uuid language sql security definer set search_path = public as $$ select app.create_challenge(p_profile_id, p_template_id, p_version); $$;
create or replace function public.join_challenge(p_profile_id uuid, p_challenge uuid) returns text language sql security definer set search_path = public as $$ select app.join_challenge(p_profile_id, p_challenge); $$;
create or replace function public.join_challenge_by_code(p_profile_id uuid, p_code text) returns text language sql security definer set search_path = public as $$ select app.join_challenge_by_code(p_profile_id, p_code); $$;
create or replace function public.approve_challenge_participant(p_challenge uuid, p_profile_id uuid) returns void language sql security definer set search_path = public as $$ select app.approve_challenge_participant(p_challenge, p_profile_id); $$;
create or replace function public.leave_challenge(p_profile_id uuid, p_challenge uuid) returns void language sql security definer set search_path = public as $$ select app.leave_challenge(p_profile_id, p_challenge); $$;
grant execute on function public.create_challenge(uuid, text, int), public.join_challenge(uuid, uuid), public.join_challenge_by_code(uuid, text), public.approve_challenge_participant(uuid, uuid), public.leave_challenge(uuid, uuid) to authenticated;
