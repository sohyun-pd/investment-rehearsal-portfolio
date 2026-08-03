import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScreenShell } from "@/components/ScreenShell";
import { Stepper, type Step } from "@/components/Stepper";
import { Card, CardContent } from "@/components/ui/card";

// 실제 처리(2.6~8초)를 대신하는 단계 진행. 각 단계가 순차로 채워진 뒤 자동 이동한다.
const LABELS = [
  "종목을 확인하고 있어요",
  "매수 조건을 나누고 있어요",
  "빠진 정보가 있는지 살펴보고 있어요",
];
const STEP_MS = 1300; // 단계당 진행 시간
const DONE_HOLD_MS = 700; // 마지막 단계 완료 후 이동까지 여유

/** Screen 2. AI 분석 진행 (자동 진행 + 자동 이동) */
export function Analyzing() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0); // 진행 중 인덱스. LABELS.length 이면 전부 완료.

  useEffect(() => {
    const timers: number[] = [];
    for (let i = 1; i <= LABELS.length; i++) {
      timers.push(window.setTimeout(() => setStep(i), STEP_MS * i));
    }
    timers.push(
      window.setTimeout(() => navigate("/clarify"), STEP_MS * LABELS.length + DONE_HOLD_MS)
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [navigate]);

  const steps: Step[] = LABELS.map((label, i) => ({
    label,
    state: i < step ? "done" : i === step ? "active" : "pending",
  }));

  return (
    <ScreenShell
      title="말해주신 계획을 정리하고 있어요"
      subtitle="종목과 조건을 확인하고 있어요. 다 되면 바로 보여드릴게요."
    >
      <Card>
        <CardContent>
          <Stepper steps={steps} />
        </CardContent>
      </Card>
    </ScreenShell>
  );
}
