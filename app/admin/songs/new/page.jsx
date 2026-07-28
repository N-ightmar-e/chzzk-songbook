"use client";

import { useMemo, useRef, useState } from "react";
import { GENRES, PRICE_PRESETS, KEY_RANGE, formatKey, formatPrice } from "@/data/genres";
import { kanaToHangul, hasKana } from "@/lib/kana";
import { extractVideoId, suggestFromTitle } from "@/lib/youtube";
import CsvImport from "./CsvImport";

function AliasInput({ id, label, sub, value, onChange, aliases, onAliasesChange, error, suggests }) {
  const [draft, setDraft] = useState("");

  function addAlias(term) {
    const next = term.trim();
    if (!next || aliases.includes(next) || next === value) return;
    onAliasesChange([...aliases, next]);
  }

  const kanaSuggest = hasKana(value) ? kanaToHangul(value) : "";
  const extras = [
    ...(kanaSuggest && kanaSuggest !== value && !aliases.includes(kanaSuggest)
      ? [{ term: kanaSuggest, note: "한글 표기" }]
      : []),
    ...(suggests || [])
      .filter((s) => s !== value && !aliases.includes(s))
      .map((s) => ({ term: s, note: null })),
  ];

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {sub && <span className="sub">{sub}</span>}
      </label>
      <input
        id={id}
        className="text-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? "true" : undefined}
        placeholder={label === "곡 제목" ? "예) 역몽" : "예) 켄시 요네즈"}
      />
      {error && <p className="field-error">{error}</p>}

      <div className="input-row" style={{ marginTop: 9 }}>
        <input
          className="text-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addAlias(draft);
              setDraft("");
            }
          }}
          placeholder="다른 표기 추가 후 Enter (예: 사카유메, 逆夢)"
          aria-label={`${label} 다른 표기`}
        />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            addAlias(draft);
            setDraft("");
          }}
        >
          추가
        </button>
      </div>

      {aliases.length > 0 && (
        <div className="chips">
          {aliases.map((alias) => (
            <span className="chip" key={alias}>
              {alias}
              <button
                type="button"
                onClick={() => onAliasesChange(aliases.filter((a) => a !== alias))}
                aria-label={`${alias} 삭제`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {extras.length > 0 && (
        <div className="suggests">
          <span className="caption">추천</span>
          {extras.map(({ term, note }) => (
            <button
              type="button"
              className="suggest"
              key={term}
              onClick={() => addAlias(term)}
            >
              + {term}
              {note && <span className="sub">{note}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewSongPage() {
  const [mode, setMode] = useState("single");
  const [mrUrl, setMrUrl] = useState("");
  const [mrMeta, setMrMeta] = useState(null);
  const [mrLoading, setMrLoading] = useState(false);
  const [mrError, setMrError] = useState("");

  const [title, setTitle] = useState("");
  const [titleAliases, setTitleAliases] = useState([]);
  const [artist, setArtist] = useState("");
  const [artistAliases, setArtistAliases] = useState([]);
  const [jacket, setJacket] = useState("");

  const [genre, setGenre] = useState("");
  const [songKey, setSongKey] = useState(0);
  const [keyLinks, setKeyLinks] = useState({});
  const [price, setPrice] = useState(3000);

  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const suggests = useMemo(() => suggestFromTitle(mrMeta?.title), [mrMeta]);

  async function loadMr() {
    if (!mrUrl.trim()) return;
    setMrLoading(true);
    setMrError("");
    try {
      const res = await fetch(`/api/youtube?url=${encodeURIComponent(mrUrl)}`);
      const data = await res.json();
      if (!res.ok) {
        setMrMeta(null);
        setMrError(data.error || "불러오지 못했어요.");
        return;
      }
      setMrMeta(data);
      if (!jacket) setJacket(data.thumbnail);
    } catch {
      setMrError("네트워크 오류로 불러오지 못했어요.");
    } finally {
      setMrLoading(false);
    }
  }

  async function uploadJacket(file) {
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body });
    const data = await res.json();
    if (res.ok) setJacket(data.url);
    else setStatus({ type: "error", message: data.error });
  }

  const currentKeyLink = songKey === 0 ? mrUrl : keyLinks[String(songKey)] || "";

  function setCurrentKeyLink(url) {
    if (songKey === 0) {
      setMrUrl(url);
      return;
    }
    setKeyLinks({ ...keyLinks, [String(songKey)]: url });
  }

  const matchTerms = useMemo(() => {
    const all = [title, ...titleAliases, artist, ...artistAliases];
    return [...new Set(all.map((t) => t.trim()).filter(Boolean))];
  }, [title, titleAliases, artist, artistAliases]);

  async function submit() {
    setSaving(true);
    setStatus(null);
    const payload = {
      jacket: jacket || null,
      title: title.trim(),
      titleAliases,
      artist: artist.trim(),
      artistAliases,
      mrUrl: mrUrl.trim(),
      mrVideoId: mrMeta?.videoId || extractVideoId(mrUrl),
      mrTitle: mrMeta?.title || null,
      mrChannel: mrMeta?.channel || null,
      key: songKey,
      keyLinks,
      genre,
      price: Number(price) || 0,
    };

    const res = await fetch("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setErrors(data.errors || {});
      setStatus({ type: "error", message: "입력을 다시 확인해 주세요." });
      return;
    }

    setErrors({});
    setStatus({ type: "ok", message: `"${data.song.title}" 등록 완료` });
    setMrUrl("");
    setMrMeta(null);
    setTitle("");
    setTitleAliases([]);
    setArtist("");
    setArtistAliases([]);
    setJacket("");
    setSongKey(0);
    setKeyLinks({});
  }

  const registeredKeys = Object.entries(keyLinks).filter(([, url]) => url?.trim());

  return (
    <div className="admin">
      <header className="admin-top">
        <div>
          <h1>곡 등록</h1>
          <p>
            {mode === "csv"
              ? "이미 정리해 둔 목록이 있다면 CSV로 한 번에 올리세요."
              : "노래책에 새 곡을 추가합니다. MR 링크를 먼저 넣으면 나머지가 자동으로 채워져요."}
          </p>
        </div>
        <a className="btn btn-ghost" href="/">
          노래책으로
        </a>
      </header>

      <div className="mode-toggle" role="group" aria-label="등록 방식">
        <button type="button" aria-pressed={mode === "single"} onClick={() => setMode("single")}>
          한 곡씩 입력
        </button>
        <button type="button" aria-pressed={mode === "csv"} onClick={() => setMode("csv")}>
          CSV로 한번에
        </button>
      </div>

      {mode === "csv" && <CsvImport />}

      <div className="admin-body" hidden={mode !== "single"}>
        <div>
          <section className="form-section">
            <h2>MR 영상</h2>
            <p className="hint">
              유튜브 주소를 넣으면 제목·채널·썸네일을 불러옵니다. 아직 찾지 않았다면 검색부터 하세요.
            </p>

            <div className="field">
              <label htmlFor="mr-url">유튜브 주소</label>
              <div className="input-row">
                <input
                  id="mr-url"
                  className="text-input"
                  value={mrUrl}
                  onChange={(e) => setMrUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadMr()}
                  placeholder="https://youtu.be/..."
                  aria-invalid={mrError ? "true" : undefined}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={loadMr}
                  disabled={mrLoading || !mrUrl.trim()}
                >
                  {mrLoading ? "불러오는 중" : "불러오기"}
                </button>
              </div>
              {mrError && <p className="field-error">{mrError}</p>}

              <div className="suggests">
                <a
                  className="suggest"
                  href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                    `${artist} ${title} MR 노래방`.trim()
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  유튜브에서 MR 검색 ↗
                </a>
              </div>
            </div>

            {mrMeta && (
              <>
                <div className="yt-frame">
                  <iframe
                    src={`https://www.youtube.com/embed/${mrMeta.videoId}`}
                    title={mrMeta.title}
                    allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <div className="yt-meta">
                  <span className="name">{mrMeta.title}</span>
                  <span>· {mrMeta.channel}</span>
                </div>
              </>
            )}
          </section>

          <section className="form-section">
            <h2>곡 정보</h2>
            <p className="hint">
              다른 표기를 넣어두면 시청자가 어떤 표기로 검색해도 이 곡이 나옵니다.
            </p>

            <div className="field">
              <span className="label">
                자켓<span className="sub">선택</span>
              </span>
              <div className="jacket-field">
                <div className="jacket-preview">
                  {jacket ? (
                    <img
                      src={jacket}
                      alt=""
                      onError={(e) => {
                        if (mrMeta?.thumbnailFallback && e.currentTarget.src !== mrMeta.thumbnailFallback) {
                          e.currentTarget.src = mrMeta.thumbnailFallback;
                        }
                      }}
                    />
                  ) : (
                    "없음"
                  )}
                </div>
                <div className="jacket-actions">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(e) => uploadJacket(e.target.files?.[0])}
                  />
                  <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                    이미지 올리기
                  </button>
                  {mrMeta && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setJacket(mrMeta.thumbnail)}
                    >
                      유튜브 썸네일 쓰기
                    </button>
                  )}
                  {jacket && (
                    <button type="button" className="btn btn-ghost" onClick={() => setJacket("")}>
                      제거
                    </button>
                  )}
                </div>
              </div>
            </div>

            <AliasInput
              id="song-title"
              label="곡 제목"
              sub="대표 표기"
              value={title}
              onChange={setTitle}
              aliases={titleAliases}
              onAliasesChange={setTitleAliases}
              error={errors.title}
              suggests={suggests}
            />

            <AliasInput
              id="song-artist"
              label="가수"
              sub="대표 표기"
              value={artist}
              onChange={setArtist}
              aliases={artistAliases}
              onAliasesChange={setArtistAliases}
              error={errors.artist}
              suggests={suggests}
            />
          </section>

          <section className="form-section">
            <h2>장르 · 키 · 가격</h2>
            <p className="hint">노래책 카드와 신청 화면에 그대로 노출되는 값입니다.</p>

            <div className="field">
              <span className="label">장르</span>
              <div className="genre-grid">
                {GENRES.map((g) => (
                  <button
                    type="button"
                    key={g}
                    aria-pressed={genre === g}
                    onClick={() => setGenre(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
              {errors.genre && <p className="field-error">{errors.genre}</p>}
            </div>

            <div className="field">
              <span className="label">
                부르는 키<span className="sub">반음 단위</span>
              </span>
              <div className="key-stepper">
                <button
                  type="button"
                  className="step"
                  onClick={() => setSongKey(songKey - 1)}
                  disabled={songKey <= KEY_RANGE.min}
                  aria-label="키 낮추기"
                >
                  −
                </button>
                <span className={songKey === 0 ? "value" : "value shifted"}>
                  {formatKey(songKey)}
                </span>
                <button
                  type="button"
                  className="step"
                  onClick={() => setSongKey(songKey + 1)}
                  disabled={songKey >= KEY_RANGE.max}
                  aria-label="키 올리기"
                >
                  +
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setSongKey(0)}>
                  원키로
                </button>
              </div>

              <div className="notice">
                <strong>유튜브 플레이어는 재생 중 키를 바꿀 수 없습니다.</strong> 임베드 영상은
                브라우저가 오디오에 접근할 수 없어 실시간 피치 조절이 막혀 있어요. 대신 이
                키로 올라온 MR 영상을 등록해 두면, 신청 시 그 영상이 바로 재생됩니다.
              </div>

              {songKey !== 0 && (
                <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
                  <label htmlFor="key-link">{formatKey(songKey)} 키 MR 주소</label>
                  <input
                    id="key-link"
                    className="text-input"
                    value={currentKeyLink}
                    onChange={(e) => setCurrentKeyLink(e.target.value)}
                    placeholder="이 키로 올라온 MR 영상 주소 (비우면 원키 MR로 재생)"
                  />
                </div>
              )}

              {registeredKeys.length > 0 && (
                <div className="key-links">
                  {registeredKeys.map(([k]) => (
                    <span className="chip" key={k}>
                      {formatKey(Number(k))} MR
                      <button
                        type="button"
                        onClick={() => {
                          const next = { ...keyLinks };
                          delete next[k];
                          setKeyLinks(next);
                        }}
                        aria-label={`${formatKey(Number(k))} MR 삭제`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="field">
              <span className="label">
                신청 가격<span className="sub">시청자가 이 곡을 신청할 때 후원 금액</span>
              </span>
              <div className="price-row">
                {PRICE_PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p}
                    className="preset"
                    aria-pressed={Number(price) === p}
                    onClick={() => setPrice(p)}
                  >
                    {formatPrice(p)}
                  </button>
                ))}
                <span className="price-custom">
                  <input
                    className="text-input"
                    type="number"
                    min="0"
                    step="100"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    aria-label="가격 직접 입력"
                    aria-invalid={errors.price ? "true" : undefined}
                  />
                  <span className="sub">원</span>
                </span>
              </div>
              {errors.price && <p className="field-error">{errors.price}</p>}
            </div>
          </section>
        </div>

        <aside className="preview-panel">
          <h2>노래책에 이렇게 보입니다</h2>

          <div className="preview-card">
            <div className="art">
              {jacket ? <img src={jacket} alt="" /> : "자켓 없음"}
            </div>
            <div>
              <div className="title">{title || "곡 제목"}</div>
              <div className="artist">{artist || "가수"}</div>
            </div>
            <div className="badges">
              {genre && <span className="badge">{genre}</span>}
              {songKey !== 0 && <span className="badge badge-key">{formatKey(songKey)} 키</span>}
              {mrMeta && <span className="badge">MR 있음</span>}
            </div>
            <div className="foot">
              <span className="price">{formatPrice(Number(price) || 0)}</span>
            </div>
          </div>

          <div className="match-box">
            <h3>검색 매칭</h3>
            <p>시청자가 아래 표기 중 무엇으로 검색해도 이 곡이 나옵니다.</p>
            <div className="match-terms">
              {matchTerms.length > 0 ? (
                matchTerms.map((term) => (
                  <span className="match-term" key={term}>
                    {term}
                  </span>
                ))
              ) : (
                <span className="match-term" style={{ color: "var(--muted)" }}>
                  제목·가수를 입력하면 표시돼요
                </span>
              )}
            </div>
          </div>

          <div className="submit-area">
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={saving}
            >
              {saving ? "등록하는 중" : "곡 등록하기"}
            </button>
            {status && (
              <span className={`status ${status.type}`}>{status.message}</span>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
