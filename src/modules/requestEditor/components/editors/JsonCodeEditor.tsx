import type { VariableSuggestion } from '../../../../shared/utils/variables'
import { StructuredCodeEditor } from './StructuredCodeEditor'

export function JsonCodeEditor(props: {
  value: string
  onChangeValue: (next: string) => void
  onSubmitShortcut?: () => boolean
  variableSuggestions: VariableSuggestion[]
  variables?: Record<string, string>
}) {
  return (
    <StructuredCodeEditor
      value={props.value}
      format="json"
      minHeight={320}
      marginTop={10}
      marginBottom={6}
      onChangeValue={props.onChangeValue}
      onSubmitShortcut={props.onSubmitShortcut}
      variableSuggestions={props.variableSuggestions}
      variables={props.variables}
      wrapVariablesInJsonStrings
      resizableOnMac
    />
  )
}
