import { describe, expect, it } from "vitest";
import { parseVersion, satisfiesVersion } from "./version";

describe("semantic versions", () => {
  it("parses versions", () => {
    expect(parseVersion(" 1.2.3 ")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(() => parseVersion("1.2")).toThrow("Invalid semantic version");
  });

  it.each([
    ["", "9.9.9", true],
    ["*", "9.9.9", true],
    ["1.2.3", "1.2.3", true],
    ["1.2.3", "1.2.4", false],
    ["^1.2.3", "1.9.0", true],
    ["^1.2.3", "2.0.0", false],
    ["^0.2.3", "0.2.9", true],
    ["^0.2.3", "0.3.0", false],
    ["^0.0.3", "0.0.3", true],
    ["^0.0.3", "0.0.4", false],
    ["~1.2.3", "1.2.9", true],
    ["~1.2.3", "1.3.0", false],
    [">=1.2.3 <2.0.0", "1.5.0", true],
    [">1.2.3", "1.2.3", false],
    ["<=1.2.3", "1.2.3", true],
    ["<1.2.3", "1.2.2", true],
    ["=1.2.3", "1.2.3", true],
  ])("checks %s against %s", (range, current, expected) => {
    expect(satisfiesVersion(range, current)).toBe(expected);
  });
});
