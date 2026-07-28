"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHANNEL } from "@/data/songs";
import { GENRES, formatKey, formatPrice } from "@/data/genres";

const PAGE_SIZE = 16; // 4x4

function hueOf(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 13;
  return Math.abs(hash) % 360;
}

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const GridIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

const ListIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const NoteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

export default function SongbookPage() {
  const [songs, setSongs] = useState([]);
  const [user, setUser] = useState(null);
  const [oauthConfigured, setOauthConfigured] = useState(true);
  const [view, setView] = useState("grid");
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("전체");
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState(null);
  const [nudgeSong, setNudgeSong] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        setUser(d.user);
        setOauthConfigured(d.oauthConfigured);
      })
      .catch(() => {});

    fetch("/api/songs")
      .then((r) => r.json())
      .then((d) => setSongs(d.songs))
      .catch(() => {});

    const url = new URL(location.href);
    const fromUrl = url.searchParams.get("view");
    const saved = fromUrl || localStorage.getItem("songbook:view");
    if (saved === "list" || saved === "grid") setView(saved);

    if (url.searchParams.get("authError")) {
      showToast("로그인에 실패했어요. 다시 시도해 주세요.", true);
      url.searchParams.delete("authError");
      history.replaceState(null, "", url);
    }
  }, []);

  function showToast(message, isError = false) {
    clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  function changeView(next) {
    setView(next);
    localStorage.setItem("songbook:view", next);
  }

  const genreTabs = useMemo(() => {
    const used = new Set(songs.map((s) => s.genre));
    return ["전체", ...GENRES.filter((g) => used.has(g))];
  }, [songs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return songs.filter((s) => {
      if (genre !== "전체" && s.genre !== genre) return false;
      if (!q) return true;
      // 별칭까지 훑는다: 역몽 / 사카유메 / 逆夢 어느 표기로 검색해도 걸리도록
      return [s.title, s.artist, ...(s.titleAliases || []), ...(s.artistAliases || [])].some(
        (term) => term.toLowerCase().includes(q)
      );
    });
  }, [songs, query, genre]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function applyFilter(fn) {
    fn();
    setPage(1);
  }

  async function requestSong(song) {
    if (!user) {
      setNudgeSong(song);
      return;
    }
    const keySuffix = song.key ? ` (${formatKey(song.key)})` : "";
    const command = `!신청 ${song.title} - ${song.artist}${keySuffix}`;
    try {
      await navigator.clipboard.writeText(command);
      showToast("복사 완료! 방송 채팅창에 붙여넣어 주세요.");
    } catch {
      showToast("복사에 실패했어요. 브라우저 권한을 확인해 주세요.", true);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    showToast("로그아웃했어요.");
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="wordmark">
          노래책 <small>SONG BOOK</small>
        </div>
        <div className="auth-area">
          {user ? (
            <>
              <span className="user-chip">
                <span className="avatar" aria-hidden="true">♪</span>
                {user.channelName}
                {user.demo && <span className="demo-badge">DEMO</span>}
              </span>
              <button className="btn btn-ghost" onClick={logout}>
                로그아웃
              </button>
            </>
          ) : (
            <a className="btn btn-primary" href="/api/auth/login">
              치지직으로 로그인
            </a>
          )}
          <a className="btn btn-ghost" href="/admin/songs/new">
            곡 등록
          </a>
        </div>
      </header>

      <section className="channel">
        <h1>
          <em>{CHANNEL.name}</em>의 노래책
        </h1>
        <p className="intro">{CHANNEL.intro}</p>
        <div className="stats">
          <span>{CHANNEL.handle}</span>
          <span>전체 {songs.length}곡</span>
          <span>인기곡 {songs.filter((s) => s.popular).length}곡</span>
        </div>
      </section>

      <div className="controls">
        <div className="search">
          <SearchIcon />
          <input
            type="search"
            placeholder="곡명이나 아티스트로 검색"
            value={query}
            onChange={(e) => applyFilter(() => setQuery(e.target.value))}
            aria-label="곡 검색"
          />
        </div>
        <div className="view-toggle" role="group" aria-label="보기 방식">
          <button
            aria-pressed={view === "grid"}
            onClick={() => changeView("grid")}
          >
            <GridIcon /> 그리드
          </button>
          <button
            aria-pressed={view === "list"}
            onClick={() => changeView("list")}
          >
            <ListIcon /> 리스트
          </button>
        </div>
      </div>

      <div className="genres" role="group" aria-label="장르 필터">
        {genreTabs.map((g) => (
          <button
            key={g}
            aria-pressed={genre === g}
            onClick={() => applyFilter(() => setGenre(g))}
          >
            {g}
          </button>
        ))}
      </div>

      <p className="result-note" aria-live="polite">
        {query || genre !== "전체"
          ? `${filtered.length}곡이 검색됐어요`
          : `총 ${filtered.length}곡 · 신청하면 채팅 명령어가 복사돼요`}
      </p>

      {visible.length === 0 ? (
        <div className="empty">
          <strong>맞는 곡이 없어요</strong>
          다른 검색어로 찾아보거나, 방송 채팅으로 신곡을 건의해 주세요.
        </div>
      ) : view === "grid" ? (
        <ul className="song-grid" style={{ listStyle: "none" }}>
          {visible.map((song) => (
            <li
              className="song-card"
              key={song.id}
              style={{ "--disc-hue": `oklch(0.6 0.14 ${hueOf(song.id)})` }}
            >
              {song.jacket ? (
                <img className="jacket" src={song.jacket} alt="" />
              ) : (
                <span className="disc" aria-hidden="true" />
              )}
              <div className="meta">
                <div className="title">{song.title}</div>
                <div className="artist">{song.artist}</div>
              </div>
              <div className="foot">
                <span className="tags">
                  <span className={song.popular ? "tag tag-popular" : "tag"}>
                    {song.popular ? `★ ${song.genre}` : song.genre}
                  </span>
                  {song.key !== 0 && <span className="tag tag-key">{formatKey(song.key)}</span>}
                </span>
                <button className="request-btn" onClick={() => requestSong(song)}>
                  <NoteIcon /> {formatPrice(song.price)}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ol className="song-list" style={{ listStyle: "none" }}>
          {visible.map((song, i) => (
            <li className="song-row" key={song.id}>
              <span className="num">
                {String((safePage - 1) * PAGE_SIZE + i + 1).padStart(2, "0")}
              </span>
              <span className="title">
                {song.title}
                {song.popular && <span className="star" aria-label="인기곡">★</span>}
                {song.key !== 0 && <span className="key-mark">{formatKey(song.key)}</span>}
              </span>
              <span className="artist">{song.artist}</span>
              <span className="tag">{song.genre}</span>
              <button className="request-btn" onClick={() => requestSong(song)}>
                <NoteIcon /> {formatPrice(song.price)}
              </button>
            </li>
          ))}
        </ol>
      )}

      {pageCount > 1 && (
        <nav className="pagination" aria-label="페이지">
          <button
            onClick={() => setPage(safePage - 1)}
            disabled={safePage === 1}
            aria-label="이전 페이지"
          >
            ‹
          </button>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              aria-current={n === safePage ? "page" : undefined}
              onClick={() => setPage(n)}
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => setPage(safePage + 1)}
            disabled={safePage === pageCount}
            aria-label="다음 페이지"
          >
            ›
          </button>
        </nav>
      )}

      <footer className="footer">
        <span>© {CHANNEL.name} · 치지직 노래방송</span>
        <span>{oauthConfigured ? "치지직 OAuth 연동" : "데모 모드 (OAuth 미설정)"}</span>
      </footer>

      {nudgeSong && !user && (
        <div className="login-nudge" role="dialog" aria-label="로그인 안내">
          <p>
            <strong>치지직 로그인이 필요해요</strong>
            로그인하면 “{nudgeSong.title}” 신청 명령어를 복사해 드려요.
          </p>
          <a className="btn btn-primary" href="/api/auth/login">
            로그인
          </a>
          <button
            className="close"
            onClick={() => setNudgeSong(null)}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {!toast.isError && <span className="check">✓</span>}
          {toast.message}
        </div>
      )}
    </div>
  );
}
