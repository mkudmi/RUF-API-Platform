import { createElement } from 'react'
import type { AppSettingsTabExtension } from './types'
import { AiSettingsTab } from '../../modules/ai'

// Project-level extension point: register additional Settings tabs here.
export const customSettingsTabExtensions: AppSettingsTabExtension[] = [
  {
    id: 'ai',
    label: 'AI',
    order: 40,
    render: ctx => createElement(AiSettingsTab, {
      value: ctx.aiSettings,
      onChange: ctx.setAiSettings,
    }),
  },
]
