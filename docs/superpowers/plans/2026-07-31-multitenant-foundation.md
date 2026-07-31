# 멀티테넌트 기반 (DB·치지직 클라이언트·세션·인가) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노래책 서비스를 멀티테넌트로 전환하기 위한 기반을 세운다 — Supabase 스키마, 치지직 Open API 클라이언트 확장, DB 기반 세션, 암호화 토큰 저장, 인가 모듈.

**Architecture:** 브라우저는 Supabase를 전혀 모른다. 모든 DB 접근은 Next.js Route Handler에서 `sb_secret_` 키로만 이루어지고, 인가는 `lib/authz.js` 한 곳에 모인다. 모든 테이블은 RLS enable + 정책 0개(deny-all)로 심층방어를 건다. 치지직 토큰은 AES-256-GCM으로 암호화해 저장하되 키는 환경변수에 두어 DB와 분리한다.

**Tech Stack:** Next.js 15.5 (App Router, JS/JSX), Node 22, pnpm, Supabase (Postgres + Storage), vitest

**설계 근거:** `docs/superpowers/specs/2026-07-31-multitenant-songbook-design.md`

**이 계획의 범위:** 스펙 구현순서 1~3단계. 노래책·곡·업로드는 계획 2, 매니저 동기화·공개 페이지는 계획 3에서 다룬다.

## Global Constraints

- **패키지 매니저는 pnpm.** `package-lock.json` 은 삭제하고 `pnpm-lock.yaml` 을 커밋한다. 모든 명령은 `pnpm` 을 쓴다.
- **새 의존성은 이 계획에서 2개만 추가한다** — `@supabase/supabase-js`(런타임), `vitest`(dev). 그 외 패키지 추가 금지.
- **`NEXT_PUBLIC_` 접두사 환경변수를 하나도 만들지 않는다.** 이 접두사가 붙으면 값이 브라우저로 전송된다.
- **언어는 JavaScript.** 프로젝트에 TypeScript가 없다(`jsconfig.json`, `.jsx`). `.ts` 파일을 만들지 않는다.
- **경로 별칭은 `@/`** → 프로젝트 루트 (`jsconfig.json` 의 `paths`).
- **주석·에러 메시지·UI 문구는 한국어.** 기존 코드베이스 관례를 따른다.
- **커밋 메시지에 AI 작성 표시(`Co-Authored-By`, `Generated with` 등)를 절대 넣지 않는다.**
- **치지직 Open API 공통 응답 봉투:** 성공 `{"code":200,"message":null,"content":{...}}`, 실패 `{"code":integer,"message":string}`.
- **암호화 저장 형식:** `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`
- **slug 형식:** `^[a-z0-9][a-z0-9_-]{1,29}$`
- **세션 수명 30일**, 남은 기간 7일 미만이면 접근 시 30일로 연장.

## File Structure

| 파일 | 책임 |
|---|---|
| `lib/env.js` (신규) | 필수 환경변수 검증. 프로덕션에서 누락 시 즉시 throw |
| `lib/crypto.js` (신규) | AES-256-GCM 암·복호화. 다른 책임 없음 |
| `lib/db/client.js` (신규) | Supabase 서버 클라이언트 싱글턴 |
| `lib/db/users.js` (신규) | `users` 조회·upsert·placeholder 생성 |
| `lib/db/tokens.js` (신규) | `user_tokens` 암호화 저장·조회·갱신 락 |
| `lib/db/sessions.js` (신규) | `sessions` 생성·검증·폐기·연장 |
| `lib/chzzk.js` (수정) | 치지직 Open API 클라이언트. 봉투 해제·검증 포함 |
| `lib/session.js` (수정) | 쿠키 서명/검증만 담당. 세션 내용은 `lib/db/sessions.js` |
| `lib/authz.js` (신규) | 인가 판정 단일 창구 |
| `supabase/migrations/*.sql` (신규) | 스키마 |
| `vitest.config.js` (신규) | 테스트 설정 |
| `tests/**` (신규) | 테스트 |

`lib/db/` 를 모듈별로 쪼갠 이유: 한 파일에 모든 쿼리를 넣으면 계획 2·3에서 노래책·곡·멤버 쿼리가 붙으면서 걷잡을 수 없이 커진다. 테이블 묶음별로 하나씩 둔다.

## 테스트 실행 환경

테스트는 두 종류다.

- **순수 단위 테스트** — `lib/crypto.js`, `lib/chzzk.js`, `lib/env.js`, `lib/session.js`. DB가 필요 없고 어디서나 돈다. `pnpm test` 로 실행.
- **DB 통합 테스트** — `lib/db/*`, `lib/authz.js`. **운영과 분리된 별도 Supabase 프로젝트**가 필요하다. `.env.test` 에 그 프로젝트 정보를 넣고 `pnpm test:db` 로 실행한다. `.env.test` 가 없으면 해당 테스트는 자동 skip되어 `pnpm test` 는 항상 통과한다.

운영 DB를 테스트에 쓰지 않는다. 테스트가 테이블을 비우기 때문이다.

---

### Task 1: pnpm 통일 + vitest 도입

**Files:**
- Delete: `package-lock.json`
- Modify: `package.json`
- Create: `vitest.config.js`
- Create: `tests/smoke.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 없음
- Produces: `pnpm test` (단위), `pnpm test:db` (DB 통합) 스크립트. 이후 모든 Task가 이 명령으로 검증한다.

- [ ] **Step 1: 락파일 정리**

`package-lock.json` 과 `pnpm-lock.yaml` 이 공존하면 설치 도구에 따라 의존성 버전이 갈린다. pnpm으로 통일한다.

```bash
rm package-lock.json
pnpm install
```

- [ ] **Step 2: vitest 설치**

```bash
pnpm add -D vitest
```

- [ ] **Step 3: `.gitignore` 에 `.env.test` 추가**

`.gitignore` 의 `.env.local` 줄 바로 아래에 추가한다:

```
.env.test
```

- [ ] **Step 4: `vitest.config.js` 작성**

```js
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd()) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    // DB 통합 테스트는 .env.test 가 있을 때만 돈다 (tests/helpers/db.js 에서 skip 처리)
    setupFiles: ["tests/helpers/setup.js"],
  },
});
```

- [ ] **Step 5: `tests/helpers/setup.js` 작성**

```js
// .env.test 가 있으면 읽어 process.env 에 넣는다. 없으면 조용히 넘어간다.
// dotenv 의존성을 추가하지 않기 위해 직접 파싱한다.
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), ".env.test");
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
```

- [ ] **Step 6: `package.json` 스크립트 추가**

`scripts` 를 아래로 교체한다:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run --exclude 'tests/db/**'",
    "test:db": "vitest run tests/db",
    "test:watch": "vitest"
  },
```

- [ ] **Step 7: 스모크 테스트 작성**

`tests/smoke.test.js`:

```js
import { describe, it, expect } from "vitest";

describe("테스트 환경", () => {
  it("경로 별칭 @/ 가 동작한다", async () => {
    const mod = await import("@/data/genres");
    expect(mod).toBeTruthy();
  });
});
```

- [ ] **Step 8: 테스트 실행**

Run: `pnpm test`
Expected: PASS (1 test)

- [ ] **Step 9: 빌드가 여전히 통과하는지 확인**

Run: `pnpm build`
Expected: 성공. 라우트 목록이 출력된다.

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "chore: pnpm으로 패키지 매니저 통일하고 vitest 도입"
```

---

### Task 2: 환경변수 검증 모듈

**Files:**
- Create: `lib/env.js`
- Create: `tests/env.test.js`
- Modify: `.env.example`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `requireEnv(name: string): string` — 값이 없으면 throw
  - `optionalEnv(name: string): string | undefined`
  - `isProduction(): boolean`
  - `assertProductionEnv(): void` — 프로덕션 필수 변수 일괄 검증

현재 `lib/session.js` 는 `SESSION_SECRET` 이 없으면 `"dev-only-secret-change-me"` 를 쓴다. 프로덕션에서 이 값이 쓰이면 누구나 세션을 위조할 수 있다. 그래서 부팅 시 검증이 필요하다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/env.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireEnv, optionalEnv, assertProductionEnv } from "@/lib/env";

describe("lib/env", () => {
  const saved = { ...process.env };
  beforeEach(() => { process.env = { ...saved }; });
  afterEach(() => { process.env = { ...saved }; });

  it("requireEnv는 값이 있으면 그 값을 준다", () => {
    process.env.SOME_KEY = "hello";
    expect(requireEnv("SOME_KEY")).toBe("hello");
  });

  it("requireEnv는 값이 없으면 변수 이름을 담아 throw한다", () => {
    delete process.env.SOME_KEY;
    expect(() => requireEnv("SOME_KEY")).toThrow(/SOME_KEY/);
  });

  it("requireEnv는 빈 문자열을 없는 것으로 취급한다", () => {
    process.env.SOME_KEY = "   ";
    expect(() => requireEnv("SOME_KEY")).toThrow(/SOME_KEY/);
  });

  it("optionalEnv는 없으면 undefined를 준다", () => {
    delete process.env.SOME_KEY;
    expect(optionalEnv("SOME_KEY")).toBeUndefined();
  });

  it("프로덕션에서 SESSION_SECRET이 없으면 throw한다", () => {
    process.env.NODE_ENV = "production";
    process.env.TOKEN_ENCRYPTION_KEY = "x";
    process.env.SUPABASE_URL = "x";
    process.env.SUPABASE_SECRET_KEY = "x";
    delete process.env.SESSION_SECRET;
    expect(() => assertProductionEnv()).toThrow(/SESSION_SECRET/);
  });

  it("프로덕션에서 TOKEN_ENCRYPTION_KEY가 없으면 throw한다", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "x";
    process.env.SUPABASE_URL = "x";
    process.env.SUPABASE_SECRET_KEY = "x";
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => assertProductionEnv()).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("개발 환경에서는 assertProductionEnv가 통과한다", () => {
    process.env.NODE_ENV = "development";
    delete process.env.SESSION_SECRET;
    expect(() => assertProductionEnv()).not.toThrow();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test tests/env.test.js`
Expected: FAIL — `Cannot find module '@/lib/env'`

- [ ] **Step 3: 구현**

`lib/env.js`:

```js
// 환경변수 검증. 프로덕션에서 필수 변수가 비면 부팅을 막는다.
// 기본값으로 조용히 넘어가면 운영에서 위조 가능한 세션이 발급된다.

const PRODUCTION_REQUIRED = [
  "SESSION_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
];

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function optionalEnv(name) {
  const value = process.env[name];
  if (value == null || value.trim() === "") return undefined;
  return value;
}

export function requireEnv(name) {
  const value = optionalEnv(name);
  if (value === undefined) {
    throw new Error(`환경변수 ${name}가 설정되지 않았습니다.`);
  }
  return value;
}

export function assertProductionEnv() {
  if (!isProduction()) return;
  const missing = PRODUCTION_REQUIRED.filter((name) => optionalEnv(name) === undefined);
  if (missing.length > 0) {
    throw new Error(`프로덕션 필수 환경변수가 없습니다: ${missing.join(", ")}`);
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `pnpm test tests/env.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: `.env.example` 갱신**

`.env.example` 을 아래 내용으로 교체한다:

```
# 치지직 개발자센터에서 앱 등록 후 발급
# 주의: 애플리케이션 ID·이름에 chzzk / 치지직 / naver / 네이버 를 포함할 수 없다.
# 필요한 API Scope: 유저 정보 조회, 채널 관리자 조회
CHZZK_CLIENT_ID=
CHZZK_CLIENT_SECRET=
# 앱 등록 시 지정한 리다이렉트 URI (예: http://localhost:3000/api/auth/callback)
CHZZK_REDIRECT_URI=

# 세션 쿠키 서명 키. 프로덕션에서 없으면 부팅 실패.
# 생성: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
SESSION_SECRET=

# 치지직 토큰 암호화 키. 32바이트 base64. 프로덕션에서 없으면 부팅 실패.
# 생성: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
TOKEN_ENCRYPTION_KEY=

# Supabase. SECRET_KEY는 sb_secret_... 서버 전용 키다.
# NEXT_PUBLIC_ 접두사를 절대 붙이지 말 것 — 붙이면 브라우저로 전송된다.
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

- [ ] **Step 6: 커밋**

```bash
git add lib/env.js tests/env.test.js .env.example
git commit -m "feat: 환경변수 검증 모듈 추가"
```

---

### Task 3: AES-256-GCM 암·복호화

**Files:**
- Create: `lib/crypto.js`
- Create: `tests/crypto.test.js`

**Interfaces:**
- Consumes: `requireEnv` from `@/lib/env`
- Produces:
  - `encryptSecret(plaintext: string): string` — `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>` 반환
  - `decryptSecret(stored: string): string` — 변조·형식오류·키불일치 시 throw

GCM을 쓰는 이유: 인증 태그가 붙어 **변조를 탐지한다.** CBC 같은 모드는 조용히 쓰레기를 복호화한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/crypto.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

const KEY = crypto.randomBytes(32).toString("base64");

describe("lib/crypto", () => {
  beforeEach(() => { process.env.TOKEN_ENCRYPTION_KEY = KEY; });

  it("암호화한 값을 그대로 복호화한다", () => {
    const secret = "FFok65zQFQVcFvH2eJ7SS7SBFlTXt0EZ10L5abcdefgh";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("한글과 긴 문자열도 왕복한다", () => {
    const secret = "리프레시토큰-".repeat(50);
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("v1: 접두사와 4개 구획으로 저장된다", () => {
    const parts = encryptSecret("hello").split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("같은 평문도 매번 다른 암호문이 된다 (IV 랜덤)", () => {
    expect(encryptSecret("hello")).not.toBe(encryptSecret("hello"));
  });

  it("ciphertext가 변조되면 복호화가 실패한다", () => {
    const [v, iv, tag, ct] = encryptSecret("hello").split(":");
    const broken = Buffer.from(ct, "base64");
    broken[0] = broken[0] ^ 0xff;
    expect(() => decryptSecret(`${v}:${iv}:${tag}:${broken.toString("base64")}`)).toThrow();
  });

  it("인증 태그가 변조되면 복호화가 실패한다", () => {
    const [v, iv, tag, ct] = encryptSecret("hello").split(":");
    const broken = Buffer.from(tag, "base64");
    broken[0] = broken[0] ^ 0xff;
    expect(() => decryptSecret(`${v}:${iv}:${broken.toString("base64")}:${ct}`)).toThrow();
  });

  it("다른 키로는 복호화되지 않는다", () => {
    const stored = encryptSecret("hello");
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("알 수 없는 버전 접두사는 거부한다", () => {
    const stored = encryptSecret("hello").replace(/^v1:/, "v9:");
    expect(() => decryptSecret(stored)).toThrow(/형식/);
  });

  it("형식이 깨진 값은 거부한다", () => {
    expect(() => decryptSecret("아무거나")).toThrow(/형식/);
  });

  it("키가 32바이트가 아니면 거부한다", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(() => encryptSecret("hello")).toThrow(/32바이트/);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test tests/crypto.test.js`
Expected: FAIL — `Cannot find module '@/lib/crypto'`

- [ ] **Step 3: 구현**

`lib/crypto.js`:

```js
// 치지직 토큰 등 민감값의 대칭 암호화. AES-256-GCM.
// 키는 환경변수(TOKEN_ENCRYPTION_KEY)에, 암호문은 DB에 둔다.
// 둘이 분리되어 있으므로 DB가 통째로 유출되어도 복호화되지 않는다.
import crypto from "node:crypto";
import { requireEnv } from "@/lib/env";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM 권장값

function loadKey() {
  const key = Buffer.from(requireEnv("TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY는 base64로 인코딩된 32바이트여야 합니다.");
  }
  return key;
}

export function encryptSecret(plaintext) {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(stored) {
  const parts = String(stored ?? "").split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("암호문 형식이 올바르지 않습니다.");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    loadKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  // 변조·키불일치는 final()에서 인증 태그 검증 실패로 throw된다.
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `pnpm test tests/crypto.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/crypto.js tests/crypto.test.js
git commit -m "feat: AES-256-GCM 암복호화 모듈 추가"
```

---

### Task 4: Supabase 스키마 마이그레이션

**Files:**
- Create: `supabase/migrations/0001_initial_schema.sql`
- Create: `docs/SETUP.md`

**Interfaces:**
- Consumes: 없음
- Produces: 8개 테이블 (`users`, `user_tokens`, `songbooks`, `songbook_members`, `songbook_invites`, `songs`, `songbook_slug_history`, `sessions`). 이후 모든 Task가 이 스키마를 전제한다.

**스펙과 다른 점 — 갱신 락:** 스펙은 `SELECT ... FOR UPDATE` 를 적었으나 supabase-js는 PostgREST 위에서 동작해 행 잠금을 걸 수 없다. 대신 `user_tokens.refresh_lock_until` 컬럼에 조건부 UPDATE로 락을 선점한다(Task 8). 그래서 아래 스키마에 해당 컬럼이 있다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/0001_initial_schema.sql`:

```sql
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
```

- [ ] **Step 2: Supabase 프로젝트 2개 준비 (운영·테스트)**

Vercel Marketplace로 Supabase를 붙이면 운영 프로젝트의 환경변수가 자동 주입된다. 테스트용은 별도 프로젝트를 하나 더 만든다. 각 프로젝트 대시보드의 **SQL Editor** 에 위 SQL을 붙여 실행한다.

Supabase CLI가 설치돼 있다면 대신 아래로 적용해도 된다:

```bash
supabase --version          # 없으면 SQL Editor 경로를 쓴다
supabase link --project-ref <ref>
supabase db push
```

- [ ] **Step 3: 테이블 8개와 RLS 상태 확인**

각 프로젝트 SQL Editor에서 실행:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

Expected: 8행, 모두 `rowsecurity = true`

```sql
select count(*) from pg_policies where schemaname = 'public';
```

Expected: `0` (정책이 하나도 없어야 deny-all)

- [ ] **Step 4: `.env.test` 작성 (커밋하지 않는다)**

프로젝트 루트에 `.env.test` 를 만든다. Task 1 Step 3에서 `.gitignore` 에 추가했다.

```
SUPABASE_URL=https://<test-project-ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
TOKEN_ENCRYPTION_KEY=<위와 같은 방법으로 생성한 다른 값>
```

- [ ] **Step 5: `docs/SETUP.md` 작성**

````markdown
# 개발 환경 설정

## 필요한 것

- Node 22 이상
- pnpm 10 이상
- Supabase 프로젝트 2개 (운영용, 테스트용)
- 치지직 개발자센터 애플리케이션

## 치지직 애플리케이션 등록

1. 치지직 개발자센터에서 앱을 등록한다.
   **애플리케이션 ID·이름에 `chzzk`, `치지직`, `naver`, `네이버` 를 포함할 수 없다.**
2. API Scope에 `유저 정보 조회` 와 `채널 관리자 조회` 를 포함한다.
3. 로그인 리디렉션 URL에 `http://localhost:3000/api/auth/callback` 을 등록한다.
4. 최근 90일간 API Scope 사용량이 0이면 애플리케이션이 삭제되니 주의한다.

## Supabase

프로젝트 2개를 만들고, 각각의 SQL Editor에서
`supabase/migrations/0001_initial_schema.sql` 을 실행한다.

- 운영용 → `.env` 의 `SUPABASE_URL` / `SUPABASE_SECRET_KEY`
- 테스트용 → `.env.test` 의 같은 변수

키는 대시보드 Settings → API Keys의 **secret key**(`sb_secret_...`)를 쓴다.
이 키는 RLS를 우회하므로 절대 클라이언트로 내보내지 않는다.
`NEXT_PUBLIC_` 접두사를 붙이면 브라우저로 전송되므로 붙이지 않는다.

> **값은 따옴표 없이 적는다.** `KEY=값` 이지 `KEY="값"` 이 아니다.
> `.env.test` 파서(`tests/helpers/setup.js`)는 따옴표를 벗기지 않으므로,
> 따옴표를 붙이면 값에 그대로 섞여 들어가 인증이 실패한다.

## 실행

```bash
pnpm install
cp .env.example .env    # 값 채우기
pnpm dev
```

## 테스트

```bash
pnpm test        # 단위 테스트. DB 불필요
pnpm test:db     # DB 통합 테스트. .env.test 필요
```
````

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/0001_initial_schema.sql docs/SETUP.md .gitignore
git commit -m "feat: 멀티테넌트 초기 스키마와 개발 환경 문서 추가"
```

---

### Task 5: 치지직 클라이언트 — 공통 응답 봉투 검증

**Files:**
- Modify: `lib/chzzk.js`
- Create: `tests/chzzk-envelope.test.js`

**Interfaces:**
- Consumes: `optionalEnv` from `@/lib/env`
- Produces:
  - `ChzzkApiError` (class) — `.status`, `.code`, `.message`
  - `exchangeCodeForToken({ code, state }): Promise<{accessToken, refreshToken, tokenType, expiresIn}>`
  - `fetchMe(accessToken): Promise<{channelId, channelName}>`
  - `isConfigured(): boolean`, `buildAuthorizeUrl({redirectUri, state}): string` (기존 유지)

기존 코드의 `json.content ?? json` 은 봉투가 바뀌면 `undefined` 를 조용히 흘려보내 빈 `channelId` 가 세션에 저장된다. 기대 필드 검증을 넣는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/chzzk-envelope.test.js`:

```js
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { exchangeCodeForToken, fetchMe, ChzzkApiError } from "@/lib/chzzk";

function mockFetch(status, body) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("치지직 공통 응답 봉투", () => {
  beforeEach(() => {
    process.env.CHZZK_CLIENT_ID = "cid";
    process.env.CHZZK_CLIENT_SECRET = "csecret";
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("content 봉투를 벗겨 토큰을 준다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {
      code: 200, message: null,
      content: { accessToken: "AT", refreshToken: "RT", tokenType: "Bearer", expiresIn: "86400" },
    }));
    const token = await exchangeCodeForToken({ code: "c", state: "s" });
    expect(token.accessToken).toBe("AT");
    expect(token.refreshToken).toBe("RT");
    expect(token.expiresIn).toBe(86400); // 숫자로 정규화
  });

  it("봉투 없이 평평하게 와도 수용한다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {
      accessToken: "AT", refreshToken: "RT", tokenType: "Bearer", expiresIn: "86400",
    }));
    const token = await exchangeCodeForToken({ code: "c", state: "s" });
    expect(token.accessToken).toBe("AT");
  });

  it("code가 200이 아니면 ChzzkApiError를 던진다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { code: 401, message: "INVALID_CLIENT" }));
    await expect(exchangeCodeForToken({ code: "c", state: "s" }))
      .rejects.toThrow(ChzzkApiError);
  });

  it("기대 필드가 없으면 undefined를 흘리지 않고 실패한다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { code: 200, message: null, content: {} }));
    await expect(exchangeCodeForToken({ code: "c", state: "s" }))
      .rejects.toThrow(/accessToken/);
  });

  it("HTTP 오류는 상태코드를 담아 던진다", async () => {
    vi.stubGlobal("fetch", mockFetch(500, { code: 500, message: "INTERNAL_SERVER_ERROR" }));
    await expect(exchangeCodeForToken({ code: "c", state: "s" }))
      .rejects.toMatchObject({ status: 500 });
  });

  it("fetchMe는 channelId와 channelName을 준다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {
      code: 200, message: null,
      content: { channelId: "abc123", channelName: "새벽감자" },
    }));
    const me = await fetchMe("AT");
    expect(me).toEqual({ channelId: "abc123", channelName: "새벽감자" });
  });

  it("fetchMe에 channelId가 없으면 실패한다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {
      code: 200, message: null, content: { channelName: "새벽감자" },
    }));
    await expect(fetchMe("AT")).rejects.toThrow(/channelId/);
  });

  it("fetchMe는 Bearer 접두사와 공백을 정확히 붙인다", async () => {
    const f = mockFetch(200, { code: 200, content: { channelId: "a", channelName: "b" } });
    vi.stubGlobal("fetch", f);
    await fetchMe("AT");
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer AT");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test tests/chzzk-envelope.test.js`
Expected: FAIL — `ChzzkApiError` is not exported

- [ ] **Step 3: `lib/chzzk.js` 를 아래 내용으로 교체**

```js
// 치지직 OpenAPI 클라이언트
// 문서: https://chzzk.gitbook.io/chzzk
//
// 공통 응답 봉투 (chzzk-api/tips 문서 기준)
//   성공: { "code": 200, "message": null, "content": {responseBody} }
//   실패: { "code": integer, "message": string }
import { optionalEnv } from "@/lib/env";

const AUTHORIZE_URL = "https://chzzk.naver.com/account-interlock"; // Open API와 다른 도메인
const API_BASE = "https://openapi.chzzk.naver.com";

export class ChzzkApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "ChzzkApiError";
    this.status = status;
    this.code = code;
  }
}

export function isConfigured() {
  return Boolean(optionalEnv("CHZZK_CLIENT_ID") && optionalEnv("CHZZK_CLIENT_SECRET"));
}

export function buildAuthorizeUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    clientId: process.env.CHZZK_CLIENT_ID,
    redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

// 공통 봉투를 벗긴다. 인증 엔드포인트의 raw JSON 예시가 문서에 없어
// 봉투가 없는 형태도 함께 수용하되, 기대 필드는 반드시 검증한다.
async function unwrap(res, { context }) {
  let json;
  try {
    json = await res.json();
  } catch {
    throw new ChzzkApiError(`${context}: 응답을 JSON으로 읽지 못했습니다.`, { status: res.status });
  }

  if (!res.ok) {
    throw new ChzzkApiError(`${context}: ${json?.message ?? "요청 실패"}`, {
      status: res.status,
      code: json?.code,
    });
  }
  if (json?.code != null && Number(json.code) !== 200) {
    throw new ChzzkApiError(`${context}: ${json?.message ?? "요청 실패"}`, {
      status: res.status,
      code: Number(json.code),
    });
  }
  return json?.content ?? json;
}

function requireFields(obj, fields, context) {
  for (const field of fields) {
    if (obj?.[field] == null || obj[field] === "") {
      throw new ChzzkApiError(`${context}: 응답에 ${field}가 없습니다.`);
    }
  }
  return obj;
}

function toToken(content, context) {
  requireFields(content, ["accessToken", "refreshToken"], context);
  return {
    accessToken: content.accessToken,
    refreshToken: content.refreshToken,
    tokenType: content.tokenType ?? "Bearer",
    // 문서상 String("86400")으로 오므로 숫자로 정규화한다.
    expiresIn: Number(content.expiresIn ?? 86400),
  };
}

export async function exchangeCodeForToken({ code, state }) {
  const res = await fetch(`${API_BASE}/auth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "authorization_code",
      clientId: process.env.CHZZK_CLIENT_ID,
      clientSecret: process.env.CHZZK_CLIENT_SECRET,
      code,
      state,
    }),
  });
  const content = await unwrap(res, { context: "토큰 발급" });
  return toToken(content, "토큰 발급");
}

export async function fetchMe(accessToken) {
  const res = await fetch(`${API_BASE}/open/v1/users/me`, {
    // Bearer와 토큰 사이 공백이 빠지면 인증이 실패한다 (문서 주의사항).
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const content = await unwrap(res, { context: "유저 정보 조회" });
  requireFields(content, ["channelId", "channelName"], "유저 정보 조회");
  return { channelId: content.channelId, channelName: content.channelName };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `pnpm test tests/chzzk-envelope.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/chzzk.js tests/chzzk-envelope.test.js
git commit -m "feat: 치지직 공통 응답 봉투 검증 추가"
```

---

### Task 6: 치지직 클라이언트 — 갱신·폐기·채널·관리자 조회

**Files:**
- Modify: `lib/chzzk.js`
- Create: `tests/chzzk-api.test.js`

**Interfaces:**
- Consumes: Task 5의 `unwrap`, `toToken`, `requireFields`, `ChzzkApiError`
- Produces:
  - `refreshAccessToken(refreshToken): Promise<{accessToken, refreshToken, tokenType, expiresIn}>`
  - `revokeToken({ token, tokenTypeHint }): Promise<void>`
  - `fetchChannels(channelIds: string[]): Promise<Array<{channelId, channelName, channelImageUrl, verifiedMark, followerCount}>>` — 20개씩 자동 분할
  - `fetchStreamingRoles(accessToken): Promise<Array<{managerChannelId, managerChannelName, userRole}>>`

`fetchChannels` 는 **Client 인증**(`Client-Id`/`Client-Secret` 헤더)이라 사용자 토큰이 필요 없다. 로그인한 적 없는 채널의 정보도 조회할 수 있어 계획 3의 매니저 동기화에서 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/chzzk-api.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  refreshAccessToken, revokeToken, fetchChannels, fetchStreamingRoles,
} from "@/lib/chzzk";

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("치지직 API 확장", () => {
  beforeEach(() => {
    process.env.CHZZK_CLIENT_ID = "cid";
    process.env.CHZZK_CLIENT_SECRET = "csecret";
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("refreshAccessToken은 grantType refresh_token으로 보낸다", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, {
      code: 200,
      content: { accessToken: "AT2", refreshToken: "RT2", tokenType: "Bearer", expiresIn: "86400" },
    }));
    vi.stubGlobal("fetch", f);
    const token = await refreshAccessToken("RT1");
    expect(JSON.parse(f.mock.calls[0][1].body).grantType).toBe("refresh_token");
    expect(JSON.parse(f.mock.calls[0][1].body).refreshToken).toBe("RT1");
    // 리프레시 토큰은 일회용이므로 새 값이 반드시 나와야 한다.
    expect(token.refreshToken).toBe("RT2");
  });

  it("refreshAccessToken 응답에 새 refreshToken이 없으면 실패한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(200, {
      code: 200, content: { accessToken: "AT2", tokenType: "Bearer", expiresIn: "86400" },
    })));
    await expect(refreshAccessToken("RT1")).rejects.toThrow(/refreshToken/);
  });

  it("revokeToken은 clientId/secret/token을 보낸다", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { code: 200, content: null }));
    vi.stubGlobal("fetch", f);
    await revokeToken({ token: "AT", tokenTypeHint: "access_token" });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toMatchObject({ clientId: "cid", clientSecret: "csecret", token: "AT", tokenTypeHint: "access_token" });
  });

  it("fetchChannels는 Client 인증 헤더를 쓴다 (Authorization 아님)", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, {
      code: 200, content: { data: [{ channelId: "a", channelName: "가", channelImageUrl: "u", verifiedMark: true, followerCount: 1 }] },
    }));
    vi.stubGlobal("fetch", f);
    await fetchChannels(["a"]);
    const headers = f.mock.calls[0][1].headers;
    expect(headers["Client-Id"]).toBe("cid");
    expect(headers["Client-Secret"]).toBe("csecret");
    expect(headers.Authorization).toBeUndefined();
  });

  it("fetchChannels는 20개를 넘으면 나눠서 호출한다", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { code: 200, content: { data: [] } }));
    vi.stubGlobal("fetch", f);
    await fetchChannels(Array.from({ length: 45 }, (_, i) => `c${i}`));
    expect(f).toHaveBeenCalledTimes(3); // 20 + 20 + 5
  });

  it("fetchChannels는 빈 배열이면 호출하지 않는다", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await fetchChannels([])).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("fetchChannels는 여러 호출 결과를 합쳐 준다", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(jsonRes(200, { code: 200, content: { data: [{ channelId: "a", channelName: "가" }] } }))
      .mockResolvedValueOnce(jsonRes(200, { code: 200, content: { data: [{ channelId: "b", channelName: "나" }] } }));
    vi.stubGlobal("fetch", f);
    const rows = await fetchChannels(Array.from({ length: 21 }, (_, i) => `c${i}`));
    expect(rows.map((r) => r.channelId)).toEqual(["a", "b"]);
  });

  it("fetchStreamingRoles는 Access Token 인증을 쓰고 목록을 준다", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, {
      code: 200,
      content: { data: [
        { managerChannelId: "m1", managerChannelName: "매니저", userRole: "STREAMING_CHANNEL_MANAGER" },
        { managerChannelId: "o1", managerChannelName: "주인", userRole: "STREAMING_CHANNEL_OWNER" },
      ] },
    }));
    vi.stubGlobal("fetch", f);
    const roles = await fetchStreamingRoles("AT");
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer AT");
    expect(roles).toHaveLength(2); // 필터링은 호출자(계획 3)의 책임
  });

  it("fetchStreamingRoles는 401을 status 401로 전달한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(401, { code: 401, message: "INVALID_TOKEN" })));
    await expect(fetchStreamingRoles("AT")).rejects.toMatchObject({ status: 401 });
  });

  it("data가 없으면 빈 배열을 준다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(200, { code: 200, content: {} })));
    expect(await fetchStreamingRoles("AT")).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test tests/chzzk-api.test.js`
Expected: FAIL — `refreshAccessToken` is not exported

- [ ] **Step 3: `lib/chzzk.js` 끝에 추가**

```js
const CHANNELS_BATCH = 20; // 문서상 최대 20개

function clientAuthHeaders() {
  return {
    "Client-Id": process.env.CHZZK_CLIENT_ID,
    "Client-Secret": process.env.CHZZK_CLIENT_SECRET,
    "Content-Type": "application/json",
  };
}

// 액세스 토큰 갱신. 리프레시 토큰은 일회용이므로 응답의 새 refreshToken을
// 반드시 저장해야 한다. 저장하지 않으면 다음 갱신이 영구히 실패한다.
export async function refreshAccessToken(refreshToken) {
  const res = await fetch(`${API_BASE}/auth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "refresh_token",
      refreshToken,
      clientId: process.env.CHZZK_CLIENT_ID,
      clientSecret: process.env.CHZZK_CLIENT_SECRET,
    }),
  });
  const content = await unwrap(res, { context: "토큰 갱신" });
  return toToken(content, "토큰 갱신");
}

// 토큰 폐기. clientId와 user가 같은 모든 토큰이 제거되므로
// 일반 로그아웃이 아니라 연동 해제에서만 호출한다.
export async function revokeToken({ token, tokenTypeHint = "access_token" }) {
  const res = await fetch(`${API_BASE}/auth/v1/token/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.CHZZK_CLIENT_ID,
      clientSecret: process.env.CHZZK_CLIENT_SECRET,
      token,
      tokenTypeHint,
    }),
  });
  await unwrap(res, { context: "토큰 폐기" });
}

// 채널 정보 조회. Client 인증이라 사용자 토큰이 필요 없다.
// 한 번도 로그인한 적 없는 채널의 이름·이미지·인증마크도 가져올 수 있다.
export async function fetchChannels(channelIds) {
  const ids = [...new Set(channelIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const rows = [];
  for (let i = 0; i < ids.length; i += CHANNELS_BATCH) {
    const batch = ids.slice(i, i + CHANNELS_BATCH);
    const params = new URLSearchParams({ channelIds: batch.join(",") });
    const res = await fetch(`${API_BASE}/open/v1/channels?${params}`, {
      headers: clientAuthHeaders(),
    });
    const content = await unwrap(res, { context: "채널 정보 조회" });
    rows.push(...(content?.data ?? []));
  }
  return rows;
}

// 채널 관리자 조회. Access Token 주인의 채널 관리자 목록을 반환한다.
// STREAMING_CHANNEL_OWNER 필터링은 호출자가 한다.
export async function fetchStreamingRoles(accessToken) {
  const res = await fetch(`${API_BASE}/open/v1/channels/streaming-roles`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const content = await unwrap(res, { context: "채널 관리자 조회" });
  return content?.data ?? [];
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `pnpm test tests/chzzk-api.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: 전체 단위 테스트 확인**

Run: `pnpm test`
Expected: PASS (전체)

- [ ] **Step 6: 커밋**

```bash
git add lib/chzzk.js tests/chzzk-api.test.js
git commit -m "feat: 치지직 토큰 갱신·폐기와 채널·관리자 조회 추가"
```

---

### Task 7: Supabase 클라이언트 + users 저장소

**Files:**
- Create: `lib/db/client.js`
- Create: `lib/db/users.js`
- Create: `tests/helpers/db.js`
- Create: `tests/db/users.test.js`

**Interfaces:**
- Consumes: `requireEnv` from `@/lib/env`
- Produces:
  - `getDb(): SupabaseClient` (from `lib/db/client.js`)
  - `upsertUserFromLogin({ chzzkChannelId, chzzkChannelName }): Promise<User>`
  - `ensurePlaceholderUsers(channels: Array<{channelId, channelName, channelImageUrl?, verifiedMark?}>): Promise<User[]>`
  - `findUserById(id): Promise<User|null>`
  - `findUserByChannelId(chzzkChannelId): Promise<User|null>`
  - `User` = `{ id, chzzkChannelId, chzzkChannelName, chzzkChannelImage, chzzkVerified, role, createdAt, lastLoginAt }`

DB 행은 snake_case, 애플리케이션은 camelCase다. 변환은 각 저장소 모듈이 책임진다.

- [ ] **Step 1: 테스트 헬퍼 작성**

`tests/helpers/db.js`:

```js
import { describe } from "vitest";

// .env.test 가 없으면 DB 통합 테스트를 통째로 건너뛴다.
// 이렇게 해야 DB 없이도 pnpm test 가 항상 통과한다.
export const describeDb =
  process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? describe : describe.skip;

// FK 역순으로 지운다. PostgREST는 조건 없는 delete를 거부하므로
// 각 테이블의 timestamp 컬럼에 "항상 참"인 조건을 건다.
const TRUNCATE_ORDER = [
  ["sessions", "created_at"],
  ["songbook_slug_history", "released_at"],
  ["songs", "created_at"],
  ["songbook_invites", "created_at"],
  ["songbook_members", "created_at"],
  ["songbooks", "created_at"],
  ["user_tokens", "updated_at"],
  ["users", "created_at"],
];

export async function truncateAll(db) {
  for (const [table, column] of TRUNCATE_ORDER) {
    const { error } = await db.from(table).delete().gt(column, "1970-01-01");
    if (error) throw new Error(`${table} 비우기 실패: ${error.message}`);
  }
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/db/users.test.js`:

```js
import { it, expect, beforeEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import {
  upsertUserFromLogin, ensurePlaceholderUsers, findUserById, findUserByChannelId,
} from "@/lib/db/users";

describeDb("lib/db/users", () => {
  beforeEach(async () => { await truncateAll(getDb()); });

  it("첫 로그인이면 유저를 만들고 lastLoginAt을 채운다", async () => {
    const user = await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "새벽감자" });
    expect(user.id).toBeTruthy();
    expect(user.chzzkChannelName).toBe("새벽감자");
    expect(user.role).toBe("user");
    expect(user.lastLoginAt).toBeTruthy();
  });

  it("재로그인이면 같은 행을 쓰고 닉네임 변경을 반영한다", async () => {
    const first = await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "옛이름" });
    const second = await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "새이름" });
    expect(second.id).toBe(first.id);
    expect(second.chzzkChannelName).toBe("새이름");
  });

  it("placeholder 유저는 lastLoginAt이 null이다", async () => {
    const [user] = await ensurePlaceholderUsers([
      { channelId: "ch2", channelName: "매니저", channelImageUrl: "http://img", verifiedMark: true },
    ]);
    expect(user.lastLoginAt).toBeNull();
    expect(user.chzzkVerified).toBe(true);
    expect(user.chzzkChannelImage).toBe("http://img");
  });

  it("placeholder 유저가 실제로 로그인하면 같은 행에 연결된다", async () => {
    const [placeholder] = await ensurePlaceholderUsers([{ channelId: "ch3", channelName: "매니저" }]);
    const loggedIn = await upsertUserFromLogin({ chzzkChannelId: "ch3", chzzkChannelName: "매니저" });
    expect(loggedIn.id).toBe(placeholder.id);
    expect(loggedIn.lastLoginAt).toBeTruthy();
  });

  it("ensurePlaceholderUsers는 기존 유저의 lastLoginAt을 지우지 않는다", async () => {
    const loggedIn = await upsertUserFromLogin({ chzzkChannelId: "ch4", chzzkChannelName: "주인" });
    const [again] = await ensurePlaceholderUsers([{ channelId: "ch4", channelName: "주인" }]);
    expect(again.id).toBe(loggedIn.id);
    expect(again.lastLoginAt).toBeTruthy();
  });

  it("ensurePlaceholderUsers는 빈 배열이면 빈 배열을 준다", async () => {
    expect(await ensurePlaceholderUsers([])).toEqual([]);
  });

  it("findUserById / findUserByChannelId는 없으면 null을 준다", async () => {
    expect(await findUserById("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await findUserByChannelId("없는채널")).toBeNull();
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `pnpm test:db`
Expected: FAIL — `Cannot find module '@/lib/db/client'`

(`.env.test` 가 없으면 skip으로 나온다. 그 경우 Task 4 Step 4를 먼저 끝낸다.)

- [ ] **Step 4: supabase-js 설치**

```bash
pnpm add @supabase/supabase-js
```

- [ ] **Step 5: `lib/db/client.js` 구현**

```js
// Supabase 서버 클라이언트. sb_secret_ 키를 쓰므로 RLS를 우회한다.
// 이 모듈은 절대 클라이언트 컴포넌트에서 import되면 안 된다.
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

let client = null;

export function getDb() {
  if (client) return client;
  client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// 테스트에서 환경변수를 바꿔 끼울 때 쓴다.
export function resetDb() {
  client = null;
}
```

- [ ] **Step 6: `lib/db/users.js` 구현**

```js
// users 테이블 저장소. DB는 snake_case, 앱은 camelCase.
import { getDb } from "@/lib/db/client";

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    chzzkChannelId: row.chzzk_channel_id,
    chzzkChannelName: row.chzzk_channel_name,
    chzzkChannelImage: row.chzzk_channel_image,
    chzzkVerified: row.chzzk_verified,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function failed(error, what) {
  throw new Error(`${what} 실패: ${error.message}`);
}

// 로그인 시 호출. 닉네임 변경을 반영하고 lastLoginAt을 갱신한다.
export async function upsertUserFromLogin({ chzzkChannelId, chzzkChannelName }) {
  const { data, error } = await getDb()
    .from("users")
    .upsert(
      {
        chzzk_channel_id: chzzkChannelId,
        chzzk_channel_name: chzzkChannelName,
        last_login_at: new Date().toISOString(),
      },
      { onConflict: "chzzk_channel_id" },
    )
    .select()
    .single();
  if (error) failed(error, "유저 저장");
  return toUser(data);
}

// 치지직 관리자 동기화용. 아직 로그인한 적 없는 채널도 users 행을 갖게 한다.
// lastLoginAt은 건드리지 않는다 — 이미 로그인한 유저의 기록을 지우면 안 된다.
export async function ensurePlaceholderUsers(channels) {
  if (!channels || channels.length === 0) return [];
  const rows = channels.map((c) => ({
    chzzk_channel_id: c.channelId,
    chzzk_channel_name: c.channelName,
    chzzk_channel_image: c.channelImageUrl ?? null,
    chzzk_verified: Boolean(c.verifiedMark),
    channel_synced_at: new Date().toISOString(),
  }));
  const { data, error } = await getDb()
    .from("users")
    .upsert(rows, { onConflict: "chzzk_channel_id" })
    .select();
  if (error) failed(error, "채널 유저 저장");
  return data.map(toUser);
}

export async function findUserById(id) {
  const { data, error } = await getDb().from("users").select().eq("id", id).maybeSingle();
  if (error) failed(error, "유저 조회");
  return toUser(data);
}

export async function findUserByChannelId(chzzkChannelId) {
  const { data, error } = await getDb()
    .from("users").select().eq("chzzk_channel_id", chzzkChannelId).maybeSingle();
  if (error) failed(error, "유저 조회");
  return toUser(data);
}
```

- [ ] **Step 7: 테스트가 통과하는지 확인**

Run: `pnpm test:db`
Expected: PASS (7 tests)

- [ ] **Step 8: 커밋**

```bash
git add lib/db/client.js lib/db/users.js tests/helpers/db.js tests/db/users.test.js package.json pnpm-lock.yaml
git commit -m "feat: Supabase 클라이언트와 users 저장소 추가"
```

---

### Task 8: 토큰 저장소 (암호화 + 갱신 락)

**Files:**
- Modify: `vitest.config.js` (Step 0)
- Modify: `lib/db/client.js` (Step 0)
- Create: `lib/db/tokens.js`
- Create: `tests/db/tokens.test.js`

**Interfaces:**
- Consumes: `getDb`, `encryptSecret`/`decryptSecret`, `refreshAccessToken` from `@/lib/chzzk`
- Produces:
  - `saveTokens(userId, { accessToken, refreshToken, expiresIn }): Promise<void>`
  - `deleteTokens(userId): Promise<void>`
  - `getValidAccessToken(userId): Promise<string|null>` — 만료됐으면 갱신하고, 갱신 불가면 행을 지우고 `null`
  - `TokenRefreshBusyError` — 다른 요청이 갱신 중일 때

**갱신 락 방식:** PostgREST는 `SELECT ... FOR UPDATE` 를 지원하지 않으므로, `refresh_lock_until` 에 대한 **조건부 UPDATE** 로 락을 선점한다. 업데이트된 행 수가 0이면 다른 요청이 이미 갱신 중이다. 리프레시 토큰이 일회용이라 이 보호가 없으면 동시 갱신 시 유효한 토큰을 잃는다.

- [ ] **Step 0: 테스트 인프라 결함 두 건 수정**

Task 8을 처음 실행했을 때 드러난 문제다. 둘 다 Task 9~11에서 그대로 재발하므로 여기서 고친다.

**(A) DB 테스트 파일 간 경합.** vitest는 테스트 파일을 기본으로 병렬 실행한다. `tests/db/` 의
파일들은 `beforeEach` 에서 `truncateAll` 로 **같은 실 DB**를 비우므로, 두 파일이 동시에 돌면
서로의 데이터를 지운다. JS 모듈 상태는 파일별로 격리되지만 DB 행은 공유된다. Task 7까지는
DB 테스트 파일이 하나뿐이라 드러나지 않았다.

`vitest.config.js` 의 `test` 블록에 한 줄 추가한다:

```js
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    // DB 테스트가 같은 실 DB를 truncate하므로 파일 병렬 실행을 끈다.
    // 단위 테스트는 수백 ms라 직렬화 비용이 무시할 수준이다.
    fileParallelism: false,
    setupFiles: ["tests/helpers/setup.js"],
  },
```

**(B) `vi.stubGlobal("fetch")` 가 Supabase 쿼리까지 가로챈다.** `@supabase/postgrest-js` 의
`PostgrestBuilder` 는 쿼리를 만들 때마다 그 시점의 전역 `fetch` 를 참조한다
(`src/PostgrestBuilder.ts:140-143` — `builder.fetch` 가 없으면 `this.fetch = fetch`).
`lib/db/client.js` 가 `createClient` 에 fetch를 넘기지 않으므로, 치지직 API를 스텁하려고
전역 `fetch` 를 갈아끼우면 Supabase 쿼리도 그 스텁을 탄다. 스텁 응답에 `.text()` 가 없어
`TypeError: res.text is not a function` 이 나고, "동시 갱신" 테스트의 호출 횟수도 Supabase
쿼리가 섞여 잘못 세어진다.

`lib/db/client.js` 를 아래로 교체한다:

```js
// Supabase 서버 클라이언트. sb_secret_ 키를 쓰므로 RLS를 우회한다.
// 이 모듈은 절대 클라이언트 컴포넌트에서 import되면 안 된다.
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

// postgrest-js는 쿼리를 만들 때마다 그 시점의 전역 fetch를 참조한다.
// 테스트가 치지직 API를 스텁하려고 전역 fetch를 갈아끼우면 Supabase 쿼리까지
// 스텁을 타 버리므로, 모듈 로드 시점의 진짜 fetch를 붙잡아 명시적으로 넘긴다.
const boundFetch = globalThis.fetch.bind(globalThis);

let client = null;

export function getDb() {
  if (client) return client;
  client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: boundFetch },
  });
  return client;
}

// 테스트에서 환경변수를 바꿔 끼울 때 쓴다.
export function resetDb() {
  client = null;
}
```

- [ ] **Step 0b: 수정 후 기존 테스트가 그대로 통과하는지 확인**

Run: `pnpm test`
Expected: 36 passed

Run: `pnpm test:db`
Expected: 7 passed (users만 있는 상태)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/tokens.test.js`:

```js
import { it, expect, beforeEach, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { saveTokens, deleteTokens, getValidAccessToken } from "@/lib/db/tokens";

const DAY = 24 * 60 * 60 * 1000;

describeDb("lib/db/tokens", () => {
  let userId;

  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    await truncateAll(getDb());
    const user = await upsertUserFromLogin({ chzzkChannelId: "owner1", chzzkChannelName: "주인" });
    userId = user.id;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("저장한 토큰을 그대로 돌려준다", async () => {
    await saveTokens(userId, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    expect(await getValidAccessToken(userId)).toBe("AT");
  });

  it("DB에는 평문이 저장되지 않는다", async () => {
    await saveTokens(userId, { accessToken: "AT-비밀", refreshToken: "RT-비밀", expiresIn: 86400 });
    const { data } = await getDb().from("user_tokens").select().eq("user_id", userId).single();
    expect(data.access_token_enc).not.toContain("AT-비밀");
    expect(data.refresh_token_enc).not.toContain("RT-비밀");
    expect(data.access_token_enc.startsWith("v1:")).toBe(true);
  });

  it("토큰이 없으면 null을 준다", async () => {
    expect(await getValidAccessToken(userId)).toBeNull();
  });

  it("액세스 토큰이 만료되면 갱신하고 새 값을 준다", async () => {
    await saveTokens(userId, { accessToken: "AT1", refreshToken: "RT1", expiresIn: 86400 });
    // 만료 시각을 과거로 되돌린다
    await getDb().from("user_tokens")
      .update({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("user_id", userId);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ code: 200, content: { accessToken: "AT2", refreshToken: "RT2", tokenType: "Bearer", expiresIn: "86400" } }),
    }));

    expect(await getValidAccessToken(userId)).toBe("AT2");
  });

  it("갱신하면 새 리프레시 토큰이 저장된다 (일회용 함정)", async () => {
    await saveTokens(userId, { accessToken: "AT1", refreshToken: "RT1", expiresIn: 86400 });
    await getDb().from("user_tokens")
      .update({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("user_id", userId);

    const f = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ code: 200, content: { accessToken: "AT2", refreshToken: "RT2", tokenType: "Bearer", expiresIn: "86400" } }),
    });
    vi.stubGlobal("fetch", f);
    await getValidAccessToken(userId);

    // 다시 만료시키고 두 번째 갱신을 시도하면 RT2가 쓰여야 한다.
    await getDb().from("user_tokens")
      .update({ access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
                refresh_lock_until: "1970-01-01T00:00:00Z" })
      .eq("user_id", userId);
    f.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ code: 200, content: { accessToken: "AT3", refreshToken: "RT3", tokenType: "Bearer", expiresIn: "86400" } }),
    });
    await getValidAccessToken(userId);
    expect(JSON.parse(f.mock.calls[1][1].body).refreshToken).toBe("RT2");
  });

  it("리프레시 토큰이 만료되면 행을 지우고 null을 준다", async () => {
    await saveTokens(userId, { accessToken: "AT1", refreshToken: "RT1", expiresIn: 86400 });
    await getDb().from("user_tokens").update({
      access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() - 1000).toISOString(),
    }).eq("user_id", userId);

    expect(await getValidAccessToken(userId)).toBeNull();
    const { data } = await getDb().from("user_tokens").select().eq("user_id", userId).maybeSingle();
    expect(data).toBeNull();
  });

  it("동시 갱신 2건이 토큰을 잃지 않는다", async () => {
    await saveTokens(userId, { accessToken: "AT1", refreshToken: "RT1", expiresIn: 86400 });
    await getDb().from("user_tokens")
      .update({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("user_id", userId);

    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true, status: 200,
        json: async () => ({ code: 200, content: { accessToken: `AT${calls + 1}`, refreshToken: `RT${calls + 1}`, tokenType: "Bearer", expiresIn: "86400" } }) };
    }));

    const results = await Promise.allSettled([
      getValidAccessToken(userId),
      getValidAccessToken(userId),
    ]);
    // 치지직 갱신 호출은 정확히 한 번만 나가야 한다.
    expect(calls).toBe(1);
    // 최소 한쪽은 성공하고, 저장된 토큰은 유효해야 한다.
    expect(results.some((r) => r.status === "fulfilled" && r.value)).toBe(true);
    const { data } = await getDb().from("user_tokens").select().eq("user_id", userId).single();
    expect(data.refresh_token_enc).toBeTruthy();
  });

  it("HTTP 200 + 봉투 code 401 이어도 죽은 토큰으로 보고 행을 지운다", async () => {
    await saveTokens(userId, { accessToken: "AT1", refreshToken: "RT1", expiresIn: 86400 });
    await getDb().from("user_tokens")
      .update({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("user_id", userId);

    // 치지직이 HTTP는 200으로 주고 봉투 안에만 401을 담는 경우.
    // err.status는 200이므로 status만 검사하면 이 케이스를 놓친다.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ code: 401, message: "INVALID_TOKEN" }),
    }));

    expect(await getValidAccessToken(userId)).toBeNull();
    const { data } = await getDb().from("user_tokens").select().eq("user_id", userId).maybeSingle();
    expect(data).toBeNull();
  });

  it("deleteTokens는 행을 지운다", async () => {
    await saveTokens(userId, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    await deleteTokens(userId);
    expect(await getValidAccessToken(userId)).toBeNull();
  });

  it("리프레시 토큰 만료는 30일로 잡는다", async () => {
    await saveTokens(userId, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    const { data } = await getDb().from("user_tokens").select().eq("user_id", userId).single();
    const diff = new Date(data.refresh_token_expires_at).getTime() - Date.now();
    expect(diff).toBeGreaterThan(29 * DAY);
    expect(diff).toBeLessThan(31 * DAY);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:db`
Expected: FAIL — `Cannot find module '@/lib/db/tokens'`

- [ ] **Step 3: 구현**

`lib/db/tokens.js`:

```js
// 치지직 토큰 저장소. 평문은 절대 DB에 넣지 않는다.
// 키는 환경변수, 암호문은 DB — 둘이 분리되어야 DB 유출이 곧 토큰 유출이 되지 않는다.
import { getDb } from "@/lib/db/client";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/chzzk";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 문서상 30일
const LOCK_TTL_MS = 30 * 1000;   // 갱신 락 유효시간
const SKEW_MS = 60 * 1000;       // 만료 임박 여유

export class TokenRefreshBusyError extends Error {
  constructor() {
    super("다른 요청이 토큰을 갱신하는 중입니다.");
    this.name = "TokenRefreshBusyError";
  }
}

function failed(error, what) {
  throw new Error(`${what} 실패: ${error.message}`);
}

export async function saveTokens(userId, { accessToken, refreshToken, expiresIn }) {
  const now = Date.now();
  const { error } = await getDb().from("user_tokens").upsert(
    {
      user_id: userId,
      access_token_enc: encryptSecret(accessToken),
      refresh_token_enc: encryptSecret(refreshToken),
      access_token_expires_at: new Date(now + Number(expiresIn) * 1000).toISOString(),
      refresh_token_expires_at: new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
      refresh_lock_until: new Date(0).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) failed(error, "토큰 저장");
}

export async function deleteTokens(userId) {
  const { error } = await getDb().from("user_tokens").delete().eq("user_id", userId);
  if (error) failed(error, "토큰 삭제");
}

async function loadRow(userId) {
  const { data, error } = await getDb()
    .from("user_tokens").select().eq("user_id", userId).maybeSingle();
  if (error) failed(error, "토큰 조회");
  return data;
}

// 조건부 UPDATE로 락을 선점한다. PostgREST는 SELECT ... FOR UPDATE를 못 쓴다.
// 갱신된 행이 없으면 다른 요청이 이미 갱신 중이다.
async function acquireRefreshLock(userId) {
  const nowIso = new Date().toISOString();
  const { data, error } = await getDb()
    .from("user_tokens")
    .update({ refresh_lock_until: new Date(Date.now() + LOCK_TTL_MS).toISOString() })
    .eq("user_id", userId)
    .lt("refresh_lock_until", nowIso)
    .select();
  if (error) failed(error, "토큰 갱신 락");
  return data?.length === 1;
}

async function releaseRefreshLock(userId) {
  await getDb().from("user_tokens")
    .update({ refresh_lock_until: new Date(0).toISOString() })
    .eq("user_id", userId);
}

// 유효한 액세스 토큰을 준다. 만료됐으면 갱신한다.
// 갱신 불가(리프레시 만료 등)면 행을 지우고 null을 준다 — 호출자는
// 동기화를 조용히 중단하고, 소유자가 다시 로그인하면 자동 복구된다.
export async function getValidAccessToken(userId) {
  const row = await loadRow(userId);
  if (!row) return null;

  const accessAlive = new Date(row.access_token_expires_at).getTime() - SKEW_MS > Date.now();
  if (accessAlive) return decryptSecret(row.access_token_enc);

  if (new Date(row.refresh_token_expires_at).getTime() <= Date.now()) {
    await deleteTokens(userId);
    return null;
  }

  if (!(await acquireRefreshLock(userId))) {
    throw new TokenRefreshBusyError();
  }

  try {
    const refreshed = await refreshAccessToken(decryptSecret(row.refresh_token_enc));
    // 리프레시 토큰은 일회용이다. 새 값을 반드시 덮어써야 다음 갱신이 산다.
    await saveTokens(userId, refreshed);
    return refreshed.accessToken;
  } catch (err) {
    // 치지직은 실패를 HTTP 상태로도, 공통 봉투의 code로도 전달할 수 있다.
    // status만 보면 "HTTP 200 + 봉투 code 401" 응답을 놓쳐 죽은 토큰이 영원히 남는다.
    if (err?.status === 401 || err?.code === 401) {
      // 리프레시 토큰이 이미 죽었다. 재로그인으로만 복구된다.
      await deleteTokens(userId);
      return null;
    }
    await releaseRefreshLock(userId);
    throw err;
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `pnpm test:db`
Expected: PASS (9 tests + Task 7의 7 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/db/tokens.js tests/db/tokens.test.js
git commit -m "feat: 암호화 토큰 저장소와 동시 갱신 방지 추가"
```

---

### Task 9: DB 기반 세션

**Files:**
- Create: `lib/db/sessions.js`
- Modify: `lib/session.js`
- Create: `tests/session-cookie.test.js`
- Create: `tests/db/sessions.test.js`

**Interfaces:**
- Consumes: `getDb`, `findUserById`, `requireEnv`/`optionalEnv`/`isProduction`
- Produces:
  - `lib/session.js`: `signSessionId(id): string`, `verifySessionCookie(value): string|null`, `getSessionCookie(): Promise<string|null>`, `setSessionCookie(id): Promise<void>`, `clearSessionCookie(): Promise<void>`, `SESSION_COOKIE_NAME`
  - `lib/db/sessions.js`: `createSession({ userId, userAgent, ip }): Promise<{id, expiresAt}>`, `resolveSession(sessionId): Promise<{session, user}|null>`, `revokeSession(sessionId): Promise<void>`

쿠키에는 세션 ID만 담는다. 치지직 토큰은 `user_tokens` 로 갔다.

**⚠️ 이 Task부터 Task 11까지 `pnpm build` 가 깨진다. 정상이다.**
`lib/session.js` 의 기존 export(`getSession`, `setSession`, `clearSession`)가 사라지는데,
아래 4개 라우트가 아직 그것들을 import하기 때문이다.

```
app/api/auth/login/route.js     setSession
app/api/auth/callback/route.js  setSession
app/api/auth/logout/route.js    clearSession
app/api/me/route.js             getSession
```

이 라우트들은 **Task 11에서 한꺼번에 재배선한다.** Task 9·10에서는 라우트를 건드리지 말고,
`pnpm build` 도 검증 항목에서 제외한다(`pnpm test` 와 `pnpm test:db` 만 본다). 하위 호환
shim을 남기지 않는 이유는 Task 11에서 곧바로 지울 코드이기 때문이다. 기능 브랜치 안에서만
깨지므로 감수한다. **Task 11 완료 시점에는 반드시 빌드가 통과해야 한다.**

- [ ] **Step 1: 쿠키 서명 테스트 작성**

`tests/session-cookie.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { signSessionId, verifySessionCookie } from "@/lib/session";

describe("세션 쿠키 서명", () => {
  beforeEach(() => { process.env.SESSION_SECRET = "test-secret-value"; });

  it("서명한 값을 검증하면 원래 id가 나온다", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(verifySessionCookie(signSessionId(id))).toBe(id);
  });

  it("서명이 위조되면 null을 준다", () => {
    const signed = signSessionId("abc");
    const [body] = signed.split(".");
    expect(verifySessionCookie(`${body}.forgedmac`)).toBeNull();
  });

  it("본문이 바뀌면 null을 준다", () => {
    const signed = signSessionId("abc");
    const [, mac] = signed.split(".");
    expect(verifySessionCookie(`${Buffer.from("evil").toString("base64url")}.${mac}`)).toBeNull();
  });

  it("다른 키로 서명한 값은 거부한다", () => {
    const signed = signSessionId("abc");
    process.env.SESSION_SECRET = "another-secret";
    expect(verifySessionCookie(signed)).toBeNull();
  });

  it("형식이 깨진 값은 null을 준다", () => {
    expect(verifySessionCookie("")).toBeNull();
    expect(verifySessionCookie(null)).toBeNull();
    expect(verifySessionCookie("점이없음")).toBeNull();
  });

  it("프로덕션에서 SESSION_SECRET이 없으면 throw한다", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;
    expect(() => signSessionId("abc")).toThrow(/SESSION_SECRET/);
    process.env.NODE_ENV = "test";
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test tests/session-cookie.test.js`
Expected: FAIL — `signSessionId` is not exported

- [ ] **Step 3: `lib/session.js` 를 아래 내용으로 교체**

```js
// 세션 쿠키. 담기는 값은 세션 ID 하나뿐이다.
// 치지직 토큰은 user_tokens 테이블로 갔다 — 쿠키에 두면 평문 노출이다.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { isProduction, optionalEnv, requireEnv } from "@/lib/env";

export const SESSION_COOKIE_NAME = "songbook_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30일

function secret() {
  // 프로덕션에서는 반드시 설정돼야 한다. 기본값을 쓰면 세션 위조가 가능하다.
  if (isProduction()) return requireEnv("SESSION_SECRET");
  return optionalEnv("SESSION_SECRET") ?? "dev-only-secret-change-me";
}

export function signSessionId(id) {
  const body = Buffer.from(String(id)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySessionCookie(value) {
  if (!value || typeof value !== "string") return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return Buffer.from(body, "base64url").toString();
}

export async function getSessionCookie() {
  const store = await cookies();
  return verifySessionCookie(store.get(SESSION_COOKIE_NAME)?.value);
}

export async function setSessionCookie(sessionId) {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, signSessionId(sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
```

- [ ] **Step 4: 쿠키 테스트가 통과하는지 확인**

Run: `pnpm test tests/session-cookie.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: 세션 저장소 테스트 작성**

`tests/db/sessions.test.js`:

```js
import { it, expect, beforeEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSession, resolveSession, revokeSession } from "@/lib/db/sessions";

const DAY = 24 * 60 * 60 * 1000;

describeDb("lib/db/sessions", () => {
  let userId;
  beforeEach(async () => {
    await truncateAll(getDb());
    const user = await upsertUserFromLogin({ chzzkChannelId: "u1", chzzkChannelName: "유저" });
    userId = user.id;
  });

  it("세션을 만들고 유저와 함께 되찾는다", async () => {
    const { id } = await createSession({ userId, userAgent: "vitest", ip: null });
    const resolved = await resolveSession(id);
    expect(resolved.user.id).toBe(userId);
    expect(resolved.user.chzzkChannelName).toBe("유저");
  });

  it("세션 수명은 30일이다", async () => {
    const { expiresAt } = await createSession({ userId });
    const diff = new Date(expiresAt).getTime() - Date.now();
    expect(diff).toBeGreaterThan(29 * DAY);
    expect(diff).toBeLessThan(31 * DAY);
  });

  it("폐기된 세션은 되찾을 수 없다", async () => {
    const { id } = await createSession({ userId });
    await revokeSession(id);
    expect(await resolveSession(id)).toBeNull();
  });

  it("만료된 세션은 되찾을 수 없다", async () => {
    const { id } = await createSession({ userId });
    await getDb().from("sessions")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);
    expect(await resolveSession(id)).toBeNull();
  });

  it("없는 세션 ID는 null을 준다", async () => {
    expect(await resolveSession("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("uuid 형식이 아닌 값도 던지지 않고 null을 준다", async () => {
    expect(await resolveSession("이건-uuid가-아님")).toBeNull();
  });

  it("만료가 7일 미만으로 남으면 30일로 연장한다", async () => {
    const { id } = await createSession({ userId });
    const soon = new Date(Date.now() + 3 * DAY).toISOString();
    await getDb().from("sessions").update({ expires_at: soon }).eq("id", id);

    await resolveSession(id);

    const { data } = await getDb().from("sessions").select().eq("id", id).single();
    const diff = new Date(data.expires_at).getTime() - Date.now();
    expect(diff).toBeGreaterThan(29 * DAY);
  });

  it("만료가 7일 이상 남으면 연장하지 않는다", async () => {
    const { id } = await createSession({ userId });
    const { data: before } = await getDb().from("sessions").select().eq("id", id).single();
    await resolveSession(id);
    const { data: after } = await getDb().from("sessions").select().eq("id", id).single();
    expect(after.expires_at).toBe(before.expires_at);
  });
});
```

- [ ] **Step 6: `lib/db/sessions.js` 구현**

```js
// sessions 테이블 저장소. 로그아웃은 쿠키 삭제만으로 부족하므로
// revoked_at을 남겨 서버에서 확실히 끊는다.
import { getDb } from "@/lib/db/client";
import { findUserById } from "@/lib/db/users";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30일
const RENEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7일 미만 남으면 연장

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failed(error, what) {
  throw new Error(`${what} 실패: ${error.message}`);
}

export async function createSession({ userId, userAgent = null, ip = null }) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { data, error } = await getDb()
    .from("sessions")
    .insert({ user_id: userId, expires_at: expiresAt, user_agent: userAgent, ip })
    .select()
    .single();
  if (error) failed(error, "세션 생성");
  return { id: data.id, expiresAt: data.expires_at };
}

export async function resolveSession(sessionId) {
  // uuid가 아니면 DB에 물어볼 것도 없다. 물어보면 22P02 에러가 난다.
  if (!sessionId || !UUID_RE.test(sessionId)) return null;

  const { data, error } = await getDb()
    .from("sessions").select().eq("id", sessionId).maybeSingle();
  if (error) failed(error, "세션 조회");
  if (!data) return null;
  if (data.revoked_at) return null;

  const expiresAtMs = new Date(data.expires_at).getTime();
  if (expiresAtMs <= Date.now()) return null;

  const user = await findUserById(data.user_id);
  if (!user) return null;

  // 만료가 임박하면 슬라이딩 연장한다. 매 요청마다 쓰지 않기 위해 임계값을 둔다.
  let expiresAt = data.expires_at;
  if (expiresAtMs - Date.now() < RENEW_THRESHOLD_MS) {
    const renewed = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const { error: renewError } = await getDb()
      .from("sessions").update({ expires_at: renewed }).eq("id", sessionId);
    // 연장은 부가 작업이다. 실패해도 세션 자체는 여전히 유효하므로 throw하지 않는다
    // (연장 실패로 조회를 실패시키면 멀쩡한 세션이 로그아웃처럼 보인다).
    // 다만 DB에 반영되지 않은 값을 반영된 척 돌려주면 안 되므로 기존 값을 유지한다.
    if (renewError) {
      console.error("세션 연장 실패:", renewError.message);
    } else {
      expiresAt = renewed;
    }
  }

  return { session: { id: data.id, expiresAt }, user };
}

export async function revokeSession(sessionId) {
  if (!sessionId || !UUID_RE.test(sessionId)) return;
  const { error } = await getDb()
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) failed(error, "세션 폐기");
}
```

- [ ] **Step 7: 테스트가 통과하는지 확인**

Run: `pnpm test:db`
Expected: PASS (8 sessions tests 포함 전체)

- [ ] **Step 8: 커밋**

```bash
git add lib/session.js lib/db/sessions.js tests/session-cookie.test.js tests/db/sessions.test.js
git commit -m "feat: DB 기반 세션으로 전환하고 쿠키에서 토큰 제거"
```

---

### Task 10: 인가 모듈

**Files:**
- Create: `lib/authz.js`
- Create: `tests/db/authz.test.js`

**Interfaces:**
- Consumes: `getSessionCookie`, `resolveSession`, `getDb`
- Produces:
  - `currentUser(): Promise<User|null>`
  - `accessLevel(user, songbookId): Promise<'owner'|'manager'|'operator'|null>`
  - `requireSongbookAccess(songbookId, { min }): Promise<{user, level}>` — 미달이면 `AuthzError` throw
  - `AuthzError` — `.status` 가 401(비로그인) 또는 404(권한 없음)

**권한이 없을 때 403이 아니라 404를 내는 이유:** 403은 "그 노래책이 존재한다"는 사실을 흘려서 비공개 노래책의 존재를 탐지당한다.

**권한은 단순 서열이 아니다.** `min: 'manager'` 는 manager·owner·operator를 통과시키고, `min: 'owner'` 는 owner·operator를 통과시킨다. 매니저 초대·해제는 operator를 배제해야 하므로 서열로 표현할 수 없어 `min: 'ownerOnly'` 를 따로 둔다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/authz.test.js`:

```js
import { it, expect, beforeEach, vi, afterEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { accessLevel, requireSongbookAccess, AuthzError } from "@/lib/authz";

async function makeUser(channelId, name, role = "user") {
  const user = await upsertUserFromLogin({ chzzkChannelId: channelId, chzzkChannelName: name });
  if (role !== "user") {
    await getDb().from("users").update({ role }).eq("id", user.id);
    return { ...user, role };
  }
  return user;
}

async function makeSongbook(ownerId, slug = "book1") {
  const { data } = await getDb().from("songbooks")
    .insert({ owner_id: ownerId, slug, title: "노래책" }).select().single();
  return data;
}

describeDb("lib/authz", () => {
  let owner, manager, stranger, operator, songbook;

  beforeEach(async () => {
    await truncateAll(getDb());
    owner = await makeUser("owner", "주인");
    manager = await makeUser("manager", "매니저");
    stranger = await makeUser("stranger", "타인");
    operator = await makeUser("operator", "운영자", "operator");
    songbook = await makeSongbook(owner.id);
    await getDb().from("songbook_members").insert({
      songbook_id: songbook.id, user_id: manager.id, role: "manager", source: "invite",
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("소유자는 owner", async () => {
    expect(await accessLevel(owner, songbook.id)).toBe("owner");
  });

  it("매니저는 manager", async () => {
    expect(await accessLevel(manager, songbook.id)).toBe("manager");
  });

  it("타인은 null", async () => {
    expect(await accessLevel(stranger, songbook.id)).toBeNull();
  });

  it("운영자는 operator", async () => {
    expect(await accessLevel(operator, songbook.id)).toBe("operator");
  });

  it("비로그인(null 유저)은 null", async () => {
    expect(await accessLevel(null, songbook.id)).toBeNull();
  });

  it("없는 노래책은 null", async () => {
    expect(await accessLevel(owner, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("소유자가 운영자를 겸하면 owner가 우선한다", async () => {
    await getDb().from("users").update({ role: "operator" }).eq("id", owner.id);
    expect(await accessLevel({ ...owner, role: "operator" }, songbook.id)).toBe("owner");
  });

  // --- requireSongbookAccess ---
  // 위 beforeEach의 픽스처를 그대로 쓴다. user를 명시적으로 넘겨
  // 쿠키·세션 없이 인가 판정만 검증한다.
  async function attempt(user, min) {
    try {
      const result = await requireSongbookAccess(songbook.id, { min, user });
      return { ok: true, level: result.level };
    } catch (err) {
      return { ok: false, status: err.status, isAuthz: err instanceof AuthzError };
    }
  }

  it("비로그인은 401", async () => {
    expect(await attempt(null, "manager")).toMatchObject({ ok: false, status: 401 });
  });

  it("타인은 404 (403이 아니다 — 존재를 누설하면 안 된다)", async () => {
    expect(await attempt(stranger, "manager")).toMatchObject({ ok: false, status: 404 });
  });

  it("min manager: 매니저·소유자·운영자 통과", async () => {
    expect(await attempt(manager, "manager")).toMatchObject({ ok: true });
    expect(await attempt(owner, "manager")).toMatchObject({ ok: true });
    expect(await attempt(operator, "manager")).toMatchObject({ ok: true });
  });

  it("min owner: 소유자·운영자 통과, 매니저 404", async () => {
    expect(await attempt(owner, "owner")).toMatchObject({ ok: true });
    expect(await attempt(operator, "owner")).toMatchObject({ ok: true });
    expect(await attempt(manager, "owner")).toMatchObject({ ok: false, status: 404 });
  });

  it("min ownerOnly: 소유자만 통과, 운영자도 404", async () => {
    expect(await attempt(owner, "ownerOnly")).toMatchObject({ ok: true });
    expect(await attempt(operator, "ownerOnly")).toMatchObject({ ok: false, status: 404 });
    expect(await attempt(manager, "ownerOnly")).toMatchObject({ ok: false, status: 404 });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:db`
Expected: FAIL — `Cannot find module '@/lib/authz'`

- [ ] **Step 3: 구현**

`lib/authz.js`:

```js
// 인가 판정 단일 창구.
// 이 프로젝트는 RLS를 심층방어로만 쓰므로(스펙 "왜 RLS가 주 방어선이 아닌가" 참조)
// 인가 로직이 이 파일 밖에 존재하면 그게 곧 취약점이다.
// 모든 쓰기 라우트 핸들러는 첫 줄에서 requireSongbookAccess를 호출한다.
import { getSessionCookie } from "@/lib/session";
import { resolveSession } from "@/lib/db/sessions";
import { getDb } from "@/lib/db/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuthzError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AuthzError";
    this.status = status;
  }
}

export async function currentUser() {
  const sessionId = await getSessionCookie();
  if (!sessionId) return null;
  const resolved = await resolveSession(sessionId);
  return resolved?.user ?? null;
}

// 'owner' | 'manager' | 'operator' | null
// 소유자가 운영자를 겸하면 owner를 우선한다 — 자기 노래책에서는 소유자 권한이 더 넓다.
export async function accessLevel(user, songbookId) {
  if (!user || !songbookId || !UUID_RE.test(songbookId)) return null;

  const db = getDb();
  const { data: songbook, error } = await db
    .from("songbooks").select("id, owner_id").eq("id", songbookId).maybeSingle();
  if (error) throw new Error(`노래책 조회 실패: ${error.message}`);
  if (!songbook) return null;

  if (songbook.owner_id === user.id) return "owner";

  const { data: member, error: memberError } = await db
    .from("songbook_members").select("role")
    .eq("songbook_id", songbookId).eq("user_id", user.id).maybeSingle();
  if (memberError) throw new Error(`멤버 조회 실패: ${memberError.message}`);
  if (member) return "manager";

  if (user.role === "operator") return "operator";
  return null;
}

// min별 통과 집합. 서열로 유도하지 않고 명시한다 —
// ownerOnly는 operator를 배제해야 해서 서열로 표현할 수 없다.
const ALLOWED = {
  manager: new Set(["manager", "owner", "operator"]),
  owner: new Set(["owner", "operator"]),
  ownerOnly: new Set(["owner"]),
};

// 권한이 없으면 403이 아니라 404를 던진다.
// 403은 "그 노래책이 존재한다"를 누설해 비공개 노래책을 탐지당한다.
export async function requireSongbookAccess(songbookId, { min, user } = {}) {
  const allowed = ALLOWED[min];
  if (!allowed) throw new Error(`알 수 없는 권한 기준: ${min}`);

  const actor = user !== undefined ? user : await currentUser();
  if (!actor) throw new AuthzError(401, "로그인이 필요해요.");

  const level = await accessLevel(actor, songbookId);
  if (!level || !allowed.has(level)) {
    throw new AuthzError(404, "찾을 수 없어요.");
  }
  return { user: actor, level };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `pnpm test:db`
Expected: PASS (authz 12 tests 포함 전체)

- [ ] **Step 5: 커밋**

```bash
git add lib/authz.js tests/db/authz.test.js
git commit -m "feat: 인가 판정 단일 모듈 추가"
```

---

### Task 11: 인증 라우트 재배선

**Files:**
- Modify: `app/api/auth/login/route.js`
- Modify: `app/api/auth/callback/route.js`
- Modify: `app/api/auth/logout/route.js`
- Modify: `app/api/me/route.js`
- Create: `app/api/auth/demo/route.js`
- Create: `lib/http.js`
- Modify (조건부): `app/page.jsx` — `user.demo` 참조가 있을 때만

**Interfaces:**
- Consumes: 앞의 모든 모듈
- Produces:
  - `lib/http.js`: `errorResponse(err): NextResponse` — `AuthzError` 를 상태코드로 변환
  - 로그인 왕복이 DB 세션을 만들고, `/api/me` 가 그 세션의 유저를 반환한다

**데모 모드는 개발 환경에서만 남긴다.** 셀프서비스 멀티테넌트에서 가짜 세션은 "아무나 임의 신원으로 로그인"이 된다.

**소유자 토큰만 저장한다.** 콜백에서 해당 유저가 `songbooks.owner_id` 에 있을 때만 `saveTokens` 를 부른다. 시청자 토큰은 쓸 데가 없으므로 저장하지 않는다.

- [ ] **Step 1: `lib/http.js` 작성**

```js
// 라우트 핸들러의 공통 에러 변환.
import { NextResponse } from "next/server";
import { AuthzError } from "@/lib/authz";

export function errorResponse(err) {
  if (err instanceof AuthzError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("요청 처리 실패:", err);
  return NextResponse.json({ error: "요청을 처리하지 못했어요." }, { status: 500 });
}
```

- [ ] **Step 2: `app/api/auth/login/route.js` 를 아래 내용으로 교체**

```js
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isConfigured, buildAuthorizeUrl } from "@/lib/chzzk";
import { isProduction } from "@/lib/env";

export async function GET(request) {
  const origin = new URL(request.url).origin;

  if (!isConfigured()) {
    // 프로덕션에서 credential이 없으면 로그인을 비활성한다.
    // 데모 세션을 발급하면 아무나 임의 신원으로 노래책을 만들 수 있다.
    if (isProduction()) {
      return NextResponse.redirect(`${origin}/?authError=unconfigured`);
    }
    return NextResponse.redirect(`${origin}/api/auth/demo`);
  }

  const state = crypto.randomBytes(16).toString("hex");
  const store = await cookies();
  store.set("chzzk_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: 600,
  });

  const redirectUri = process.env.CHZZK_REDIRECT_URI || `${origin}/api/auth/callback`;
  return NextResponse.redirect(buildAuthorizeUrl({ redirectUri, state }));
}
```

- [ ] **Step 3: `app/api/auth/demo/route.js` 신규 작성 (개발 전용)**

```js
// 개발 전용 데모 로그인. 프로덕션에서는 404를 낸다.
import { NextResponse } from "next/server";
import { isProduction } from "@/lib/env";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSession } from "@/lib/db/sessions";
import { setSessionCookie } from "@/lib/session";
import { errorResponse } from "@/lib/http";

export async function GET(request) {
  if (isProduction()) {
    return NextResponse.json({ error: "찾을 수 없어요." }, { status: 404 });
  }
  try {
    const origin = new URL(request.url).origin;
    const user = await upsertUserFromLogin({
      chzzkChannelId: "demo-channel",
      chzzkChannelName: "새벽감자",
    });
    const session = await createSession({
      userId: user.id,
      userAgent: request.headers.get("user-agent"),
    });
    await setSessionCookie(session.id);
    return NextResponse.redirect(`${origin}/`);
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4: `app/api/auth/callback/route.js` 를 아래 내용으로 교체**

```js
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeCodeForToken, fetchMe } from "@/lib/chzzk";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSession } from "@/lib/db/sessions";
import { saveTokens } from "@/lib/db/tokens";
import { setSessionCookie } from "@/lib/session";
import { getDb } from "@/lib/db/client";

// 이 유저가 노래책 소유자인지. 소유자의 토큰만 저장한다 —
// 시청자 토큰은 쓸 데가 없고, 저장하지 않은 데이터는 유출되지 않는다.
async function ownsSongbook(userId) {
  const { data } = await getDb()
    .from("songbooks").select("id").eq("owner_id", userId).limit(1);
  return Boolean(data?.length);
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const store = await cookies();
  const savedState = store.get("chzzk_oauth_state")?.value;
  store.delete("chzzk_oauth_state");

  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${url.origin}/?authError=state`);
  }

  try {
    const token = await exchangeCodeForToken({ code, state });
    const me = await fetchMe(token.accessToken);

    const user = await upsertUserFromLogin({
      chzzkChannelId: me.channelId,
      chzzkChannelName: me.channelName,
    });

    if (await ownsSongbook(user.id)) {
      await saveTokens(user.id, token);
    }

    const session = await createSession({
      userId: user.id,
      userAgent: request.headers.get("user-agent"),
    });
    await setSessionCookie(session.id);

    return NextResponse.redirect(`${url.origin}/`);
  } catch (err) {
    console.error("치지직 OAuth 콜백 실패:", err);
    return NextResponse.redirect(`${url.origin}/?authError=1`);
  }
}
```

- [ ] **Step 5: `app/api/auth/logout/route.js` 를 아래 내용으로 교체**

```js
import { NextResponse } from "next/server";
import { getSessionCookie, clearSessionCookie } from "@/lib/session";
import { revokeSession } from "@/lib/db/sessions";
import { errorResponse } from "@/lib/http";

export async function POST() {
  try {
    // 쿠키 삭제만으로는 부족하다. 복사된 쿠키가 있으면 계속 유효하다.
    const sessionId = await getSessionCookie();
    if (sessionId) await revokeSession(sessionId);
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 6: `app/api/me/route.js` 를 아래 내용으로 교체**

```js
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/authz";
import { isConfigured } from "@/lib/chzzk";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    const user = await currentUser();
    return NextResponse.json({
      user: user
        ? {
            id: user.id,
            channelName: user.chzzkChannelName,
            channelImage: user.chzzkChannelImage,
            verified: user.chzzkVerified,
          }
        : null,
      oauthConfigured: isConfigured(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 7: `app/page.jsx` 의 `demo` 배지 참조 정리**

`app/page.jsx` 에서 `/api/me` 응답의 `user.demo` 를 읽는 부분이 있으면 제거한다. `demo` 필드는 더 이상 반환하지 않는다.

Run: `grep -rn "\.demo" app/ lib/`
Expected: 결과가 없어야 한다. 남아 있으면 해당 줄을 지운다.

- [ ] **Step 8: 빌드 확인**

Run: `pnpm build`
Expected: 성공. 라우트 목록에 `/api/auth/demo` 가 추가로 보인다.

- [ ] **Step 9: 수동 왕복 확인**

`.env` 에 Supabase 값을 넣고 (치지직 credential은 비워둔 채) 실행한다.

```bash
pnpm dev
```

1. 브라우저에서 `http://localhost:3000/api/auth/login` 접속 → `/` 로 리다이렉트
2. `http://localhost:3000/api/me` → `{"user":{"channelName":"새벽감자",...},"oauthConfigured":false}`
3. Supabase 대시보드에서 `select * from users;`, `select * from sessions;` → 각 1행
4. `curl -X POST http://localhost:3000/api/auth/logout` (브라우저 개발자도구 콘솔에서 `fetch('/api/auth/logout',{method:'POST'})`)
5. Supabase에서 `select revoked_at from sessions;` → 값이 채워져 있음
6. `/api/me` → `{"user":null,...}`

- [ ] **Step 10: 전체 테스트 확인**

Run: `pnpm test && pnpm test:db`
Expected: 둘 다 PASS

- [ ] **Step 11: 커밋**

```bash
git add app/api lib/http.js app/page.jsx
git commit -m "feat: 인증 라우트를 DB 세션으로 재배선하고 데모 모드를 개발 환경으로 한정"
```

---

## 완료 기준

- [ ] `pnpm test` 통과 (단위: env 7, crypto 10, chzzk 18, session-cookie 6, smoke 1)
- [ ] `pnpm test:db` 통과 (통합: users 7, tokens 9, sessions 8, authz 12)
- [ ] `pnpm build` 통과
- [ ] Supabase 운영·테스트 프로젝트에 테이블 8개, 전부 `rowsecurity = true`, 정책 0개
- [ ] 소스 어디에도 `NEXT_PUBLIC_` 환경변수가 없다 — `grep -rn "NEXT_PUBLIC_" app/ lib/` 결과 없음
- [ ] 쿠키 payload에 치지직 토큰이 없다 — 로그인 후 개발자도구에서 `songbook_session` 쿠키 값을 base64 디코드하면 UUID 하나만 나온다
- [ ] `git status` 가 깨끗하고 `package-lock.json` 이 사라졌다

## 다음 계획

계획 2 (노래책·곡·자켓 업로드)에서 이 기반 위에 기능을 올린다. 이 계획이 끝난 시점에는 로그인·세션·인가가 동작하지만 노래책이 없어 `requireSongbookAccess` 를 호출하는 라우트가 아직 없다. 그건 계획 2의 첫 Task에서 생긴다.
