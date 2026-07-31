"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import "../../manage.css";

const SYNC_MESSAGE = {
  synced: "동기화했어요.",
  busy: "토큰을 갱신하는 중이에요. 잠시 후 다시 시도해 주세요.",
  failed: "동기화하지 못했어요. 잠시 후 다시 시도해 주세요.",
};
const SKIP_REASON = {
  "no-token": "동기화를 켜려면 치지직으로 다시 로그인해 주세요.",
  disabled: "이 노래책은 자동 동기화가 꺼져 있어요.",
  cooldown: "방금 동기화했어요. 잠시 후 다시 시도해 주세요.",
};

export default function MembersPage() {
  const { slug } = useParams();
  const [book, setBook] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [inviteUrl, setInviteUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const me = await (await fetch("/api/me")).json();
    const found = (me.songbooks ?? []).find((b) => b.slug === slug);
    setBook(found ?? null);
    if (found) {
      const res = await fetch(`/api/songbooks/${found.id}/members`);
      if (res.ok) setMembers((await res.json()).members ?? []);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  async function sync() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/songbooks/${book.id}/members/sync`, { method: "POST" });
      if (!res.ok) {
        setNotice("동기화 권한이 없어요.");
        return;
      }
      const result = await res.json();
      setNotice(
        result.status === "skipped"
          ? SKIP_REASON[result.reason] ?? "동기화를 건너뛰었어요."
          : SYNC_MESSAGE[result.status] ?? "동기화했어요.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/songbooks/${book.id}/invites`, { method: "POST" });
      if (!res.ok) {
        setNotice("초대 링크를 만들지 못했어요.");
        return;
      }
      const body = await res.json();
      setInviteUrl(body.url);
    } finally {
      setBusy(false);
    }
  }

  async function remove(member) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/songbooks/${book.id}/members/${member.userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setNotice("해제하지 못했어요.");
        return;
      }
      if (member.source === "chzzk_sync") {
        setNotice("해제했어요. 다만 치지직에서 관리자 지정을 해제하지 않으면 다음 동기화에서 다시 추가돼요.");
      }
      await load();
    } finally {
      setBusy(false);
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

  const isOwner = book.role === "owner";

  return (
    <main className="manage">
      <h1>{book.title} · 매니저</h1>
      <Link className="btn btn-ghost" href={`/manage/${slug}`}>설정</Link>

      {isOwner && (
        <div className="manage-actions">
          <button className="btn btn-ghost" type="button" onClick={sync} disabled={busy}>
            치지직 관리자 동기화
          </button>
          <button className="btn btn-primary" type="button" onClick={invite} disabled={busy}>
            초대 링크 만들기
          </button>
        </div>
      )}

      {notice && <p className="manage-hint">{notice}</p>}

      {inviteUrl && (
        <div className="manage-invite">
          <p>이 링크를 전달하세요. 7일 뒤 만료되고 한 번만 쓸 수 있어요.</p>
          <code>{inviteUrl}</code>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => navigator.clipboard?.writeText(inviteUrl)}
          >
            복사
          </button>
        </div>
      )}

      {members.length === 0 ? (
        <p className="manage-hint">아직 매니저가 없어요.</p>
      ) : (
        <ul className="manage-list">
          {members.map((member) => (
            <li key={member.userId}>
              {member.user.chzzkChannelImage && (
                <img
                  src={member.user.chzzkChannelImage}
                  alt=""
                  width={32}
                  height={32}
                  className="manage-avatar"
                />
              )}
              <span>
                {member.user.chzzkChannelName}
                {member.user.chzzkVerified && <span className="manage-verified" title="치지직 인증 채널">✓</span>}
              </span>
              <span className="manage-role">
                {member.source === "chzzk_sync" ? "치지직 관리자" : "초대"}
              </span>
              {isOwner && (
                <button className="btn btn-ghost" type="button" onClick={() => remove(member)} disabled={busy}>
                  해제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
