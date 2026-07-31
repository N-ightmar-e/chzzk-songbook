import "./globals.css";

export const metadata = {
  title: "노래책",
  description: "치지직 노래방송 신청곡 목록 — 부를 수 있는 곡이 한눈에.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link
          href="https://cdn.jsdelivr.net/gh/sunn-us/SUIT/fonts/variable/woff2/SUIT-Variable.css"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
