import { GENRES } from "@/data/genres";
import { extractVideoId } from "@/lib/youtube";

// ───── 인코딩 ─────
// 한국 엑셀·한셀은 CSV를 EUC-KR(CP949)로 내보내는 일이 잦다. UTF-8로 읽어 깨지면 되돌린다.
export function decodeBytes(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8 (BOM)" };
  }
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("�")) return { text: utf8, encoding: "UTF-8" };
  try {
    const euckr = new TextDecoder("euc-kr").decode(bytes);
    if (!euckr.includes("�")) return { text: euckr, encoding: "EUC-KR" };
  } catch {
    /* 브라우저가 euc-kr을 모르면 UTF-8 결과를 그대로 쓴다 */
  }
  return { text: utf8, encoding: "UTF-8 (일부 글자 깨짐)" };
}

export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = [
    [",", (firstLine.match(/,/g) || []).length],
    ["\t", (firstLine.match(/\t/g) || []).length],
    [";", (firstLine.match(/;/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      if (char === "\r" && text[i + 1] === "\n") {
        field += "\n";
        i += 2;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      i += 1;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
      i += 1;
    } else if (char === "\n" || char === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += char === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += char;
      i += 1;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// ───── 열 매핑 ─────

const FIELD_ALIASES = {
  title: ["제목", "곡제목", "곡명", "노래제목", "노래", "title", "song", "songtitle", "name"],
  titleAliases: ["별칭", "제목별칭", "곡별칭", "다른표기", "이명", "titlealiases", "aliases", "alias"],
  artist: ["가수", "아티스트", "artist", "singer", "vocalist"],
  artistAliases: ["가수별칭", "아티스트별칭", "가수다른표기", "artistaliases", "artistalias"],
  mrUrl: ["mr", "mr링크", "mr주소", "링크", "주소", "유튜브", "유튜브링크", "url", "mrurl", "youtube", "link"],
  key: ["키", "음정", "key", "pitch"],
  genre: ["장르", "분류", "genre", "category"],
  price: ["가격", "금액", "비용", "price", "cost", "amount"],
  jacket: ["자켓", "자켓이미지", "이미지", "커버", "jacket", "image", "cover", "thumbnail"],
  popular: ["인기", "인기곡", "추천", "추천곡", "popular", "featured"],
};

function normalizeHeader(header) {
  return header.replace(/[\s_\-()[\]]/g, "").toLowerCase();
}

export function mapHeaders(headerRow) {
  const mapping = {};
  const unmatched = [];
  headerRow.forEach((raw, index) => {
    const normalized = normalizeHeader(raw);
    const field = Object.keys(FIELD_ALIASES).find((key) =>
      FIELD_ALIASES[key].includes(normalized)
    );
    if (field && mapping[field] === undefined) mapping[field] = index;
    else if (!field && raw.trim()) unmatched.push(raw.trim());
  });
  return { mapping, unmatched };
}

// ───── 값 정규화 ─────

const GENRE_ALIASES = {
  케이팝: "K-POP", k팝: "K-POP", kpop: "K-POP", "k-pop": "K-POP",
  제이팝: "J-POP", j팝: "J-POP", jpop: "J-POP", "j-pop": "J-POP",
  팝: "POP", pop: "POP", 팝송: "POP",
  발라드: "발라드", ballad: "발라드",
  애니: "애니", 애니메이션: "애니", anime: "애니", 애니송: "애니",
  락: "락", 록: "락", rock: "락",
  밴드: "밴드", band: "밴드",
  댄스: "댄스", dance: "댄스",
  알앤비: "R&B", rnb: "R&B", "r&b": "R&B",
  재즈: "재즈", jazz: "재즈",
  트로트: "트로트", trot: "트로트",
  기타: "기타", etc: "기타",
};

export function normalizeGenre(raw) {
  const value = (raw || "").trim();
  if (!value) return null;
  if (GENRES.includes(value)) return value;
  return GENRE_ALIASES[value.toLowerCase()] || null;
}

export function splitAliases(raw) {
  return (raw || "")
    // 셀 안에서는 ; | , 로 나누고, 슬래시는 "역몽 / 사카유메"처럼 띄어쓴 경우만 나눈다
    // (AC/DC 같은 표기를 쪼개지 않기 위해)
    .split(/\s*[;|,]\s*|\s+\/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseKey(raw) {
  const value = (raw || "").trim();
  if (!value || /^(원키|기본|original)$/i.test(value)) return 0;
  const match = value.match(/^([+-]?\d+)/);
  if (!match) return null;
  return Math.max(-6, Math.min(6, Number(match[1])));
}

export function parsePrice(raw) {
  const value = (raw || "").trim();
  if (!value) return 0;
  if (/^(무료|free|0원?)$/i.test(value)) return 0;
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

export function parseBoolean(raw) {
  return /^(y|yes|o|true|1|인기|인기곡|추천|v|✓)$/i.test((raw || "").trim());
}

// ───── 행 → 곡 ─────

export function buildRows(text, existingSongs = [], options = {}) {
  const delimiter = detectDelimiter(text);
  const table = parseDelimited(text, delimiter);
  if (table.length === 0) {
    return { delimiter, mapping: {}, unmatched: [], rows: [], fatal: "내용이 비어 있어요." };
  }

  const { mapping, unmatched } = mapHeaders(table[0]);
  if (mapping.title === undefined || mapping.artist === undefined) {
    return {
      delimiter,
      mapping,
      unmatched,
      rows: [],
      fatal: "첫 줄에서 '제목'과 '가수' 열을 찾지 못했어요. 헤더 행이 있는지 확인해 주세요.",
    };
  }

  const seenInFile = new Set();
  const existingKeys = new Set(
    existingSongs.map((s) => `${s.title.trim().toLowerCase()}|${s.artist.trim().toLowerCase()}`)
  );

  const cell = (row, field) =>
    mapping[field] === undefined ? "" : (row[mapping[field]] || "").trim();

  const rows = table.slice(1).map((raw, index) => {
    const errors = [];
    const warnings = [];

    const title = cell(raw, "title");
    const artist = cell(raw, "artist");
    if (!title) errors.push("제목 없음");
    if (!artist) errors.push("가수 없음");

    const genreRaw = cell(raw, "genre");
    let genre = normalizeGenre(genreRaw);
    if (!genre) {
      genre = "기타";
      if (genreRaw) warnings.push(`장르 '${genreRaw}' → 기타`);
      else warnings.push("장르 비어 있음 → 기타");
    }

    const keyRaw = cell(raw, "key");
    let key = parseKey(keyRaw);
    if (key === null) {
      key = 0;
      warnings.push(`키 '${keyRaw}' 인식 불가 → 원키`);
    }

    const priceRaw = cell(raw, "price");
    let price = parsePrice(priceRaw);
    if (price === null) {
      price = 0;
      warnings.push(`가격 '${priceRaw}' 인식 불가 → 무료`);
    }

    const mrUrl = cell(raw, "mrUrl");
    const mrVideoId = mrUrl ? extractVideoId(mrUrl) : null;
    if (mrUrl && !mrVideoId) warnings.push("유튜브 주소 형식이 아님");

    let jacket = cell(raw, "jacket") || null;
    if (!jacket && mrVideoId && options.thumbnailFromYoutube) {
      jacket = `https://i.ytimg.com/vi/${mrVideoId}/hqdefault.jpg`;
    }

    const dupKey = `${title.toLowerCase()}|${artist.toLowerCase()}`;
    const duplicate = Boolean(title && artist && (existingKeys.has(dupKey) || seenInFile.has(dupKey)));
    if (duplicate) warnings.push("이미 있는 곡");
    if (title && artist) seenInFile.add(dupKey);

    return {
      line: index + 2,
      errors,
      warnings,
      duplicate,
      include: errors.length === 0 && !duplicate,
      song: {
        title,
        titleAliases: splitAliases(cell(raw, "titleAliases")),
        artist,
        artistAliases: splitAliases(cell(raw, "artistAliases")),
        mrUrl,
        mrVideoId,
        key,
        keyLinks: {},
        genre,
        price,
        jacket,
        popular: parseBoolean(cell(raw, "popular")),
      },
    };
  });

  return { delimiter, mapping, unmatched, rows, fatal: null };
}

export const SAMPLE_CSV = [
  "제목,별칭,가수,가수별칭,장르,키,가격,MR링크,인기곡",
  '역몽,"사카유메 / 逆夢",켄시 요네즈,"요네즈 켄시 / 米津玄師",J-POP,-2,5000,https://youtu.be/dQw4w9WgXcQ,Y',
  "너의 모든 순간,,성시경,,발라드,원키,3000,,Y",
  "사건의 지평선,,윤하,,K-POP,+1,3000,,",
].join("\n");
