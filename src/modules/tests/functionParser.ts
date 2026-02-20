import type { TestClass, TestFunctionRef } from './types'

export function extractFunctionNamesFromCode(code: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const src = code || ''

  const fnDecl = /function\s+([A-Za-z_$][\w$]*)\s*\(/g
  for (let m = fnDecl.exec(src); m; m = fnDecl.exec(src)) {
    const name = m[1]
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }

  const fnExpr = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g
  for (let m = fnExpr.exec(src); m; m = fnExpr.exec(src)) {
    const name = m[1]
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }

  return out
}

export function buildAvailableTestFunctions(classes: TestClass[]): TestFunctionRef[] {
  return classes.flatMap(testClass => {
    const className = testClass.name.trim() || 'UnnamedClass'
    return extractFunctionNamesFromCode(testClass.code).map(functionName => ({
      className,
      functionName,
      code: testClass.code,
    }))
  })
}

export function sanitizeTestClasses(classes: TestClass[]): TestClass[] {
  return classes
    .map(testClass => ({ ...testClass, name: testClass.name.trim() }))
    .filter(testClass => !!testClass.name)
}
