-- Data API(PostgREST) 노출 차단.
--
-- 이 프로젝트는 브라우저가 Supabase를 직접 호출하지 않는다. 모든 접근은 Next.js
-- Route Handler에서 sb_secret_ 키로만 이루어진다. 따라서 anon/authenticated 역할에
-- 권한이 있을 이유가 전혀 없다.
--
-- 0001 적용 후 실측한 결과, publishable·anon 키로 users·user_tokens·sessions 에
-- HTTP 200 이 돌아왔다(행은 RLS가 막아 빈 배열). 즉 테이블이 Data API에 노출돼 있고
-- RLS deny-all 이 유일한 방어선인 상태였다.
--
-- 새 테이블 자동 미노출은 2026-10-30 부터 강제되므로 그때까지는 이 명시적 차단이 필요하다.
-- 이렇게 두면 정책을 잘못 추가해도(예: songbooks 공개 읽기) Data API 경로 자체가 막혀 있어
-- 사고가 나지 않는다. service_role(sb_secret_)은 BYPASSRLS 이며 별도 권한을 가지므로
-- 아래 revoke의 영향을 받지 않는다.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- 앞으로 만들어질 객체에도 자동 grant 가 붙지 않게 한다.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- 스키마 진입 자체를 막는다. 브라우저가 public 스키마를 볼 일이 없다.
revoke usage on schema public from anon, authenticated;
