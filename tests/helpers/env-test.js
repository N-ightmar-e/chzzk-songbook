// .env.test 로더.
//
// 두 곳에서 필요하다 — setupFiles(tests/helpers/setup.js)는 워커 프로세스에서,
// globalSetup(tests/helpers/global-server.js)은 vitest 메인 프로세스에서 돈다.
// 예전에 파서를 각자 갖고 있다가 한쪽만 따옴표를 벗기게 되어, 값에 따옴표를 쓰면
// spawn 된 개발 서버만 인증에 실패하는 상태가 됐다. 한 곳으로 합쳐 그 어긋남을 없앤다.
import fs from "node:fs";
import path from "node:path";

// KEY="값" / KEY='값' 의 따옴표를 벗긴다. 벗기지 않으면 값에 섞여 들어가
// 인증이 실패하는데, 증상이 "키가 틀렸다"로 나와 원인 추적이 어렵다.
function unquote(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

// 이미 설정된 환경변수는 덮어쓰지 않는다.
export function loadEnvTest() {
  const file = path.join(process.cwd(), ".env.test");
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = unquote(trimmed.slice(eq + 1).trim());
    if (!(key in process.env)) process.env[key] = value;
  }
}
