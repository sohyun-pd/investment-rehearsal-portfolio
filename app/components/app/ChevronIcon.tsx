/**
 * 펼치기·접기 등에 쓰는 chevron 아이콘 — 텍스트 화살표(˅ ˄ →)를 대신한다.
 *
 * 근거: 사용자 확정 — "더보기 ˅"/"접기 ˄"처럼 키보드로 입력한 화살표 문자를 쓰면 폰트마다
 * 굵기·정렬이 달라 조잡해 보인다. 항상 같은 굵기·크기로 그려지는 SVG 를 쓴다.
 */
export function ChevronIcon({
  direction,
  className,
}: {
  direction: "up" | "down";
  className?: string;
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={className}
      style={{ transform: direction === "up" ? "rotate(180deg)" : undefined }}
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
