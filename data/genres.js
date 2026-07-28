export const GENRES = [
  "발라드",
  "K-POP",
  "POP",
  "J-POP",
  "애니",
  "락",
  "밴드",
  "댄스",
  "R&B",
  "재즈",
  "트로트",
  "기타",
];

export const PRICE_PRESETS = [0, 1000, 3000, 5000, 10000];

export const KEY_RANGE = { min: -6, max: 6 };

export function formatKey(key) {
  if (key === 0) return "원키";
  return key > 0 ? `+${key}` : `${key}`;
}

export function formatPrice(price) {
  return price === 0 ? "무료" : `${price.toLocaleString("ko-KR")}원`;
}
