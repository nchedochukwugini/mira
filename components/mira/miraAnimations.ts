import type { MiraState } from "@/components/mira/miraStates";
type CharacterMotion = { y: number[]; rotate: number[]; scale: number[]; x?: number[] };

export const miraCharacterMotion: Record<MiraState, CharacterMotion> = {
  idle: { y: [0, -1, 0], rotate: [0, 0, 0], scale: [1, 1.006, 1] },
  greeting: { y: [0, -2, 0], rotate: [0, 1.4, 0], scale: [1, 1.015, 1] },
  thinking: { y: [0, -1, 0], rotate: [0, -2.2, -1.5], scale: [1, 1.01, 1] },
  searching: { y: [0, -1.5, 0], rotate: [0, 2.5, -1, 0], scale: [1, 1.01, 1], x: [0, 2, 0] },
  analyzing: { y: [0, -1, 0], rotate: [0, -1.2, 0], scale: [1, 1.008, 1] },
  explaining: { y: [0, -1.5, 0], rotate: [0, 1.4, 0], scale: [1, 1.012, 1] },
  success: { y: [0, -5, 0], rotate: [0, 0, 0], scale: [1, 1.025, 1] },
  "insufficient-data": { y: [0, -1, 0], rotate: [-2, 3, -2], scale: [1, 1, 1] },
  "trade-ready": { y: [0, -1, 0], rotate: [0, 2, 0], scale: [1, 1.01, 1] },
  "trade-success": { y: [0, -6, 0], rotate: [0, 2, -1, 0], scale: [1, 1.03, 1] },
  error: { y: [0, -1, 0], rotate: [-1, 1, -1], scale: [1, 1, 1] },
  resting: { y: [0, -0.5, 0], rotate: [1, 1, 1], scale: [1, 1, 1] },
};

export function miraMotionDuration(state: MiraState) {
  if (state === "success" || state === "trade-success") return 0.8;
  if (state === "thinking" || state === "searching") return 2.2;
  return state === "idle" || state === "resting" ? 4.2 : 2.8;
}
