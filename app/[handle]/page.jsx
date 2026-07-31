import { notFound, permanentRedirect } from "next/navigation";
import { findSongbookBySlug, findSongbookByHistoricalSlug } from "@/lib/db/songbooks";
import { findUserById } from "@/lib/db/users";
import { listSongs } from "@/lib/db/songs";
import { jacketPublicUrl } from "@/lib/storage";
import { currentUser, accessLevel } from "@/lib/authz";
import SongbookView from "./SongbookView";

// DB를 만지므로 빌드 타임 정적 프리렌더에 말려들면 안 된다.
export const dynamic = "force-dynamic";

export default async function HandlePage({ params }) {
  const { handle: rawHandle } = await params;
  // Next.js가 이 dynamic segment 값을 퍼센트 인코딩된 그대로 넘겨준다("@dutto"가
  // "%40dutto"로 온다). 라우팅 단계에서 디코딩해 주지 않으므로 여기서 직접 푼다 —
  // 안 그러면 "@" 검사도, 한글 slug 비교도 전부 어긋난다.
  let handle;
  try {
    handle = rawHandle ? decodeURIComponent(rawHandle) : rawHandle;
  } catch {
    // 깨진 퍼센트 인코딩(예: "%zz")은 존재하지 않는 주소와 동일하게 취급한다.
    notFound();
  }

  // Next.js에서 폴더명 @foo 는 parallel route slot 문법이라 URL이 되지 않는다.
  // dynamic segment 로 받아 여기서 @ 를 검사한다.
  if (!handle?.startsWith("@")) notFound();
  const slug = handle.slice(1).toLowerCase();

  let songbook = await findSongbookBySlug(slug);

  if (!songbook) {
    // 주소를 바꾼 노래책이면 현재 주소로 보낸다. 공유된 옛 링크가 죽지 않는다.
    const history = await findSongbookByHistoricalSlug(slug);
    if (history?.currentSlug) permanentRedirect(`/@${history.currentSlug}`);
    notFound();
  }

  if (!songbook.isPublic) {
    // 비공개는 참여자만. 없는 것과 구분되지 않게 404.
    const user = await currentUser();
    const level = await accessLevel(user, songbook.id);
    if (!level) notFound();
  }

  const [owner, songs] = await Promise.all([
    findUserById(songbook.ownerId),
    listSongs(songbook.id),
  ]);

  return (
    <SongbookView
      songbook={{
        slug: songbook.slug,
        title: songbook.title,
        intro: songbook.intro,
      }}
      channel={{
        name: owner?.chzzkChannelName ?? null,
        image: owner?.chzzkChannelImage ?? null,
        verified: owner?.chzzkVerified ?? false,
        chzzkUrl: owner?.chzzkChannelId
          ? `https://chzzk.naver.com/${owner.chzzkChannelId}`
          : null,
      }}
      songs={songs.map((song) => ({
        // 시청자에게 필요한 필드만 내려보낸다. jacketPath 원문이나 mrUrl·keyLinks,
        // songbookId 같은 내부 값은 여기서 걸러진다 — jacketPath를 그대로 실어 보내면
        // 크로스 테넌트 자켓 조회의 실마리가 된다.
        id: song.id,
        title: song.title,
        titleAliases: song.titleAliases,
        artist: song.artist,
        artistAliases: song.artistAliases,
        genre: song.genre,
        key: song.key,
        price: song.price,
        popular: song.popular,
        jacketUrl: jacketPublicUrl(song.jacketPath),
      }))}
    />
  );
}
