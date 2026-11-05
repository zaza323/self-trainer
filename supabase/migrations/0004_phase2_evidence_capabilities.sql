-- ============================================================================
-- المرحلة 2: الأدلة والخريطة
-- evidence_events (append-only، GATE-4/5)، capability_states (أ.5/أ.6)، capability_snapshots (أ.3)،
-- xp_events (append-only، GAME-3 — الحساب فقط، العرض في المرحلة 3)، transfer_reports (هيكل للمرحلة 5)،
-- self_insights (MAP-2). المحرك يكتب عبر service_role فقط؛ المتصفح يقرأ.
-- ============================================================================

alter table public.missions add column is_mastery_check boolean not null default false;

create type public.evidence_source as enum ('auto', 'ai', 'self', 'guardian', 'companion');
create type public.evidence_type as enum (
  'strategy_fit', 'prediction_accuracy', 'recovery', 'distraction_response', 'help_needed',
  'reflection_quality', 'transfer_report', 'guardian_observation', 'companion_insight', 'novel_context'
);

-- ----------------------------------------------------------------------------
-- الأدلة (4.7) — سجل غير قابل للتعديل
-- ----------------------------------------------------------------------------
create table public.evidence_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  capability_id text not null references public.capabilities (id),
  mission_id uuid references public.missions (id) on delete cascade,
  rule_id text not null,
  source public.evidence_source not null,
  type public.evidence_type not null,
  value numeric not null check (value between -1 and 1),
  rule_weight numeric not null default 1.0,
  weight numeric not null,                  -- لقطة للعرض؛ إعادة الحساب تشتقه من source × support_level × rule_weight
  context_tag text not null,
  support_level text not null check (support_level in ('L0_instruct', 'L1_hint', 'L2_ask', 'L3_free')),
  config_version text not null,
  created_at timestamptz not null default now()
);
-- GATE-5: قيد فريد؛ NULL في mission_id لا يُقيَّد (أدلة المربي والمرافق خارج المهام)، وهو قيد كامل لا جزئي حتى يعمل ON CONFLICT عبر PostgREST
alter table public.evidence_events add constraint evidence_unique_per_mission unique (mission_id, capability_id, type);
create index evidence_profile_cap_idx on public.evidence_events (profile_id, capability_id, created_at desc);

create or replace function app.evidence_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'evidence_events is append-only' using errcode = '23514';
end;
$$;
create trigger evidence_no_update before update or delete on public.evidence_events for each row execute function app.evidence_immutable();

-- ----------------------------------------------------------------------------
-- حالة القدرة (المرجع للمحرك)
-- ----------------------------------------------------------------------------
create table public.capability_states (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  capability_id text not null references public.capabilities (id),
  support_level text not null check (support_level in ('L0_instruct', 'L1_hint', 'L2_ask', 'L3_free')),
  support_changed_at_mission_count int not null default 0,
  support_temp_override jsonb,              -- {level, until, by}
  training_level public.training_level not null default 'simulated',
  mastered boolean not null default false,
  next_mastery_check_at date,
  focused boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (profile_id, capability_id)
);

-- ----------------------------------------------------------------------------
-- لقطات يومية للمسار (أ.3) — تُعاد من الأدلة في أي وقت (MAP-5)
-- ----------------------------------------------------------------------------
create table public.capability_snapshots (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  capability_id text not null references public.capabilities (id),
  date date not null,
  score int not null check (score between 0 and 100),
  confidence numeric not null check (confidence between 0 and 1),
  training_level public.training_level not null,
  support_level text not null,
  phrase_key text not null,
  config_version text not null,
  primary key (profile_id, capability_id, date)
);

-- ----------------------------------------------------------------------------
-- XP (أ.8) — سجل غير قابل للتعديل؛ الرصيد ملخص محسوب. العرض يخضع للكثافة (المرحلة 3)
-- ----------------------------------------------------------------------------
create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  amount int not null check (amount >= 0),
  reason text not null,
  source_id text not null,
  created_at timestamptz not null default now(),
  unique (reason, source_id)
);
create trigger xp_no_update before update or delete on public.xp_events for each row execute function app.evidence_immutable();

-- ----------------------------------------------------------------------------
-- تقارير النقل (LIFE-2) — الهيكل الآن لأن قواعد أ.6 تقرؤه؛ الواجهة في المرحلة 5
-- ----------------------------------------------------------------------------
create table public.transfer_reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  mission_id uuid references public.missions (id) on delete set null,
  capability_id text not null references public.capabilities (id),
  context_tag text not null,
  what text not null,
  worked boolean not null,
  guardian_confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

-- MAP-2: "ماذا تعلمت عن نفسك؟" — يُولَّد من التأملات ويستطيع المستخدم تعديله بكلماته
create table public.self_insights (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  text text not null default '',
  edited_by_user boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- RLS: القراءة للمالك والمربي (view_progress)؛ الكتابة من service_role فقط (المحرك)
-- ----------------------------------------------------------------------------
alter table public.evidence_events enable row level security;
alter table public.capability_states enable row level security;
alter table public.capability_snapshots enable row level security;
alter table public.xp_events enable row level security;
alter table public.transfer_reports enable row level security;
alter table public.self_insights enable row level security;

create policy "evidence select" on public.evidence_events for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress') or app.is_admin());
create policy "states select" on public.capability_states for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress') or app.is_admin());
create policy "snapshots select" on public.capability_snapshots for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress') or app.is_admin());
create policy "xp select" on public.xp_events for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress'));
create policy "transfer select" on public.transfer_reports for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress'));
create policy "insights select" on public.self_insights for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress'));
create policy "insights upsert" on public.self_insights for insert to authenticated with check (app.is_profile_owner(profile_id));
create policy "insights update" on public.self_insights for update to authenticated
  using (app.is_profile_owner(profile_id)) with check (app.is_profile_owner(profile_id));

grant select on public.evidence_events, public.capability_states, public.capability_snapshots, public.xp_events, public.transfer_reports to authenticated;
grant select, insert, update on public.self_insights to authenticated;

-- ----------------------------------------------------------------------------
-- تهيئة حالات القدرات الثماني لملف متدرب (الدعم الابتدائي حسب الوضع من support.json عبر config_meta)
-- ----------------------------------------------------------------------------
alter table public.config_meta add column support jsonb not null default '{}'::jsonb;

create or replace function app.ensure_capability_states(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_mode public.age_mode;
  v_level text;
begin
  select age_mode into v_mode from public.profiles where id = p_profile_id;
  if v_mode is null then return; end if;
  select support -> 'initial_by_age_mode' ->> v_mode::text into v_level from public.config_meta where id = 1;
  if v_level is null then raise exception 'config_meta.support missing: run config:sync' using errcode = '23514'; end if;
  insert into public.capability_states (profile_id, capability_id, support_level)
  select p_profile_id, c.id, v_level from public.capabilities c
  on conflict do nothing;
end;
$$;

-- عند إنشاء ملف متدرب تُهيأ الحالات تلقائيًا
create or replace function app.profiles_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'player' then perform app.ensure_capability_states(new.id); end if;
  return new;
end;
$$;
create trigger profiles_after_insert_trg after insert on public.profiles for each row execute function app.profiles_after_insert();
