-- 멀티테넌트 노래책 초기 스키마
-- 모든 테이블은 RLS enable + 정책 0개(deny-all). 접근은 서버의 sb_secret_ 키 전용.

create table users (
  id                  uuid primary key default gen_random_uuid(),
  chzzk_channel_id    text not null unique,
  chzzk_channel_name  text not null,
  chzzk_channel_image text,
  chzzk_verified      boolean not null default false,
  channel_synced_at   timestamptz,
  role                text not null default 'user' check (role in ('user','operator')),
  created_at          timestamptz not null default now(),
  last_login_at       timestamptz
);

-- 노래책 소유자의 치지직 토큰. 유저당 최대 1행.
create table user_tokens (
  user_id                  uuid primary key references users(id) on delete cascade,
  access_token_enc         text not null,
  refresh_token_enc        text not null,
  access_token_expires_at  timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  -- 동시 갱신 방지용 락. 'epoch' 기본값이라 항상 비교 가능하다.
  refresh_lock_until       timestamptz not null default 'epoch',
  updated_at               timestamptz not null default now()
);

create table songbooks (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references users(id),
  slug               text not null unique check (slug ~ '^[a-z0-9][a-z0-9_-]{1,29}$'),
  title              text not null,
  intro              text,
  is_public          boolean not null default true,
  chzzk_sync_enabled boolean not null default true,
  members_synced_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index songbooks_owner_id_idx on songbooks (owner_id);

create table songbook_members (
  songbook_id uuid not null references songbooks(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  role        text not null check (role = 'manager'),
  source      text not null check (source in ('chzzk_sync','invite')),
  invited_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  primary key (songbook_id, user_id)
);
create index songbook_members_user_id_idx on songbook_members (user_id);

create table songbook_invites (
  id          uuid primary key default gen_random_uuid(),
  songbook_id uuid not null references songbooks(id) on delete cascade,
  token_hash  text not null unique,
  created_by  uuid not null references users(id),
  expires_at  timestamptz not null,
  accepted_by uuid references users(id),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create table songs (
  id             uuid primary key default gen_random_uuid(),
  songbook_id    uuid not null references songbooks(id) on delete cascade,
  jacket_path    text,
  title          text not null,
  title_aliases  text[] not null default '{}',
  artist         text not null,
  artist_aliases text[] not null default '{}',
  mr_url         text,
  mr_video_id    text,
  mr_title       text,
  mr_channel     text,
  key            smallint not null default 0 check (key between -6 and 6),
  key_links      jsonb    not null default '{}',
  genre          text not null,
  price          integer  not null default 0 check (price >= 0),
  popular        boolean  not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index songs_songbook_id_idx on songs (songbook_id);

-- slug 변경 이력. 옛 주소를 살리고 제3자 재선점을 막는다.
create table songbook_slug_history (
  slug        text primary key check (slug ~ '^[a-z0-9][a-z0-9_-]{1,29}$'),
  songbook_id uuid not null references songbooks(id) on delete cascade,
  released_at timestamptz not null default now()
);

create table sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip         inet,
  created_at timestamptz not null default now()
);
create index sessions_user_id_idx on sessions (user_id);

-- 심층방어: Data API에 노출되더라도 행이 새지 않도록 전 테이블 deny-all.
alter table users                 enable row level security;
alter table user_tokens           enable row level security;
alter table songbooks             enable row level security;
alter table songbook_members      enable row level security;
alter table songbook_invites      enable row level security;
alter table songs                 enable row level security;
alter table songbook_slug_history enable row level security;
alter table sessions              enable row level security;
