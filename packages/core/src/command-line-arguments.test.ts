import { describe, expect, it } from "vitest";
import {
  formatCommandLineArguments,
  parseCommandLineArguments,
} from "./command-line-arguments";

describe("command-line arguments", () => {
  it("splits ordinary command-line parameters", () => {
    expect(parseCommandLineArguments("runserver localhost:9092")).toEqual([
      "runserver",
      "localhost:9092",
    ]);
  });

  it("preserves quoted and empty parameters", () => {
    expect(parseCommandLineArguments('--name "Preço Certo" ""')).toEqual([
      "--name",
      "Preço Certo",
      "",
    ]);
  });

  it("formats parameters without changing their values", () => {
    const parameters = [
      "runserver",
      "localhost:9092",
      "value with space",
      "",
      'a"b',
      "C:\\project\\file.py",
    ];
    expect(parseCommandLineArguments(formatCommandLineArguments(parameters))).toEqual(parameters);
  });

  it("rejects unclosed quotes", () => {
    expect(() => parseCommandLineArguments('runserver "localhost:9092')).toThrow(
      "aspas não fechadas",
    );
  });
});
