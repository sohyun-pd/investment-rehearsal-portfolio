/**
 * 환경변수 로더.
 *
 * 실제 키는 .env.local 에만 저장하는 정책이므로 그 파일을 먼저 로드한다.
 * (dotenv 기본 동작은 .env 만 로드하므로 명시적으로 지정)
 * 이미 셸에 설정된 값은 덮어쓰지 않는다(override:false 기본).
 */
import { config } from "dotenv";

config({ path: ".env.local" }); // 실제 키
config(); // .env 가 있으면 보조로 로드(.env.local 값이 우선)
