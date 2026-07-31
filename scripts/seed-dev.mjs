// 개발용 시드. 노래책 하나에 예시 곡을 넣는다.
// 사용법: node --env-file=.env scripts/seed-dev.mjs <songbook-slug>
import { findSongbookBySlug } from "../lib/db/songbooks.js";
import { createSongs } from "../lib/db/songs.js";

const SONGS = [
  { title: "너의 모든 순간", artist: "성시경", genre: "발라드", popular: true },
  { title: "사건의 지평선", artist: "윤하", genre: "K-POP", popular: true },
  { title: "밤편지", artist: "아이유", genre: "발라드" },
  { title: "夜に駆ける", artist: "YOASOBI", genre: "J-POP", popular: true },
  { title: "Bohemian Rhapsody", artist: "Queen", genre: "락" },
];

const slug = process.argv[2];
if (!slug) {
  console.error("사용법: node --env-file=.env scripts/seed-dev.mjs <songbook-slug>");
  process.exit(1);
}

const book = await findSongbookBySlug(slug);
if (!book) {
  console.error(`노래책을 찾을 수 없습니다: ${slug}`);
  process.exit(1);
}

const created = await createSongs(book.id, SONGS);
console.log(`${created.length}곡 등록했습니다.`);
