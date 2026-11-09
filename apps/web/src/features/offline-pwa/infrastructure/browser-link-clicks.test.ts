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

function addLink(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.addEventListener("click", (e) => e.preventDefault());
  document.body.append(a);
  return a;
}

function listen() {
  const received: LinkClick[] = [];
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
  });

  it.each([["同じパスのハッシュ", "http://localhost/rounds#a"]])(
    "%sのリンクは、通知しない",
    (_, href) => {
      // Given
      const { received } = listen();
      const link = addLink(href);

      // When
      fireEvent.click(link);

      // Then
      expect(received).toEqual([]);
    },
  );

  it("リンクの外のclickは、通知しない", () => {
    // Given
    const { received } = listen();

    // When
    fireEvent.click(document.body);

    // Then
    expect(received).toEqual([]);
  });

  it("修飾キーつきのclickは、通知しない", () => {
    // Given
    const { received } = listen();
    const link = addLink("http://localhost/rounds/new");

    // When
    fireEvent.click(link, { ctrlKey: true });

    // Then
    expect(received).toEqual([]);
  });

  it("blockは、遷移を止め、後の購読者へclickを届けない", () => {
    // Given
    const { received } = listen();
    const link = addLink("http://localhost/rounds/new");
    const passed = vi.fn();
    document.addEventListener("click", passed);
    const blockOnClick = createBrowserLinkClicks().onClick((l) => l.block());

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
