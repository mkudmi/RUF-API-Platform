import {
  IconArrowLeft,
  IconArrowsSort,
  IconArrowsDiagonal,
  IconCopy,
  IconEraser,
  IconFolderMinus,
  IconFolderPlus,
  IconFunction,
  IconLayoutBottombarExpand,
  IconLayoutSidebarLeftExpand,
  IconMaximize,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconReload,
  IconSchema,
  IconSearch,
  IconServer2,
  IconSettings,
  IconSortAscending2,
  IconSortDescending2,
  IconSql,
  IconStar,
  IconTerminal2,
  IconTrash,
  IconWindowMinimize,
  IconX,
  type IconProps as TablerIconProps,
} from '@tabler/icons-react'
import type { ComponentType } from 'react'

type SharedIconProps = {
  size?: number
  className?: string
}

function renderIcon(Icon: ComponentType<TablerIconProps>, props?: SharedIconProps) {
  const size = props?.size ?? 16
  return <Icon size={size} className={props?.className} stroke={1.9} aria-hidden="true" />
}

export function CopyIcon(props?: SharedIconProps) {
  return renderIcon(IconCopy, props)
}

export function CloseIcon(props?: SharedIconProps) {
  return renderIcon(IconX, props)
}

export function BackIcon(props?: SharedIconProps) {
  return renderIcon(IconArrowLeft, props)
}

export function MinimizeIcon(props?: SharedIconProps) {
  return renderIcon(IconWindowMinimize, props)
}

export function MaximizeIcon(props?: SharedIconProps) {
  return renderIcon(IconMaximize, props)
}

export function TrashIcon(props?: SharedIconProps) {
  return renderIcon(IconTrash, props)
}

export function BroomIcon(props?: SharedIconProps) {
  return renderIcon(IconEraser, props)
}

export function PencilIcon(props?: SharedIconProps) {
  return renderIcon(IconPencil, props)
}

export function StarIcon(props?: SharedIconProps) {
  return renderIcon(IconStar, props)
}

export function ReloadIcon(props?: SharedIconProps) {
  return renderIcon(IconReload, props)
}

export function SearchIcon(props?: SharedIconProps) {
  return renderIcon(IconSearch, props)
}

export function SchemaIcon(props?: SharedIconProps) {
  return renderIcon(IconSchema, props)
}

export function SqlIcon(props?: SharedIconProps) {
  return renderIcon(IconSql, props)
}

export function FoldersExpandIcon(props?: SharedIconProps) {
  return renderIcon(IconFolderPlus, props)
}

export function FoldersCollapseIcon(props?: SharedIconProps) {
  return renderIcon(IconFolderMinus, props)
}

export function SortNeutralIcon(props?: SharedIconProps) {
  return renderIcon(IconArrowsSort, props)
}

export function SortAscIcon(props?: SharedIconProps) {
  return renderIcon(IconSortAscending2, props)
}

export function SortDescIcon(props?: SharedIconProps) {
  return renderIcon(IconSortDescending2, props)
}

export function SqlTerminalPositionIcon(props: { left: boolean; size?: number; className?: string }) {
  return props.left
    ? renderIcon(IconLayoutSidebarLeftExpand, props)
    : renderIcon(IconLayoutBottombarExpand, props)
}

export function SettingsIcon(props?: SharedIconProps) {
  return renderIcon(IconSettings, props)
}

export function PlayIcon(props?: SharedIconProps) {
  return renderIcon(IconPlayerPlay, props)
}

export function FunctionIcon(props?: SharedIconProps) {
  return renderIcon(IconFunction, props)
}

export function TerminalIcon(props?: SharedIconProps) {
  return renderIcon(IconTerminal2, props)
}

export function MockServerIcon(props?: SharedIconProps) {
  return renderIcon(IconServer2, props)
}

export function PlusIcon(props?: SharedIconProps) {
  return renderIcon(IconPlus, props)
}

export function OpenInNewIcon(props?: SharedIconProps) {
  return renderIcon(IconArrowsDiagonal, props)
}
