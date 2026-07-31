"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import "../../manage/manage.css";

export default function InvitePage() {
  const { token } = useParams();
  const router = useRouter();
  const [state, setState] = useState({ phase: "checking" });

  useEffect(() => {
    (async () => {
      const me = await (await fetch("/api/me")).json();
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
    <main className="manage">
      <h1>노래책 매니저 초대</h1>

      {state.phase === "checking" && <p>확인하는 중…</p>}

      {state.phase === "login" && (
        <>
          <p>초대를 수락하려면 치지직으로 로그인해 주세요.</p>
          {/* 로그인 후 이 페이지로 돌아오면 자동으로 수락된다. */}
          <a className="btn btn-primary" href="/api/auth/login">치지직으로 로그인</a>
        </>
      )}

      {state.phase === "done" && (
        <>
          <p>매니저가 되었어요.</p>
          <button className="btn btn-primary" type="button" onClick={() => router.push("/manage")}>
            노래책 관리로
          </button>
        </>
      )}

      {state.phase === "error" && (
        <>
          <p className="manage-error">{state.message}</p>
          <button className="btn btn-ghost" type="button" onClick={() => router.push("/")}>
            처음으로
          </button>
        </>
      )}
    </main>
  );
}
