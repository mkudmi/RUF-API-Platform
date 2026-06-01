import { AuthorizationTab } from '../components/AuthorizationTab'
import { MockerTab } from '../components/MockerTab'
import { SqlScriptsTab } from '../components/SqlScriptsTab'
import type { RequestEditorTabExtension } from './types'

function getHeaderCaseInsensitive(headers: Record<string, string>, name: string): string {
  const needle = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === needle) return v
  }
  return ''
}

const authorizationTab: RequestEditorTabExtension = {
  id: 'authorization',
  label: 'Authorization',
  order: 20,
  hasData: ctx => !!getHeaderCaseInsensitive(ctx.committedHeaders, 'Authorization').trim(),
  render: ctx => (
    <AuthorizationTab
      value={getHeaderCaseInsensitive(ctx.committedHeaders, 'Authorization')}
      variableSuggestions={ctx.variableSuggestions}
      onChangeValue={next => ctx.setHeaderValue('Authorization', next)}
    />
  ),
}

const sqlTab: RequestEditorTabExtension = {
  id: 'sql',
  label: 'SQL',
  order: 30,
  hasData: ctx => !!ctx.preSqlScript.trim() || !!ctx.postSqlScript.trim(),
  render: ctx => (
    <SqlScriptsTab
      sqlConnections={ctx.sqlConnections}
      selectedSqlConnectionId={ctx.selectedSqlConnectionId}
      onChangeSqlConnectionId={ctx.setSelectedSqlConnectionId}
      preSqlScript={ctx.preSqlScript}
      postSqlScript={ctx.postSqlScript}
      preSqlScriptIsActive={ctx.preSqlScriptIsActive}
      postSqlScriptIsActive={ctx.postSqlScriptIsActive}
      onChangePreSqlScriptIsActive={ctx.setPreSqlScriptIsActive}
      onChangePostSqlScriptIsActive={ctx.setPostSqlScriptIsActive}
      onChangePreSqlScript={ctx.setPreSqlScript}
      onChangePostSqlScript={ctx.setPostSqlScript}
    />
  ),
}

const mockerTab: RequestEditorTabExtension = {
  id: 'mocker',
  label: 'Mocker',
  order: 31,
  render: ctx => (
    <MockerTab
      requestId={ctx.request.id}
      routeMethodDefault={ctx.mockRouteMethodDefault}
      routePathDefault={ctx.mockRoutePathDefault}
      targetOriginDefault={ctx.mockTargetOriginDefault}
    />
  ),
}

export function getDefaultRequestEditorTabExtensions(): RequestEditorTabExtension[] {
  return [authorizationTab, sqlTab, mockerTab]
}
