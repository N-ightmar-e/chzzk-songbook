import { describe, it, expect } from "vitest";
import { detectImageType } from "@/lib/image";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"),
]);

describe("lib/image", () => {
  it("JPEG를 판별한다", () => {
    expect(detectImageType(jpeg)).toBe("jpeg");
  });

  it("PNG를 판별한다", () => {
    expect(detectImageType(png)).toBe("png");
  });

  it("WebP를 판별한다", () => {
    expect(detectImageType(webp)).toBe("webp");
  });

  it("HTML을 이미지로 보지 않는다", () => {
    // .jpg 확장자로 위장한 HTML — 이게 이 함수의 존재 이유다.
    expect(detectImageType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
  });

  it("SVG를 이미지로 보지 않는다", () => {
    // SVG는 스크립트를 담을 수 있어 화이트리스트에서 제외한다.
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
  });

  it("GIF를 거부한다 (화이트리스트에 없다)", () => {
    expect(detectImageType(Buffer.from("GIF89a"))).toBeNull();
  });

  it("빈 버퍼·짧은 버퍼를 던지지 않고 null로 다룬다", () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0xff]))).toBeNull();
    expect(detectImageType(null)).toBeNull();
  });

  it("RIFF지만 WEBP가 아니면 거부한다", () => {
    const wav = Buffer.concat([
      Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE"),
    ]);
    expect(detectImageType(wav)).toBeNull();
  });
});
