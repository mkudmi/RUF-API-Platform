import { AuthorizationTab } from '../components/AuthorizationTab'
import { SqlScriptsTab } from '../components/SqlScriptsTab'
import type { RequestEditorTabExtension } from './types'

const authorizationTab: RequestEditorTabExtension = {
  id: 'authorization',
  label: 'Authorization',
  order: 20,
  hasData: ctx => !!(ctx.committedHeaders.Authorization ?? '').trim(),
  render: ctx => (
    <AuthorizationTab
      value={ctx.committedHeaders.Authorization ?? ''}
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

export function getDefaultRequestEditorTabExtensions(): RequestEditorTabExtension[] {
  return [authorizationTab, sqlTab]
}
