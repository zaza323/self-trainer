-- المرحلة 7: التكيّف الذكي — ذاكرة الاستراتيجيات، اقتراحات التكيّف، فعالية القوالب، مسودات القوالب.
-- معيار القبول: اقتراح مقبول يغيّر الإعداد مع سجل؛ اقتراح مرفوض لا يتكرر 30 يومًا؛ القالب الضعيف يُعلَّم.

-- 1) ذاكرة الاستراتيجيات (4.13.2، ADAPT-3): محسوبة من المهام والأدلة بصلاحيات الخدمة.
create table public.strategy_outcomes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  mechanic_id text not null references public.mechanics (id),
  strategy_key text not null,
  strategy_label text,
  uses int not null default 0,
  shown_count int not null default 0,
  partial_count int not null default 0,
  last_used_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, mechanic_id, strategy_key)
);
alter table public.strategy_outcomes enable row level security;
create policy "strategy_outcomes select" on public.strategy_outcomes for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress'));
grant select on public.strategy_outcomes to authenticated;

-- 2) اقتراحات التكيّف (5.8، ADAPT-4، ADAPT-5)
create type public.suggestion_decision as enum ('accepted', 'rejected', 'expired');
create type public.suggestion_audience as enum ('owner', 'guardian');
create table public.adaptation_suggestions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  setting_key text references public.settings_catalog (key),
  proposed_value jsonb,
  reason_short text not null,
  expected_effect text not null,
  audience public.suggestion_audience not null default 'owner',
  decision public.suggestion_decision,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  expires_at timestamptz not null,
  dedupe_key text not null,            -- type:setting_key:value لمنع التكرار بعد الرفض
  created_at timestamptz not null default now()
);
create index adaptation_suggestions_profile_idx on public.adaptation_suggestions (profile_id, created_at desc);
alter table public.adaptation_suggestions enable row level security;

-- من يقرر (5.8): المربي في child (المنشئ أو من له approve_suggestions)؛ المتدرب في teen/adult، ومربّيه إن مُنح approve_suggestions
-- وكان إعداد adaptation_suggestions_to = owner_and_permitted_guardians. اقتراحات audience=guardian للمربين فقط.
create or replace function app.can_decide_suggestion(p_profile_id uuid, p_audience public.suggestion_audience) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_mode public.age_mode; v_to text;
begin
  if auth.uid() is null then return false; end if;
  v_mode := app.profile_age_mode(p_profile_id);
  if v_mode = 'child' or p_audience = 'guardian' then
    return app.is_creator_guardian(p_profile_id) or app.guardian_has_permission(p_profile_id, 'approve_suggestions');
  end if;
  if app.is_profile_owner(p_profile_id) then return true; end if;
  v_to := app.setting_effective(p_profile_id, 'adaptation_suggestions_to') #>> '{}';
  return v_to = 'owner_and_permitted_guardians' and app.guardian_has_permission(p_profile_id, 'approve_suggestions');
end;
$$;
grant execute on function app.can_decide_suggestion(uuid, public.suggestion_audience) to authenticated;

create policy "suggestions select" on public.adaptation_suggestions for select to authenticated
  using (app.can_decide_suggestion(profile_id, audience) or (audience = 'owner' and app.is_profile_owner(profile_id)) or app.is_admin());
grant select on public.adaptation_suggestions to authenticated;

-- القرار: القبول يمر عبر نظام الإعدادات (طبقة صاحب القرار) بمصدر تدقيق adaptation_suggestion؛ الرفض يُسجل (لا يتكرر 30 يومًا عبر dedupe_key في المخطط).
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
    end if;
    -- try_mechanic: يقرأه المحرك من الاقتراحات المقبولة خلال engine_hint_days؛ real_mission_idea: المربي يضيفها من G04.
  end if;
  update public.adaptation_suggestions set decision = p_decision::public.suggestion_decision, decided_by = auth.uid(), decided_at = now() where id = p_id;
  insert into public.audit_log (actor_id, action, target, meta) values (auth.uid(), 'adaptation_suggestion_' || p_decision, p_id::text, jsonb_build_object('type', s.type, 'setting_key', s.setting_key, 'result', v_result));
  return v_result;
end;
$$;
grant execute on function app.decide_adaptation_suggestion(uuid, text) to authenticated;
create or replace function public.decide_adaptation_suggestion(p_id uuid, p_decision text) returns jsonb language sql security definer set search_path = public as $$ select app.decide_adaptation_suggestion(p_id, p_decision); $$;
grant execute on function public.decide_adaptation_suggestion(uuid, text) to authenticated;

-- تتبّع التشغيل الأسبوعي
create table public.adaptation_runs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  last_run_at timestamptz not null,
  last_suggestions int not null default 0
);
alter table public.adaptation_runs enable row level security;

-- 3) فعالية القوالب (7.6، ADAPT-6): للمشرف.
create table public.template_metrics (
  template_id text not null,
  template_version int not null,
  missions_n int not null default 0,
  shown_rate numeric not null default 0,
  partial_rate numeric not null default 0,
  not_yet_rate numeric not null default 0,
  abandon_rate numeric not null default 0,
  transfer_rate numeric not null default 0,
  avg_prediction_error numeric,
  flagged boolean not null default false,
  flag_reasons text[] not null default '{}',
  computed_at timestamptz not null default now(),
  config_version text,
  primary key (template_id, template_version),
  foreign key (template_id, template_version) references public.mission_templates (id, version) on delete cascade
);
alter table public.template_metrics enable row level security;
create policy "template_metrics admin" on public.template_metrics for select to authenticated using (app.is_admin());
grant select on public.template_metrics to authenticated;

-- 4) مسودات القوالب (ADAPT-7، ADMIN-5): القالب يُدرج في mission_templates بحالة draft وأصل ai_draft، والطابور هنا.
create table public.template_draft_reviews (
  template_id text not null,
  template_version int not null,
  source_version int not null,
  metrics jsonb not null default '{}'::jsonb,
  rationale text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  primary key (template_id, template_version),
  foreign key (template_id, template_version) references public.mission_templates (id, version) on delete cascade
);
alter table public.template_draft_reviews enable row level security;
create policy "draft reviews admin" on public.template_draft_reviews for select to authenticated using (app.is_admin());
grant select on public.template_draft_reviews to authenticated;
-- المشرف يرى المسودات (سياسة "templates read" تسمح له بكل الحالات).

-- قرار المشرف: القبول يفعّل النسخة الجديدة ويُحيل القديمة إلى retired (المهام الجارية تبقى بنسختها — الحالات الحدية)؛ الرفض يحذف المسودة.
create or replace function app.review_template_draft(p_template_id text, p_version int, p_decision text, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.template_draft_reviews%rowtype;
begin
  if not app.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from public.template_draft_reviews where template_id = p_template_id and template_version = p_version;
  if not found or r.status <> 'pending' then raise exception 'draft not pending' using errcode = '23514'; end if;
  if p_decision = 'approved' then
    update public.mission_templates set status = 'retired' where id = p_template_id and status = 'active';
    update public.mission_templates set status = 'active' where id = p_template_id and version = p_version;
    update public.template_draft_reviews set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), notes = p_notes where template_id = p_template_id and template_version = p_version;
  elsif p_decision = 'rejected' then
    update public.template_draft_reviews set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), notes = p_notes where template_id = p_template_id and template_version = p_version;
    update public.mission_templates set status = 'retired' where id = p_template_id and version = p_version;
  else
    raise exception 'bad decision' using errcode = '23514';
  end if;
  insert into public.audit_log (actor_id, action, target, meta) values (auth.uid(), 'template_draft_' || p_decision, p_template_id || ':' || p_version, jsonb_build_object('source_version', r.source_version, 'notes', p_notes));
end;
$$;
grant execute on function app.review_template_draft(text, int, text, text) to authenticated;
create or replace function public.review_template_draft(p_template_id text, p_version int, p_decision text, p_notes text default null) returns void language sql security definer set search_path = public as $$ select app.review_template_draft(p_template_id, p_version, p_decision, p_notes); $$;
grant execute on function public.review_template_draft(text, int, text, text) to authenticated;
