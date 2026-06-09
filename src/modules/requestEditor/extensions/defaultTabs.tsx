import { AuthorizationTab } from '../components/tabs/AuthorizationTab'
import { MockerTab } from '../components/tabs/MockerTab'
import { SqlScriptsTab } from '../components/tabs/SqlScriptsTab'
import { getHeaderCaseInsensitive } from '../state/headers/headerState'
import type { RequestEditorTabExtension } from './types'

const authorizationTab: RequestEditorTabExtension = {
  id: 'authorization',
  label: 'Authorization',
  order: 20,
  hasData: ctx => !!(getHeaderCaseInsensitive(ctx.committedHeaders, 'Authorization') ?? '').trim(),
  render: ctx => (
    <AuthorizationTab
      value={getHeaderCaseInsensitive(ctx.committedHeaders, 'Authorization') ?? ''}
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
