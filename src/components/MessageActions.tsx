import { createContext, use, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Copy, Ellipsis, Reply, X } from "lucide-react";
import { popoverClosesOnKey, usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { overlayPortal } from "./ModalPresence";
import { MENU_ITEM, MENU_SHEET } from "./menu-recipe";
import { StreamingReplyContext } from "@/state/live-reply";

export const ACTION_ICON = { size: 16, strokeWidth: 1.5 } as const;

export const messageActionClass =
  "inline-flex size-7 items-center justify-center rounded-full text-ink-tertiary transition-colors interaction:bg-raised/50 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

export type MessageMenuItem = {
  key: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  title?: string;
  disabled?: boolean;
  /** Offered only while the chat's turn is not running. */
  idleOnly?: boolean;
};

/** Whether the chat's turn is running, apart from the row values every message reads: a turn starting or ending
 * re-renders only the few rows that show it, not every message. */
export const ChatBusyContext = createContext(false);

export const MESSAGE_ROW = "data-message-row";

export const INTERACTIVE = "a, button, input, textarea, select, summary, label, [role=button], [contenteditable=true]";
const OWN_MENU_MEDIA = "img, video, audio";
const LONG_PRESS_MS = 450;

function focusVisible(target: EventTarget | null): boolean {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return false;
  }
}

export function MessageActions({
  side,
  forceOpen = false,
  preferMenuAbove = false,
  className,
  menu: items = [],
  contextItems = [],
  children,
}: {
  side: "user" | "bot";
  forceOpen?: boolean;
  preferMenuAbove?: boolean;
  className?: string;
  menu?: MessageMenuItem[];
  /** Added before `menu` when a right-click on the bubble opens it, for the actions that are inline buttons otherwise. */
  contextItems?: MessageMenuItem[];
  children?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pointAt, setPointAt] = useState<{ x: number; y: number } | null>(null);
  const offered = pointAt ? [...contextItems, ...items] : items;
  // use() may run conditionally: a closed menu has no reason to follow the turn.
  const busy = menuOpen && offered.some((item) => item.idleOnly) ? use(ChatBusyContext) : false;
  const menu = busy ? offered.filter((item) => !item.idleOnly) : offered;
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [tapped, setTapped] = useState(false);
  const menuBoundary = useRef({
    contains: (target: unknown) => target instanceof Node && Boolean(rootRef.current?.contains(target) || menuRef.current?.contains(target)),
  });
  const mirrored = side === "user";
  const streaming = use(StreamingReplyContext);
  const shown = !streaming && (forceOpen || menuOpen || hovered || keyboardFocus || tapped);
  const canPointRef = useRef(false);
  canPointRef.current = !streaming && items.length + contextItems.length > 0;

  useEffect(() => {
    const row = rootRef.current?.closest<HTMLElement>(`[${MESSAGE_ROW}]`) ?? rootRef.current;
    rowRef.current = row;
    if (!row) return;
    let press: { x: number; y: number; at: number; timer: ReturnType<typeof setTimeout> } | null = null;
    const enter = (event: PointerEvent) => { if (event.pointerType !== "touch") setHovered(true); };
    const leave = (event: PointerEvent) => { if (event.pointerType !== "touch") setHovered(false); };
    const focusIn = (event: FocusEvent) => setKeyboardFocus(focusVisible(event.target));
    const focusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
      setKeyboardFocus(false);
    };
    const inside = (target: EventTarget | null) => target instanceof Element && Boolean(rootRef.current?.contains(target));
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || inside(event.target)) return;
      if (press) clearTimeout(press.timer);
      press = { x: event.clientX, y: event.clientY, at: Date.now(), timer: setTimeout(() => setTapped(true), LONG_PRESS_MS) };
    };
    const move = (event: PointerEvent) => {
      if (!press || event.pointerType !== "touch") return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
        clearTimeout(press.timer);
        press = null;
      }
    };
    const cancel = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };
    const up = (event: PointerEvent) => {
      if (!press || event.pointerType !== "touch") return;
      clearTimeout(press.timer);
      const quick = Date.now() - press.at < LONG_PRESS_MS;
      press = null;
      if (!quick || (event.target instanceof Element && event.target.closest(INTERACTIVE))) return;
      if (window.getSelection()?.toString()) return;
      setTapped((value) => !value);
    };
    const context = (event: MouseEvent) => {
      if (!canPointRef.current || (event as Partial<PointerEvent>).pointerType === "touch") return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("[data-chat-bubble]") || target.closest(INTERACTIVE) || target.closest(OWN_MENU_MEDIA)) return;
      if (window.getSelection()?.toString().trim()) return;
      event.preventDefault();
      setPointAt({ x: event.clientX, y: event.clientY });
      setMenuOpen(true);
    };
    row.addEventListener("pointerenter", enter);
    row.addEventListener("pointerleave", leave);
    row.addEventListener("focusin", focusIn);
    row.addEventListener("focusout", focusOut);
    row.addEventListener("pointerdown", down);
    row.addEventListener("pointermove", move);
    row.addEventListener("pointerup", up);
    row.addEventListener("pointercancel", cancel);
    row.addEventListener("contextmenu", context);
    return () => {
      if (press) clearTimeout(press.timer);
      row.removeEventListener("pointerenter", enter);
      row.removeEventListener("pointerleave", leave);
      row.removeEventListener("focusin", focusIn);
      row.removeEventListener("focusout", focusOut);
      row.removeEventListener("pointerdown", down);
      row.removeEventListener("pointermove", move);
      row.removeEventListener("pointerup", up);
      row.removeEventListener("pointercancel", cancel);
      row.removeEventListener("contextmenu", context);
    };
  }, []);

  usePopoverDismiss(tapped && !menuOpen, rowRef, () => setTapped(false));
  usePopoverDismiss(menuOpen, menuBoundary, () => {
    const focused = menuBoundary.current.contains(document.activeElement);
    setMenuOpen(false);
    if (focused) moreRef.current?.focus({ preventScroll: true });
  });

  useLayoutEffect(() => {
    const sheet = menuRef.current;
    const tray = rootRef.current;
    if (!menuOpen || !sheet || !tray) return;
    const anchor = (moreRef.current ?? tray).getBoundingClientRect();
    const { left, right } = tray.getBoundingClientRect();
    const { width, height } = sheet.getBoundingClientRect();
    const gutter = 8;
    const gap = 4;
    const rtl = getComputedStyle(tray).direction === "rtl";
    const alignRight = mirrored !== rtl;
    const alignLeftX = pointAt?.x ?? left;
    const alignRightX = (pointAt?.x ?? right) - width;
    const below = pointAt?.y ?? anchor.bottom + gap;
    const above = (pointAt?.y ?? anchor.top - gap) - height;
    const x = alignRight && !pointAt
      ? (alignRightX >= gutter ? alignRightX : alignLeftX)
      : (alignLeftX + width <= window.innerWidth - gutter ? alignLeftX : alignRightX);
    const y = ((!pointAt && preferMenuAbove) || below + height > window.innerHeight - gutter) && above >= gutter ? above : below;
    sheet.style.left = `${Math.max(gutter, Math.min(x, window.innerWidth - width - gutter))}px`;
    sheet.style.top = `${Math.max(gutter, Math.min(y, window.innerHeight - height - gutter))}px`;
    sheet.dir = rtl ? "rtl" : "ltr";
    sheet.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus({ preventScroll: true });
  }, [menuOpen, mirrored, pointAt, preferMenuAbove]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menuOpen]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next === null || !items.length) {
      if (event.key === "Tab") setMenuOpen(false);
      return;
    }
    event.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative flex items-center gap-0.5 self-end pb-0.5 transition-opacity duration-150",
        mirrored && "flex-row-reverse",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
      data-testid="message-actions"
      inert={streaming || undefined}
      data-shown={shown ? "true" : undefined}
      onKeyDown={(event) => {
        if (menuOpen || forceOpen || !popoverClosesOnKey(event.nativeEvent) || !keyboardFocus) return;
        event.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      {children}
      {items.length > 0 && (
        <button
          ref={moreRef}
          type="button"
          onClick={() => {
            setPointAt(null);
            setMenuOpen((value) => !value);
          }}
          aria-label={t("chat.messageActions")}
          title={t("chat.messageActions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          className={cn(messageActionClass, menuOpen && "bg-ink/10 text-ink")}
        >
          <Ellipsis {...ACTION_ICON} aria-hidden="true" />
        </button>
      )}
      {menuOpen && overlayPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu" data-look="menu"
          aria-label={t("chat.messageActions")}
          onKeyDown={moveFocus}
          className={cn("fixed z-40 min-w-52 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto", MENU_SHEET)}
        >
          {menu.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                item.onSelect();
                setMenuOpen(false);
                moreRef.current?.focus();
              }}
              className={cn(MENU_ITEM, "text-start text-ink interaction:bg-raised/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60")}
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-4" aria-hidden="true">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </div>,
        rootRef.current?.closest("dialog[open]") ?? document.body,
      )}
    </div>
  );
}

export function ReplyAction({ onReply }: { onReply: () => void }) {
  return (
    <button type="button" onClick={onReply} aria-label={t("chat.replyToMessage")} title={t("chat.reply")} className={messageActionClass}>
      <Reply {...ACTION_ICON} aria-hidden="true" />
    </button>
  );
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { state, copy } = useCopyFeedback(text);
  const label = t(state === "copied" ? "chat.copyMessageDone" : state === "failed" ? "chat.copyMessageFailed" : "chat.copyMessage");
  return (
    <button
      onClick={copy}
      aria-label={label}
      title={label}
      className={className ?? messageActionClass}
    >
      {state === "copied" ? <Check {...ACTION_ICON} className="text-success" /> : state === "failed" ? <X {...ACTION_ICON} className="text-danger" /> : <Copy {...ACTION_ICON} />}
    </button>
  );
}
