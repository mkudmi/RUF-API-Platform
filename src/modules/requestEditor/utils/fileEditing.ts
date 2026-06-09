import type { FileSystemFileHandleLike } from '../types'
import type { BeautifyBodyFormat } from './bodyBeautify'

type WindowWithFilePickers = Window & {
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandleLike[]>
}

const EDITABLE_TEXT_FILE_EXTENSIONS = new Set([
  '.txt',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.md',
  '.graphql',
  '.gql',
  '.csv',
  '.tsv',
  '.sql',
  '.env',
  '.log',
])

function getFileExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase()
  const dotIndex = normalized.lastIndexOf('.')
  return dotIndex >= 0 ? normalized.slice(dotIndex) : ''
}

export function isEditableTextFile(file: File) {
  const type = (file.type || '').toLowerCase()
  if (type.startsWith('text/')) return true
  if (
    type.includes('json')
    || type.includes('xml')
    || type.includes('yaml')
    || type.includes('javascript')
    || type.includes('ecmascript')
    || type.includes('csv')
    || type.includes('graphql')
    || type.includes('sql')
  ) return true

  return EDITABLE_TEXT_FILE_EXTENSIONS.has(getFileExtension(file.name || ''))
}

export function buildEditedFile(sourceFile: File, text: string) {
  return new File([text], sourceFile.name, {
    type: sourceFile.type || 'text/plain',
    lastModified: Date.now(),
  })
}

export function inferEditableFileFormat(file: File): BeautifyBodyFormat | null {
  const type = (file.type || '').toLowerCase()
  const extension = getFileExtension(file.name || '')

  if (type.includes('json') || extension === '.json') return 'json'
  if (type.includes('xml') || extension === '.xml') return 'xml'
  if (type.includes('yaml') || extension === '.yaml' || extension === '.yml') return 'yaml'
  if (type.startsWith('text/')) return 'text'
  if (EDITABLE_TEXT_FILE_EXTENSIONS.has(extension)) return 'text'
  return null
}

export async function saveTextToFileHandle(handle: FileSystemFileHandleLike, text: string) {
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
}

export async function openSingleFileWithHandle() {
  const picker = (window as WindowWithFilePickers).showOpenFilePicker
  if (typeof picker !== 'function') return null

  const [handle] = await picker({ multiple: false })
  if (!handle) return null

  const file = await handle.getFile()
  return { file, handle }
}
