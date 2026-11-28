// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import { ChatPins, useChatPins } from "./ChatPins";
import { MENU_MOTION_MS } from "../MenuMotion";

const { api, dispatch } = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({ api }));
vi.mock("@/state/store-select", () => ({ useStoreDispatch: () => dispatch, useStoreSelector: () => 0 }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const message: Message = { id: "m1", role: "user", kind: "text", text: "Ship on Friday", at: 1 };
const history = new Map([[message.id, message]]);

function Fixture({ ids }: { ids: string[] }) {
  const bot = { id: "bot", threadId: "thread", name: "Pepper", tasks: [{ threadId: "thread", pinnedMessageIds: ids }] } as Bot;
  const { pins, update, pendingIds } = useChatPins(bot, history, undefined, true);
  return createElement("div", null,
    createElement("button", { "data-pin": "", onClick: () => update(message.id, true) }, "Pin"),
    createElement(ChatPins, { pins, pendingIds, jump: () => {}, remove: id => update(id, false) }),
  );
}

const row = () => document.querySelector(".v2-pin-row");
const remove = () => document.querySelector<HTMLButtonElement>(".v2-pin-remove")!;
const click = (button: HTMLButtonElement) => act(async () => button.click());

function mount() {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  return {
    render: (ids: string[]) => act(async () => root.render(createElement(Fixture, { ids }))),
    close: () => { act(() => root.unmount()); container.remove(); },
  };
}

afterEach(() => {
  api.mockReset();
  dispatch.mockReset();
  vi.useRealTimers();
});

it("shows a pin immediately and keeps both operations busy until the server state changes", async () => {
  vi.useFakeTimers();
  api.mockImplementation((_path, options) => options.method === "PATCH" ? Promise.resolve({}) : new Promise(() => {}));
  const fixture = mount();
  try {
    await fixture.render([]);
    await click(document.querySelector<HTMLButtonElement>("[data-pin]")!);
    expect(row()?.textContent).toContain("Ship on Friday");
    expect(remove().getAttribute("aria-busy")).toBe("true");
    expect(api).toHaveBeenCalledTimes(1);

    const originalRow = row();
    await fixture.render([message.id]);
    expect(row()).toBe(originalRow);
    expect(remove().disabled).toBe(false);
    expect(api.mock.calls[1]?.[0]).toContain("view=pins");

    await click(remove());
    expect(row()?.hasAttribute("data-leaving")).toBe(false);
    expect(remove().getAttribute("aria-busy")).toBe("true");
    await fixture.render([]);
    expect(row()?.hasAttribute("data-leaving")).toBe(true);
    expect(remove().hasAttribute("aria-busy")).toBe(false);
    await act(async () => vi.advanceTimersByTime(MENU_MOTION_MS / 2));
    await fixture.render([]);
    await act(async () => vi.advanceTimersByTime(MENU_MOTION_MS / 2));
    expect(row()).toBeNull();
  } finally {
    fixture.close();
  }
});

it("restores the confirmed state and reports a rejected pin change", async () => {
  api.mockImplementation((_path, options) => options.method === "PATCH" ? Promise.reject(new Error("Save failed")) : Promise.resolve({ messages: [message] }));
  const fixture = mount();
  try {
    await fixture.render([message.id]);
    await click(remove());
    expect(row()?.hasAttribute("data-leaving")).toBe(false);
    expect(remove().disabled).toBe(false);
    expect(dispatch).toHaveBeenCalledWith({ type: "error", message: "Error: Save failed" });
  } finally {
    fixture.close();
  }
});
