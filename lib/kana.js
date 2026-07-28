// 일본어 가나 → 한글 표기 변환 (국립국어원 외래어 표기법)
// か·た행은 어두와 어중의 표기가 달라 [어두, 어중] 쌍으로 둔다.

const DIGRAPHS = {
  きゃ: ["갸", "캬"], きゅ: ["규", "큐"], きょ: ["교", "쿄"],
  しゃ: "샤", しゅ: "슈", しょ: "쇼",
  ちゃ: ["자", "차"], ちゅ: ["주", "추"], ちょ: ["조", "초"],
  にゃ: "냐", にゅ: "뉴", にょ: "뇨",
  ひゃ: "햐", ひゅ: "휴", ひょ: "효",
  みゃ: "먀", みゅ: "뮤", みょ: "묘",
  りゃ: "랴", りゅ: "류", りょ: "료",
  ぎゃ: "갸", ぎゅ: "규", ぎょ: "교",
  じゃ: "자", じゅ: "주", じょ: "조",
  びゃ: "뱌", びゅ: "뷰", びょ: "뵤",
  ぴゃ: "퍄", ぴゅ: "퓨", ぴょ: "표",
  てぃ: "티", でぃ: "디", ふぁ: "파", ふぃ: "피", ふぇ: "페", ふぉ: "포",
  うぃ: "위", うぇ: "웨", うぉ: "워", ゔぁ: "바", ゔぃ: "비", ゔぇ: "베", ゔぉ: "보",
};

const MONOGRAPHS = {
  あ: "아", い: "이", う: "우", え: "에", お: "오",
  か: ["가", "카"], き: ["기", "키"], く: ["구", "쿠"], け: ["게", "케"], こ: ["고", "코"],
  さ: "사", し: "시", す: "스", せ: "세", そ: "소",
  た: ["다", "타"], ち: ["지", "치"], つ: "쓰", て: ["데", "테"], と: ["도", "토"],
  な: "나", に: "니", ぬ: "누", ね: "네", の: "노",
  は: "하", ひ: "히", ふ: "후", へ: "헤", ほ: "호",
  ま: "마", み: "미", む: "무", め: "메", も: "모",
  や: "야", ゆ: "유", よ: "요",
  ら: "라", り: "리", る: "루", れ: "레", ろ: "로",
  わ: "와", ゐ: "이", ゑ: "에", を: "오",
  が: "가", ぎ: "기", ぐ: "구", げ: "게", ご: "고",
  ざ: "자", じ: "지", ず: "즈", ぜ: "제", ぞ: "조",
  だ: "다", ぢ: "지", づ: "즈", で: "데", ど: "도",
  ば: "바", び: "비", ぶ: "부", べ: "베", ぼ: "보",
  ぱ: "파", ぴ: "피", ぷ: "푸", ぺ: "페", ぽ: "포",
  ゔ: "부",
  ぁ: "아", ぃ: "이", ぅ: "우", ぇ: "에", ぉ: "오",
  ゃ: "야", ゅ: "유", ょ: "요",
};

const JONGSEONG_N = 4;
const JONGSEONG_S = 19;

function withJongseong(text, jongseong) {
  const code = text.charCodeAt(text.length - 1);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return text;
  if ((code - 0xac00) % 28 !== 0) return text;
  return text.slice(0, -1) + String.fromCharCode(code + jongseong);
}

// 장음은 표기하지 않는다(とうきょう → 도쿄). 앞 음절의 중성이 ㅗ/ㅛ/ㅜ/ㅠ/ㅡ면
// 뒤따르는 う를, ㅗ/ㅛ면 뒤따르는 お를 흘려보낸다.
const LONG_U_AFTER = new Set([8, 12, 13, 17, 18]);
const LONG_O_AFTER = new Set([8, 12]);

function jungseongOf(text) {
  const code = text.charCodeAt(text.length - 1);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return -1;
  return Math.floor(((code - 0xac00) % 588) / 28);
}

function toHiragana(text) {
  return text.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  );
}

function pick(entry, atWordStart) {
  return Array.isArray(entry) ? entry[atWordStart ? 0 : 1] : entry;
}

export function hasKana(text) {
  return /[ぁ-ゖァ-ヺ]/.test(text || "");
}

export function hasKanji(text) {
  return /[一-鿿]/.test(text || "");
}

export function kanaToHangul(input) {
  const src = toHiragana(input || "");
  let out = "";
  let atWordStart = true;

  for (let i = 0; i < src.length; i += 1) {
    const digraph = DIGRAPHS[src.slice(i, i + 2)];
    if (digraph) {
      out += pick(digraph, atWordStart);
      atWordStart = false;
      i += 1;
      continue;
    }

    const ch = src[i];

    if (ch === "っ") {
      out = withJongseong(out, JONGSEONG_S);
      continue;
    }
    if (ch === "ん") {
      out = withJongseong(out, JONGSEONG_N);
      continue;
    }
    if (ch === "ー") continue;
    if (ch === "う" && LONG_U_AFTER.has(jungseongOf(out))) continue;
    if (ch === "お" && LONG_O_AFTER.has(jungseongOf(out))) continue;

    const mono = MONOGRAPHS[ch];
    if (mono) {
      out += pick(mono, atWordStart);
      atWordStart = false;
      continue;
    }

    out += ch;
    atWordStart = true;
  }

  return out;
}
