import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind 클래스 병합 유틸(shadcn 스타일). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
