import { createElement } from 'react'
import type { AppSettingsTabExtension } from './types'
import { AiSettingsTab } from '../../modules/ai'
import { McpSettingsTab } from '../../modules/mcp'

// Project-level extension point: register additional Settings tabs here.
export const customSettingsTabExtensions: AppSettingsTabExtension[] = [
  {
    id: 'ai',
    label: 'AI',
    order: 40,
    render: ctx => createElement(AiSettingsTab, {
      value: ctx.aiSettings,
      onChange: ctx.setAiSettings,
      testMessage: ctx.aiTestMessage,
      testError: ctx.aiTestError,
    }),
  },
  {
    id: 'mcp',
    label: 'MCP',
    order: 50,
    render: ctx => createElement(McpSettingsTab, {
      value: ctx.mcpSettings,
      onChange: ctx.setMcpSettings,
    }),
  },
]
