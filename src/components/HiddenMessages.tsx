import { useCallback, useState, useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";
import { ConfirmDialog } from "./ConfirmDialog";

const storageKey = "omb-hidden-messages";
const empty: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
let hidden: ReadonlySet<string> | undefined;

function readHidden(): ReadonlySet<string> {
  if (!hidden) {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      hidden = Array.isArray(stored) ? new Set(stored.filter((id): id is string => typeof id === "string")) : empty;
    } catch {
      hidden = empty;
    }
  }
  return hidden;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useHiddenMessages(threadId: string) {
  const hiddenIds = useSyncExternalStore(subscribe, readHidden, () => empty);
  const [pending, setPending] = useState<{ threadId: string; messageId: string } | null>(null);
  const requestDelete = useCallback((messageId: string) => setPending({ threadId, messageId }), [threadId]);
  const cancel = () => setPending(null);
  const open = pending?.threadId === threadId;
  const dialog = <ConfirmDialog open={open} title={t("chat.deleteMessageTitle")} body={t("chat.deleteMessageBody")}
    confirmLabel={t("common.delete")} onCancel={cancel} onConfirm={() => {
      if (!open) return;
      hidden = new Set([...readHidden(), pending.messageId]);
      try { localStorage.setItem(storageKey, JSON.stringify([...hidden])); } catch {}
      for (const listener of listeners) listener();
      cancel();
    }} />;
  return { hiddenIds, requestDelete, dialog };
}
