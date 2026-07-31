// .env.test 가 있으면 읽어 process.env 에 넣는다. 없으면 조용히 넘어간다.
// dotenv 의존성을 추가하지 않기 위해 직접 파싱한다.
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), ".env.test");
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // KEY="값" / KEY='값' 형태를 벗긴다. 벗기지 않으면 따옴표가 값에 섞여
    // 인증이 실패하는데, 증상이 "키가 틀렸다"로 나와 원인 추적이 어렵다.
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
