import { JSONPath } from 'jsonpath-plus'
import type { RequestItem } from '../collectionTree'
import type { RunResult, RunTestResult } from '../requestRunner/runRequest'
import type { TestFunctionRef } from './types'
import { extractFunctionNamesFromCode } from './functionParser'

type TestMessage = { passed: boolean, message: string, expected?: unknown, actual?: unknown }

type StreamOps = {
  values: unknown[]
  allEquals: (expectedValue: unknown) => TestMessage
  anyEquals: (expectedValue: unknown) => boolean
  count: () => number
}

type AssertionSnapshot = {
  expected: unknown
  actual: unknown
}

class AssertionFailure extends Error {
  expected?: unknown
  actual?: unknown

  constructor(message: string, expected?: unknown, actual?: unknown) {
    super(message)
    this.name = 'AssertionFailure'
    this.expected = expected
    this.actual = actual
  }
}

type AssertApi = {
  equal: (actual: unknown, expected: unknown, message?: string) => true
  notEqual: (actual: unknown, expected: unknown, message?: string) => true
  deepEqual: (actual: unknown, expected: unknown, message?: string) => true
  notDeepEqual: (actual: unknown, expected: unknown, message?: string) => true
  isTrue: (actual: unknown, message?: string) => true
  isFalse: (actual: unknown, message?: string) => true
  ok: (actual: unknown, message?: string) => true
  includes: (actual: unknown, expectedPart: unknown, message?: string) => true
  matches: (actual: unknown, pattern: RegExp | string, message?: string) => true
  greaterThan: (actual: unknown, expected: number, message?: string) => true
  greaterThanOrEqual: (actual: unknown, expected: number, message?: string) => true
  lessThan: (actual: unknown, expected: number, message?: string) => true
  lessThanOrEqual: (actual: unknown, expected: number, message?: string) => true
  fail: (message?: string, expected?: unknown, actual?: unknown) => never
}

type ExpectedActualAssertion = (expected: unknown, actual: unknown, message?: string) => true
type ExpectedActualNumericAssertion = (expected: number, actual: unknown, message?: string) => true
type ExpectedActualIncludesAssertion = (expectedPart: unknown, actual: unknown, message?: string) => true
type ExpectedActualMatchesAssertion = (pattern: RegExp | string, actual: unknown, message?: string) => true
type TestResultExpectedActual = Pick<RunTestResult, 'expected' | 'actual'>

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function deepEqual(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) return true

  if (!isObjectLike(left) || !isObjectLike(right)) return false

  if (seen.get(left) === right) return true
  seen.set(left, right)

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i += 1) {
      if (!deepEqual(left[i], right[i], seen)) return false
    }
    return true
  }

  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
  }

  if (left instanceof RegExp || right instanceof RegExp) {
    return left instanceof RegExp && right instanceof RegExp && left.source === right.source && left.flags === right.flags
  }

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!deepEqual(left[key], right[key], seen)) return false
  }
  return true
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function failAssert(message: string, expected?: unknown, actual?: unknown): never {
  throw new AssertionFailure(message, expected, actual)
}

function createAssertApi() {
  let lastAssertion: AssertionSnapshot | null = null
  const remember = (expected: unknown, actual: unknown) => {
    lastAssertion = { expected, actual }
  }

  return {
    api: {
      equal(actual, expected, message) {
        remember(expected, actual)
        if (Object.is(actual, expected)) return true
        failAssert(message || 'assertEqual failed', expected, actual)
      },
      notEqual(actual, expected, message) {
        remember(`not ${String(expected)}`, actual)
        if (!Object.is(actual, expected)) return true
        failAssert(message || 'assertNotEqual failed', expected, actual)
      },
      deepEqual(actual, expected, message) {
        remember(expected, actual)
        if (deepEqual(actual, expected)) return true
        failAssert(message || 'assertDeepEqual failed', expected, actual)
      },
      notDeepEqual(actual, expected, message) {
        remember('values should differ', actual)
        if (!deepEqual(actual, expected)) return true
        failAssert(message || 'assertNotDeepEqual failed', expected, actual)
      },
      isTrue(actual, message) {
        remember(true, actual)
        if (actual === true) return true
        failAssert(message || 'assertTrue failed', true, actual)
      },
      isFalse(actual, message) {
        remember(false, actual)
        if (actual === false) return true
        failAssert(message || 'assertFalse failed', false, actual)
      },
      ok(actual, message) {
        remember(true, actual)
        if (actual) return true
        failAssert(message || 'assertOk failed', true, actual)
      },
      includes(actual, expectedPart, message) {
        remember(expectedPart, actual)
        if (typeof actual === 'string') {
          const expectedText = String(expectedPart ?? '')
          if (actual.includes(expectedText)) return true
        } else if (Array.isArray(actual)) {
          if (actual.some(item => Object.is(item, expectedPart))) return true
        } else if (isObjectLike(actual) && (typeof expectedPart === 'string' || typeof expectedPart === 'number' || typeof expectedPart === 'symbol')) {
          if (expectedPart in actual) return true
        }
        failAssert(message || 'assertIncludes failed', expectedPart, actual)
      },
      matches(actual, pattern, message) {
        const text = typeof actual === 'string' ? actual : String(actual ?? '')
        const re = pattern instanceof RegExp ? pattern : new RegExp(pattern)
        remember(String(re), actual)
        if (re.test(text)) return true
        failAssert(message || 'assertMatches failed', String(re), actual)
      },
      greaterThan(actual, expected, message) {
        remember(`> ${expected}`, actual)
        const n = toNumberOrNull(actual)
        if (n !== null && n > expected) return true
        failAssert(message || 'assertGreaterThan failed', `> ${expected}`, actual)
      },
      greaterThanOrEqual(actual, expected, message) {
        remember(`>= ${expected}`, actual)
        const n = toNumberOrNull(actual)
        if (n !== null && n >= expected) return true
        failAssert(message || 'assertGreaterThanOrEqual failed', `>= ${expected}`, actual)
      },
      lessThan(actual, expected, message) {
        remember(`< ${expected}`, actual)
        const n = toNumberOrNull(actual)
        if (n !== null && n < expected) return true
        failAssert(message || 'assertLessThan failed', `< ${expected}`, actual)
      },
      lessThanOrEqual(actual, expected, message) {
        remember(`<= ${expected}`, actual)
        const n = toNumberOrNull(actual)
        if (n !== null && n <= expected) return true
        failAssert(message || 'assertLessThanOrEqual failed', `<= ${expected}`, actual)
      },
      fail(message, expected, actual) {
        remember(expected, actual)
        failAssert(message || 'assertFail called', expected, actual)
      },
    } as AssertApi,
    getLastAssertion: () => lastAssertion,
    resetLastAssertion: () => {
      lastAssertion = null
    },
  }
}

function getAssertionFailure(error: unknown): AssertionFailure | null {
  if (error instanceof AssertionFailure) return error
  if (!error || typeof error !== 'object') return null
  const item = error as { name?: unknown, message?: unknown, expected?: unknown, actual?: unknown }
  if (item.name !== 'AssertionFailure') return null
  const message = typeof item.message === 'string' ? item.message : 'Assertion failed'
  return new AssertionFailure(message, item.expected, item.actual)
}

function normalizeTestResultOutput(output: unknown): { passed: boolean, message: string, expected?: unknown, actual?: unknown } {
  if (typeof output === 'boolean') {
    if (output) return { passed: true, message: 'Passed' }
    return { passed: false, message: 'Returned false', expected: true, actual: false }
  }
  if (output && typeof output === 'object') {
    const record = output as { passed?: unknown, message?: unknown, expected?: unknown, actual?: unknown }
    if (typeof record.passed === 'boolean') {
      const msg = typeof record.message === 'string' && record.message.trim()
        ? record.message.trim()
        : (record.passed ? 'Passed' : 'Failed')
      return { passed: record.passed, message: msg, expected: record.expected, actual: record.actual }
    }
  }
  if (output === undefined) return { passed: true, message: 'Passed' }
  if (output) return { passed: true, message: 'Passed' }
  return { passed: false, message: 'Returned falsy value', expected: true, actual: output }
}

function resolveExpectedActual(
  normalized: ReturnType<typeof normalizeTestResultOutput>,
  snapshot: AssertionSnapshot | null,
): TestResultExpectedActual {
  return {
    expected: typeof normalized.expected !== 'undefined' ? normalized.expected : snapshot?.expected,
    actual: typeof normalized.actual !== 'undefined' ? normalized.actual : snapshot?.actual,
  }
}

function buildRuntimeErrorResult(args: {
  name: string
  source: RunTestResult['source']
  startedAt: number
  error: unknown
}): RunTestResult {
  return {
    name: args.name,
    source: args.source,
    passed: false,
    message: 'Runtime error',
    error: (args.error as Error | null)?.message || String(args.error),
    durationMs: Math.max(0, performance.now() - args.startedAt),
  }
}

function buildAssertionErrorResult(args: {
  name: string
  source: RunTestResult['source']
  startedAt: number
  assertion: AssertionFailure
}): RunTestResult {
  return {
    name: args.name,
    source: args.source,
    passed: false,
    message: args.assertion.message || 'Assertion failed',
    expected: args.assertion.expected,
    actual: args.assertion.actual,
    durationMs: Math.max(0, performance.now() - args.startedAt),
  }
}

function createStream(values: unknown[], path: string): StreamOps {
  return {
    values,
    allEquals: (expectedValue: unknown) => {
      const mismatches = values.filter(v => !Object.is(v, expectedValue))
      return {
        passed: mismatches.length === 0,
        message: mismatches.length === 0
          ? `All ${values.length} values for ${path} equal ${JSON.stringify(expectedValue)}`
          : `Found ${mismatches.length}/${values.length} mismatches for ${path}. Examples: ${JSON.stringify(mismatches.slice(0, 10))}`,
        expected: expectedValue,
        actual: mismatches.length === 0 ? values : {
          total: values.length,
          mismatches: mismatches.slice(0, 20),
        },
      }
    },
    anyEquals: (expectedValue: unknown) => values.some(v => Object.is(v, expectedValue)),
    count: () => values.length,
  }
}

export function executeResponseTests(args: {
  selectedGlobalTestFunction: string
  globalTestFunctions: TestFunctionRef[]
  requestTestScript: string
  request: RequestItem
  result: RunResult
}): RunTestResult[] {
  const out: RunTestResult[] = []
  let parsedReady = false
  let parsedBodyCache: unknown | null = null
  const getParsedJsonBody = () => {
    if (!parsedReady) {
      try {
        parsedBodyCache = JSON.parse(args.result.bodyText || '')
      } catch {
        parsedBodyCache = null
      }
      parsedReady = true
    }
    return parsedBodyCache
  }
  const jsonPath = (path: string): unknown[] => {
    const parsed = getParsedJsonBody()
    if (parsed === null) throw new Error('Response body is not valid JSON')
    const q = (path || '').trim()
    if (!q) return []
    const json = parsed as object | string | number | boolean | null | Array<unknown>
    const res = JSONPath<unknown[] | unknown>({ path: q, json, resultType: 'value' })
    return Array.isArray(res) ? res : [res]
  }
  const assertAllEquals = (path: string, expectedValue: unknown): TestMessage => {
    const values = jsonPath(path)
    if (!values.length) {
      return {
        passed: false,
        message: `No values found for JSONPath: ${path}`,
        expected: expectedValue,
        actual: [],
      }
    }
    return createStream(values, path).allEquals(expectedValue)
  }
  const stream = (path: string): StreamOps => createStream(jsonPath(path), path)
  const assertBundle = createAssertApi()
  const assert = assertBundle.api
  const assertEqual: ExpectedActualAssertion = (expected, actual, message) => assert.equal(actual, expected, message)
  const assertEquals: ExpectedActualAssertion = (expected, actual, message) => assert.equal(actual, expected, message)
  const assertNotEqual: ExpectedActualAssertion = (expected, actual, message) => assert.notEqual(actual, expected, message)
  const assertNotEquals: ExpectedActualAssertion = (expected, actual, message) => assert.notEqual(actual, expected, message)
  const assertDeepEqual: ExpectedActualAssertion = (expected, actual, message) => assert.deepEqual(actual, expected, message)
  const assertDeepEquals: ExpectedActualAssertion = (expected, actual, message) => assert.deepEqual(actual, expected, message)
  const assertNotDeepEqual: ExpectedActualAssertion = (expected, actual, message) => assert.notDeepEqual(actual, expected, message)
  const assertNotDeepEquals: ExpectedActualAssertion = (expected, actual, message) => assert.notDeepEqual(actual, expected, message)
  const assertTrue = assert.isTrue
  const assertFalse = assert.isFalse
  const assertIncludes: ExpectedActualIncludesAssertion = (expectedPart, actual, message) => assert.includes(actual, expectedPart, message)
  const assertMatches: ExpectedActualMatchesAssertion = (pattern, actual, message) => assert.matches(actual, pattern, message)
  const assertGreaterThan: ExpectedActualNumericAssertion = (expected, actual, message) => assert.greaterThan(actual, expected, message)
  const assertGreaterThanOrEqual: ExpectedActualNumericAssertion = (expected, actual, message) => assert.greaterThanOrEqual(actual, expected, message)
  const assertLessThan: ExpectedActualNumericAssertion = (expected, actual, message) => assert.lessThan(actual, expected, message)
  const assertLessThanOrEqual: ExpectedActualNumericAssertion = (expected, actual, message) => assert.lessThanOrEqual(actual, expected, message)
  const assertOk = assert.ok
  const assertFail = assert.fail
  const assertEqualActualFirst = assert.equal
  const assertNotEqualActualFirst = assert.notEqual
  const assertDeepEqualActualFirst = assert.deepEqual
  const assertNotDeepEqualActualFirst = assert.notDeepEqual
  const assertIncludesActualFirst = assert.includes
  const assertMatchesActualFirst = assert.matches
  const assertGreaterThanActualFirst = assert.greaterThan
  const assertGreaterThanOrEqualActualFirst = assert.greaterThanOrEqual
  const assertLessThanActualFirst = assert.lessThan
  const assertLessThanOrEqualActualFirst = assert.lessThanOrEqual

  const ctx = {
    status: args.result.status,
    statusText: args.result.statusText,
    ok: args.result.ok,
    timeMs: args.result.timeMs,
    headers: args.result.responseHeaders,
    requestHeaders: args.result.requestHeaders,
    bodyText: args.result.bodyText,
    request: args.request,
    response: args.result,
    jsonPath,
    assertAllEquals,
    stream,
    assert,
    assertEqual,
    assertEquals,
    assertNotEqual,
    assertNotEquals,
    assertDeepEqual,
    assertDeepEquals,
    assertNotDeepEqual,
    assertNotDeepEquals,
    assertTrue,
    assertFalse,
    assertIncludes,
    assertMatches,
    assertGreaterThan,
    assertGreaterThanOrEqual,
    assertLessThan,
    assertLessThanOrEqual,
    assertOk,
    assertFail,
    assertEqualActualFirst,
    assertNotEqualActualFirst,
    assertDeepEqualActualFirst,
    assertNotDeepEqualActualFirst,
    assertIncludesActualFirst,
    assertMatchesActualFirst,
    assertGreaterThanActualFirst,
    assertGreaterThanOrEqualActualFirst,
    assertLessThanActualFirst,
    assertLessThanOrEqualActualFirst,
  }

  const selectedGlobalName = args.selectedGlobalTestFunction.trim()
  if (selectedGlobalName) {
    const fn = args.globalTestFunctions.find(item => `${item.className.trim()}.${item.functionName.trim()}` === selectedGlobalName)
    if (!fn) {
      out.push({
        name: selectedGlobalName,
        source: 'global',
        passed: false,
        message: 'Function not found in global tests.',
        durationMs: 0,
      })
    } else {
      const startedAt = performance.now()
      try {
        const run = new Function(
          'ctx',
          'fnName',
          'response',
          'request',
          'jsonPath',
          'assertAllEquals',
          'stream',
          'assert',
          'assertEqual',
          'assertEquals',
          'assertNotEqual',
          'assertNotEquals',
          'assertDeepEqual',
          'assertDeepEquals',
          'assertNotDeepEqual',
          'assertNotDeepEquals',
          'assertTrue',
          'assertFalse',
          'assertIncludes',
          'assertMatches',
          'assertGreaterThan',
          'assertGreaterThanOrEqual',
          'assertLessThan',
          'assertLessThanOrEqual',
          'assertOk',
          'assertFail',
          'assertEqualActualFirst',
          'assertNotEqualActualFirst',
          'assertDeepEqualActualFirst',
          'assertNotDeepEqualActualFirst',
          'assertIncludesActualFirst',
          'assertMatchesActualFirst',
          'assertGreaterThanActualFirst',
          'assertGreaterThanOrEqualActualFirst',
          'assertLessThanActualFirst',
          'assertLessThanOrEqualActualFirst',
          `${fn.code}\nconst __picked = eval(fnName);\nif (typeof __picked !== 'function') throw new Error('Selected function is not defined in code');\nreturn __picked(ctx);`,
        ) as (
          ctxArg: unknown,
          fnNameArg: string,
          responseArg: unknown,
          requestArg: unknown,
          jsonPathArg: (path: string) => unknown[],
          assertAllEqualsArg: (path: string, expectedValue: unknown) => TestMessage,
          streamArg: (path: string) => StreamOps,
          assertArg: AssertApi,
          assertEqualArg: ExpectedActualAssertion,
          assertEqualsArg: ExpectedActualAssertion,
          assertNotEqualArg: ExpectedActualAssertion,
          assertNotEqualsArg: ExpectedActualAssertion,
          assertDeepEqualArg: ExpectedActualAssertion,
          assertDeepEqualsArg: ExpectedActualAssertion,
          assertNotDeepEqualArg: ExpectedActualAssertion,
          assertNotDeepEqualsArg: ExpectedActualAssertion,
          assertTrueArg: AssertApi['isTrue'],
          assertFalseArg: AssertApi['isFalse'],
          assertIncludesArg: ExpectedActualIncludesAssertion,
          assertMatchesArg: ExpectedActualMatchesAssertion,
          assertGreaterThanArg: ExpectedActualNumericAssertion,
          assertGreaterThanOrEqualArg: ExpectedActualNumericAssertion,
          assertLessThanArg: ExpectedActualNumericAssertion,
          assertLessThanOrEqualArg: ExpectedActualNumericAssertion,
          assertOkArg: AssertApi['ok'],
          assertFailArg: AssertApi['fail'],
          assertEqualActualFirstArg: AssertApi['equal'],
          assertNotEqualActualFirstArg: AssertApi['notEqual'],
          assertDeepEqualActualFirstArg: AssertApi['deepEqual'],
          assertNotDeepEqualActualFirstArg: AssertApi['notDeepEqual'],
          assertIncludesActualFirstArg: AssertApi['includes'],
          assertMatchesActualFirstArg: AssertApi['matches'],
          assertGreaterThanActualFirstArg: AssertApi['greaterThan'],
          assertGreaterThanOrEqualActualFirstArg: AssertApi['greaterThanOrEqual'],
          assertLessThanActualFirstArg: AssertApi['lessThan'],
          assertLessThanOrEqualActualFirstArg: AssertApi['lessThanOrEqual'],
        ) => unknown
        const raw = run(
          ctx,
          fn.functionName,
          args.result,
          args.request,
          jsonPath,
          assertAllEquals,
          stream,
          assert,
          assertEqual,
          assertEquals,
          assertNotEqual,
          assertNotEquals,
          assertDeepEqual,
          assertDeepEquals,
          assertNotDeepEqual,
          assertNotDeepEquals,
          assertTrue,
          assertFalse,
          assertIncludes,
          assertMatches,
          assertGreaterThan,
          assertGreaterThanOrEqual,
          assertLessThan,
          assertLessThanOrEqual,
          assertOk,
          assertFail,
          assertEqualActualFirst,
          assertNotEqualActualFirst,
          assertDeepEqualActualFirst,
          assertNotDeepEqualActualFirst,
          assertIncludesActualFirst,
          assertMatchesActualFirst,
          assertGreaterThanActualFirst,
          assertGreaterThanOrEqualActualFirst,
          assertLessThanActualFirst,
          assertLessThanOrEqualActualFirst,
        )
        const normalized = normalizeTestResultOutput(raw)
        out.push({
          name: selectedGlobalName,
          source: 'global',
          passed: normalized.passed,
          message: normalized.message,
          ...resolveExpectedActual(normalized, assertBundle.getLastAssertion()),
          durationMs: Math.max(0, performance.now() - startedAt),
        })
      } catch (error) {
        const assertion = getAssertionFailure(error)
        if (assertion) {
          out.push(buildAssertionErrorResult({
            name: selectedGlobalName,
            source: 'global',
            startedAt,
            assertion,
          }))
        } else {
          out.push(buildRuntimeErrorResult({
            name: selectedGlobalName,
            source: 'global',
            startedAt,
            error,
          }))
        }
      }
    }
  }

  const requestScript = args.requestTestScript.trim()
  if (requestScript) {
    const requestFunctionNames = extractFunctionNamesFromCode(requestScript)
    const hasNamedFunctions = requestFunctionNames.length > 0
    const requestCases = hasNamedFunctions ? requestFunctionNames : ['Request Test Script']

    for (const caseName of requestCases) {
      const startedAt = performance.now()
      assertBundle.resetLastAssertion()
      try {
        const requestScriptExecutable = hasNamedFunctions
          ? `${requestScript}\nconst __picked = eval(fnName);\nif (typeof __picked !== 'function') throw new Error('Selected function is not defined in request script');\nreturn __picked(ctx);`
          : requestScript
        const run = new Function(
          'ctx',
          'fnName',
          'response',
          'request',
          'status',
          'statusText',
          'ok',
          'timeMs',
          'headers',
          'bodyText',
          'jsonPath',
          'assertAllEquals',
          'stream',
          'assert',
          'assertEqual',
          'assertEquals',
          'assertNotEqual',
          'assertNotEquals',
          'assertDeepEqual',
          'assertDeepEquals',
          'assertNotDeepEqual',
          'assertNotDeepEquals',
          'assertTrue',
          'assertFalse',
          'assertIncludes',
          'assertMatches',
          'assertGreaterThan',
          'assertGreaterThanOrEqual',
          'assertLessThan',
          'assertLessThanOrEqual',
          'assertOk',
          'assertFail',
          'assertEqualActualFirst',
          'assertNotEqualActualFirst',
          'assertDeepEqualActualFirst',
          'assertNotDeepEqualActualFirst',
          'assertIncludesActualFirst',
          'assertMatchesActualFirst',
          'assertGreaterThanActualFirst',
          'assertGreaterThanOrEqualActualFirst',
          'assertLessThanActualFirst',
          'assertLessThanOrEqualActualFirst',
          requestScriptExecutable,
        ) as (
          ctxArg: unknown,
          fnNameArg: string,
          responseArg: unknown,
          requestArg: unknown,
          statusArg: number,
          statusTextArg: string,
          okArg: boolean,
          timeMsArg: number,
          headersArg: Record<string, string>,
          bodyTextArg: string,
          jsonPathArg: (path: string) => unknown[],
          assertAllEqualsArg: (path: string, expectedValue: unknown) => TestMessage,
          streamArg: (path: string) => StreamOps,
          assertArg: AssertApi,
          assertEqualArg: ExpectedActualAssertion,
          assertEqualsArg: (expected: unknown, actual: unknown, message?: string) => true,
          assertNotEqualArg: ExpectedActualAssertion,
          assertNotEqualsArg: (expected: unknown, actual: unknown, message?: string) => true,
          assertDeepEqualArg: ExpectedActualAssertion,
          assertDeepEqualsArg: (expected: unknown, actual: unknown, message?: string) => true,
          assertNotDeepEqualArg: ExpectedActualAssertion,
          assertNotDeepEqualsArg: (expected: unknown, actual: unknown, message?: string) => true,
          assertTrueArg: AssertApi['isTrue'],
          assertFalseArg: AssertApi['isFalse'],
          assertIncludesArg: ExpectedActualIncludesAssertion,
          assertMatchesArg: ExpectedActualMatchesAssertion,
          assertGreaterThanArg: ExpectedActualNumericAssertion,
          assertGreaterThanOrEqualArg: ExpectedActualNumericAssertion,
          assertLessThanArg: ExpectedActualNumericAssertion,
          assertLessThanOrEqualArg: ExpectedActualNumericAssertion,
          assertOkArg: AssertApi['ok'],
          assertFailArg: AssertApi['fail'],
          assertEqualActualFirstArg: AssertApi['equal'],
          assertNotEqualActualFirstArg: AssertApi['notEqual'],
          assertDeepEqualActualFirstArg: AssertApi['deepEqual'],
          assertNotDeepEqualActualFirstArg: AssertApi['notDeepEqual'],
          assertIncludesActualFirstArg: AssertApi['includes'],
          assertMatchesActualFirstArg: AssertApi['matches'],
          assertGreaterThanActualFirstArg: AssertApi['greaterThan'],
          assertGreaterThanOrEqualActualFirstArg: AssertApi['greaterThanOrEqual'],
          assertLessThanActualFirstArg: AssertApi['lessThan'],
          assertLessThanOrEqualActualFirstArg: AssertApi['lessThanOrEqual'],
        ) => unknown
        const raw = run(
          ctx,
          caseName,
          args.result,
          args.request,
          args.result.status,
          args.result.statusText,
          args.result.ok,
          args.result.timeMs,
          args.result.responseHeaders,
          args.result.bodyText,
          jsonPath,
          assertAllEquals,
          stream,
          assert,
          assertEqual,
          assertEquals,
          assertNotEqual,
          assertNotEquals,
          assertDeepEqual,
          assertDeepEquals,
          assertNotDeepEqual,
          assertNotDeepEquals,
          assertTrue,
          assertFalse,
          assertIncludes,
          assertMatches,
          assertGreaterThan,
          assertGreaterThanOrEqual,
          assertLessThan,
          assertLessThanOrEqual,
          assertOk,
          assertFail,
          assertEqualActualFirst,
          assertNotEqualActualFirst,
          assertDeepEqualActualFirst,
          assertNotDeepEqualActualFirst,
          assertIncludesActualFirst,
          assertMatchesActualFirst,
          assertGreaterThanActualFirst,
          assertGreaterThanOrEqualActualFirst,
          assertLessThanActualFirst,
          assertLessThanOrEqualActualFirst,
        )
        const normalized = normalizeTestResultOutput(raw)
        out.push({
          name: caseName,
          source: 'request',
          passed: normalized.passed,
          message: normalized.message,
          ...resolveExpectedActual(normalized, assertBundle.getLastAssertion()),
          durationMs: Math.max(0, performance.now() - startedAt),
        })
      } catch (error) {
        const assertion = getAssertionFailure(error)
        if (assertion) {
          out.push(buildAssertionErrorResult({
            name: caseName,
            source: 'request',
            startedAt,
            assertion,
          }))
        } else {
          out.push(buildRuntimeErrorResult({
            name: caseName,
            source: 'request',
            startedAt,
            error,
          }))
        }
      }
    }
  }

  return out
}
