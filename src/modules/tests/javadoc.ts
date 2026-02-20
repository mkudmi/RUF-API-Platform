export const TESTS_DOCS_TEXT = `RUF Tests API (Docs)

Overview
- Global tests: pick one function from selected class.
- Request Test Script: can contain multiple functions.
- If script contains functions, each function is executed as a separate test.

Runtime Context
- response: full response object (status, ok, headers, bodyText, timeMs, ...)
- request: current request object
- status: shortcut for response.status
- statusText: shortcut for response.statusText
- ok: shortcut for response.ok
- timeMs: shortcut for response.timeMs
- headers: shortcut for response.responseHeaders
- bodyText: shortcut for response.bodyText
- ctx: same values + helper methods

JSON Helpers
- jsonPath(path): unknown[]
  @param path JSONPath expression, for example "$.data.id" or "$..id"
  @returns array of matched values

- stream(path): { values, allEquals, anyEquals, count }
  @param path JSONPath expression
  @returns stream-like object:
    - values: matched values array
    - allEquals(expected): returns { passed, message, expected, actual }
    - anyEquals(expected): boolean
    - count(): number

- assertAllEquals(path, expected): { passed, message, expected, actual }
  @param path JSONPath expression
  @param expected expected value for every match

Assertions
- assertEqual(expected, actual, message?)
- assertEquals(expected, actual, message?)
- assertNotEqual(expected, actual, message?)
- assertNotEquals(expected, actual, message?)

- assertDeepEqual(expected, actual, message?)
- assertDeepEquals(expected, actual, message?)
- assertNotDeepEqual(expected, actual, message?)
- assertNotDeepEquals(expected, actual, message?)

- assertTrue(actual, message?)
- assertFalse(actual, message?)
- assertOk(actual, message?)
- assertIncludes(expectedPart, actual, message?)
- assertMatches(pattern, actual, message?)
- assertGreaterThan(expectedNumber, actual, message?)
- assertGreaterThanOrEqual(expectedNumber, actual, message?)
- assertLessThan(expectedNumber, actual, message?)
- assertLessThanOrEqual(expectedNumber, actual, message?)
- assertFail(message?, expected?, actual?)

Legacy actual-first aliases (for compatibility)
- assertEqualActualFirst(actual, expected, message?)
- assertNotEqualActualFirst(actual, expected, message?)
- assertDeepEqualActualFirst(actual, expected, message?)
- assertNotDeepEqualActualFirst(actual, expected, message?)
- assertIncludesActualFirst(actual, expectedPart, message?)
- assertMatchesActualFirst(actual, pattern, message?)
- assertGreaterThanActualFirst(actual, expectedNumber, message?)
- assertGreaterThanOrEqualActualFirst(actual, expectedNumber, message?)
- assertLessThanActualFirst(actual, expectedNumber, message?)
- assertLessThanOrEqualActualFirst(actual, expectedNumber, message?)

Behavior
- Any thrown assertion marks test as FAIL.
- expected/actual are captured and shown in Test Result Details.
- If assertion passes, the last assertion values can also be shown in details.

Supported Return Values
- boolean: true = PASS, false = FAIL
- object: { passed: boolean, message?: string, expected?: unknown, actual?: unknown }
- undefined: PASS (if no assertion failed)

Example
function assertStatus200() {
  assertEquals(200, response.status)
}

function assertAllIdsEqualOne() {
  return stream('$..id').allEquals(1)
}
`
