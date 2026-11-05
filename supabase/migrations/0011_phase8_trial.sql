-- المرحلة 8: التجربة المغلقة (القسم 14/15)، القياس المجهّل (القسم 9)، حذف الحساب وتصدير البيانات (8.4)، تدقيق وصول المشرف (ADMIN-6).

create table public.trial_cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null default now(),
  weeks int not null,
  enabled_age_modes public.age_mode[] not null,
  max_users int not null,
  status text not null default 'active' check (status in ('active', 'finished')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.trial_participants (
  cohort_id uuid not null references public.trial_cohorts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  age_mode_at_join public.age_mode not null,
  joined_at timestamptz not null default now(),
  primary key (cohort_id, profile_id)
);
create table public.trial_metric_snapshots (
  cohort_id uuid not null references public.trial_cohorts (id) on delete cascade,
  week int not null,
  metrics jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  participants int not null,
  config_version text not null,
  computed_at timestamptz not null default now(),
  primary key (cohort_id, week)
);
-- أحداث منتج مجهّلة (القسم 9): لا نص حر، لا معرّف ملف صريح (hash مملّح)
create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  profile_hash text,
  props jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index product_events_event_idx on public.product_events (event, at desc);

alter table public.trial_cohorts enable row level security;
alter table public.trial_participants enable row level security;
alter table public.trial_metric_snapshots enable row level security;
alter table public.product_events enable row level security;
create policy "trial admin" on public.trial_cohorts for select to authenticated using (app.is_admin());
create policy "trial participants admin" on public.trial_participants for select to authenticated using (app.is_admin() or app.is_profile_owner(profile_id));
create policy "trial snapshots admin" on public.trial_metric_snapshots for select to authenticated using (app.is_admin());
create policy "product_events admin" on public.product_events for select to authenticated using (app.is_admin());
grant select on public.trial_cohorts, public.trial_participants, public.trial_metric_snapshots, public.product_events to authenticated;

-- تسجيل الدفعة والمشاركين (المشرف فقط؛ الحدود من config تُمرَّر من الخادم)
create or replace function app.create_trial_cohort(p_name text, p_weeks int, p_modes public.age_mode[], p_max int) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not app.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.trial_cohorts set status = 'finished' where status = 'active';
  insert into public.trial_cohorts (name, weeks, enabled_age_modes, max_users, created_by) values (p_name, p_weeks, p_modes, p_max, auth.uid()) returning id into v_id;
  insert into public.audit_log (actor_id, action, target, meta) values (auth.uid(), 'trial_cohort_created', v_id::text, jsonb_build_object('weeks', p_weeks, 'modes', p_modes, 'max', p_max));
  return v_id;
end;
$$;
create or replace function app.enroll_trial_participant(p_cohort uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.trial_cohorts%rowtype; v_mode public.age_mode; v_n int;
begin
  if not app.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.trial_cohorts where id = p_cohort and status = 'active';
  if not found then raise exception 'not_found' using errcode = '23514'; end if;
  select age_mode into v_mode from public.profiles where id = p_profile and kind = 'player';
  if v_mode is null then raise exception 'not_found' using errcode = '23514'; end if;
  if not (v_mode = any (c.enabled_age_modes)) then raise exception 'mode_disabled' using errcode = '23514'; end if;
  if exists (select 1 from public.trial_participants where cohort_id = p_cohort and profile_id = p_profile) then raise exception 'already' using errcode = '23514'; end if;
  select count(*) into v_n from public.trial_participants where cohort_id = p_cohort;
  if v_n >= c.max_users then raise exception 'cohort_full' using errcode = '23514'; end if;
  insert into public.trial_participants (cohort_id, profile_id, age_mode_at_join) values (p_cohort, p_profile, v_mode);
end;
$$;
grant execute on function app.create_trial_cohort(text, int, public.age_mode[], int), app.enroll_trial_participant(uuid, uuid) to authenticated;
create or replace function public.create_trial_cohort(p_name text, p_weeks int, p_modes public.age_mode[], p_max int) returns uuid language sql security definer set search_path = public as $$ select app.create_trial_cohort(p_name, p_weeks, p_modes, p_max); $$;
create or replace function public.enroll_trial_participant(p_cohort uuid, p_profile uuid) returns void language sql security definer set search_path = public as $$ select app.enroll_trial_participant(p_cohort, p_profile); $$;
grant execute on function public.create_trial_cohort(text, int, public.age_mode[], int), public.enroll_trial_participant(uuid, uuid) to authenticated;

-- ADMIN-6: سجل تدقيق لكل وصول مشرف
create or replace function app.log_admin_access(p_path text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.audit_log (actor_id, action, target) values (auth.uid(), 'admin_access', p_path);
end;
$$;
grant execute on function app.log_admin_access(text) to authenticated;
create or replace function public.log_admin_access(p_path text) returns void language sql security definer set search_path = public as $$ select app.log_admin_access(p_path); $$;
grant execute on function public.log_admin_access(text) to authenticated;

-- 8.4 / الحالات الحدية: حذف حساب المتدرب — المالك في teen/adult، والمربي المنشئ فقط في child (الطفل لا يحذف حسابه).
-- يعيد user_id ليحذف الخادم مستخدم auth بصلاحيات الخدمة. الحذف يتعاقب على كل الجداول (on delete cascade).
create or replace function app.delete_player_account(p_profile uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_mode public.age_mode;
begin
  select user_id, age_mode into v_user, v_mode from public.profiles where id = p_profile and kind = 'player';
  if v_user is null then raise exception 'not_found' using errcode = '23514'; end if;
  if v_mode = 'child' then
    if not app.is_creator_guardian(p_profile) then raise exception 'not allowed' using errcode = '42501'; end if;
  else
    if not app.is_profile_owner(p_profile) then raise exception 'not allowed' using errcode = '42501'; end if;
  end if;
  insert into public.audit_log (actor_id, action, target, meta) values (auth.uid(), 'account_deleted', md5(p_profile::text), jsonb_build_object('age_mode', v_mode));
  delete from public.profiles where id = p_profile;
  return v_user;
end;
$$;
grant execute on function app.delete_player_account(uuid) to authenticated;
create or replace function public.delete_player_account(p_profile uuid) returns uuid language sql security definer set search_path = public as $$ select app.delete_player_account(p_profile); $$;
grant execute on function public.delete_player_account(uuid) to authenticated;

-- حذف الحساب يتعاقب على الجداول الملحقة فقط (append-only) داخل app.delete_player_account عبر علم معاملة؛ لا يفتح الحذف لأي مسار آخر.
create or replace function app.evidence_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.account_deletion', true), '') = 'on' then return old; end if;
  raise exception 'evidence_events is append-only' using errcode = '23514';
end;
$$;
create or replace function app.deny_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.account_deletion', true), '') = 'on' then return old; end if;
  raise exception 'append-only' using errcode = '42501';
end;
$$;
create or replace function app.delete_player_account(p_profile uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_mode public.age_mode;
begin
  select user_id, age_mode into v_user, v_mode from public.profiles where id = p_profile and kind = 'player';
  if v_user is null then raise exception 'not_found' using errcode = '23514'; end if;
  if v_mode = 'child' then
    if not app.is_creator_guardian(p_profile) then raise exception 'not allowed' using errcode = '42501'; end if;
  else
    if not app.is_profile_owner(p_profile) then raise exception 'not allowed' using errcode = '42501'; end if;
  end if;
  insert into public.audit_log (actor_id, action, target, meta) values (auth.uid(), 'account_deleted', md5(p_profile::text), jsonb_build_object('age_mode', v_mode));
  perform set_config('app.account_deletion', 'on', true);
  delete from public.profiles where id = p_profile;
  perform set_config('app.account_deletion', 'off', true);
  return v_user;
end;
$$;
