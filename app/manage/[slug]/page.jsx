"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import "../manage.css";

export default function SongbookSettingsPage() {
  const { slug } = useParams();
  const router = useRouter();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: "", intro: "", isPublic: true, slug: "" });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        const found = (d.songbooks ?? []).find((b) => b.slug === slug);
        setBook(found ?? null);
        if (found) {
          setForm((f) => ({
            ...f,
            title: found.title,
            slug: found.slug,
            intro: found.intro ?? "",
            isPublic: found.isPublic,
          }));
        }
        setLoading(false);
      });
  }, [slug]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/songbooks/${book.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "저장하지 못했어요.");
        return;
      }
      setSaved(true);
      if (body.songbook.slug !== slug) router.replace(`/manage/${body.songbook.slug}`);
    } finally {
      setSaving(false);
    }
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

  const readOnly = book.role !== "owner";

  return (
    <main className="manage">
      <h1>{book.title} 설정</h1>
      <Link className="btn btn-ghost" href={`/manage/${slug}/songs`}>곡 관리</Link>
      <Link className="btn btn-ghost" href={`/manage/${slug}/members`}>매니저</Link>

      {readOnly ? (
        <p className="manage-hint">설정 변경은 소유자만 할 수 있어요.</p>
      ) : (
        <form className="manage-form" onSubmit={save}>
          <label>
            이름
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </label>
          <label>
            주소
            <span className="manage-prefix">/@</span>
            <input
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              maxLength={30}
              required
            />
          </label>
          <label>
            소개
            <textarea
              value={form.intro}
              onChange={(e) => setForm({ ...form, intro: e.target.value })}
              rows={3}
            />
          </label>
          <label className="manage-check">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(e) => setForm({ ...form, isPublic: e.target.checked })}
            />
            시청자에게 공개
          </label>
          <label className="manage-check">
            <input
              type="checkbox"
              checked={form.chzzkSyncEnabled ?? true}
              onChange={(e) => setForm({ ...form, chzzkSyncEnabled: e.target.checked })}
            />
            치지직 채널 관리자를 매니저로 자동 등록
          </label>
          {error && <p className="manage-error">{error}</p>}
          {saved && <p className="manage-ok">저장했어요.</p>}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </form>
      )}
    </main>
  );
}
