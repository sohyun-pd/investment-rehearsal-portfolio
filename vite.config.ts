import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

import { bffApiPlugin } from "./server/apiPlugin";

// 제품 프로토타입(app/)만 빌드한다. spikes/ 는 tsx 로 별도 실행되며 여기 포함되지 않는다.
// bffApiPlugin 은 dev/preview 서버(Node 프로세스)에만 /api/* BFF 라우트를 추가한다(로컬 전용 —
// production BFF 는 Cloudflare Pages Functions, functions/api/**). FINNHUB_API_KEY ·
// TWELVE_DATA_API_KEY · ANTHROPIC_API_KEY 는 이 프로세스의 process.env 에만 존재하고
// 클라이언트 번들에는 포함되지 않는다.
export default defineConfig({
  plugins: [react(), tailwindcss(), bffApiPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  server: {
    watch: {
      // temporary/ 는 이 앱과 무관한 별도 정적 페이지(랜딩 프로토타입 등) 작업 공간이다 — Vite
      // 가 이 안의 변경도 모듈 그래프 밖이라 HMR 대신 "전체 새로고침"을 모든 연결된 클라이언트
      // (이 앱을 테스트 중인 탭 포함)에 강제로 보내, 진행 중인 대화 상태가 통째로 날아가는
      // 문제가 있었다. 이 앱 코드와 무관한 디렉터리이므로 watch 대상에서 제외한다.
      ignored: ["**/temporary/**"],
    },
  },
});
