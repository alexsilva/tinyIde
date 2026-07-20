interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(value: string): SemanticVersion {
  const match = VERSION_PATTERN.exec(value.trim());

  if (!match) {
    throw new Error(`Invalid semantic version: ${value}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compare(left: SemanticVersion, right: SemanticVersion): number {
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  );
}

function upperBoundForCaret(version: SemanticVersion): SemanticVersion {
  if (version.major > 0) {
    return { major: version.major + 1, minor: 0, patch: 0 };
  }

  if (version.minor > 0) {
    return { major: 0, minor: version.minor + 1, patch: 0 };
  }

  return { major: 0, minor: 0, patch: version.patch + 1 };
}

function matchesComparator(current: SemanticVersion, comparator: string): boolean {
  if (comparator.startsWith("^")) {
    const minimum = parseVersion(comparator.slice(1));
    return compare(current, minimum) >= 0 && compare(current, upperBoundForCaret(minimum)) < 0;
  }

  if (comparator.startsWith("~")) {
    const minimum = parseVersion(comparator.slice(1));
    const maximum = { major: minimum.major, minor: minimum.minor + 1, patch: 0 };
    return compare(current, minimum) >= 0 && compare(current, maximum) < 0;
  }

  for (const operator of [">=", "<=", ">", "<", "="] as const) {
    if (!comparator.startsWith(operator)) {
      continue;
    }

    const expected = parseVersion(comparator.slice(operator.length));
    const result = compare(current, expected);

    return {
      ">=": result >= 0,
      "<=": result <= 0,
      ">": result > 0,
      "<": result < 0,
      "=": result === 0,
    }[operator];
  }

  return compare(current, parseVersion(comparator)) === 0;
}

export function satisfiesVersion(range: string, currentVersion: string): boolean {
  const normalizedRange = range.trim();

  if (!normalizedRange || normalizedRange === "*") {
    return true;
  }

  const current = parseVersion(currentVersion);
  const comparators = normalizedRange.split(/\s+/);
  return comparators.every((comparator) => matchesComparator(current, comparator));
}
