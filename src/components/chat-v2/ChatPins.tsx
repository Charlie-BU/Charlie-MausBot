import { api, type Bot, type Message } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { peerLine, peerRequest } from "@/lib/peer-message";
import { botLineText } from "@/lib/transcript-derivations";
import { stripLeakedSystemHarnessMessages } from "../../../shared/system-message-guard";
import { splitTranscriptAttachments } from "@/lib/composer-attachments";
import { citationPreviewText } from "@/lib/citations";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Pin, PinOff } from "lucide-react";
import { reducedMotion } from "@/lib/onboarding";
import { MENU_MOTION_MS } from "../MenuMotion";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { t } from "@/lib/i18n";
import type { PinnedPreview } from "../PinnedMessagesMenu";

const EMPTY_IDS: string[] = [];

export function useChatPins(bot: Bot, history: Map<string, Message>, userName: string | undefined, writable: boolean) {
  const { threadId, id: botId, name } = bot;
  const ids = bot.tasks?.find(task => task.threadId === threadId)?.pinnedMessageIds ?? EMPTY_IDS;
  const pinnedIds = useMemo(() => new Set(ids), [ids]);
  const [pending, setPending] = useState<ReadonlyMap<string, { pinned: boolean }>>(() => new Map());
  const pendingIds = useMemo(() => new Set([...pending].flatMap(([id, { pinned }]) =>
    pinnedIds.has(id) === pinned ? [] : [id])), [pending, pinnedIds]);
  useEffect(() => {
    setPending(current => {
      const remaining = new Map([...current].filter(([id, { pinned }]) => pinnedIds.has(id) !== pinned));
      return remaining.size === current.size ? current : remaining;
    });
  }, [pinnedIds]);
  const path = `/api/bots/${botId}/tasks/${threadId}`;
  const dispatch = useStoreDispatch();
  const report = useCallback((err: unknown) => dispatch({ type: "error", message: String(err) }), [dispatch]);
  const update = useCallback((id: string, pinned: boolean) => {
    if (pendingIds.has(id) || pinnedIds.has(id) === pinned) return;
    const change = { pinned };
    setPending(current => new Map(current).set(id, change));
    void api(path, { method: "PATCH", body: JSON.stringify({ messagePin: { id, pinned } }) }).catch(error => {
      setPending(current => {
        if (current.get(id) !== change) return current;
        const remaining = new Map(current);
        remaining.delete(id);
        return remaining;
      });
      report(error);
    });
  }, [path, pendingIds, pinnedIds, report]);
  useEffect(() => {
    if (!writable) return;
    const key = "omb-chat-pins:" + threadId;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const entries: unknown = JSON.parse(raw);
      if (!Array.isArray(entries)) return;
      void api(path, { method: "PATCH", body: JSON.stringify({ importMessagePins: entries.map(pin => pin.id) }) })
        .then(() => localStorage.removeItem(key)).catch(report);
    } catch (error) { report(error); }
  }, [threadId, writable, path, report]);
  const generation = useStoreSelector(state => state.transcriptGeneration[threadId] ?? 0);
  const branch = JSON.stringify([threadId, generation]);
  const pinView = ids.length ? JSON.stringify(ids) : null;
  const [loaded, setLoaded] = useState<{ branch: string; messages: Message[] }>();
  useEffect(() => {
    if (!pinView) return;
    const controller = new AbortController();
    void api<{messages: Message[]}>(`/api/threads/${threadId}/messages?view=pins`, { signal: controller.signal })
      .then(({ messages }) => { if (!controller.signal.aborted) setLoaded({ branch, messages }); })
      .catch(error => { if (!controller.signal.aborted) report(error); });
    return () => controller.abort();
  }, [threadId, branch, pinView, report]);
  const pins = useMemo(() => {
    const previews = new Map((loaded?.branch === branch ? loaded.messages : []).map(message => [message.id, message]));
    const adding = [...pendingIds].filter(id => pending.get(id)?.pinned).reverse();
    return [...adding, ...ids].flatMap(id => {
      const m = history.get(id) ?? previews.get(id);
      if (m?.kind !== "text") return [];
      const peer = peerLine(m) ?? peerRequest(m, botId);
      const own = m.role === "user" && !peer;
      const legacy = own ? splitTranscriptAttachments(m.text ?? "", true, true, { collapsePastes: true }) : null;
      const text = peer?.body ?? legacy?.display ?? stripLeakedSystemHarnessMessages(botLineText(m));
      return [{ id, sender: peer?.name || m.from?.name || (own ? userName || t("chat.you") : name),
        text: (citationPreviewText(text).trim() || m.attachments?.find(a => a.kind !== "audio")?.name || legacy?.files[0]?.name || t("attach.gallerySingle")).replace(/\s+/g, " ").slice(0, 512) }];
    });
  }, [history, loaded, branch, ids, pending, pendingIds, botId, userName, name]);
  return { pins, update, pinnedIds, pendingIds };
}

export function ChatPins({ pins, pendingIds, jump, remove }: {
  pins: PinnedPreview[]; pendingIds: ReadonlySet<string>; jump: (id: string) => void; remove?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [displayed, setDisplayed] = useState(pins);
  const ids = useMemo(() => new Set(pins.map(pin => pin.id)), [pins]);
  const leaving = JSON.stringify(displayed.filter(pin => !ids.has(pin.id)).map(pin => pin.id));
  const removing = leaving !== "[]";
  const finish = useEffectEvent(() => {
    setDisplayed(pins);
    if (pins.length < 2) setOpen(false);
  });
  useLayoutEffect(() => {
    if (!removing || reducedMotion()) finish();
  }, [pins, removing]);
  useLayoutEffect(() => {
    if (leaving === "[]" || reducedMotion()) return;
    const timer = window.setTimeout(finish, MENU_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const shown = removing
    ? [...pins.filter(pin => !displayed.some(old => old.id === pin.id)), ...displayed]
    : pins;
  const expanded = open && shown.length > 1;
  const root = useRef<HTMLElement>(null);
  usePopoverDismiss(expanded, root, () => setOpen(false));
  if (!shown.length) return null;
  function row(pin: PinnedPreview, first = false) {
    const pending = pendingIds.has(pin.id);
    return <div key={pin.id} className="v2-pin-row" data-leaving={!ids.has(pin.id) || undefined} inert={!ids.has(pin.id)}>
      {remove ? <button className="v2-pin-remove" aria-label={t("chat.unpinMessage")} title={t("chat.unpinMessage")} aria-busy={pending || undefined} disabled={pending} onClick={() => remove(pin.id)}>
        {pending ? <Loader2 size={15} aria-hidden="true" className="v2-pin-loading" /> : <><Pin size={15} /><PinOff size={15} /></>}
      </button> : <Pin size={15} />}
      <button className="v2-pin-jump" onClick={() => { setOpen(false); jump(pin.id); }}>
        <span className="truncate">{pin.sender}: {pin.text}</span>
      </button>
      {first && shown.length > 1 && <button className="v2-pin-toggle" aria-expanded={expanded}
        aria-label={t("chat.pinnedMessages")} onClick={() => setOpen(!expanded)}><ChevronDown size={16} /></button>}
    </div>;
  }
  return <section ref={root} className="v2-pins" data-leaving={!pins.length || undefined} aria-label={t("chat.pinnedMessages")}>
    {row(shown[0], true)}
    <div className="v2-pin-list" data-open={expanded} inert={!expanded}><div>
      {shown.slice(1).map(pin => row(pin))}
    </div></div>
  </section>;
}
