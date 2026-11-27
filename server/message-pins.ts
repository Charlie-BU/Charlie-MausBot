import type { Store } from "./store.ts";

type PinStore = Pick<Store, "taskByThread" | "patchTask" | "messagesFor">;

export function setMessagePin(store: PinStore, botId: string, threadId: string, id: unknown, pinned: unknown) {
  if (typeof id !== "string" || !id || typeof pinned !== "boolean") return { error: "Expected a message ID and boolean pinned state" };
  const task = store.taskByThread(botId, threadId);
  if (!task) return { error: "No such conversation" };
  const ids = task.pinnedMessageIds ?? [];
  if (!store.messagesFor(threadId).some(message => message.id === id && message.kind === "text"))
    return { error: "No such text message in this conversation" };
  if (ids.includes(id) !== pinned) store.patchTask(botId, threadId, {
    pinnedMessageIds: pinned ? [id, ...ids] : ids.filter(value => value !== id),
  });
  return { messageId: id, pinned };
}
