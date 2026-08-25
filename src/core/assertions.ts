import { JSONPath } from "jsonpath-plus";
import { interpolate } from "./interpolate";
import type { Assertion, AssertionResult, HttpSendResult } from "./types";

function headerValue(
  headers: [string, string][],
  name: string,
): string | undefined {
  const found = headers.find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return found?.[1];
}

function decodeBody(result: HttpSendResult): string {
  if (result.bodyEncoding === "base64") {
    try {
      return atob(result.body);
    } catch {
      return result.body;
    }
  }
  return result.body;
}

function fail(id: string, message: string): AssertionResult {
  return { id, passed: false, message };
}

function pass(id: string, message: string): AssertionResult {
  return { id, passed: true, message };
}

export function runAssertions(
  tests: Assertion[],
  result: HttpSendResult,
  vars: Record<string, string>,
): AssertionResult[] {
  return tests
    .filter((test) => test.enabled)
    .map((test) => evaluate(test, result, vars));
}

function evaluate(
  test: Assertion,
  result: HttpSendResult,
  vars: Record<string, string>,
): AssertionResult {
  if (test.kind === "status") {
    const status = result.status;
    if (status == null) return fail(test.id, "No hay status");
    if (test.op === "inRange") {
      const ok = status >= test.min && status <= test.max;
      return ok
        ? pass(test.id, `${status} está en ${test.min}–${test.max}`)
        : fail(test.id, `${status} no está en ${test.min}–${test.max}`);
    }
    const expected = Number(interpolate(test.expected || "200", vars));
    return status === expected
      ? pass(test.id, `status ${status}`)
      : fail(test.id, `status ${status}, se esperaba ${expected}`);
  }

  if (test.kind === "header") {
    const name = interpolate(test.headerName, vars).trim();
    if (!name) return fail(test.id, "Falta el nombre del header");
    const value = headerValue(result.headers, name);
    if (test.op === "exists") {
      return value != null
        ? pass(test.id, `${name}: ${value}`)
        : fail(test.id, `No está el header ${name}`);
    }
    const expected = interpolate(test.expected, vars);
    if (value == null) return fail(test.id, `No está el header ${name}`);
    return value.toLowerCase() === expected.toLowerCase() || value.includes(expected)
      ? pass(test.id, `${name} = ${value}`)
      : fail(test.id, `${name} es “${value}”, se esperaba “${expected}”`);
  }

  const raw = decodeBody(result).trim();
  if (!raw) return fail(test.id, "el body no es JSON");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail(test.id, "el body no es JSON");
  }
  const path = interpolate(test.path || "$", vars);
  let matches: unknown[] = [];
  try {
    const found = JSONPath({ path, json: json as object });
    matches = Array.isArray(found) ? found : [found];
  } catch (error) {
    return fail(
      test.id,
      error instanceof Error ? error.message : "JSONPath inválido",
    );
  }
  const first = matches[0];
  if (test.op === "exists") {
    return first !== undefined
      ? pass(test.id, `${path} existe`)
      : fail(test.id, `${path} no existe`);
  }
  const expected = interpolate(test.expected, vars);
  const asText =
    first === undefined
      ? ""
      : typeof first === "string"
        ? first
        : JSON.stringify(first);
  if (test.op === "contains") {
    return asText.includes(expected)
      ? pass(test.id, `${path} contiene “${expected}”`)
      : fail(test.id, `${path} = ${asText}`);
  }
  return asText === expected
    ? pass(test.id, `${path} = ${asText}`)
    : fail(test.id, `${path} = ${asText}, se esperaba “${expected}”`);
}
