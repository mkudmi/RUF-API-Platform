import { uid } from '../../shared/utils/id'
import type { TestClass } from './types'

export function createDefaultTestClass(): TestClass {
  return {
    id: uid('gtc'),
    name: 'DefaultTests',
    code: `// Проверяет, что HTTP статус равен 200.
function assertStatus200() {
  assertEqual(200, response.status, 'Status must be 200')
}

// Проверяет, что ответ успешный (response.ok === true).
function assertOkResponse() {
  assertTrue(response.ok, 'Response must be OK')
}

// Проверяет, что время ответа меньше 500 мс.
function assertFastUnder500ms() {
  assertLessThan(500, response.timeMs, 'Response is too slow')
}

// Проверяет, что в ответе есть заголовок Content-Type.
function assertHasContentTypeHeader() {
  const hasCt = Object.keys(response.responseHeaders || {}).some(k => k.toLowerCase() === 'content-type')
  assertTrue(hasCt, 'Content-Type header is missing')
}

// Проверяет, что тело ответа валидный JSON.
function assertJsonBodyIsValid() {
  try {
    JSON.parse(response.bodyText || '')
  } catch (error) {
    assertFail('Body is not valid JSON', 'valid JSON', response.bodyText)
  }
}

// Проверяет через JSONPath, что поле $.data.id существует и равно 1.
function assertDataIdEqualsOne() {
  const values = jsonPath('$.data.id')
  assertGreaterThan(0, values.length, 'JSONPath $.data.id returned no values')
  assertEqual(1, values[0], 'data.id must be 1')
}

// Проверяет через stream API, что все id в ответе равны 1.
function assertAllIdsEqualOneWithStream() {
  return stream('$..id').allEquals(1)
}

// Проверяет через stream API, что среди id есть хотя бы один id = 1.
function assertAnyIdEqualsOneWithStream() {
  assertTrue(stream('$..id').anyEquals(1), 'No id equal to 1 found')
}

// Проверяет deep equality для объекта в ответе.
function assertUserShapeDeepEqual() {
  const users = jsonPath('$.data.user')
  assertGreaterThan(0, users.length, 'No user object found')
  assertDeepEqual({ id: 1, role: 'admin' }, users[0], 'User object mismatch')
}

// Проверяет, что строка тела ответа содержит подстроку.
function assertBodyIncludesKeyword() {
  assertIncludes('success', response.bodyText || '', 'Body must include keyword "success"')
}

// Проверяет регулярным выражением, что в теле есть UUID-подобное значение.
function assertBodyContainsUuidLikeValue() {
  assertMatches(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i, response.bodyText || '', 'UUID-like value not found')
}

// Проверяет, что тест выполняется только для GET-запросов (доступ к request).
function assertRequestMethodIsGet() {
  assertEqual('GET', request.method, 'Expected request method GET')
}

// Проверяет, что количество элементов массива больше либо равно 1.
function assertItemsCountAtLeastOne() {
  const items = jsonPath('$.data.items[*]')
  assertGreaterThanOrEqual(1, items.length, 'Expected at least one item')
}

// Проверяет not-equal / not-deep-equal сценарий.
function assertNegativeChecksSample() {
  assertNotEqual(500, response.status, 'Status must not be 500')
  assertNotDeepEqual({ ok: false }, { ok: response.ok }, 'Response should not be marked as failed')
}
`,
  }
}
