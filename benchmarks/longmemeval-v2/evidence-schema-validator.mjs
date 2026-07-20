import { readFileSync } from "node:fs";

function resolveReference(schema, reference) {
  if (!reference.startsWith("#/")) throw new Error(`Unsupported schema reference: ${reference}`);
  return reference
    .slice(2)
    .split("/")
    .reduce((value, key) => value[key.replaceAll("~1", "/").replaceAll("~0", "~")], schema);
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";
  return false;
}

function validateNode(value, rule, schema, location) {
  if (rule.$ref) return validateNode(value, resolveReference(schema, rule.$ref), schema, location);
  if (rule.const !== undefined && JSON.stringify(value) !== JSON.stringify(rule.const)) {
    throw new Error(`${location} does not equal its required constant.`);
  }
  if (rule.enum && !rule.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    throw new Error(`${location} is not an allowed value.`);
  }
  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some((type) => matchesType(value, type)))
      throw new Error(`${location} has the wrong type.`);
  }
  if (typeof value === "string") {
    if (rule.minLength !== undefined && value.length < rule.minLength)
      throw new Error(`${location} is too short.`);
    if (rule.pattern && !new RegExp(rule.pattern, "u").test(value))
      throw new Error(`${location} does not match its pattern.`);
    if (rule.format === "date-time" && Number.isNaN(Date.parse(value)))
      throw new Error(`${location} is not a date-time.`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${location} is not finite.`);
    if (rule.minimum !== undefined && value < rule.minimum)
      throw new Error(`${location} is below its minimum.`);
    if (rule.maximum !== undefined && value > rule.maximum)
      throw new Error(`${location} is above its maximum.`);
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems)
      throw new Error(`${location} has too few items.`);
    if (rule.maxItems !== undefined && value.length > rule.maxItems)
      throw new Error(`${location} has too many items.`);
    if (rule.items)
      value.forEach((item, index) =>
        validateNode(item, rule.items, schema, `${location}[${index}]`),
      );
    for (const condition of rule.allOf ?? []) validateNode(value, condition, schema, location);
    if (
      rule.contains &&
      !value.some((item) => {
        try {
          validateNode(item, rule.contains, schema, location);
          return true;
        } catch {
          return false;
        }
      })
    )
      throw new Error(`${location} has no required member.`);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (rule.minProperties !== undefined && keys.length < rule.minProperties)
      throw new Error(`${location} has too few properties.`);
    for (const key of rule.required ?? [])
      if (!Object.hasOwn(value, key)) throw new Error(`${location}.${key} is required.`);
    if (rule.additionalProperties === false) {
      for (const key of keys)
        if (!Object.hasOwn(rule.properties ?? {}, key))
          throw new Error(`${location}.${key} is not allowed.`);
    }
    for (const [key, item] of Object.entries(value)) {
      const child =
        rule.properties?.[key] ??
        (typeof rule.additionalProperties === "object" ? rule.additionalProperties : undefined);
      if (child) validateNode(item, child, schema, `${location}.${key}`);
    }
  }
}

export function validateEvidenceSchema(evidence, schemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  validateNode(evidence, schema, schema, "evidence");
}
