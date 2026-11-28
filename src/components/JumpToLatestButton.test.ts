// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { JumpToLatestButton } from "./JumpToLatestButton";

it("shows later messages in the jump button's slot until the remaining messages are displayed", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const jumpToLatest = vi.fn();
  const showLater = vi.fn();
  const render = (laterCount: number, showJumpToLatest: boolean) => flushSync(() => root.render(createElement(JumpToLatestButton, {
    laterCount, showJumpToLatest, showLater, jumpToLatest, className: "bottom-full",
  })));
  try {
    render(5, true);
    const later = host.querySelector("button")!;
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(later.textContent).toBe("Show later messages (5 more)");
    expect(later.classList.contains("text-sm")).toBe(true);
    expect(later.classList.contains("bottom-full")).toBe(true);
    later.click();
    expect(showLater).toHaveBeenCalledOnce();
    expect(jumpToLatest).not.toHaveBeenCalled();

    render(0, true);
    const jump = host.querySelector("button")!;
    expect(jump.querySelector("svg")).not.toBeNull();
    expect(jump.classList.contains("bottom-full")).toBe(true);
    jump.click();
    expect(jumpToLatest).toHaveBeenCalledOnce();

    render(0, false);
    expect(host.querySelector("button")).toBeNull();
  } finally {
    flushSync(() => root.unmount());
  }
});
