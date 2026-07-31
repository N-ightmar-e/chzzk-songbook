"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "./manage.css";

export default function ManagePage() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/me");
    setMe(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function create(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/songbooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, title }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "노래책을 만들지 못했어요.");
        return;
      }
      setSlug("");
      setTitle("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="manage"><p>불러오는 중…</p></main>;

  if (!me?.user) {
    return (
      <main className="manage">
        <h1>노래책 관리</h1>
        <p>치지직으로 로그인하면 노래책을 만들 수 있어요.</p>
        <a className="btn btn-primary" href="/api/auth/login">치지직으로 로그인</a>
      </main>
    );
  }

  const books = me.songbooks ?? [];

  return (
    <main className="manage">
      <h1>노래책 관리</h1>

      {books.length > 0 && (
        <ul className="manage-list">
          {books.map((book) => (
            <li key={book.id}>
              <Link href={`/manage/${book.slug}`}>
                <strong>{book.title}</strong>
                <span>/@{book.slug}</span>
              </Link>
              <span className="manage-role">
                {book.role === "owner" ? "소유자" : "매니저"}
              </span>
              <Link className="btn btn-ghost" href={`/manage/${book.slug}/songs`}>
                곡 관리
              </Link>
            </li>
          ))}
        </ul>
      )}

      {books.some((b) => b.role === "owner") ? (
        <p className="manage-hint">노래책은 계정당 하나만 만들 수 있어요.</p>
      ) : (
        <form className="manage-form" onSubmit={create}>
          <h2>노래책 만들기</h2>
          <label>
            주소
            <span className="manage-prefix">/@</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="dutto"
              maxLength={30}
              required
            />
          </label>
          <label>
            이름
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="듀토의 노래책"
              required
            />
          </label>
          {error && <p className="manage-error">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "만드는 중…" : "만들기"}
          </button>
        </form>
      )}
    </main>
  );
}
