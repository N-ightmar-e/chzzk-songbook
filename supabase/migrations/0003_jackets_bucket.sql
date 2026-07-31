-- 자켓 이미지 버킷. 공개 읽기(자켓은 시청자에게 보이라고 있다),
-- 쓰기는 서버가 sb_secret_ 키로만 한다.
-- storage.objects 의 RLS 정책을 만들지 않으므로 anon/authenticated 는 쓸 수 없다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'jackets', 'jackets', true, 2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
