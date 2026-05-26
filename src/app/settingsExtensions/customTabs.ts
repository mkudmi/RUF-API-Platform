import { createElement } from 'react'
import type { AppSettingsTabExtension } from './types'
import { AiSettingsTab } from '../../modules/ai'
import { JiraSettingsTab } from '../../modules/jira'

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
    id: 'jira',
    label: 'Jira',
    order: 50,
    render: ctx => createElement(JiraSettingsTab, {
      value: ctx.jiraSettings,
      onChange: ctx.setJiraSettings,
      testMessage: ctx.jiraTestMessage,
      testError: ctx.jiraTestError,
    }),
  },
]
