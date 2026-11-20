import { type CSSProperties, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";

const FRIDAY_LINES = [
  "I was working all week, nothing exciting",
  "I was waiting all week, so boring",
  "But tonight, I will go out because it's",
  "Friday night",
];

// A fixed set of confetti pieces with deterministic offsets/colours so the
// effect is stable across renders (no random re-layout on every keystroke).
const CONFETTI = Array.from({ length: 40 }, (_, index) => ({
  left: `${(index * 37) % 100}%`,
  color: ["#ff2e88", "#ffd200", "#00e5ff", "#7c4dff", "#3dff88"][index % 5],
  duration: `${2.6 + (index % 7) * 0.35}s`,
  delay: `${(index % 11) * 0.27}s`,
}));

interface FridayEasterEggDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FridayEasterEggDialog({ open, onOpenChange }: FridayEasterEggDialogProps) {
  const confetti = useMemo(() => CONFETTI, []);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden border-fuchsia-400/40 bg-gradient-to-br from-[#1a0b2e] via-[#0b1a2e] to-[#2e0b1f] sm:max-w-xl"
        showCloseButton
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {confetti.map((piece, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: decorative static confetti
              key={index}
              className="df-friday-confetti"
              style={
                {
                  left: piece.left,
                  backgroundColor: piece.color,
                  "--fall-duration": piece.duration,
                  "--fall-delay": piece.delay,
                } as CSSProperties
              }
            />
          ))}
        </div>

        <DialogHeader className="relative z-10 items-center text-center">
          <span className="df-friday-title block py-2">Friday Night!</span>
        </DialogHeader>

        <div className="relative z-10 space-y-2 py-4 text-center">
          {FRIDAY_LINES.map((line, index) => (
            <p key={line} className="df-friday-line" style={{ animationDelay: `${index * 0.2}s` }}>
              {line}
            </p>
          ))}
        </div>

        <DialogFooter className="relative z-10 justify-center">
          <Button onClick={() => onOpenChange(false)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
