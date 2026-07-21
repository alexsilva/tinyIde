export function parseCommandLineArguments(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let tokenStarted = false;

  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      tokenStarted = true;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      tokenStarted = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (tokenStarted) result.push(current);
      current = "";
      tokenStarted = false;
      continue;
    }
    current += character;
    tokenStarted = true;
  }

  if (quote) throw new Error("Parâmetros contêm aspas não fechadas.");
  if (escaped) {
    current += "\\";
    tokenStarted = true;
  }
  if (tokenStarted) result.push(current);
  return result;
}

export function formatCommandLineArguments(argumentsList: readonly string[]): string {
  return argumentsList
    .map((argument) => {
      if (!argument) return '""';
      if (!/[\s"'\\]/.test(argument)) return argument;
      return `"${argument.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    })
    .join(" ");
}
