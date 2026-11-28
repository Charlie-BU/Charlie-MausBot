import type { CSSProperties } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export function JumpToLatestButton({ jumpToLatest, showJumpToLatest, showLater, laterCount, className, style }: {
  jumpToLatest: () => void;
  showJumpToLatest: boolean;
  showLater: () => void;
  laterCount: number;
  className?: string;
  style?: CSSProperties;
}) {
  const hasLater = laterCount > 0;
  if (!hasLater && !showJumpToLatest) return null;
  return (
    <button
      onClick={hasLater ? showLater : jumpToLatest}
      type="button"
      aria-label={hasLater ? undefined : t("chat.jumpToLatestAria")}
      title={hasLater ? undefined : t("chat.jumpToLatest")}
      className={cn("animate-pop-in absolute left-1/2 z-10 flex h-9 -translate-x-1/2 items-center justify-center rounded-full border border-hairline/40 bg-raised text-ink shadow-lg interaction:bg-raised/50", hasLater ? "w-max max-w-full px-3 text-sm" : "w-9", className)}
      style={style}
    >
      {hasLater ? t("chat.showLater", { count: laterCount }) : <ArrowDown size={18} aria-hidden="true" />}
    </button>
  );
}
