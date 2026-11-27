import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/cn";
import type { CopyFeedback } from "@/lib/copy-text";
import { MENU_ITEM } from "./menu-recipe";
import { t } from "@/lib/i18n";

export function CopyImageButton({ name, state, copy, supported, mac }: {
  name: string; state: CopyFeedback; copy: () => void; supported: boolean; mac: boolean;
}) {
  const label = state === "copied"
    ? t("attach.imageCopied")
    : state === "failed"
      ? t("attach.copyImageFailed")
      : t("attach.copyImage");
  return (
    <button
      type="button"
      onClick={copy}
      disabled={!supported}
      className={cn(MENU_ITEM, "text-ink interaction:bg-raised/50 disabled:opacity-50")}
      aria-label={state === "idle" ? t("attach.copyImageAria", { name }) : label}
      aria-keyshortcuts={mac ? "Meta+C" : "Control+C"}
      title={label}
    >
      {state === "copied" ? <Check size={17} /> : <Copy size={17} />}
      <span className="min-w-0 truncate" aria-live="polite">{label}</span>
      <kbd aria-hidden="true" className="ms-auto text-ink-tertiary">{mac ? "⌘C" : "Ctrl+C"}</kbd>
    </button>
  );
}
