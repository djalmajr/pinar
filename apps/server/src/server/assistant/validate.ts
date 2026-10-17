// Input-schema validation for the assistant tool adapter.
//
// Moved from scripts/assistant-bench/tools.ts (the bench now imports it from
// here) without behavior changes: the Pinar MCP tool inputSchema values are
// JSON Schema objects, and this validator only reads the keys declared in
// ToolInputSchema.

export interface ToolInputSchema {
  [key: string]: unknown;
  anyOf?: ToolInputSchema[];
  items?: ToolInputSchema;
  maxItems?: number;
  maxLength?: number;
  maximum?: number;
  minItems?: number;
  minimum?: number;
  properties?: Record<string, ToolInputSchema>;
  required?: string[];
  type?: string | string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    default:
      return false;
  }
}

function schemaTypes(schema: ToolInputSchema): string[] {
  const type = schema.type;
  if (type === undefined) return [];
  return Array.isArray(type) ? type : [type];
}

// Validates a value against one schema node; pushes human-readable problems.
function validateNode(schema: ToolInputSchema, value: unknown, path: string, problems: string[]): void {
  if (schema.anyOf && schema.anyOf.length > 0) {
    const matchesAny = schema.anyOf.some((branch) => {
      const branchProblems: string[] = [];
      validateNode(branch, value, path, branchProblems);
      return branchProblems.length === 0;
    });
    if (!matchesAny) problems.push(`${path} does not match any allowed variant`);
    return;
  }
  const types = schemaTypes(schema);
  if (types.length > 0 && !types.some((type) => typeMatches(type, value))) {
    problems.push(`${path} has invalid type (expected ${types.join(" | ")})`);
    return;
  }
  if (typeof value === "string" && schema.maxLength !== undefined && value.length > schema.maxLength) {
    problems.push(`${path} exceeds maxLength ${schema.maxLength}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${path} is below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${path} is above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path} has fewer than ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${path} has more than ${schema.maxItems} item(s)`);
    if (schema.items) {
      value.forEach((item, index) => validateNode(schema.items as ToolInputSchema, item, `${path}[${index}]`, problems));
    }
    return;
  }
  if (isRecord(value) && schema.properties) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required) || value[required] === undefined) {
        problems.push(`${path ? `${path}.` : ""}${required} is missing`);
      }
    }
    for (const [key, sub] of Object.entries(value)) {
      const child = schema.properties[key];
      const childPath = path ? `${path}.${key}` : key;
      if (!child) {
        problems.push(`${childPath} is not declared`);
        continue;
      }
      validateNode(child, sub, childPath, problems);
    }
  }
}

// Validates tool arguments against a tool inputSchema: required fields,
// types, minimum/maximum, maxLength, array item bounds and undeclared
// properties. An empty result means the arguments are acceptable.
export function validateArgs(schema: ToolInputSchema, args: unknown): string[] {
  if (!isRecord(args)) {
    return ["arguments must be a JSON object"];
  }
  const problems: string[] = [];
  validateNode(schema, args, "", problems);
  return problems;
}
