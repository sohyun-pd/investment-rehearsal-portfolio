import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

interface CtaButtonProps extends Omit<ButtonProps, "loading" | "onClick"> {
  /** 이동할 경로. */
  to: string;
  /** 누른 뒤 이동까지 대기 시간(ms). 대기 동안 로딩 인터랙션을 보여준다. */
  holdMs?: number;
}

/**
 * 주요 CTA. 누르면 버튼이 눌리는 반응(scale) + 로딩 스피너를 잠시 보여준 뒤 이동한다.
 * "누르고 기다리는" 짧은 인터랙션으로 처리 중임을 부드럽게 전달한다.
 */
export function CtaButton({ to, holdMs = 700, children, disabled, ...props }: CtaButtonProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const handleClick = () => {
    if (loading || disabled) return;
    setLoading(true);
    timer.current = window.setTimeout(() => navigate(to), holdMs);
  };

  return (
    <Button loading={loading} disabled={disabled} onClick={handleClick} {...props}>
      {children}
    </Button>
  );
}
