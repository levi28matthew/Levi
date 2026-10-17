import { describe, expect, it } from "vitest";
import { moveInOrder, reorderTargets } from "./ordering";

const ORDER = ["a", "b", "c", "d"];

describe("reorder targets", () => {
  it("points at the neighbour a mission should trade places with", () => {
    expect(reorderTargets(ORDER, "c", "up")).toEqual({ currentIndex: 2, targetIndex: 1 });
    expect(reorderTargets(ORDER, "c", "down")).toEqual({ currentIndex: 2, targetIndex: 3 });
  });

  it("refuses to move off the ends of the list", () => {
    expect(reorderTargets(ORDER, "a", "up")).toBeNull();
    expect(reorderTargets(ORDER, "d", "down")).toBeNull();
    expect(reorderTargets(["only"], "only", "up")).toBeNull();
    expect(reorderTargets(["only"], "only", "down")).toBeNull();
  });

  it("reports nothing for an id that is not in the list", () => {
    expect(reorderTargets(ORDER, "missing", "up")).toBeNull();
    expect(reorderTargets([], "a", "down")).toBeNull();
  });
});

describe("moving inside a stored order", () => {
  it("swaps exactly two entries", () => {
    expect(moveInOrder(ORDER, "c", "b")).toEqual(["a", "c", "b", "d"]);
    expect(moveInOrder(ORDER, "a", "b")).toEqual(["b", "a", "c", "d"]);
  });

  it("leaves resolved missions where they are", () => {
    // b is completed, so only a and c are open: swapping them must not move b.
    expect(moveInOrder(ORDER, "c", "a")).toEqual(["c", "b", "a", "d"]);
  });

  it("sends a stale form nowhere", () => {
    expect(moveInOrder(ORDER, "missing", "a")).toEqual(ORDER);
    expect(moveInOrder(ORDER, "a", "missing")).toEqual(ORDER);
    expect(moveInOrder(ORDER, "a", "a")).toEqual(ORDER);
  });

  it("never mutates the order it was given", () => {
    const original = [...ORDER];
    moveInOrder(original, "a", "d");
    expect(original).toEqual(ORDER);
  });
});
