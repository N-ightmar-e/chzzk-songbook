import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { SONGS as SEED } from "@/data/songs";

const STORE_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(STORE_DIR, "songs.json");

const SEED_GENRE_MAP = {
  케이팝: "K-POP",
  제이팝: "J-POP",
  팝: "POP",
};

function fromSeed(song) {
  return {
    id: `seed-${song.id}`,
    jacket: null,
    title: song.title,
    titleAliases: [],
    artist: song.artist,
    artistAliases: [],
    mrUrl: "",
    mrVideoId: null,
    mrTitle: null,
    mrChannel: null,
    key: 0,
    keyLinks: {},
    genre: SEED_GENRE_MAP[song.genre] || song.genre,
    price: 3000,
    popular: Boolean(song.popular),
    createdAt: new Date(0).toISOString(),
  };
}

async function read() {
  try {
    return JSON.parse(await fs.readFile(STORE_FILE, "utf8"));
  } catch {
    const seeded = SEED.map(fromSeed);
    await write(seeded);
    return seeded;
  }
}

async function write(songs) {
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(songs, null, 2), "utf8");
}

export async function listSongs() {
  return read();
}

function toSong(input) {
  return {
    id: crypto.randomUUID(),
    jacket: input.jacket || null,
    title: input.title,
    titleAliases: input.titleAliases || [],
    artist: input.artist,
    artistAliases: input.artistAliases || [],
    mrUrl: input.mrUrl || "",
    mrVideoId: input.mrVideoId || null,
    mrTitle: input.mrTitle || null,
    mrChannel: input.mrChannel || null,
    key: Number(input.key) || 0,
    keyLinks: input.keyLinks || {},
    genre: input.genre,
    price: Number(input.price) || 0,
    popular: Boolean(input.popular),
    createdAt: new Date().toISOString(),
  };
}

export async function createSong(input) {
  const songs = await read();
  const song = toSong(input);
  songs.unshift(song);
  await write(songs);
  return song;
}

// 일괄 등록은 파일을 한 번만 읽고 한 번만 쓴다.
export async function createSongs(inputs) {
  const songs = await read();
  const created = inputs.map(toSong);
  await write([...created, ...songs]);
  return created;
}

export function validateSong(input) {
  const errors = {};
  if (!input?.title?.trim()) errors.title = "곡 제목을 입력해 주세요.";
  if (!input?.artist?.trim()) errors.artist = "가수를 입력해 주세요.";
  if (!input?.genre) errors.genre = "장르를 선택해 주세요.";
  if (input?.price == null || Number.isNaN(Number(input.price)) || Number(input.price) < 0) {
    errors.price = "가격은 0원 이상이어야 합니다.";
  }
  return errors;
}
