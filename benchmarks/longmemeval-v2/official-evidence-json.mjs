function invalidJson() {
  throw new SyntaxError("Invalid JSON structure.");
}

export function assertNoDuplicateJsonKeys(source) {
  let index = 0;

  function skipWhitespace() {
    while (index < source.length && /[\t\n\r ]/u.test(source[index])) index += 1;
  }

  function readString() {
    const start = index;
    if (source[index] !== '"') invalidJson();
    index += 1;
    while (index < source.length) {
      const character = source[index];
      index += 1;
      if (character === '"') return JSON.parse(source.slice(start, index));
      if (character === "\\") {
        if (index >= source.length) invalidJson();
        index += 1;
      }
    }
    invalidJson();
  }

  function scanPrimitive() {
    const start = index;
    while (index < source.length && !/[\t\n\r ,\]}]/u.test(source[index])) index += 1;
    if (index === start) invalidJson();
  }

  function scanArray() {
    index += 1;
    skipWhitespace();
    if (source[index] === "]") {
      index += 1;
      return;
    }
    while (index < source.length) {
      scanValue();
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      if (source[index] !== ",") invalidJson();
      index += 1;
    }
    invalidJson();
  }

  function scanObject() {
    const keys = new Set();
    index += 1;
    skipWhitespace();
    if (source[index] === "}") {
      index += 1;
      return;
    }
    while (index < source.length) {
      skipWhitespace();
      const key = readString();
      if (keys.has(key)) throw new Error(`Duplicate JSON object key: ${key}`);
      keys.add(key);
      skipWhitespace();
      if (source[index] !== ":") invalidJson();
      index += 1;
      scanValue();
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      if (source[index] !== ",") invalidJson();
      index += 1;
    }
    invalidJson();
  }

  function scanValue() {
    skipWhitespace();
    if (source[index] === "{") return scanObject();
    if (source[index] === "[") return scanArray();
    if (source[index] === '"') {
      readString();
      return;
    }
    scanPrimitive();
  }

  scanValue();
  skipWhitespace();
  if (index !== source.length) invalidJson();
}
