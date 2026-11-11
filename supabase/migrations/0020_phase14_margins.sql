-- 0.5 المرحلة 14 (الجزء ب): هامش الوقت لكل مهمة + سجل التعديلات والقواعد + decision_trace (RULES-7).
-- الترقيم: CHANGE-0.5 يسميها 0019؛ الفعلي 0020 (انظر docs/CONFIG-MERGE-0.5.md).
-- درس الثغرة الخلفية: لا كتابة مباشرة من المتصفح على أي شيء يخص الهامش. الكتابة فقط عبر دوال لدور الخدمة بهوية الجلسة (p_actor).

-- قيم config/margins.json في القاعدة (تُزامَن مع بقية الإعدادات) حتى لا تُكتب أرقام في SQL.
alter table public.config_meta add column if not exists margins jsonb not null default '{}'::jsonb;

-- ب.2: نطاق صلاحية set_task_margin لكل ربط مربٍّ.
alter table public.guardian_links add column if not exists margin_scope text not null default 'own_tasks' check (margin_scope in ('own_tasks', 'all_tasks'));
update public.guardian_links set margin_scope = 'all_tasks' where is_creator;
create or replace function app.guardian_links_margin_scope_default() returns trigger language plpgsql as $$
begin
  if new.is_creator then new.margin_scope := 'all_tasks'; end if;
  return new;
end;
$$;
drop trigger if exists guardian_links_margin_scope_trg on public.guardian_links;
create trigger guardian_links_margin_scope_trg before insert on public.guardian_links for each row execute function app.guardian_links_margin_scope_default();

-- ب.8: أعمدة الهامش على المهام التدريبية ومهام المخطط.
alter table public.missions
  add column if not exists margin_min int check (margin_min is null or margin_min > 0),
  add column if not exists margin_source text check (margin_source is null or margin_source in ('user', 'guardian', 'guardian_rule', 'history', 'system')),
  add column if not exists margin_set_by uuid references auth.users (id) on delete set null,
  add column if not exists margin_locked boolean not null default false,
  add column if not exists margin_extra_min int not null default 0 check (margin_extra_min >= 0);
alter table public.planner_tasks
  add column if not exists margin_min int check (margin_min is null or margin_min > 0),
  add column if not exists margin_source text check (margin_source is null or margin_source in ('user', 'guardian', 'guardian_rule', 'history', 'system')),
  add column if not exists margin_set_by uuid references auth.users (id) on delete set null,
  add column if not exists margin_locked boolean not null default false,
  add column if not exists margin_extra_min int not null default 0 check (margin_extra_min >= 0);

-- حماية أولى: صلاحيات الأعمدة. يُسحب UPDATE على مستوى الجدول ويُمنح على كل الأعمدة عدا أعمدة الهامش.
-- تنبيه للهجرات القادمة: أي عمود جديد على هذين الجدولين يحتاج grant update صريحًا إن كان المتصفح يعدّله.
do $$
declare t text; cols text;
begin
  foreach t in array array['missions', 'planner_tasks'] loop
    select string_agg(quote_ident(column_name), ', ') into cols from information_schema.columns
     where table_schema = 'public' and table_name = t and column_name not in ('margin_min', 'margin_source', 'margin_set_by', 'margin_locked', 'margin_extra_min');
    execute format('revoke update on public.%I from authenticated', t);
    execute format('grant update (%s) on public.%I to authenticated', cols, t);
  end loop;
end $$;

-- حماية ثانية (تغطي الإدراج أيضًا وتعطي خطأ واضحًا): حارس على الصف.
create or replace function app.margin_columns_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.margin_min is not null or new.margin_source is not null or new.margin_set_by is not null or new.margin_locked or new.margin_extra_min <> 0 then
      raise exception 'margin is written by the server only' using errcode = '42501';
    end if;
  elsif new.margin_min is distinct from old.margin_min or new.margin_source is distinct from old.margin_source
     or new.margin_set_by is distinct from old.margin_set_by or new.margin_locked is distinct from old.margin_locked
     or new.margin_extra_min is distinct from old.margin_extra_min then
    raise exception 'margin is written by the server only' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists missions_margin_guard_trg on public.missions;
create trigger missions_margin_guard_trg before insert or update on public.missions for each row execute function app.margin_columns_guard();
drop trigger if exists planner_tasks_margin_guard_trg on public.planner_tasks;
create trigger planner_tasks_margin_guard_trg before insert or update on public.planner_tasks for each row execute function app.margin_columns_guard();

-- ب.5: سجل التعديلات (لا يُحذف ولا يُعدَّل) والقواعد الصريحة.
create table if not exists public.margin_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_role text not null check (actor_role in ('player', 'guardian')),
  guardian_link_id uuid references public.guardian_links (id) on delete set null,
  subject_type text not null check (subject_type in ('mission', 'planner_task')),
  subject_id uuid not null,
  similarity jsonb not null default '{}'::jsonb,     -- { l1, l2 }
  system_default_min int not null,
  set_min int not null check (set_min > 0),
  apply_scope text not null check (apply_scope in ('this_task', 'all_similar')),
  reason_code text,
  created_at timestamptz not null default now()
);
create index if not exists margin_events_profile_idx on public.margin_events (profile_id, created_at desc);
create index if not exists margin_events_subject_idx on public.margin_events (subject_type, subject_id, created_at desc);

create table if not exists public.margin_rules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  guardian_link_id uuid references public.guardian_links (id) on delete set null,   -- null = قاعدة وضعها المتدرب نفسه (teen/adult)
  set_by uuid references auth.users (id) on delete set null,
  subject_type text not null check (subject_type in ('mission', 'planner_task')),
  similarity_key text not null,
  level text not null check (level in ('L1', 'L2')),
  margin_min int not null check (margin_min > 0),
  created_from_event_id uuid references public.margin_events (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists margin_rules_profile_idx on public.margin_rules (profile_id, active, similarity_key);

create or replace function app.margin_events_immutable() returns trigger language plpgsql as $$
begin raise exception 'margin_events is append-only' using errcode = '23514'; end;
$$;
drop trigger if exists margin_events_immutable_trg on public.margin_events;
create trigger margin_events_immutable_trg before update or delete on public.margin_events for each row execute function app.margin_events_immutable();

-- القراءة: المالك، ومربٍّ بصلاحية view_progress، أو set_task_margin ضمن نطاقه (own_tasks ⇒ ما ضبطه هو فقط).
create or replace function app.can_view_margin_row(p_profile_id uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_profile_owner(p_profile_id) or app.is_admin() or exists (
    select 1 from public.guardian_links l
    where l.player_id = p_profile_id and l.guardian_id = auth.uid() and l.status = 'active'
      and ( coalesce((l.permissions ->> 'view_progress')::boolean, false)
         or (l.is_creator and app.profile_age_mode(p_profile_id) = 'child')
         or (coalesce((l.permissions ->> 'set_task_margin')::boolean, false) and (l.margin_scope = 'all_tasks' or p_actor = auth.uid())) ));
$$;
grant execute on function app.can_view_margin_row(uuid, uuid) to authenticated;

alter table public.margin_events enable row level security;
alter table public.margin_rules enable row level security;
drop policy if exists "margin_events select" on public.margin_events;
create policy "margin_events select" on public.margin_events for select to authenticated using (app.can_view_margin_row(profile_id, actor_user_id));
drop policy if exists "margin_rules select" on public.margin_rules;
create policy "margin_rules select" on public.margin_rules for select to authenticated using (app.can_view_margin_row(profile_id, set_by));
revoke all on public.margin_events from authenticated, anon;
revoke all on public.margin_rules from authenticated, anon;
grant select on public.margin_events to authenticated;
grant select on public.margin_rules to authenticated;

-- RULES-7: أثر القرار للقرارات الظاهرة للمستخدم (مستوى الدعم، مرحلة الحوافز، هامش الوقت، سبب تأجيل إشعار).
create table if not exists public.decision_traces (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('support_level', 'incentive_stage', 'time_margin', 'notification_defer')),
  subject_type text,
  subject_id text,
  rule text not null,                       -- معرّف القاعدة التي حسمت (يقابله قالب نص ثابت)
  decision jsonb not null default '{}'::jsonb,
  inputs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists decision_traces_profile_idx on public.decision_traces (profile_id, kind, created_at desc);
create index if not exists decision_traces_subject_idx on public.decision_traces (kind, subject_id, created_at desc);
alter table public.decision_traces enable row level security;
drop policy if exists "decision_traces select" on public.decision_traces;
create policy "decision_traces select" on public.decision_traces for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress') or app.is_admin());
revoke all on public.decision_traces from authenticated, anon;
grant select on public.decision_traces to authenticated;

-- إزالة هوية الجلسة داخل دالة الخادم بعد انتهاء فحوص الصلاحية (لتمر كتابة الأعمدة المحمية كدور الخدمة).
create or replace function app.act_as_server() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
revoke all on function app.act_as_server() from public;

/**
 * ب.8: الضبط الوحيد للهامش. يتحقق من الصلاحية والنطاق والقفل، يقص إلى حدود الوضع ويقرّب لمضاعف الخطوة،
 * يكتب الحدث (والقاعدة إن كان «لكل المهام المشابهة»)، ثم يحدّث المهمة بالفائز حسب الأسبقية (ب.3).
 */
create or replace function app.set_task_margin(
  p_actor uuid, p_subject_type text, p_subject_id uuid, p_set_min int, p_apply_scope text default 'this_task',
  p_reason text default null, p_system_default int default null, p_similarity jsonb default '{}'::jsonb, p_lock boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb; v_profile uuid; v_created_by uuid; v_guardian_made boolean; v_locked boolean;
  v_mode public.age_mode; v_owner boolean; l public.guardian_links%rowtype; v_role text; v_link uuid;
  v_step int; v_lo int; v_hi int; v_min int; v_event uuid; v_rule uuid; v_key text; v_level text;
  w_min int; w_actor uuid; w_role text; v_source text; v_new_lock boolean;
begin
  if auth.uid() is not null then raise exception 'not allowed' using errcode = '42501'; end if;   -- لدور الخدمة فقط
  perform app.act_as(p_actor);
  select margins into cfg from public.config_meta where id = 1;
  if cfg is null or cfg = '{}'::jsonb then raise exception 'margins config not synced' using errcode = '23514'; end if;

  if p_subject_type = 'mission' then
    select m.profile_id, m.created_by, (m.created_by is not null and m.created_by = p_actor), m.margin_locked into v_profile, v_created_by, v_guardian_made, v_locked from public.missions m where m.id = p_subject_id;
  elsif p_subject_type = 'planner_task' then
    select t.profile_id, t.created_by, (t.created_via = 'guardian' and t.created_by = p_actor), t.margin_locked into v_profile, v_created_by, v_guardian_made, v_locked from public.planner_tasks t where t.id = p_subject_id;
  else raise exception 'bad subject type' using errcode = '23514';
  end if;
  if v_profile is null then raise exception 'not allowed' using errcode = '42501'; end if;

  v_mode := app.profile_age_mode(v_profile);
  v_owner := app.is_profile_owner(v_profile);
  if v_owner then
    if v_mode = 'child' then raise exception 'not allowed: child_view_only' using errcode = '42501'; end if;   -- ب.2: الطفل يرى فقط
    v_role := 'player';
  else
    select * into l from public.guardian_links g where g.player_id = v_profile and g.guardian_id = p_actor and g.status = 'active';
    if not found then raise exception 'not allowed' using errcode = '42501'; end if;
    if not ((l.is_creator and v_mode = 'child') or coalesce((l.permissions ->> 'set_task_margin')::boolean, false)) then
      raise exception 'not allowed: no_permission' using errcode = '42501';
    end if;
    if l.margin_scope = 'own_tasks' and not coalesce(v_guardian_made, false) then raise exception 'not allowed: out_of_scope' using errcode = '42501'; end if;
    if v_mode = 'child' and v_locked and not l.is_creator then raise exception 'not allowed: margin_locked' using errcode = '42501'; end if;
    v_role := 'guardian'; v_link := l.id;
  end if;

  if p_set_min is null or p_set_min <= 0 then raise exception 'bad margin' using errcode = '23514'; end if;
  if not (cfg -> 'apply_scopes') ? p_apply_scope then raise exception 'bad apply scope' using errcode = '23514'; end if;
  if p_reason is not null and not (cfg -> 'reason_codes') ? p_reason then raise exception 'bad reason' using errcode = '23514'; end if;
  v_step := (cfg ->> 'step_min')::int;
  v_lo := (cfg -> 'bounds_min' -> v_mode::text ->> 'min')::int;
  v_hi := (cfg -> 'bounds_min' -> v_mode::text ->> 'max')::int;
  v_min := least(v_hi, greatest(v_lo, (ceil(p_set_min::numeric / v_step) * v_step)::int));   -- ب.11-4: تقريب ثم قص

  insert into public.margin_events (profile_id, actor_user_id, actor_role, guardian_link_id, subject_type, subject_id, similarity, system_default_min, set_min, apply_scope, reason_code)
  values (v_profile, p_actor, v_role, v_link, p_subject_type, p_subject_id, coalesce(p_similarity, '{}'::jsonb), coalesce(p_system_default, v_min), v_min, p_apply_scope, p_reason)
  returning id into v_event;

  if p_apply_scope = 'all_similar' then
    v_key := nullif(p_similarity ->> 'l1', ''); v_level := 'L1';
    if v_key is null then v_key := nullif(p_similarity ->> 'l2', ''); v_level := 'L2'; end if;
    if v_key is null then raise exception 'similarity key required for all_similar' using errcode = '23514'; end if;
    update public.margin_rules set active = false, updated_at = now()
     where profile_id = v_profile and subject_type = p_subject_type and similarity_key = v_key and active and guardian_link_id is not distinct from v_link;
    insert into public.margin_rules (profile_id, guardian_link_id, set_by, subject_type, similarity_key, level, margin_min, created_from_event_id)
    values (v_profile, v_link, p_actor, p_subject_type, v_key, v_level, v_min, v_event) returning id into v_rule;
  end if;

  -- الفائز على هذه المهمة (ب.3): teen/adult تعديل المستخدم أولًا؛ ثم أحدث تعديل مربٍّ (والمقفل لا يصله غير المنشئ أصلًا).
  if v_mode <> 'child' then
    select e.set_min, e.actor_user_id, e.actor_role into w_min, w_actor, w_role from public.margin_events e
     where e.subject_type = p_subject_type and e.subject_id = p_subject_id and e.actor_role = 'player' order by e.created_at desc, e.id desc limit 1;
  end if;
  if w_min is null then
    select e.set_min, e.actor_user_id, e.actor_role into w_min, w_actor, w_role from public.margin_events e
     where e.subject_type = p_subject_type and e.subject_id = p_subject_id and e.actor_role = 'guardian' order by e.created_at desc, e.id desc limit 1;
  end if;
  v_source := case when w_role = 'player' then 'user' else 'guardian' end;
  v_new_lock := case when v_role = 'guardian' and v_mode = 'child' and l.is_creator then coalesce(p_lock, false) else coalesce(v_locked, false) end;

  perform app.act_as_server();
  if p_subject_type = 'mission' then
    update public.missions set margin_min = w_min, margin_source = v_source, margin_set_by = w_actor, margin_locked = v_new_lock where id = p_subject_id;
  else
    update public.planner_tasks set margin_min = w_min, margin_source = v_source, margin_set_by = w_actor, margin_locked = v_new_lock where id = p_subject_id;
  end if;
  insert into public.decision_traces (profile_id, kind, subject_type, subject_id, rule, decision, inputs)
  values (v_profile, 'time_margin', p_subject_type, p_subject_id::text, case when v_source = 'user' then 'margin_user_override' else 'margin_guardian_this_task' end,
          jsonb_build_object('margin_min', w_min, 'source', v_source, 'set_by', w_actor),
          jsonb_build_object('requested_min', p_set_min, 'stored_min', v_min, 'system_default_min', p_system_default, 'apply_scope', p_apply_scope, 'actor_role', v_role, 'event_id', v_event, 'bounds', jsonb_build_object('min', v_lo, 'max', v_hi), 'step', v_step));
  return jsonb_build_object('margin_min', w_min, 'source', v_source, 'stored_min', v_min, 'event_id', v_event, 'rule_id', v_rule, 'applied', (w_actor = p_actor and w_min = v_min), 'locked', v_new_lock);
end;
$$;
revoke all on function app.set_task_margin(uuid, text, uuid, int, text, text, int, jsonb, boolean) from public, authenticated, anon;
create or replace function public.set_task_margin(p_actor uuid, p_subject_type text, p_subject_id uuid, p_set_min int, p_apply_scope text default 'this_task', p_reason text default null, p_system_default int default null, p_similarity jsonb default '{}'::jsonb, p_lock boolean default false)
returns jsonb language sql security definer set search_path = public as $$ select app.set_task_margin(p_actor, p_subject_type, p_subject_id, p_set_min, p_apply_scope, p_reason, p_system_default, p_similarity, p_lock); $$;
revoke all on function public.set_task_margin(uuid, text, uuid, int, text, text, int, jsonb, boolean) from public, authenticated, anon;
grant execute on function public.set_task_margin(uuid, text, uuid, int, text, text, int, jsonb, boolean) to service_role;
grant execute on function app.set_task_margin(uuid, text, uuid, int, text, text, int, jsonb, boolean) to service_role;

-- ب.6: «تحتاج وقتًا أكثر؟ +5 / +10 / +15» — معلومة تُسجَّل، لا عقوبة. صاحب المهمة فقط.
create or replace function app.extend_task_margin(p_actor uuid, p_subject_type text, p_subject_id uuid, p_minutes int) returns int
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; v_profile uuid; v_total int;
begin
  if auth.uid() is not null then raise exception 'not allowed' using errcode = '42501'; end if;
  perform app.act_as(p_actor);
  select margins into cfg from public.config_meta where id = 1;
  if not exists (select 1 from jsonb_array_elements_text(cfg -> 'at_expiry' -> 'extension_options_min') o where o::int = p_minutes) then raise exception 'bad extension' using errcode = '23514'; end if;
  if p_subject_type = 'mission' then select profile_id into v_profile from public.missions where id = p_subject_id;
  else select profile_id into v_profile from public.planner_tasks where id = p_subject_id; end if;
  if v_profile is null or not app.is_profile_owner(v_profile) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform app.act_as_server();
  if p_subject_type = 'mission' then update public.missions set margin_extra_min = margin_extra_min + p_minutes where id = p_subject_id returning margin_extra_min into v_total;
  else update public.planner_tasks set margin_extra_min = margin_extra_min + p_minutes where id = p_subject_id returning margin_extra_min into v_total; end if;
  return v_total;
end;
$$;
revoke all on function app.extend_task_margin(uuid, text, uuid, int) from public, authenticated, anon;
create or replace function public.extend_task_margin(p_actor uuid, p_subject_type text, p_subject_id uuid, p_minutes int) returns int
language sql security definer set search_path = public as $$ select app.extend_task_margin(p_actor, p_subject_type, p_subject_id, p_minutes); $$;
revoke all on function public.extend_task_margin(uuid, text, uuid, int) from public, authenticated, anon;
grant execute on function public.extend_task_margin(uuid, text, uuid, int) to service_role;
grant execute on function app.extend_task_margin(uuid, text, uuid, int) to service_role;

-- G18: تعديل قاعدة صريحة أو إيقافها. واضعها، أو المتدرب صاحب الحساب في teen/adult، أو المربي المنشئ في child.
create or replace function app.margin_rule_update(p_actor uuid, p_rule_id uuid, p_margin_min int default null, p_active boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.margin_rules%rowtype; cfg jsonb; v_mode public.age_mode; v_step int; v_min int;
begin
  if auth.uid() is not null then raise exception 'not allowed' using errcode = '42501'; end if;
  perform app.act_as(p_actor);
  select * into r from public.margin_rules where id = p_rule_id;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  v_mode := app.profile_age_mode(r.profile_id);
  if not (r.set_by = p_actor or app.is_account_owner(r.profile_id)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if r.set_by = p_actor and not app.is_account_owner(r.profile_id) and not app.has_permission(r.profile_id, 'set_task_margin') then raise exception 'not allowed: no_permission' using errcode = '42501'; end if;
  select margins into cfg from public.config_meta where id = 1;
  v_step := (cfg ->> 'step_min')::int;
  if p_margin_min is not null then
    if p_margin_min <= 0 then raise exception 'bad margin' using errcode = '23514'; end if;
    v_min := least((cfg -> 'bounds_min' -> v_mode::text ->> 'max')::int, greatest((cfg -> 'bounds_min' -> v_mode::text ->> 'min')::int, (ceil(p_margin_min::numeric / v_step) * v_step)::int));
  end if;
  update public.margin_rules set margin_min = coalesce(v_min, margin_min), active = coalesce(p_active, active), updated_at = now() where id = p_rule_id;
  return jsonb_build_object('id', p_rule_id, 'margin_min', coalesce(v_min, r.margin_min), 'active', coalesce(p_active, r.active));
end;
$$;
revoke all on function app.margin_rule_update(uuid, uuid, int, boolean) from public, authenticated, anon;
create or replace function public.margin_rule_update(p_actor uuid, p_rule_id uuid, p_margin_min int default null, p_active boolean default null) returns jsonb
language sql security definer set search_path = public as $$ select app.margin_rule_update(p_actor, p_rule_id, p_margin_min, p_active); $$;
revoke all on function public.margin_rule_update(uuid, uuid, int, boolean) from public, authenticated, anon;
grant execute on function public.margin_rule_update(uuid, uuid, int, boolean) to service_role;
grant execute on function app.margin_rule_update(uuid, uuid, int, boolean) to service_role;

-- ب.7: معالج apply_margin_rule — قبول اقتراح margin_adjustment ينشئ قاعدة صريحة (المبدأ 15: لا تطبيق بلا موافقة).
create or replace function app.apply_margin_rule(p_suggestion public.adaptation_suggestions) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb := p_suggestion.proposed_value; v_link uuid; v_rule uuid;
begin
  select id into v_link from public.guardian_links where player_id = p_suggestion.profile_id and guardian_id = auth.uid() and status = 'active';
  update public.margin_rules set active = false, updated_at = now()
   where profile_id = p_suggestion.profile_id and subject_type = v ->> 'subject_type' and similarity_key = v ->> 'similarity_key' and active;
  insert into public.margin_rules (profile_id, guardian_link_id, set_by, subject_type, similarity_key, level, margin_min)
  values (p_suggestion.profile_id, v_link, auth.uid(), v ->> 'subject_type', v ->> 'similarity_key', v ->> 'level', (v ->> 'margin_min')::int) returning id into v_rule;
  return jsonb_build_object('rule_id', v_rule, 'margin_min', (v ->> 'margin_min')::int);
end;
$$;
revoke all on function app.apply_margin_rule(public.adaptation_suggestions) from public, authenticated, anon;

create or replace function app.decide_adaptation_suggestion(p_id uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.adaptation_suggestions%rowtype; v_role public.setting_role; v_result jsonb := '{}'::jsonb; v_cap text;
begin
  select * into s from public.adaptation_suggestions where id = p_id;
  if not found then raise exception 'suggestion not found' using errcode = '23514'; end if;
  if s.decision is not null then raise exception 'already decided' using errcode = '23514'; end if;
  if not app.can_decide_suggestion(s.profile_id, s.audience) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_decision not in ('accepted', 'rejected') then raise exception 'bad decision' using errcode = '23514'; end if;
  if p_decision = 'accepted' then
    if s.setting_key is not null then
      v_role := case when app.is_profile_owner(s.profile_id) then 'player' else 'guardian' end;
      perform set_config('app.audit_source', 'adaptation_suggestion', true);
      insert into public.settings (profile_id, key, value, set_by_role, set_by_user_id, locked)
      values (s.profile_id, s.setting_key, s.proposed_value, v_role, auth.uid(), false)
      on conflict (profile_id, key, set_by_role) do update set value = excluded.value, set_by_user_id = excluded.set_by_user_id, updated_at = now();
      v_result := jsonb_build_object('setting', s.setting_key, 'value', s.proposed_value, 'role', v_role);
    elsif s.type = 'request_more_support' then
      v_cap := s.proposed_value ->> 'capability_id';
      v_result := app.request_more_support(s.profile_id, v_cap);
    elsif s.type = 'margin_adjustment' then
      v_result := app.apply_margin_rule(s);
    end if;
  end if;
  update public.adaptation_suggestions set decision = p_decision::public.suggestion_decision, decided_by = auth.uid(), decided_at = now() where id = p_id;
  insert into public.audit_log (actor_id, action, target, meta) values (auth.uid(), 'adaptation_suggestion_' || p_decision, p_id::text, jsonb_build_object('type', s.type, 'setting_key', s.setting_key, 'result', v_result));
  return v_result;
end;
$$;

-- ب.7: تتبّع المراجعة الأسبوعية للهامش (للخادم فقط).
create table if not exists public.margin_review_runs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  last_run_at timestamptz not null,
  last_suggestions int not null default 0
);
alter table public.margin_review_runs enable row level security;
revoke all on public.margin_review_runs from authenticated, anon;
