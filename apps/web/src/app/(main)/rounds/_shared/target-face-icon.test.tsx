import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  lookupTargetFace,
  TargetFaceIcon,
  TargetFaceInfo,
  type TargetFaceRing,
  type TargetFaceSpotLayout,
} from "./target-face-icon";

const yellowRing: TargetFaceRing = {
  radius: 8,
  color: "#FFE800",
  line_color: "#000000",
  z_index: 2,
  score_str: "9",
  score_int: 9,
};

const redRing: TargetFaceRing = {
  radius: 16,
  color: "#FF0000",
  line_color: "#000000",
  z_index: 1,
  score_str: "7",
  score_int: 7,
};

describe("TargetFaceIcon", () => {
  const emptySpot: TargetFaceSpotLayout = {
    center_x: 0,
    center_y: 0,
    target_face_rings: [],
  };

  const filledSpot: TargetFaceSpotLayout = {
    center_x: 10,
    center_y: -5,
    target_face_rings: [yellowRing, redRing],
  };

  it("renders a dashed placeholder when no spot has any ring", () => {
    const { container } = render(<TargetFaceIcon spots={[emptySpot]} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("span.border-dashed")).not.toBeNull();
  });

  it("renders a group per spot, positioned by center_x/center_y", () => {
    const { container } = render(
      <TargetFaceIcon spots={[emptySpot, filledSpot]} />,
    );
    // 空のスポットもグループ自体は描画されるが、中身のcircleは持たない。
    const groups = container.querySelectorAll("g");
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelectorAll("circle")).toHaveLength(0);

    const filledGroup = groups[1];
    expect(filledGroup).toHaveAttribute(
      "transform",
      `translate(${filledSpot.center_x} ${-filledSpot.center_y})`,
    );
    expect(filledGroup.querySelectorAll("circle")).toHaveLength(2);
  });
});

describe("lookupTargetFace", () => {
  const faces = [{ id: "a" }, { id: "b" }];

  it('一覧にidが無ければ"missing"を返す(空の一覧を含む)', () => {
    expect(lookupTargetFace(faces, "x")).toBe("missing");
    expect(lookupTargetFace([], "a")).toBe("missing");
  });

  it("一覧にidがあれば、その的を返す", () => {
    expect(lookupTargetFace(faces, "b")).toBe(faces[1]);
  });
});

describe("TargetFaceInfo", () => {
  const face = {
    size: 122,
    target_face_spots: [
      { center_x: 0, center_y: 0, target_face_rings: [yellowRing, redRing] },
    ],
  };

  it("的があれば、サイズと図を表示する", () => {
    const { container } = render(<TargetFaceInfo face={face} />);

    expect(container).toHaveTextContent("122cm");
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("見つからないときは、「的データを取得できません」を表示する", () => {
    const { container } = render(<TargetFaceInfo face="missing" />);

    expect(container).toHaveTextContent("的データを取得できません");
    expect(container.querySelector("svg")).toBeNull();
  });
});
