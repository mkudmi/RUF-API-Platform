import { uid } from '../../shared/utils/id'
import { loadLocalStorageJson, saveLocalStorageJson } from '../../shared/utils/localStorageJson'
import type { TestClass } from './types'

export const TEST_CLASSES_STORAGE_KEY = 'ruf_global_test_functions_v1'

export function normalizeTestClasses(raw: unknown): TestClass[] {
  if (!Array.isArray(raw)) return []
  const out: TestClass[] = []
  const defaultLegacyClassName = 'DefaultTests'

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as { id?: unknown, name?: unknown, methods?: unknown, code?: unknown }

    // Backward compatibility: old flat function list -> single DefaultTests class code.
    if (!Array.isArray(row.methods)) {
      const legacyName = typeof row.name === 'string' ? row.name.trim() : ''
      const legacyCode = typeof row.code === 'string' ? row.code : ''
      if (!legacyName) continue
      const fallbackCode = `function ${legacyName}(ctx) {\n  return true\n}\n`
      const methodCode = (legacyCode || fallbackCode).trim()
      const existingDefault = out.find(c => c.name === defaultLegacyClassName)
      if (existingDefault) {
        existingDefault.code = `${existingDefault.code.trim()}\n\n${methodCode}\n`
      } else {
        out.push({
          id: uid('gtc'),
          name: defaultLegacyClassName,
          code: `${methodCode}\n`,
        })
      }
      continue
    }

    const classId = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : uid('gtc')
    const className = typeof row.name === 'string' ? row.name.trim() : ''
    if (!className) continue

    const methodCodes: string[] = []
    for (const methodRaw of row.methods) {
      if (!methodRaw || typeof methodRaw !== 'object') continue
      const method = methodRaw as { id?: unknown, name?: unknown, code?: unknown }
      const methodName = typeof method.name === 'string' ? method.name.trim() : ''
      const methodCode = typeof method.code === 'string' ? method.code.trim() : ''
      if (methodCode) {
        methodCodes.push(methodCode)
        continue
      }
      if (methodName) methodCodes.push(`function ${methodName}(ctx) {\n  return true\n}`)
    }

    out.push({
      id: classId,
      name: className,
      code: methodCodes.join('\n\n'),
    })
  }

  return out
}

export function loadTestClasses(): TestClass[] {
  const parsed = loadLocalStorageJson<unknown>(TEST_CLASSES_STORAGE_KEY, [])
  return normalizeTestClasses(parsed)
}

export function saveTestClasses(items: TestClass[]) {
  saveLocalStorageJson(TEST_CLASSES_STORAGE_KEY, items)
}
