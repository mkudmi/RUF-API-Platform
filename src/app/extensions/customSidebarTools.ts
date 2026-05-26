import { createElement } from 'react'
import { BugReportDialog } from '../../modules/jira'
import { BugIcon } from '../../shared/icons'
import type { AppSidebarToolExtension } from './types'

// Project-level extension point: register additional sidebar tools here.
// Keeping this list in a dedicated file allows extending the shell without editing App.tsx.
export const customSidebarToolExtensions: AppSidebarToolExtension[] = [
  {
    id: 'bug-report',
    label: 'Bug Report',
    title: 'Bug Report',
    icon: createElement('span', { className: 'iconGlyph' }, BugIcon({ size: 16 })),
    order: 15,
    render: ctx => createElement(BugReportDialog, {
      open: ctx.openDrawerId === 'bug-report',
      onClose: ctx.closeDrawer,
      aiSettings: ctx.aiSettings,
      jiraSettings: ctx.jiraSettings,
      validateCertificates: ctx.validateCertificates,
      caCertificates: ctx.caCertificates,
      clientTlsIdentity: ctx.clientTlsIdentity,
      openSettings: ctx.openSettings,
    }),
  },
]
