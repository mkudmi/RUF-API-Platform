import type { VariableSuggestion } from '../../../../shared/utils/variables'
import type { BeautifyBodyFormat } from '../../utils/bodyBeautify'
import { StructuredCodeEditor } from './StructuredCodeEditor'

export function FileTextCodeEditor(props: {
  value: string
  format: BeautifyBodyFormat | null
  minHeight?: number
  marginTop?: number
  marginBottom?: number
  onChangeValue: (next: string) => void
  onSubmitShortcut?: () => boolean
  variableSuggestions?: VariableSuggestion[]
  variables?: Record<string, string>
  resizableOnMac?: boolean
}) {
  return (
    <StructuredCodeEditor
      value={props.value}
      format={props.format}
      minHeight={props.minHeight}
      marginTop={props.marginTop}
      marginBottom={props.marginBottom}
      onChangeValue={props.onChangeValue}
      onSubmitShortcut={props.onSubmitShortcut}
      variableSuggestions={props.variableSuggestions}
      variables={props.variables}
      resizableOnMac={props.resizableOnMac}
    />
  )
}
