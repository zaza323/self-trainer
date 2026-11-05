-- المرحلة 6: PWA والعمل دون اتصال — طابور المزامنة (idempotent)، اشتراكات Web Push، تسليم الإشعارات، وقت الحدث من العميل.
-- معيار القبول: إكمال مهمة وتأمل دون اتصال يُزامَن بلا تكرار أدلة.

-- 1) سجل عمليات العميل: المفتاح من العميل (uuid) فيُرفض التكرار بالقيد الأساسي، والنتيجة تُحفظ لتُعاد كما هي عند إعادة الإرسال.
create table public.client_ops (
  id uuid primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('complete', 'interrupt', 'resume', 'reflect', 'abandon')),
  mission_id uuid not null references public.missions (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  client_at timestamptz not null,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  result jsonb
);
create index client_ops_profile_idx on public.client_ops (profile_id, received_at desc);
alter table public.client_ops enable row level security;
create policy "client_ops select" on public.client_ops for select to authenticated using (app.is_profile_owner(profile_id));
-- الكتابة من الخادم (service role) فقط عبر /api/sync.

-- 2) وقت الحدث من العميل (الحالات الحدية: حدود اليوم بوقت الحدث): transition_mission يقبل client_at في meta ولا يقبل مستقبلًا.
create or replace function app.transition_mission(p_mission_id uuid, p_to public.mission_status, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_profile uuid; v_at timestamptz;
begin
  select profile_id into v_profile from public.missions where id = p_mission_id;
  if not found then raise exception 'mission not found' using errcode = '23514'; end if;
  if not app.is_profile_owner(v_profile) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('app.transition_meta', coalesce(p_meta, '{}'::jsonb)::text, true);
  v_at := case when (p_meta ->> 'client_at') is null then null else least(now(), (p_meta ->> 'client_at')::timestamptz) end;
  if p_to in ('completed', 'abandoned') and v_at is not null then
    update public.missions set status = p_to, completed_at = coalesce(completed_at, v_at) where id = p_mission_id;
  elsif p_to = 'in_progress' and v_at is not null then
    update public.missions set status = p_to, started_at = coalesce(started_at, v_at) where id = p_mission_id;
  else
    update public.missions set status = p_to where id = p_mission_id;
  end if;
end;
$$;

-- 3) اشتراكات Web Push (NOTIF-4): لكل مستخدم (متدرب أو مربٍ) أجهزة عدة؛ endpoint فريد.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failed_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "push select own" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "push insert own" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy "push update own" on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push delete own" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- 4) الإشعارات: التسليم والتكرار والمستلم (NOTIF-1، NOTIF-5).
alter table public.notifications
  add column delivered_at timestamptz,
  add column deferred_count int not null default 0,
  add column dedupe_key text,
  add column title text,
  add column body text,
  add column url text;
alter table public.notifications add constraint notifications_dedupe_key unique (dedupe_key);
create index notifications_due_idx on public.notifications (scheduled_for) where sent_at is null;
-- المربي يرى الإشعارات الموجهة إليه (payload.guardian_id) — G09
create policy "notif select guardian" on public.notifications for select to authenticated
  using ((payload ->> 'guardian_id') is not null and (payload ->> 'guardian_id')::uuid = auth.uid());
create policy "notif update guardian" on public.notifications for update to authenticated
  using ((payload ->> 'guardian_id') is not null and (payload ->> 'guardian_id')::uuid = auth.uid())
  with check ((payload ->> 'guardian_id') is not null and (payload ->> 'guardian_id')::uuid = auth.uid());

-- 5) المنطقة الزمنية: المالك يحدّثها من جهازه (NOTIF-4 احترام المنطقة الزمنية) عبر سياسة تحديث profiles الموجودة.

-- 6) الجدولة الدورية: على Supabase Cloud يمكن استخدام pg_cron + pg_net لاستدعاء /api/cron/tick (انظر README).
--    الافتراضي في هذا المشروع Vercel Cron (vercel.json).
