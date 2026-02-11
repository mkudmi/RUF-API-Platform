import type { ReactNode } from 'react'
import type { Collection } from '../../modules/collectionTree'
import type { Environment, GlobalSqlConnectionItem } from '../../shared/types/environment'

export type AppDrawerRenderContext = {
  openDrawerId: string | null
  closeDrawer: () => void
  collections: Collection[]
  environmentsByCollection: Record<string, Environment>
  globalSqlConnections: GlobalSqlConnectionItem[]
}

export type AppSidebarToolExtension = {
  id: string
  label: string
  title: string
  icon: ReactNode
  order?: number
  buttonClassName?: string
  render: (context: AppDrawerRenderContext) => ReactNode
}
