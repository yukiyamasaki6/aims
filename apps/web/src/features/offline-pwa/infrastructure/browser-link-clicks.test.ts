import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkClick } from "../application/update-activation";
import { createBrowserLinkClicks } from "./browser-link-clicks";

const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal("location", {
    href: "http://localhost/rounds",
    origin: "http://localhost",
    pathname: "/rounds",
    search: "",
    assign,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function addLink(href: string, attrs: Record<string, string> = {}) {
  const a = document.createElement("a");
  a.href = href;
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  a.addEventListener("click", (e) => e.preventDefault());
  document.body.append(a);
  return a;
}

function listen() {
  const received: (LinkClick | null)[] = [];
  const stop = createBrowserLinkClicks().onClick((link) => received.push(link));
  return { received, stop };
}

describe("createBrowserLinkClicks", () => {
  it("内部へ移る通常のリンク操作を、LinkClickとして渡す", () => {
    // Given
    const { received } = listen();
    const link = addLink("http://localhost/rounds/new");

    // When
    fireEvent.click(link);

    // Then
    expect(received).toHaveLength(1);
    expect(received[0]).not.toBeNull();
  });

  it.each([
    ["別のオリジン", "http://example.com/x", {}],
    ["target=_blank", "http://localhost/x", { target: "_blank" }],
    ["download", "http://localhost/x", { download: "" }],
    ["同じパスのハッシュ", "http://localhost/rounds#a", {}],
  ])("%sのリンクは、除外としてnullで渡す", (_, href, attrs) => {
    // Given
    const { received } = listen();
    const link = addLink(href, attrs);

    // When
    fireEvent.click(link);

    // Then
    expect(received).toEqual([null]);
  });

  it("リンクの外のclickは、除外としてnullで渡す", () => {
    // Given
    const { received } = listen();

    // When
    fireEvent.click(document.body);

    // Then
    expect(received).toEqual([null]);
  });

  it("修飾キーつきのclickは、除外としてnullで渡す", () => {
    // Given
    const { received } = listen();
    const link = addLink("http://localhost/rounds/new");

    // When
    fireEvent.click(link, { ctrlKey: true });

    // Then
    expect(received).toEqual([null]);
  });

  it("主ボタンでないclickは、除外としてnullで渡す", () => {
    // Given
    const { received } = listen();
    const link = addLink("http://localhost/rounds/new");

    // When
    fireEvent.click(link, { button: 1 });

    // Then
    expect(received).toEqual([null]);
  });

  it("他の処理が止めたclick(defaultPrevented)は、除外としてnullで渡す", () => {
    // Given
    const { received } = listen();
    const link = addLink("http://localhost/rounds/new");
    const stopper = (e: Event) => e.preventDefault();
    window.addEventListener("click", stopper, true);

    // When
    fireEvent.click(link);
    window.removeEventListener("click", stopper, true);

    // Then
    expect(received).toEqual([null]);
  });

  it("blockは、遷移を止め、後の購読者へclickを届けない", () => {
    // Given
    const { received } = listen();
    const link = addLink("http://localhost/rounds/new");
    const passed = vi.fn();
    document.addEventListener("click", passed);
    const blockOnClick = createBrowserLinkClicks().onClick((l) => l?.block());

    // When
    fireEvent.click(link);
    document.removeEventListener("click", passed);
    blockOnClick();

    // Then
    expect(received).toHaveLength(1);
    expect(passed).not.toHaveBeenCalled();
  });

  it("followは、リンク先へlocation.assignで進む", () => {
    // Given
    const { received } = listen();
    fireEvent.click(addLink("http://localhost/rounds/new"));

    // When
    received[0]?.follow();

    // Then
    expect(assign).toHaveBeenCalledExactlyOnceWith(
      "http://localhost/rounds/new",
    );
  });

  it("repeatは、同じリンクを押し直し、その間の操作は自分の購読者へ届けない", () => {
    // Given
    const { received } = listen();
    const link = addLink("http://localhost/rounds/new");
    const repeated = vi.fn();
    link.addEventListener("click", repeated);
    fireEvent.click(link);

    // When
    received[0]?.repeat();

    // Then
    expect(repeated).toHaveBeenCalledTimes(2);
    expect(received).toHaveLength(1);
  });

  it("repeatの後は、再び操作を購読者へ届ける", () => {
    // Given
    const { received } = listen();
    const link = addLink("http://localhost/rounds/new");
    fireEvent.click(link);
    received[0]?.repeat();

    // When
    fireEvent.click(link);

    // Then
    expect(received).toHaveLength(2);
  });

  it("返した関数で購読を外す", () => {
    // Given
    const { received, stop } = listen();
    const link = addLink("http://localhost/rounds/new");

    // When
    stop();
    fireEvent.click(link);

    // Then
    expect(received).toEqual([]);
  });
});
