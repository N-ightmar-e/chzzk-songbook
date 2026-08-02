"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import TopBar from "../../TopBar";
import "../../manage/manage.css";

export default function InvitePage() {
  const { token } = useParams();
  const router = useRouter();
  const [state, setState] = useState({ phase: "checking" });
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      const me = await (await fetch("/api/me")).json();
      setUser(me.user);
      if (!me.user) {
        setState({ phase: "login" });
        return;
      }

      const res = await fetch(`/api/invites/${token}/accept`, { method: "POST" });
      const body = await res.json();

      if (res.ok) {
        setState({ phase: "done", songbookId: body.songbookId });
        return;
      }
      setState({ phase: "error", message: body.error ?? "초대를 수락하지 못했어요." });
    })();
  }, [token]);

  return (
    <div className="shell">
      <TopBar user={user} />
      <main className="manage">
        <div className="manage-head">
          <div>
            <h1>노래책 매니저 초대</h1>
            <p className="sub">수락하면 이 노래책의 곡을 등록·수정할 수 있어요.</p>
          </div>
        </div>

        {state.phase === "checking" && <p className="manage-hint">확인하는 중…</p>}

        {state.phase === "login" && (
          <div className="empty">
            <strong>로그인이 필요해요</strong>
            {/* 로그인 후 이 페이지로 돌아오면 자동으로 수락된다. */}
            초대를 수락하려면 치지직으로 로그인해 주세요.
            <a className="btn btn-primary" href="/api/auth/login">치지직으로 로그인</a>
          </div>
        )}

        {state.phase === "done" && (
          <div className="empty">
            <strong>매니저가 되었어요</strong>
            이제 노래책 관리에서 곡을 등록할 수 있어요.
            <button className="btn btn-primary" type="button" onClick={() => router.push("/manage")}>
              노래책 관리로
            </button>
          </div>
        )}

        {state.phase === "error" && (
          <div className="empty">
            <strong>초대를 수락하지 못했어요</strong>
            <p className="manage-error">{state.message}</p>
            <button className="btn btn-ghost" type="button" onClick={() => router.push("/")}>
              처음으로
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
