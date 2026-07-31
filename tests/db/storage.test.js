import { it, expect, afterEach } from "vitest";
import { describeDb } from "../helpers/db.js";
import { uploadJacket, deleteJacket, jacketPublicUrl, UploadError } from "@/lib/storage";

// 1x1 투명 PNG
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function fakeFile(bytes, { size = bytes.length } = {}) {
  return {
    size,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

describeDb("lib/storage", () => {
  const songbookId = "00000000-0000-0000-0000-0000000000aa";
  const uploaded = [];

  afterEach(async () => {
    for (const path of uploaded) await deleteJacket(path);
    uploaded.length = 0;
  });

  it("PNG를 올리고 공개 URL을 준다", async () => {
    const result = await uploadJacket(songbookId, fakeFile(PNG_BYTES));
    uploaded.push(result.path);
    expect(result.path).toMatch(new RegExp(`^${songbookId}/[0-9a-f-]+\\.png$`));
    expect(result.publicUrl).toContain("/jackets/");
  });

  it("확장자를 서버가 정한다 — 클라이언트 파일명을 쓰지 않는다", async () => {
    const result = await uploadJacket(songbookId, fakeFile(PNG_BYTES));
    uploaded.push(result.path);
    expect(result.path.endsWith(".png")).toBe(true);
  });

  it("이미지가 아닌 바이트를 거부한다", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    await expect(uploadJacket(songbookId, fakeFile(html))).rejects.toThrow(UploadError);
  });

  it("2MB 초과를 거부한다", async () => {
    await expect(
      uploadJacket(songbookId, fakeFile(PNG_BYTES, { size: 3 * 1024 * 1024 })),
    ).rejects.toThrow(/2MB/);
  });

  it("파일이 없으면 거부한다", async () => {
    await expect(uploadJacket(songbookId, null)).rejects.toThrow(UploadError);
    await expect(uploadJacket(songbookId, "문자열")).rejects.toThrow(UploadError);
  });

  it("없는 파일을 지워도 던지지 않는다", async () => {
    await expect(deleteJacket("없는/경로.png")).resolves.toBeUndefined();
  });

  it("경로가 null이면 URL도 null이다", () => {
    expect(jacketPublicUrl(null)).toBeNull();
  });
});
