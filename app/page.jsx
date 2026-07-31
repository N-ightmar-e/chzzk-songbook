"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// 로그인 실패 사유별 안내. 재시도로 해결되는 것과 아닌 것을 구분한다 —
// OAuth 미설정에 "다시 시도해 주세요" 는 틀린 안내다.
const AUTH_ERROR = {
  state: "로그인 요청이 만료됐어요. 다시 시도해 주세요.",
  unconfigured: "아직 치지직 로그인이 준비되지 않았어요. 잠시 후 다시 찾아와 주세요.",
  1: "로그인에 실패했어요. 다시 시도해 주세요.",
};

// useSearchParams()는 정적 프리렌더 시 Suspense 경계를 요구한다
// (https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout).
export default function LandingPage() {
  return (
    <Suspense fallback={<main className="landing"><p>불러오는 중…</p></main>}>
      <LandingContent />
    </Suspense>
  );
}

function LandingContent() {
  const params = useSearchParams();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const authError = params.get("authError");
  const errorMessage = authError
    ? AUTH_ERROR[authError] ?? AUTH_ERROR[1]
    : null;

  const books = me?.songbooks ?? [];

  return (
    <main className="landing">
      <h1>치지직 노래책</h1>
      <p className="landing-lead">
        채팅창에 물어보지 않아도, 부를 수 있는 곡이 한눈에.
      </p>

      {errorMessage && <p className="landing-error">{errorMessage}</p>}

      {loading ? (
        <p>불러오는 중…</p>
      ) : me?.user ? (
        <div className="landing-actions">
          {books.length > 0 && (
            <Link className="btn btn-primary" href={`/@${books[0].slug}`}>
              내 노래책 보기
            </Link>
          )}
          <Link className="btn btn-ghost" href="/manage">노래책 관리</Link>
        </div>
      ) : (
        <div className="landing-actions">
          <a className="btn btn-primary" href="/api/auth/login">치지직으로 로그인</a>
        </div>
      )}

      <section className="landing-how">
        <h2>어떻게 쓰나요</h2>
        <ol>
          <li>치지직으로 로그인해서 노래책을 만듭니다.</li>
          <li>부를 수 있는 곡을 등록합니다. 스프레드시트에서 CSV로 한 번에 올릴 수도 있어요.</li>
          <li>시청자에게 <code>/@내주소</code> 를 알려주면, 곡을 골라 신청 명령어를 복사해 갑니다.</li>
        </ol>
      </section>
    </main>
  );
}
