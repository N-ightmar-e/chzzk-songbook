"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import "../../manage.css";

export default function SongListPage() {
  const { slug } = useParams();
  const [book, setBook] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const me = await (await fetch("/api/me")).json();
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

  if (loading) return <main className="manage"><p>불러오는 중…</p></main>;
  if (!book) {
    return (
      <main className="manage">
        <p>찾을 수 없어요.</p>
        <Link className="btn btn-ghost" href="/manage">돌아가기</Link>
      </main>
    );
  }

  return (
    <main className="manage">
      <h1>{book.title} · 곡 {songs.length}개</h1>
      <Link className="btn btn-primary" href={`/manage/${slug}/songs/new`}>곡 등록</Link>
      {error && <p className="manage-error">{error}</p>}

      {songs.length === 0 ? (
        <p className="manage-hint">아직 등록된 곡이 없어요.</p>
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
                <td>{song.genre}</td>
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
  );
}
