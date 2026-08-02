"use client";

// 시청자 페이지와 관리 화면이 같은 헤더를 쓴다.
//
// 원래 이 마크업은 SongbookView 안에 인라인으로 있었고, 관리 화면에는 헤더가
// 아예 없었다. 그래서 /@slug 에서 /manage 로 넘어가면 워드마크도 로그인 상태도
// 사라져 다른 사이트처럼 보였다. 마크업은 옮기기만 했다 — globals.css 의
// .topbar / .wordmark / .user-chip 규칙을 그대로 쓴다.
//
// children 은 .auth-area 맨 뒤에 붙는 페이지별 네비다. 시청자 페이지가 넘기는
// "노래책 관리" 링크가 원래 위치 그대로 오도록 순서를 맞춰 뒀다.
export default function TopBar({ user, onLogout, children }) {
  async function logout() {
    // 시청자 페이지는 토스트를 띄우려고 자기 핸들러를 넘긴다.
    // 관리 화면처럼 넘기지 않는 쪽은 여기서 처리하고 첫 화면으로 보낸다.
    if (onLogout) {
      onLogout();
      return;
    }
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/";
  }

  return (
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
        {children}
      </div>
    </header>
  );
}
