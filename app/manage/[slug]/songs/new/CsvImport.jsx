"use client";

import { useRef, useState } from "react";
import { decodeBytes, buildRows, SAMPLE_CSV } from "@/lib/csv";
import { formatKey, formatPrice } from "@/data/genres";

const DELIMITER_LABEL = { ",": "쉼표", "\t": "탭", ";": "세미콜론" };

export default function CsvImport({ songbookId, onImported }) {
  const [source, setSource] = useState(null);
  const [result, setResult] = useState(null);
  const [useThumbnail, setUseThumbnail] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState(null);
  const fileRef = useRef(null);

  async function readFile(file) {
    if (!file) return;
    setStatus(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { text, encoding } = decodeBytes(bytes);
    const existing = await fetch(`/api/songbooks/${songbookId}/songs`)
      .then((r) => r.json())
      .then((d) => d.songs)
      .catch(() => []);
    const next = { name: file.name, encoding, text, existing };
    setSource(next);
    setResult(buildRows(text, existing, { thumbnailFromYoutube: useThumbnail }));
  }

  function reparse(thumbnail) {
    setUseThumbnail(thumbnail);
    if (source) {
      setResult(buildRows(source.text, source.existing, { thumbnailFromYoutube: thumbnail }));
    }
  }

  function toggleRow(line) {
    setResult((prev) => ({
      ...prev,
      rows: prev.rows.map((row) =>
        row.line === line ? { ...row, include: !row.include } : row
      ),
    }));
  }

  function setAll(predicate) {
    setResult((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => ({ ...row, include: predicate(row) })),
    }));
  }

  function downloadSample() {
    // 엑셀이 한글을 깨뜨리지 않도록 BOM을 붙인다
    const blob = new Blob(["﻿" + SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "노래책-예시.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importSelected() {
    const selected = result.rows.filter((row) => row.include && row.errors.length === 0);
    if (selected.length === 0) return;
    setImporting(true);
    setStatus(null);

    const res = await fetch(`/api/songbooks/${songbookId}/songs/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // CSV의 자켓은 유튜브 썸네일 URL이라 Storage 경로가 아니다.
        // jacketPath에 넣으면 jacketPublicUrl이 잘못된 주소를 만드므로 비워서 보낸다.
        songs: selected.map((row) => {
          const { jacket, ...song } = row.song;
          return song;
        }),
      }),
    });
    const data = await res.json();
    setImporting(false);

    if (!res.ok) {
      setStatus({ type: "error", message: data.error || "등록에 실패했어요." });
      return;
    }
    setStatus({ type: "ok", message: `${data.created}곡을 등록했어요.` });
    setSource(null);
    setResult(null);
    onImported?.(data.created);
  }

  const rows = result?.rows || [];
  const selectedCount = rows.filter((r) => r.include && r.errors.length === 0).length;
  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  const dupCount = rows.filter((r) => r.duplicate).length;

  return (
    <section className="form-section" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
      <h2>CSV로 한번에 등록</h2>
      <p className="hint">
        스프레드시트에서 CSV로 내려받아 올리면 여러 곡을 한 번에 넣습니다. 등록 전에 미리
        확인하고 뺄 수 있어요.
      </p>

      <div
        className={dragging ? "dropzone dragging" : "dropzone"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          readFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          hidden
          onChange={(e) => readFile(e.target.files?.[0])}
        />
        <strong>CSV 파일을 끌어다 놓거나 클릭해서 고르세요</strong>
        <span>
          첫 줄은 헤더 · 제목과 가수는 필수, 나머지 열은 있으면 씁니다 · 엑셀에서 저장한
          한글 인코딩 파일도 읽습니다
        </span>
      </div>

      <div className="csv-actions">
        <button type="button" className="btn btn-ghost" onClick={downloadSample}>
          예시 CSV 내려받기
        </button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={useThumbnail}
            onChange={(e) => reparse(e.target.checked)}
          />
          유튜브 링크가 있으면 썸네일을 자켓으로 쓰기
        </label>
      </div>

      {status && (
        <p className={`csv-status ${status.type}`} role="status">
          {status.message}
        </p>
      )}

      {result?.fatal && (
        <div className="notice" style={{ marginTop: 16 }}>
          <strong>{result.fatal}</strong>
          <br />
          인식할 수 있는 제목 열 이름: 제목 · 곡명 · title / 가수 열 이름: 가수 · 아티스트 · artist
        </div>
      )}

      {result && !result.fatal && (
        <>
          <div className="csv-summary">
            <span className="file">{source.name}</span>
            <span>{source.encoding}</span>
            <span>{DELIMITER_LABEL[result.delimiter] || result.delimiter} 구분</span>
            <span>{rows.length}행</span>
            {errorCount > 0 && <span className="warn">오류 {errorCount}행</span>}
            {dupCount > 0 && <span className="warn">중복 {dupCount}행</span>}
          </div>

          {result.unmatched.length > 0 && (
            <p className="csv-note">
              쓰이지 않은 열: {result.unmatched.join(", ")}
            </p>
          )}

          <div className="csv-toolbar">
            <button type="button" className="btn btn-ghost" onClick={() => setAll((r) => r.errors.length === 0)}>
              전부 선택
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setAll((r) => r.errors.length === 0 && !r.duplicate)}
            >
              중복 빼고 선택
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAll(() => false)}>
              전부 해제
            </button>
          </div>

          <div className="csv-table-wrap">
            <table className="csv-table">
              <thead>
                <tr>
                  <th scope="col" className="pick">등록</th>
                  <th scope="col">줄</th>
                  <th scope="col">제목</th>
                  <th scope="col">가수</th>
                  <th scope="col">장르</th>
                  <th scope="col">키</th>
                  <th scope="col">가격</th>
                  <th scope="col">확인할 점</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.line} className={row.errors.length > 0 ? "row-error" : undefined}>
                    <td className="pick">
                      <input
                        type="checkbox"
                        checked={row.include}
                        disabled={row.errors.length > 0}
                        onChange={() => toggleRow(row.line)}
                        aria-label={`${row.line}번째 줄 등록`}
                      />
                    </td>
                    <td className="num">{row.line}</td>
                    <td className="strong">
                      {row.song.title || <span className="blank">비어 있음</span>}
                      {row.song.titleAliases.length > 0 && (
                        <span className="alias">+{row.song.titleAliases.length}</span>
                      )}
                    </td>
                    <td>
                      {row.song.artist || <span className="blank">비어 있음</span>}
                      {row.song.artistAliases.length > 0 && (
                        <span className="alias">+{row.song.artistAliases.length}</span>
                      )}
                    </td>
                    <td>{row.song.genre}</td>
                    <td className="num">{formatKey(row.song.key)}</td>
                    <td className="num">{formatPrice(row.song.price)}</td>
                    <td className="notes">
                      {row.errors.map((e) => (
                        <span className="pill pill-error" key={e}>{e}</span>
                      ))}
                      {row.warnings.map((w) => (
                        <span className="pill" key={w}>{w}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="csv-submit">
            <button
              type="button"
              className="btn btn-primary"
              onClick={importSelected}
              disabled={importing || selectedCount === 0}
            >
              {importing ? "등록하는 중" : `${selectedCount}곡 등록하기`}
            </button>
            {selectedCount === 0 && <span className="hint">등록할 행을 선택해 주세요.</span>}
          </div>
        </>
      )}
    </section>
  );
}
