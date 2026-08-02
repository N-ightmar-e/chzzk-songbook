"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import TopBar from "../../../TopBar";
import "../../manage.css";

export default function SongListPage() {
  const { slug } = useParams();
  const [book, setBook] = useState(null);
  const [user, setUser] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const me = await (await fetch("/api/me")).json();
    setUser(me.user);
    const found = (me.songbooks ?? []).find((b) => b.slug === slug);
    setBook(found ?? null);
    if (found) {
      const res = await fetch(`/api/songbooks/${found.id}/songs`);
      const body = await res.json();
      setSongs(body.songs ?? []);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  async function remove(song) {
    setError(null);
    const res = await fetch(`/api/songs/${song.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("곡을 지우지 못했어요.");
      return;
    }
    setSongs((prev) => prev.filter((s) => s.id !== song.id));
  }

  if (loading) {
    return (
      <div className="shell">
        <TopBar user={null} />
        <main className="manage"><p className="manage-hint">불러오는 중…</p></main>
      </div>
    );
  }
  if (!book) {
    return (
      <div className="shell">
        <TopBar user={user} />
        <main className="manage">
          <div className="empty">
            <strong>찾을 수 없어요</strong>
            주소가 바뀌었거나 접근 권한이 없는 노래책이에요.
            <Link className="btn btn-ghost" href="/manage">노래책 관리로</Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <TopBar user={user} />
      <main className="manage">
        <div className="manage-head">
          <div>
            <h1>{book.title}</h1>
            <p className="sub">등록된 곡 {songs.length}개</p>
          </div>
          <div className="manage-nav">
            <Link className="btn btn-ghost" href={`/manage/${slug}`}>설정</Link>
            <Link className="btn btn-ghost" href={`/manage/${slug}/members`}>매니저</Link>
            <Link className="btn btn-primary" href={`/manage/${slug}/songs/new`}>곡 등록</Link>
          </div>
        </div>

        {error && <p className="manage-error">{error}</p>}

        {songs.length === 0 ? (
          <div className="empty">
            <strong>아직 등록된 곡이 없어요</strong>
            부를 수 있는 곡을 등록하면 시청자 페이지에 바로 보여요.
            <Link className="btn btn-primary" href={`/manage/${slug}/songs/new`}>
              첫 곡 등록하기
            </Link>
          </div>
        ) : (
          <table className="manage-table">
            <thead>
              <tr><th>제목</th><th>가수</th><th>장르</th><th>키</th><th>가격</th><th /></tr>
            </thead>
            <tbody>
              {songs.map((song) => (
                <tr key={song.id}>
                  <td>{song.title}</td>
                  <td>{song.artist}</td>
                  <td><span className="tag">{song.genre}</span></td>
                  <td>{song.key > 0 ? `+${song.key}` : song.key}</td>
                  <td>{song.price.toLocaleString()}원</td>
                  <td>
                    <button className="btn btn-ghost" type="button" onClick={() => remove(song)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
