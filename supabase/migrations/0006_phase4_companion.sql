-- ============================================================================
-- المرحلة 4: المرافق الذكي والأمان وسجل استدعاءات الذكاء الاصطناعي
-- companion_sessions / companion_messages (خيط واحد مشترك مع المربين بصلاحية view_chat)،
-- companion_insights (أدلة بوزن منخفض خارج المهام)، context_suggestions (ADAPT-2، تُستخدم في 5)،
-- human_requests (AI-12/13)، safety_flags (AI-5/7.4)، ai_calls (7.3/7.5).
-- ============================================================================

create type public.companion_mode as enum ('free', 'goal', 'plan', 'reflect', 'comeback', 'review');
create type public.handoff_state as enum ('ai', 'guardian');
create type public.message_role as enum ('player', 'ai', 'guardian', 'system');
create type public.safety_category as enum ('self_harm', 'abuse', 'immediate_danger', 'age_inappropriate');
create type public.safety_severity as enum ('low', 'medium', 'high');

create table public.companion_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  mode public.companion_mode not null default 'free',
  mission_id uuid references public.missions (id) on delete set null,
  handoff public.handoff_state not null default 'ai',
  handoff_guardian_id uuid references auth.users (id) on delete set null,
  handoff_at timestamptz,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  summary text,
  draft jsonb,                      -- مسودة الغاية الحية (goal) أو حالة التأمل (reflect)
  turn_count int not null default 0,
  created_at timestamptz not null default now()
);
create index companion_sessions_profile_idx on public.companion_sessions (profile_id, started_at desc);

create table public.companion_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.companion_sessions (id) on delete cascade,
  role public.message_role not null,
  author_id uuid references auth.users (id) on delete set null,
  content text not null,
  needs_human boolean not null default false,
  safety_flagged boolean not null default false,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index companion_messages_session_idx on public.companion_messages (session_id, created_at);

create table public.companion_insights (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.companion_sessions (id) on delete set null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  capability_id text not null references public.capabilities (id),
  type text not null,
  value numeric not null check (value between -1 and 1),
  confidence numeric not null check (confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create table public.context_suggestions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid references public.companion_sessions (id) on delete set null,
  field text not null check (field in ('interests', 'routine', 'free_windows', 'contexts')),
  value text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

create table public.human_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.companion_sessions (id) on delete cascade,
  message_id uuid references public.companion_messages (id) on delete set null,
  requested_by text not null check (requested_by in ('ai', 'player')),
  reason text,
  notified_guardian_ids uuid[] not null default '{}',
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.safety_flags (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid references public.companion_sessions (id) on delete set null,
  message_id uuid references public.companion_messages (id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  category public.safety_category not null,
  severity public.safety_severity not null,
  detector text not null,           -- keywords | model | both
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  notified_at timestamptz,
  notified_guardian_ids uuid[] not null default '{}',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index safety_flags_status_idx on public.safety_flags (status, created_at desc);

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id) on delete cascade,
  function text not null,
  prompt_version text not null,
  model_id text not null,
  input_hash text not null,
  output jsonb,
  valid boolean not null,
  attempt int not null default 1,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cache_read_tokens int not null default 0,
  latency_ms int,
  error text,
  created_at timestamptz not null default now()
);
create index ai_calls_profile_fn_day_idx on public.ai_calls (profile_id, function, created_at desc);

-- ----------------------------------------------------------------------------
-- RLS: المتدرب يرى خيطه؛ المربي بـ view_chat يرى؛ intervene_chat يكتب باسمه ويبدّل handoff؛ المشرف يرى الأمان فقط.
-- الكتابة الآلية (رسائل ai، المؤشرات، التنبيهات، ai_calls) من service_role.
-- ----------------------------------------------------------------------------
alter table public.companion_sessions enable row level security;
alter table public.companion_messages enable row level security;
alter table public.companion_insights enable row level security;
alter table public.context_suggestions enable row level security;
alter table public.human_requests enable row level security;
alter table public.safety_flags enable row level security;
alter table public.ai_calls enable row level security;

create or replace function app.session_profile(p_session_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select profile_id from public.companion_sessions where id = p_session_id;
$$;

create policy "sessions select" on public.companion_sessions for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_chat'));
create policy "sessions insert" on public.companion_sessions for insert to authenticated
  with check (app.is_profile_owner(profile_id) and handoff = 'ai');
-- المربي صاحب intervene_chat يبدّل handoff؛ المالك يُنهي جلسته
create policy "sessions update" on public.companion_sessions for update to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'intervene_chat'))
  with check (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'intervene_chat'));

create policy "messages select" on public.companion_messages for select to authenticated
  using (app.is_profile_owner(app.session_profile(session_id)) or app.has_permission(app.session_profile(session_id), 'view_chat'));
-- المتدرب يكتب رسائله؛ المربي بـ intervene_chat يكتب باسمه؛ رسائل ai من الخادم فقط
create policy "messages insert" on public.companion_messages for insert to authenticated
  with check (
    (role = 'player' and author_id = auth.uid() and app.is_profile_owner(app.session_profile(session_id)))
    or (role = 'guardian' and author_id = auth.uid() and app.has_permission(app.session_profile(session_id), 'intervene_chat'))
  );

create policy "insights select" on public.companion_insights for select to authenticated
  using (app.is_profile_owner(profile_id) or app.has_permission(profile_id, 'view_progress'));
create policy "context_suggestions select" on public.context_suggestions for select to authenticated
  using (app.is_profile_owner(profile_id) or (app.profile_age_mode(profile_id) = 'child' and app.is_active_guardian(profile_id)));
create policy "context_suggestions update" on public.context_suggestions for update to authenticated
  using (app.is_profile_owner(profile_id) or (app.profile_age_mode(profile_id) = 'child' and app.has_permission(profile_id, 'manage_settings')));

create policy "human_requests select" on public.human_requests for select to authenticated
  using (app.is_profile_owner(app.session_profile(session_id)) or app.has_permission(app.session_profile(session_id), 'intervene_chat'));
create policy "human_requests resolve" on public.human_requests for update to authenticated
  using (app.has_permission(app.session_profile(session_id), 'intervene_chat'));

-- الأمان: المربي بـ receive_alerts يرى تنبيهات متدربه؛ المشرف يرى كل ما وُسم أمنيًا فقط (8.3)
create policy "safety select" on public.safety_flags for select to authenticated
  using (app.has_permission(profile_id, 'receive_alerts') or app.is_admin());
create policy "safety review" on public.safety_flags for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

create policy "ai_calls admin" on public.ai_calls for select to authenticated using (app.is_admin());

grant select, insert, update on public.companion_sessions to authenticated;
grant select, insert on public.companion_messages to authenticated;
grant select on public.companion_insights, public.ai_calls to authenticated;
grant select, update on public.context_suggestions, public.human_requests, public.safety_flags to authenticated;

-- ----------------------------------------------------------------------------
-- تنبيه الأمان (AI-5، GUARD-2، NOTIF-5): إشعار فوري لكل مربٍ لديه receive_alerts، خارج حد العدد وساعات الهدوء؛
-- للبالغ بلا مربٍ مخوّل: إشعار للمتدرب نفسه بموارد المساعدة. التصعيد للمشرف عبر safety_flags.status = open.
-- ----------------------------------------------------------------------------
create or replace function app.notify_safety(p_flag_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  f public.safety_flags%rowtype;
  v_ids uuid[] := '{}';
  v_n int := 0;
  r record;
begin
  select * into f from public.safety_flags where id = p_flag_id;
  if not found then return 0; end if;
  for r in select l.guardian_id from public.guardian_links l
           where l.player_id = f.profile_id and l.status = 'active' and coalesce((l.permissions ->> 'receive_alerts')::boolean, false)
  loop
    insert into public.notifications (profile_id, type, payload)
    values (f.profile_id, 'safety_alert', jsonb_build_object('flag_id', f.id, 'guardian_id', r.guardian_id, 'category', f.category, 'severity', f.severity, 'bypass_limits', true));
    v_ids := array_append(v_ids, r.guardian_id);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    insert into public.notifications (profile_id, type, payload)
    values (f.profile_id, 'safety_resources', jsonb_build_object('flag_id', f.id, 'category', f.category, 'bypass_limits', true));
  end if;
  update public.safety_flags set notified_at = now(), notified_guardian_ids = v_ids where id = f.id;
  insert into public.audit_log (actor_id, action, target, meta) values (null, 'safety_flag_notified', f.id::text, jsonb_build_object('guardians', v_n));
  return v_n;
end;
$$;

-- AI-11: عند إزالة مربٍ أثناء تدخله يعود handoff فورًا إلى المرافق (القسم 13)
create or replace function app.guardian_links_handoff_release()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'removed' and old.status <> 'removed' then
    update public.companion_sessions set handoff = 'ai', handoff_guardian_id = null, handoff_at = null
      where profile_id = new.player_id and handoff = 'guardian' and handoff_guardian_id = new.guardian_id;
    insert into public.companion_messages (session_id, role, content, meta)
    select s.id, 'system', 'guardian_removed', jsonb_build_object('guardian_id', new.guardian_id)
    from public.companion_sessions s where s.profile_id = new.player_id and s.ended_at is null and s.handoff_guardian_id is null;
  end if;
  return new;
end;
$$;
create trigger guardian_links_handoff_release_trg after update on public.guardian_links for each row execute function app.guardian_links_handoff_release();

-- Realtime للمراقبة الحية (AI-10): يُضاف الجدول إلى النشر إن وُجد (Supabase)؛ محليًا لا يوجد النشر فيُتجاوز.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.companion_messages;
    alter publication supabase_realtime add table public.companion_sessions;
  end if;
end $$;

create or replace function public.notify_safety(p_flag_id uuid)
returns int language sql security definer set search_path = public as $$ select app.notify_safety(p_flag_id); $$;
revoke all on function public.notify_safety(uuid) from public, anon, authenticated;
grant execute on function public.notify_safety(uuid) to service_role;
