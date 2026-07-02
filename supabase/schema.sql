-- Sağlık Takip — Supabase şeması + Row Level Security (RLS)
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.
-- Her kullanıcı YALNIZCA kendi verisini görür/yazar (RLS ile). Anon key public
-- olsa bile veriler korunur.
--
-- Senkron mantığı: yerel IndexedDB doğruluk kaynağı. Kayıtlar client-uuid PK +
-- updated_at taşır; çakışmada "son yazan kazanır" (last-write-wins). Silmeler
-- deleted=1 (soft delete) ile senkronlanır.

-- ── Beslenme kayıtları ──────────────────────────────────────────────
create table if not exists public.food_logs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tarih text not null,
  food_id text,
  gram numeric,
  porsiyon_carpani numeric,
  ogun text,
  deleted int not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists food_logs_user_upd on public.food_logs(user_id, updated_at);

-- ── Antrenman kayıtları (set başına bir satır) ──────────────────────
create table if not exists public.workout_logs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tarih text not null,
  exercise_id text,
  hareket text,
  set_no int,
  tekrar numeric,
  kilo numeric,
  tamam int not null default 0,
  deleted int not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists workout_logs_user_upd on public.workout_logs(user_id, updated_at);

-- ── Antrenman programları / şablonlar ───────────────────────────────
create table if not exists public.programs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ad text,
  hareketler jsonb,
  deleted int not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists programs_user_upd on public.programs(user_id, updated_at);

-- ── Kullanıcının eklediği gıdalar (online/özel) ─────────────────────
-- Katalog (seed) gıdalar senkronlanmaz; yalnızca kullanıcının eklediği ürünler.
create table if not exists public.user_foods (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ad text, arama text, kategori text, porsiyon_adi text,
  gram numeric, kalori numeric, protein numeric, karb numeric, yag numeric,
  kaynak text,
  deleted int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists user_foods_user_upd on public.user_foods(user_id, updated_at);

-- ── Kullanıcı ayarları (kullanıcı başına tek satır) ─────────────────
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kalori_hedefi int,
  makro_oranlari jsonb,
  updated_at timestamptz not null default now()
);

-- ── RLS: herkes yalnızca kendi satırlarını görür/yazar ──────────────
alter table public.food_logs     enable row level security;
alter table public.workout_logs  enable row level security;
alter table public.programs      enable row level security;
alter table public.user_foods    enable row level security;
alter table public.user_settings enable row level security;

create policy "own_food_logs"     on public.food_logs     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_workout_logs"  on public.workout_logs  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_programs"      on public.programs      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_user_foods"    on public.user_foods    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_user_settings" on public.user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
