/**
 * 서버(BFF) 프로세스에만 시크릿을 로드한다.
 *
 * `.env.local` 은 gitignore 대상이며 `FINNHUB_API_KEY` · `TWELVE_DATA_API_KEY` 를 담는다.
 * 이 값은 `process.env` 에만 채워지고 `import.meta.env.VITE_*` 를 거치지 않으므로
 * 클라이언트 번들에 포함되지 않는다. Vite dev/preview 서버(Node 프로세스)에서만 호출한다.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

let loaded = false;

export function loadServerEnv(): void {
  if (loaded) return;
  loaded = true;

  const localPath = resolve(process.cwd(), ".env.local");
  if (existsSync(localPath)) {
    config({ path: localPath });
  }
}
