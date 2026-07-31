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
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
