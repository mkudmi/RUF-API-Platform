import { MockServerIcon, SqlIcon, TerminalIcon } from '../../shared/icons'
import { LocalMockServerDrawer } from '../../modules/localMockServer'
import { SqlTerminalDrawer } from '../../modules/sqlTerminal'
import { TerminalDrawer } from '../../modules/terminal'
import type { AppSidebarToolExtension } from './types'

const terminalTool: AppSidebarToolExtension = {
  id: 'terminal',
  label: 'Terminal',
  title: 'Terminal',
  icon: <span className="iconGlyph"><TerminalIcon size={16} /></span>,
  order: 10,
  buttonClassName: 'terminalBtn',
  render: ctx => (
    <TerminalDrawer
      open={ctx.openDrawerId === 'terminal'}
      onClose={ctx.closeDrawer}
    />
  ),
}

const sqlTerminalTool: AppSidebarToolExtension = {
  id: 'sql-terminal',
  label: 'SQL Terminal',
  title: 'SQL Terminal',
  icon: <span className="iconGlyph"><SqlIcon size={16} /></span>,
  order: 20,
  buttonClassName: 'terminalBtn sqlTerminalBtn',
  render: ctx => (
    <SqlTerminalDrawer
      open={ctx.openDrawerId === 'sql-terminal'}
      onClose={ctx.closeDrawer}
      collections={ctx.collections}
      environmentsByCollection={ctx.environmentsByCollection}
      extraConnections={ctx.globalSqlConnections}
      aiSettings={ctx.aiSettings}
      mcpSettings={ctx.mcpSettings}
    />
  ),
}

const localMockServerTool: AppSidebarToolExtension = {
  id: 'local-mock-server',
  label: 'Local Mock Server',
  title: 'Local Mock Server',
  icon: <span className="iconGlyph"><MockServerIcon size={16} /></span>,
  order: 30,
  buttonClassName: 'terminalBtn',
  render: ctx => (
    <LocalMockServerDrawer
      open={ctx.openDrawerId === 'local-mock-server'}
      onClose={ctx.closeDrawer}
      collections={ctx.collections}
    />
  ),
}

export function getDefaultSidebarToolExtensions(): AppSidebarToolExtension[] {
  return [terminalTool, sqlTerminalTool, localMockServerTool]
}
