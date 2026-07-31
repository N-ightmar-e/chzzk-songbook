import { it, expect, afterEach, vi } from "vitest";
import { describeDb } from "../helpers/db.js";
import { uploadJacketFromYoutube, deleteJacket, UploadError } from "@/lib/storage";

// 1x1 투명 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function imageResponse(bytes) {
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(
    bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

describeDb("lib/storage — 유튜브 썸네일", () => {
  const songbookId = "00000000-0000-0000-0000-0000000000bb";
  const uploaded = [];

  afterEach(async () => {
    for (const path of uploaded) await deleteJacket(path);
    uploaded.length = 0;
    vi.unstubAllGlobals();
  });

  it("썸네일을 받아 Storage에 올린다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse(PNG)));
    const result = await uploadJacketFromYoutube(songbookId, "dQw4w9WgXcQ");
    uploaded.push(result.path);
    expect(result.path).toMatch(new RegExp(`^${songbookId}/[0-9a-f-]+\\.png$`));
    expect(result.publicUrl).toContain("/jackets/");
  });

  it("서버가 주소를 조립한다 — 사용자 URL을 받지 않는다", async () => {
    const f = vi.fn().mockResolvedValue(imageResponse(PNG));
    vi.stubGlobal("fetch", f);
    const result = await uploadJacketFromYoutube(songbookId, "dQw4w9WgXcQ");
    uploaded.push(result.path);
    const requested = String(f.mock.calls[0][0]);
    expect(requested.startsWith("https://i.ytimg.com/vi/dQw4w9WgXcQ/")).toBe(true);
  });

  it("videoId 형식이 아니면 거부한다", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (const bad of ["../../etc", "short", "way-too-long-id-here", "", null]) {
      await expect(uploadJacketFromYoutube(songbookId, bad)).rejects.toThrow(UploadError);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("이미지가 아닌 응답을 거부한다", async () => {
    // 유튜브가 오류 페이지를 200으로 주는 경우가 있다.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      imageResponse(Buffer.from("<html>not found</html>")),
    ));
    await expect(uploadJacketFromYoutube(songbookId, "dQw4w9WgXcQ"))
      .rejects.toThrow(UploadError);
  });

  it("maxres가 없으면 hqdefault로 물러난다", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
      .mockResolvedValueOnce(imageResponse(PNG));
    vi.stubGlobal("fetch", f);
    const result = await uploadJacketFromYoutube(songbookId, "dQw4w9WgXcQ");
    uploaded.push(result.path);
    expect(String(f.mock.calls[1][0])).toContain("hqdefault");
  });

  it("둘 다 없으면 거부한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) },
    ));
    await expect(uploadJacketFromYoutube(songbookId, "dQw4w9WgXcQ")).rejects.toThrow(UploadError);
  });

  it("너무 큰 썸네일을 거부한다", async () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse(huge)));
    await expect(uploadJacketFromYoutube(songbookId, "dQw4w9WgXcQ"))
      .rejects.toThrow(/2MB/);
  });
});
