# 멀티테넌트 노래책 서비스 전환 설계

작성일: 2026-07-31

## 배경

현재 코드베이스는 "노래책 하나"를 전제로 만들어져 있다. 그런데 이 제품은 각 스트리머가
소스를 내려받아 직접 배포하는 형태가 아니라, **우리가 서버를 운영하고 여러 스트리머가
접속해 쓰는 호스팅 서비스**다. 코드는 오픈소스로 공개하되 운영 인스턴스가 정본이다.
오픈소스라는 사실은 단일 테넌트로 둘 근거가 되지 못한다.

전제가 어긋난 결과 다음 네 가지가 동시에 깨져 있다.

| 항목 | 현재 상태 | 결과 |
|---|---|---|
| 소유권 | 곡 저장소가 평면 배열이고 `ownerId` 필드 자체가 없음 | 스트리머 A와 B를 구분할 수 없음 |
| 접근 제어 | `/admin/songs/new` 에 인증 가드가 전혀 없음 | 누구나 곡을 등록·수정할 수 있음 |
| 세션 | 치지직 `accessToken`/`refreshToken` 을 쿠키 payload에 base64 평문 저장 (HMAC은 서명이지 암호화가 아님) | 토큰 노출 위험 |
| 저장소 | `.data/songs.json` 파일, 동시 쓰기 보호 없음. 자켓은 `public/uploads/` | 동시 쓰기 시 유실, 서버리스에서 미동작 |

로그인은 존재하지만 세션의 `channelId` 가 어디에서도 사용되지 않는다. 신원은 있는데
권한이 없는 상태다.

## 확정 결정

| 결정 항목 | 선택 | 근거 |
|---|---|---|
| 서비스 형태 | 호스팅 멀티테넌트 (코드는 오픈소스) | 운영 주체가 우리 |
| 테넌트 생성 | 완전 셀프서비스 — 치지직 로그인 시 자기 노래책 생성 | 운영 개입 없이 확장, 치지직 계정이 진입 장벽 |
| 노래책 주소 | `/@slug` (사용자 지정) | `@` 접두사로 시스템 경로와 네임스페이스 분리 |
| 역할 | 소유자 · 매니저 · 서비스 운영자 | 스태프 위임 + 남용 대응 |
| 매니저 지정 | **치지직 채널 관리자 자동 동기화 + 수동 초대 링크 병행** | 치지직에서 이미 관리하는 스태프를 재입력시키지 않으면서, 그 밖의 사람도 위임 가능 |
| 치지직 토큰 | **AES-256-GCM 암호화 후 DB 저장** | 관리자 동기화를 소유자 로그인 시점과 무관하게 수행하려면 토큰이 필요 |
| 배포 | Vercel (서버리스) | 배포·TLS·스케일 운영 부담 제거 |
| DB · 파일 | Supabase (Postgres + Storage) | 서버리스에서 파일시스템 사용 불가 |
| 인가 방식 | 서버 전용 접근 + 앱 레벨 인가 | 아래 "왜 RLS가 주 방어선이 아닌가" 참고 |
| 테스트 | vitest | 인가 매트릭스 테스트가 늘어날 것을 전제 |

## 치지직 Open API 연동

`https://chzzk.gitbook.io/chzzk` 문서로 확인한 사실을 근거로 한다. 기존
`lib/chzzk.js` 의 `TODO(handoff)` 는 이 절로 해소된다.

### 공통 응답 봉투 (확정)

```
성공: { "code": 200, "message": null, "content": {responseBody} }
실패: { "code": integer, "message": string }
```

모든 Open API 응답이 `content` 로 감싸인다. 따라서 `lib/chzzk.js` 는
`json.content` 를 읽되, **`json.code !== 200` 검사와 기대 필드 존재 검사를 추가한다.**
현재는 봉투 형태가 바뀌면 `undefined` 가 조용히 흘러들어가 세션에 빈 `channelId` 가
저장된다.

### 사용하는 엔드포인트

| 엔드포인트 | 인증 | 용도 |
|---|---|---|
| `GET chzzk.naver.com/account-interlock` | — | 로그인 화면 (Open API와 **다른 도메인**) |
| `POST /auth/v1/token` (`grantType: authorization_code`) | — | 코드 → 토큰 교환 |
| `POST /auth/v1/token` (`grantType: refresh_token`) | — | 액세스 토큰 갱신 |
| `POST /auth/v1/token/revoke` | — | 토큰 폐기 |
| `GET /open/v1/users/me` | Access Token | `channelId`, `channelName` **둘뿐** |
| `GET /open/v1/channels?channelIds=` | **Client 인증** | `channelImageUrl`, `verifiedMark`, `followerCount`. 최대 20개 배치 |
| `GET /open/v1/channels/streaming-roles` | Access Token | 채널 관리자 목록 |

필요한 API Scope: `유저 정보 조회`, `채널 관리자 조회`.

**`users/me` 는 채널 이미지를 주지 않는다.** 프로필 이미지와 인증 마크는
`GET /open/v1/channels` 로 따로 가져온다. 이 API는 **Client 인증(Client-Id/Client-Secret
헤더)만으로 호출되어 사용자 토큰이 필요 없으므로**, 언제든 배치로 갱신할 수 있고
한 번도 로그인한 적 없는 채널의 정보도 조회할 수 있다. 이 성질을 매니저 자동 동기화에서
활용한다.

### 토큰 저장

액세스 토큰 만료 1일, 리프레시 토큰 만료 30일. **리프레시 토큰은 일회용이다.**

- **저장 대상은 노래책 소유자뿐이다.** 시청자 토큰은 우리가 쓸 데가 없다. 로그인 콜백에서
  해당 유저가 `songbooks.owner_id` 에 존재할 때만 저장하고, 아니면 메모리에서 폐기한다.
  노래책을 처음 만든 직후에는 저장된 토큰이 없으므로 관리 화면에 "치지직 관리자 자동
  동기화를 켜려면 다시 로그인해 주세요"를 1회 안내한다. 노래책 생성은 계정당 한 번이므로
  불편도 한 번이다.
- **AES-256-GCM으로 암호화해 저장한다.** 키는 환경변수 `TOKEN_ENCRYPTION_KEY`(32바이트,
  base64)이며 Vercel 환경변수에 둔다. **DB와 키가 분리되는 것이 핵심이다** — Supabase가
  통째로 유출되어도 키가 없으면 토큰은 쓸모없다. Node 내장 `crypto` 만 쓰므로 의존성이
  늘지 않는다.
- 저장 형식 `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`. 버전 접두사를 두어 나중에 키 회전이
  가능하게 한다.
- **저장한 토큰의 용도는 `GET /open/v1/channels/streaming-roles` 호출 하나뿐이다.**
  용도를 명세에 못박고, 다른 목적의 사용은 스펙 변경을 거친다.

### 토큰 갱신 (함정 주의)

`streaming-roles` 호출이 401(`INVALID_TOKEN`)을 반환하면 리프레시 토큰으로 재발급한다.

- **갱신 응답에 담긴 새 리프레시 토큰을 반드시 덮어써야 한다.** 리프레시 토큰은 일회용이라
  기존 값을 그대로 두면 다음 갱신이 영구히 실패한다.
- **동시 갱신 방지.** 두 요청이 동시에 갱신을 시도하면 한쪽은 이미 소모된 리프레시 토큰을
  쓰게 되어 실패하고, 최악의 경우 유효한 토큰을 덮어써 잃는다.
  **supabase-js는 PostgREST 위에서 동작해 `SELECT ... FOR UPDATE` 를 쓸 수 없으므로**,
  `user_tokens.refresh_lock_until` 컬럼에 대한 조건부 UPDATE로 락을 선점한다 —
  `update ... set refresh_lock_until = now() + 30s where user_id = $1 and refresh_lock_until < now()`
  가 갱신한 행이 0개면 다른 요청이 이미 갱신 중이다. 기본값을 `'epoch'` 로 두어 항상
  비교 가능하게 한다.
- 리프레시 토큰마저 만료(30일)되면 행을 삭제하고 동기화를 중단한다. 소유자가 다시
  로그인하면 자동으로 복구된다. 사용자에게 재로그인을 강제하지 않는다.

### 토큰 폐기(revoke) 정책

`POST /auth/v1/token/revoke` 는 "요청한 토큰과 동일한 인증 과정을 거친 **모든** 토큰"
(clientId + user가 같은 토큰 전부)을 제거한다.

- **일반 로그아웃에서는 호출하지 않는다.** 다른 기기의 로그인까지 끊어지고, 우리 세션은
  자체 DB 기반이라 치지직 토큰과 무관하다.
- **연동 해제(사용자가 명시적으로 요청) 시에만 호출**하고 `user_tokens` 행을 삭제한다.

### 애플리케이션 등록 제약

- 애플리케이션 ID·이름에 `chzzk`, `치지직`, `naver`, `네이버` 를 **포함할 수 없다.**
  서비스명이 "치지직 노래책"이므로 앱 등록명은 다른 이름을 써야 한다.
- **최근 90일간 API Scope 사용량이 0이면 애플리케이션이 삭제된다.** 운영 중에는 자연히
  호출되므로 문제되지 않으나, 장기 중단 시 재등록이 필요하다.

## 왜 RLS가 주 방어선이 아닌가

인증 주체가 치지직 OAuth이므로 Supabase Auth의 `auth.uid()` 가 존재하지 않는다.
Supabase 문서 기준 Third-Party Auth가 지원하는 발급자는 Clerk, Firebase Auth, Auth0,
AWS Cognito, WorkOS **다섯 개뿐이며**, 발급자는 OIDC Issuer Discovery URL을 노출하는
비대칭 서명 JWT여야 한다. 대칭 서명 및 자체 서명 JWT는 지원되지 않는다. 치지직은 이 조건을
충족하지 않으므로 `auth.uid()` 기반 RLS를 그대로 쓸 방법이 없다.

검토했으나 채택하지 않은 대안:

- **Supabase Auth 브릿지** — 지원되지 않는 경로를 우회로 만들고 우리 쿠키 세션과 Supabase
  세션 두 개를 동기화해야 한다. 보안을 강화하려다 새 취약점 표면을 만드는 셈이라 제외.
- **직접 Postgres 연결 + `SET LOCAL app.user_id` 기반 RLS** — 보안적으로는 더 강하다.
  다만 Vercel 서버리스에서 Supavisor 트랜잭션 모드가 강제되어 prepared statement 제약과
  커넥션 관리가 따라붙고, `SET LOCAL` 누락 시 전면 차단되는 함정이 있으며 Storage는 별도
  처리가 필요하다. 현재 규모 대비 난이도가 과해 보류. 향후 재검토 여지는 남긴다.

**채택안:** 브라우저는 Supabase의 존재를 전혀 모른다.

- `NEXT_PUBLIC_` 으로 노출되는 Supabase 키가 하나도 없다.
- 모든 DB·Storage 접근은 Next.js Route Handler에서 `sb_secret_...` 키로만 이루어진다.
  이 키는 `BYPASSRLS` 속성의 `service_role` Postgres role로 동작하므로 RLS를 전부 우회한다.
- 테이블을 Data API에 노출하지 않는다. **명시적으로 권한을 회수해야 한다.**
  2026-05-30 변경(새 테이블 자동 미노출)은 **2026-10-30부터 강제**이므로, 그 이전에 만든
  프로젝트에서는 여전히 `anon`/`authenticated` 에 자동 grant가 붙는다. 실측으로 확인했다 —
  스키마 적용 직후 publishable·anon 키로 `users`·`user_tokens`·`sessions` 를 조회하면
  HTTP 200이 돌아왔다(행은 RLS가 막아 빈 배열). 즉 방어가 1겹뿐이었다.
  → `supabase/migrations/0002_revoke_data_api_access.sql` 로 `anon`/`authenticated` 의
  테이블·시퀀스·함수 권한과 `public` 스키마 usage를 회수하고, default privileges도 회수해
  이후 만들어질 객체에 자동 grant가 붙지 않게 한다. 적용 후 공개 키는 401(42501)을 받는다.
- 그럼에도 **모든 테이블에 RLS를 enable하고 정책을 0개로 둔다**(deny-all). 설정 실수로
  테이블이 노출되더라도 행이 새지 않게 하는 심층방어다.

이 구조의 대가는 명확하다. **인가 누락이 곧 데이터 노출이다.** 따라서 인가 로직을
`lib/authz.js` 한 곳에 모으고, 모든 쓰기 경로가 반드시 그것을 거치게 하며, 인가 매트릭스를
전수 테스트한다.

## 데이터 모델

테이블 8개. 전부 RLS enable + 정책 0개.

```sql
-- 치지직 계정 = 서비스 계정
create table users (
  id                  uuid primary key default gen_random_uuid(),
  chzzk_channel_id    text not null unique,
  chzzk_channel_name  text not null,
  chzzk_channel_image text,
  chzzk_verified      boolean not null default false,  -- channels API의 verifiedMark
  channel_synced_at   timestamptz,                     -- 이미지·인증마크 갱신 시각
  role                text not null default 'user' check (role in ('user','operator')),
  created_at          timestamptz not null default now(),
  last_login_at       timestamptz            -- null = 아직 로그인한 적 없는 placeholder
);

-- 소유자의 치지직 토큰. 유저당 최대 1행
create table user_tokens (
  user_id                uuid primary key references users(id) on delete cascade,
  access_token_enc       text not null,      -- v1:<iv>:<tag>:<ciphertext>
  refresh_token_enc      text not null,
  access_token_expires_at  timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  -- 동시 갱신 방지 락. 'epoch' 기본값이라 항상 비교 가능하다
  refresh_lock_until       timestamptz not null default 'epoch',
  updated_at             timestamptz not null default now()
);

-- 테넌트
create table songbooks (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references users(id),
  slug       text not null unique
             check (slug ~ '^[a-z0-9][a-z0-9_-]{1,29}$'),
  title      text not null,
  intro      text,
  is_public  boolean not null default true,
  chzzk_sync_enabled boolean not null default true,  -- 치지직 관리자 자동 동기화
  members_synced_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 매니저만 들어간다 (소유자는 songbooks.owner_id)
create table songbook_members (
  songbook_id uuid not null references songbooks(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  role        text not null check (role = 'manager'),
  source      text not null check (source in ('chzzk_sync','invite')),
  invited_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  primary key (songbook_id, user_id)
);

-- 수동 매니저 초대
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

-- slug 변경 이력. 옛 주소를 살리고 재선점을 막는다
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
```

### 설계 의도

**소유자는 `songbooks.owner_id`, 매니저만 별도 테이블.** 소유자까지 `songbook_members` 에
role로 통합하는 편이 정규화상 깔끔하지만, 그러면 "소유자 0명" 또는 "소유자 2명" 상태를
스키마가 막지 못한다. `owner_id NOT NULL` 로 불변식을 DB에 새기면 그 상태가 표현 불가능해지고,
소유권 양도는 컬럼 교체 한 번으로 끝나며, 소유자 판정에 조인이 필요 없다.

**`songbook_members.source` 로 자동 동기화와 수동 초대를 구분한다.** 자동 동기화는
`source='chzzk_sync'` 인 행만 대상으로 추가·삭제하고, `source='invite'` 인 행은 절대 건드리지
않는다. 이 구분이 없으면 동기화가 수동으로 초대한 매니저를 지워버린다.

**`users.last_login_at` 이 nullable이다.** 치지직 관리자 동기화로 알게 된 채널 중 우리
서비스에 한 번도 로그인한 적 없는 사람이 있다. 이들도 `users` 행이 필요하다(FK 유지).
이름·이미지는 `GET /open/v1/channels` 로 채운다 — Client 인증이라 그 사람의 토큰이 필요 없다.
해당 계정이 실제로 로그인하면 같은 `chzzk_channel_id` 행에 연결되어 즉시 매니저 권한을 갖는다.

**`user_tokens` 를 `sessions` 와 분리한다.** 토큰은 유저당 1개이고 세션은 기기당 1개다.
세션에 토큰을 넣으면 같은 사람이 3개 기기에서 로그인할 때 토큰이 3벌 복제되어 유출면이
3배가 되고, 리프레시 토큰이 일회용이라 서로를 무효화한다.

**`slug` 는 소문자만 허용하고 애플리케이션에서 소문자로 정규화한 뒤 저장한다.** check 제약이
대문자를 거부하므로 대소문자만 다른 중복이 구조적으로 불가능하다. `citext` 확장이 필요 없다.

**`users.role` 을 `'operator'` 로 올리는 API 경로를 만들지 않는다.** 운영자 승격은 DB 직접
조작으로만 가능하다. 권한 상승 엔드포인트가 없으면 권한 상승 취약점도 없다.

**초대 토큰은 원문을 저장하지 않고 해시만 남긴다.** DB가 통째로 유출되어도 초대 링크를
재사용할 수 없다. 만료는 필수이며 기본값 7일.

**slug를 바꾸면 옛 slug가 `songbook_slug_history` 로 이동한다.** `/@oldslug` 요청은
현재 slug로 301 리다이렉트한다. 이미 공유된 링크가 죽지 않고, 무엇보다 **옛 slug를 다른
사람이 선점할 수 없다.** 재선점을 허용하면 유명 스트리머가 slug를 바꾼 직후 제3자가
그 주소를 가져가 사칭할 수 있다. 신규 slug 생성 시 `songbooks.slug` 와
`songbook_slug_history.slug` 양쪽 모두에서 중복을 검사한다.

## 매니저 자동 동기화

소유자에게 유효한 토큰이 있고 `songbooks.chzzk_sync_enabled` 가 참일 때 동작한다.

동기화 시점: 소유자 로그인 직후, 그리고 관리 화면의 "지금 동기화" 버튼. 주기적 배치는
초기 범위에 넣지 않는다 — 소유자 로그인만으로 실용적으로 충분하고, 크론은 실패 관측
수단이 갖춰진 뒤에 붙이는 편이 낫다.

절차:

1. `GET /open/v1/channels/streaming-roles` 호출 (401이면 리프레시 후 1회 재시도)
2. `STREAMING_CHANNEL_OWNER` 는 제외한다 — 소유자는 `songbooks.owner_id` 로 이미 표현된다
3. 남은 `managerChannelId` 목록에 대해 `users` 를 upsert (없으면 `last_login_at = null`
   placeholder 생성). 이름·이미지는 `GET /open/v1/channels` 로 최대 20개씩 배치 조회해 채운다
4. `source='chzzk_sync'` 인 기존 행과 비교해 추가·삭제를 반영한다.
   **`source='invite'` 행은 건드리지 않는다**
5. `songbooks.members_synced_at` 갱신

동기화 실패(토큰 만료, 429, 5xx)는 로그인을 막지 않는다. 관리 화면에 마지막 동기화 시각과
실패 사유를 표시하고 재시도 버튼을 둔다.

**같은 사람이 자동·수동 양쪽에 해당하면** `songbook_members` 의 PK가 `(songbook_id, user_id)`
이므로 행은 하나다. 먼저 들어온 `source` 를 유지하고, 자동 동기화가 `source='invite'` 행을
덮어쓰지 않는다. 치지직에서 관리자 지정이 해제되어도 수동 초대분은 살아남는다.

## 권한 모델

### 인가 매트릭스

| 주체 | 조회(공개) | 조회(비공개) | 곡 등록 | 곡 수정·삭제 | 설정 변경 | 매니저 초대·해제 |
|---|---|---|---|---|---|---|
| 비로그인 | 200 | 404 | 401 | 401 | 401 | 401 |
| 타인(로그인) | 200 | 404 | 404 | 404 | 404 | 404 |
| 매니저 | 200 | 200 | 200 | 200 | **404** | **404** |
| 소유자 | 200 | 200 | 200 | 200 | 200 | 200 |
| 운영자 | 200 | 200 | 200 | 200 | 200 | **404** |

**권한이 없을 때 403이 아니라 404를 반환한다.** 403은 "그 리소스가 존재한다"는 사실을
누설하여 비공개 노래책의 존재 여부를 탐지당한다. 비로그인만 401을 쓰는데, 이는 리소스
존재 여부와 무관하게 "로그인하면 달라질 수 있다"는 안내가 필요하기 때문이다.

**운영자에게 매니저 초대 권한이 없는 이유:** 운영자 역할의 목적은 남용 대응(신고된 노래책·
자켓 내리기, slug 회수)이지 남의 노래책 인사권이 아니다. 필요 이상의 권한을 주지 않는다.

### 인가 단일화 — `lib/authz.js`

```js
currentUser()                                 // 세션 → 유저 | null
accessLevel(user, songbookId)                 // 'owner' | 'manager' | 'operator' | null
requireSongbookAccess(songbookId, { min })    // 미달이면 throw → 라우트에서 401/404로 변환
```

모든 쓰기 라우트 핸들러는 첫 줄에서 `requireSongbookAccess` 를 호출한다. 인가 판정이
이 모듈 밖에 존재해서는 안 된다.

**권한은 단순 서열이 아니다.** `min: 'manager'` 는 `manager`, `owner`, `operator` 를 통과시키고
(곡 관련 동작), `min: 'owner'` 는 `owner`, `operator` 를 통과시킨다(설정 변경). 다만 매니저
초대·해제는 `owner` 만 통과하며 `operator` 를 명시적으로 배제하므로, 이 경우만 서열 판정이
아니라 `accessLevel(...) === 'owner'` 로 직접 검사한다. 위 인가 매트릭스가 정본이고, 서열
표현으로 매트릭스를 유도하려 하지 않는다.

## 라우팅

```
app/page.jsx                  랜딩. 비로그인=소개+로그인, 로그인=내 노래책으로 이동
app/[handle]/page.jsx         /@slug 시청자 노래책. 공개, 비로그인 열람 허용
app/manage/page.jsx           내 노래책 (소유 + 매니저로 참여중)
app/manage/[slug]/page.jsx    노래책 설정 (제목·소개·slug·공개여부·동기화)
app/manage/[slug]/songs/      곡 목록·등록·수정  ← 기존 app/admin/songs/new 이설
app/manage/[slug]/members/    매니저 목록·동기화·초대·해제
app/invite/[token]/page.jsx   초대 수락
```

**Next.js 함정:** App Router에서 폴더명 `@foo` 는 parallel route slot 문법이라 URL 세그먼트가
되지 않는다. `/@dutto` 를 만들려면 `app/[handle]/page.jsx` 로 받아 `params.handle` 이
`"@dutto"` 로 들어오는 것을 쓰고, `@` 로 시작하지 않으면 404를 반환한다. 정적 세그먼트
(`manage`, `invite`, `api`)가 dynamic segment보다 우선 매칭되므로 충돌하지 않는다.

`/admin` 은 제거한다. 관리 화면을 `/@slug/manage` 가 아니라 `/manage/[slug]` 로 둔 것은
catch-all과 얽히지 않게 하기 위해서다.

`app/[handle]/page.jsx` 의 해석 순서: `@` 로 시작하지 않으면 404 → `songbooks.slug` 조회 →
없으면 `songbook_slug_history` 조회 후 현재 slug로 301 → 그것도 없으면 404.

### API

```
POST   /api/auth/login                      치지직 OAuth 시작
GET    /api/auth/callback                   users upsert + sessions insert + (소유자면) 토큰 저장 + 동기화
POST   /api/auth/logout                     sessions.revoked_at 기록 (치지직 revoke 호출 안 함)
DELETE /api/auth/unlink                     연동 해제 — 치지직 revoke + user_tokens 삭제
GET    /api/me                              현재 유저 + 참여 노래책 목록

GET    /api/songbooks/[slug]/songs          공개 조회 (is_public 확인)
POST   /api/songbooks                       노래책 생성
PATCH  /api/songbooks/[id]                  설정 변경                      (owner|operator)
POST   /api/songbooks/[id]/songs            곡 등록                        (manager 이상)
POST   /api/songbooks/[id]/songs/bulk       CSV 일괄 등록                  (manager 이상)
PATCH  /api/songs/[id]                      곡 수정                        (manager 이상)
DELETE /api/songs/[id]                      곡 삭제 + Storage 객체 삭제    (manager 이상)
POST   /api/songbooks/[id]/members/sync     치지직 관리자 동기화           (owner)
POST   /api/songbooks/[id]/invites          초대 생성                      (owner)
POST   /api/invites/[token]/accept          초대 수락
DELETE /api/songbooks/[id]/members/[userId] 매니저 해제                    (owner)
POST   /api/upload                          자켓 업로드 (songbookId 필수)  (manager 이상)
GET    /api/youtube                         유튜브 oEmbed 프록시 (변경 없음)
```

## 엣지 케이스

**초대 수락**

| 상황 | 처리 |
|---|---|
| 비로그인 상태로 초대 링크 접속 | 로그인 유도 후 원래 초대 링크로 복귀 |
| 만료된 토큰 | 410, "초대가 만료되었습니다" |
| 이미 수락된 토큰 | 410. 토큰은 1회용이며 `accepted_at` 이 있으면 재사용 불가 |
| 존재하지 않는 토큰 | 410 (404와 구분하지 않는다 — 토큰 존재 여부를 누설하지 않기 위해) |
| 이미 매니저인 사용자가 수락 | 200, 멱등 처리. 토큰은 소모하고 `source` 는 그대로 둔다 |
| 소유자 본인이 수락 | 400, "이미 이 노래책의 소유자입니다". 매니저로 강등되면 안 된다 |
| 다른 노래책을 소유한 사용자가 수락 | 허용. 소유와 매니저 겸직은 막을 이유가 없다 |

**매니저 해제** — 해제된 매니저의 세션은 유지되지만 다음 요청부터 인가에서 걸린다.
인가는 매 요청 시 DB에서 판정하므로 세션 무효화가 필요 없다. 단, `source='chzzk_sync'` 인
매니저를 수동 해제해도 다음 동기화에서 되살아난다. 이 경우 "치지직에서 관리자 지정을
해제해야 합니다"를 안내한다.

**소유자 계정 삭제** — 범위 밖. `songbooks.owner_id` 에 `on delete cascade` 를 걸지 않았으므로
사용자 삭제 시도는 FK 제약으로 실패한다. 의도된 동작이며, 노래책이 소유자 없이 남는 것보다 낫다.

## 세션

| | 현재 | 변경 후 |
|---|---|---|
| 쿠키 내용 | `{channelId, channelName, accessToken, refreshToken}` base64 평문 | `sessionId` 하나 (HMAC-SHA256 서명) |
| 치지직 토큰 | 쿠키에 상주 | `user_tokens` 에 AES-256-GCM 암호화 저장 (소유자만) |
| 로그아웃 | 쿠키 삭제만 | `sessions.revoked_at` 기록 + 쿠키 삭제 |
| 수명 | 1일 (치지직 토큰 만료에 연동) | 30일. 남은 기간이 7일 미만이면 접근 시 30일로 연장 |
| `SESSION_SECRET` | 기본값 `"dev-only-secret-change-me"` | 프로덕션에서 미설정 시 부팅 실패 |

검증 순서: 서명 확인 → `sessions` 조회 → `revoked_at is null and expires_at > now()` →
`users` 조인. 어느 단계에서 실패해도 동일하게 비로그인으로 취급한다.

로그인 시 `chzzk_channel_id` 기준으로 `users` 를 upsert하고 `chzzk_channel_name` 을
갱신한다(닉네임 변경 반영).

**데모 모드는 프로덕션에서 제거한다.** 현재 `.env` 미설정 시 가짜 세션을 발급하는데,
셀프서비스 멀티테넌트에서 이는 "아무나 임의 신원으로 로그인해 노래책 생성"이 된다.
`NODE_ENV !== 'production'` 에서만 유지하고, 프로덕션에서 OAuth 미설정 시 로그인을 비활성한다.

## 자켓 이미지 저장

`public/uploads/` 는 Vercel에서 동작하지 않으므로 Supabase Storage로 교체한다.

- 버킷 `jackets`, 공개 읽기 / 쓰기는 서버 Route Handler 경유(`sb_secret_` 키). 클라이언트
  직접 업로드나 서명 URL을 쓰지 않는다 — 검증을 서버가 수행해야 하기 때문이다.
- 경로 `{songbook_id}/{uuid}.{ext}`
- 검증: 2MB 상한 · MIME 화이트리스트(`image/jpeg`, `image/png`, `image/webp`) ·
  **매직바이트 확인** · 확장자는 서버가 재생성. 파일명과 `Content-Type` 은 클라이언트가
  자유롭게 위조할 수 있으므로 둘 다 신뢰하지 않는다.
- 곡 삭제 시 Storage 객체도 함께 삭제한다.

## 남용 방어

셀프서비스이므로 상한이 없으면 그대로 뚫린다. IP 기반 rate limit은 Vercel에서 외부
스토어(Upstash 등)를 추가로 붙여야 하므로 초기에는 자원 상한으로 갈음한다.

- 유저당 노래책 1개
- 노래책당 곡 5,000개. **CSV 일괄 등록이 상한을 넘기면 부분 등록하지 않고 전체를 거부하고,
  몇 곡이 초과인지 알린다.** 부분 등록은 어디까지 들어갔는지 사용자가 알 수 없어 더 나쁘다.
- CSV 1회 1,000곡 (기존 제한 유지)
- 자켓 2MB
- 동기화는 노래책당 1분에 1회로 제한 (`members_synced_at` 기준). 치지직 API 429 방지
- 쓰기 요청에 `Origin` 헤더 검증. `SameSite=Lax` 가 cross-site POST의 쿠키 전송을 이미
  막지만 이중으로 건다.
- slug 형식 `^[a-z0-9][a-z0-9_-]{1,29}$`. **한글·유니코드 불허** — 셀프서비스 선착순이라
  시각적으로 동일한 유니코드 문자(homograph)로 유명 스트리머를 사칭할 수 있다.
- slug 예약어 차단: `admin`, `official`, `staff`, `support`, `help`, `chzzk`, `naver`,
  `songbook`, `api`, `system`. 라우팅 충돌이 아니라 **사칭 방지** 목적이다.
- **사칭 방어의 핵심은 `verifiedMark` 다.** 노래책 페이지 상단에 치지직 채널명·채널 링크와
  함께 **치지직 인증 배지**를 노출한다(`GET /open/v1/channels` 의 `verifiedMark`). slug는
  검증된 신원이 아니라 단순 문자열이지만, 인증 마크는 치지직이 보증한 값이다.

## 기존 자산 처리

| 대상 | 처리 | 근거 |
|---|---|---|
| `.data/songs.json` | 삭제 | 로컬 데모 산출물. 실사용자 데이터 없음 |
| `data/songs.js` (SEED 60여 곡) | 로컬 개발 시드 스크립트로 이설 | 프로덕션 시드로 쓰면 남의 노래책에 남의 곡이 들어감 |
| `data/genres.js` | 유지 | 장르·가격 프리셋·키 표기 유틸. 테넌트 무관 |
| `lib/store.js` | 삭제 → `lib/db/*` 로 대체 | 파일 기반 전제가 무효 |
| `lib/chzzk.js` | 확장 | 봉투 검증, channels, streaming-roles, refresh, revoke 추가 |
| `app/admin/**` | 삭제 → `app/manage/[slug]/**` 로 이설 | 곡 등록 UI·CSV 로직은 그대로 옮기고 배선만 교체 |
| `lib/csv.js`, `lib/kana.js`, `lib/youtube.js` | 손대지 않음 | 순수 함수, 테넌트 무관. 검증된 자산 |

**삭제는 이설 커밋과 분리한다.** 기능 이설을 먼저 커밋하고, 삭제를 다음 커밋으로 둔다.
리뷰·롤백 단위가 깔끔해진다. 중간 커밋 시점에 구조가 잠시 중복 상태로 남는 것을 감수한다.

## 환경변수

```
CHZZK_CLIENT_ID
CHZZK_CLIENT_SECRET
CHZZK_REDIRECT_URI
SESSION_SECRET            # 프로덕션 미설정 시 부팅 실패
TOKEN_ENCRYPTION_KEY      # 32바이트 base64. 프로덕션 미설정 시 부팅 실패
SUPABASE_URL
SUPABASE_SECRET_KEY       # sb_secret_... 서버 전용. NEXT_PUBLIC_ 접두사 금지
```

`NEXT_PUBLIC_` 접두사가 붙은 변수는 브라우저로 전송된다. 위 목록에 하나도 없어야 한다.

## 구현 순서

앞 단계가 뒤 단계의 전제이므로 순서가 고정이다.

1. Supabase 프로젝트 연동(Vercel Marketplace 흐름) + 스키마 마이그레이션 + `lib/db` 서버 클라이언트
2. `lib/chzzk.js` 확장 — 봉투 검증, `channels`, `streaming-roles`, refresh, revoke
3. 세션 재설계 — `sessions` 테이블, `lib/crypto.js`(AES-256-GCM), `user_tokens`, `lib/authz.js` 골격
4. 노래책 CRUD + `/manage` + slug 검증
5. 곡 CRUD를 `songbook_id` 스코프로 이설 — 등록 화면·CSV 재배선, 목록·수정·삭제 신규
6. 자켓 업로드 → Supabase Storage
7. 매니저 — 치지직 관리자 동기화 + 수동 초대·해제
8. `/@handle` 시청자 페이지 + 랜딩 (인증 배지 포함)
9. `app/admin/**`, `lib/store.js`, `.data/` 삭제 (별도 커밋)

## 검증 계획

도구는 vitest. 인가 매트릭스는 서버를 띄우고 실제 HTTP 응답 코드를 검증하는 통합 방식으로
작성한다. 인가를 모킹하면 인가가 동작하지 않아도 테스트가 통과하기 때문이다.
치지직 API는 스텁으로 대체한다(실 API 호출 없음).

- **인가 매트릭스 전수** — 위 표의 5주체 × 6동작 = 30조합. 이 설계의 유일한 방어선이므로
  구멍이 곧 취약점이다.
- **404/403 구분** — 권한 없는 비공개 노래책 요청이 404를 반환해 존재를 누설하지 않는지
- **세션** — 로그아웃 후 기존 쿠키 재사용 거부, 만료 세션 거부, 서명 위조 거부
- **토큰 암호화** — 암·복호화 왕복, 변조된 ciphertext가 GCM 인증 태그에서 거부되는지,
  `TOKEN_ENCRYPTION_KEY` 미설정 시 프로덕션 부팅 실패
- **토큰 갱신** — 갱신 응답의 새 리프레시 토큰이 저장되는지(일회용 함정),
  **동시 갱신 2건이 토큰을 잃지 않는지**, 리프레시 만료 시 행 삭제 후 동기화 중단
- **관리자 동기화** — `STREAMING_CHANNEL_OWNER` 제외, `source='invite'` 행 미삭제,
  치지직에서 빠진 관리자의 `chzzk_sync` 행 삭제, placeholder 유저 생성 후 실제 로그인 시 연결,
  동기화 실패가 로그인을 막지 않는지
- **업로드** — `.jpg` 확장자로 위장한 HTML 거부, 크기 초과 거부, 매직바이트 불일치 거부
- **slug** — 대소문자만 다른 중복(`Dutto`/`dutto`), 형식 위반, 유니코드, 예약어 거부,
  변경 후 옛 slug의 301 리다이렉트, 옛 slug의 제3자 선점 거부
- **초대** — 위 엣지 케이스 표 7건 전수
- **상한** — 유저당 2번째 노래책 생성 거부, 곡 5,000개 초과 시 CSV 전체 거부
- **응답 봉투** — `code !== 200` 응답, `content` 누락 응답에서 `undefined` 가 흘러들지 않고
  명확히 실패하는지
- **기존 검증 유지** — `npm run build`, 가나→한글 13케이스, CSV 파싱

## 범위 밖

- 운영자 전용 UI (초기에는 DB 직접 조작으로 대응)
- 공개 노래책 탐색·검색 페이지
- 신청 목록 서버 저장, 스트리머 대시보드
- 결제·후원 연동 (가격은 표시·명령어 생성까지)
- 주기적 배치 동기화 (소유자 로그인 + 수동 버튼으로 갈음)
- IP 기반 rate limit
- 소유권 양도 UI (스키마상 `owner_id` 교체로 가능하나 화면은 만들지 않음)
- 저장된 토큰의 `streaming-roles` 외 용도

## 가정 및 미해결

- **실 credential로 확인이 필요한 항목.** 문서로 공통 봉투 구조는 확정했으나, 인증
  엔드포인트(`/auth/v1/token`)의 응답에도 같은 봉투가 적용되는지는 문서가 raw JSON 예시를
  싣지 않아 단정할 수 없다. 같은 도메인의 Open API이므로 적용된다고 보되, `lib/chzzk.js` 는
  두 형태를 모두 수용하고 **기대 필드가 없으면 명확히 실패**하도록 구현한다.
- **`GET /open/v1/channels/streaming-roles` 의 Request Param 표가 문서에 없다.** Access Token
  주인의 채널 관리자를 반환하는 것으로 해석했다. 채널 ID를 명시해야 한다면 소유자의
  `chzzk_channel_id` 를 넘기면 되므로 설계는 영향받지 않으나, 구현 시 실 응답으로 확인한다.
- 노래책당 곡 수가 수백~수천 규모라고 가정하고, 시청자 페이지는 기존처럼 전체 목록을 받아
  클라이언트에서 별칭 검색을 수행한다. 별칭 검색 특성상 서버 페이지네이션은 오히려 UX를
  해친다. 한 노래책이 5,000곡에 근접하면 서버 검색으로 재설계한다.
- 유저당 노래책 1개 제한은 초기 정책이다. 완화할 경우 `/manage` 목록 화면이 이미 복수를
  전제하므로 제한 검사만 풀면 된다.
- 토큰 저장 대상을 노래책 소유자로 한정했다. 시청자 토큰은 사용처가 없어 저장하지 않는다.
  이 정책을 완화하면 유출면이 사용자 수만큼 커지므로, 새 용도가 생기기 전에는 유지한다.
