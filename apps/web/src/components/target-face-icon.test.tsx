import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  TargetFaceIcon,
  type TargetFaceRing,
  type TargetFaceSpotLayout,
  TargetFaceThumbnail,
  TargetFaceTile,
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
  it("renders a dashed placeholder when there are no rings", () => {
    const { container } = render(<TargetFaceIcon rings={[]} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("span.border-dashed")).not.toBeNull();
  });

  it("renders one circle per ring when rings are present", () => {
    const { container } = render(
      <TargetFaceIcon rings={[yellowRing, redRing]} />,
    );
    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(2);
  });

  it("draws the largest ring first so smaller rings layer on top", () => {
    const { container } = render(
      <TargetFaceIcon rings={[yellowRing, redRing]} />,
    );
    const circles = container.querySelectorAll("circle");
    expect(circles[0]).toHaveAttribute("r", String(redRing.radius));
    expect(circles[1]).toHaveAttribute("r", String(yellowRing.radius));
  });
});

describe("TargetFaceThumbnail", () => {
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
    const { container } = render(<TargetFaceThumbnail spots={[emptySpot]} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("span.border-dashed")).not.toBeNull();
  });

  it("renders a group per spot, positioned by center_x/center_y", () => {
    const { container } = render(
      <TargetFaceThumbnail spots={[emptySpot, filledSpot]} />,
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

describe("TargetFaceTile", () => {
  it("renders the size label", () => {
    const spot: TargetFaceSpotLayout = {
      center_x: 0,
      center_y: 0,
      target_face_rings: [yellowRing, redRing],
    };
    const { getByText } = render(<TargetFaceTile spots={[spot]} sizeCm={80} />);
    expect(getByText("80")).toBeInTheDocument();
  });

  it("does not render a center badge when there are no rings", () => {
    const spot: TargetFaceSpotLayout = {
      center_x: 0,
      center_y: 0,
      target_face_rings: [],
    };
    const { container } = render(<TargetFaceTile spots={[spot]} sizeCm={80} />);
    expect(container.querySelector('[role="img"]')).toBeNull();
  });
});
