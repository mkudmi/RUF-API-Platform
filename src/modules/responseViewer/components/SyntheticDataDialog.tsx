import { useCallback, useEffect, useRef, useState } from 'react'
import { CloseIcon } from '../../../shared/icons'
import { copyText } from '../../../shared/utils/clipboard'
import { useDismissibleLayer } from '../../../shared/hooks/useDismissibleLayer'
import { generateSyntheticValue, SYNTHETIC_DATA_TYPE_OPTIONS, type SyntheticDataType } from '../utils/syntheticData'

export function SyntheticDataDialog(props: {
  open: boolean
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const syntheticTypeMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const [syntheticTypeMenuOpen, setSyntheticTypeMenuOpen] = useState(false)
  const [syntheticDataType, setSyntheticDataType] = useState<SyntheticDataType>('string')
  const [syntheticStringLength, setSyntheticStringLength] = useState(12)
  const [syntheticMin, setSyntheticMin] = useState(0)
  const [syntheticMax, setSyntheticMax] = useState(1000)
  const [syntheticFloatPrecision, setSyntheticFloatPrecision] = useState(2)
  const [syntheticValue, setSyntheticValue] = useState('')
  const [syntheticValueCopied, setSyntheticValueCopied] = useState(false)

  useDismissibleLayer({
    open: syntheticTypeMenuOpen,
    onDismiss: () => setSyntheticTypeMenuOpen(false),
    isInsideTarget: target => {
      const wrap = syntheticTypeMenuWrapRef.current
      return !!(target && wrap && wrap.contains(target))
    },
  })

  const regenerateSyntheticValue = useCallback(() => {
    setSyntheticValue(generateSyntheticValue({
      type: syntheticDataType,
      stringLength: syntheticStringLength,
      min: syntheticMin,
      max: syntheticMax,
      floatPrecision: syntheticFloatPrecision,
    }))
    setSyntheticValueCopied(false)
  }, [syntheticDataType, syntheticFloatPrecision, syntheticMax, syntheticMin, syntheticStringLength])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (props.open) {
      if (!syntheticValue) regenerateSyntheticValue()
      setSyntheticTypeMenuOpen(false)
      if (!dialog.open) dialog.showModal()
      return
    }

    if (dialog.open) dialog.close()
  }, [props.open, regenerateSyntheticValue, syntheticValue])

  async function copySyntheticValue() {
    if (!syntheticValue) return
    await copyText(syntheticValue)
    setSyntheticValueCopied(true)
    window.setTimeout(() => setSyntheticValueCopied(false), 900)
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal modalSyntheticData"
      onClose={() => {
        setSyntheticValueCopied(false)
        setSyntheticTypeMenuOpen(false)
        props.onClose()
      }}
    >
      <div className="modalHeader">
        <b>Synthetic Data</b>
        <button className="iconBtn" onClick={() => dialogRef.current?.close()} aria-label="Close" title="Close">
          <CloseIcon />
        </button>
      </div>

      <div className="syntheticDataGrid">
        <div className="syntheticDataField syntheticTypeField">
          <span className="small">Type</span>
          <div ref={syntheticTypeMenuWrapRef} className="selectMenuWrap syntheticTypeMenuWrap">
            <button
              type="button"
              className="selectMenuBtn mono syntheticTypeMenuBtn"
              aria-haspopup="listbox"
              aria-expanded={syntheticTypeMenuOpen}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                setSyntheticTypeMenuOpen(prev => !prev)
              }}
            >
              {SYNTHETIC_DATA_TYPE_OPTIONS.find(option => option.value === syntheticDataType)?.label ?? syntheticDataType}
            </button>
            {syntheticTypeMenuOpen ? (
              <div className="selectMenuPanel syntheticTypeMenuPanel" role="listbox">
                {SYNTHETIC_DATA_TYPE_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={`selectMenuItem mono ${option.value === syntheticDataType ? 'selectMenuItemActive' : ''}`.trim()}
                    role="option"
                    aria-selected={option.value === syntheticDataType}
                    onClick={() => {
                      setSyntheticDataType(option.value)
                      setSyntheticValueCopied(false)
                      setSyntheticTypeMenuOpen(false)
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {syntheticDataType === 'string' ? (
          <label className="small syntheticDataField">
            <span>Length</span>
            <input
              className="mono"
              type="text"
              inputMode="numeric"
              value={syntheticStringLength}
              onChange={e => setSyntheticStringLength(Math.max(0, Math.min(100000, Number(e.target.value) || 0)))}
            />
          </label>
        ) : null}

        {syntheticDataType === 'int' || syntheticDataType === 'float' ? (
          <>
            <label className="small syntheticDataField">
              <span>Min</span>
              <input
                className="mono"
                type="text"
                inputMode="decimal"
                value={syntheticMin}
                onChange={e => setSyntheticMin(Number(e.target.value) || 0)}
              />
            </label>

            <label className="small syntheticDataField">
              <span>Max</span>
              <input
                className="mono"
                type="text"
                inputMode="decimal"
                value={syntheticMax}
                onChange={e => setSyntheticMax(Number(e.target.value) || 0)}
              />
            </label>
          </>
        ) : null}

        {syntheticDataType === 'float' ? (
          <label className="small syntheticDataField">
            <span>Precision</span>
            <input
              className="mono"
              type="text"
              inputMode="numeric"
              value={syntheticFloatPrecision}
              onChange={e => setSyntheticFloatPrecision(Math.max(0, Math.min(8, Number(e.target.value) || 0)))}
            />
          </label>
        ) : null}

        <label className="small syntheticDataField">
          <span>Value</span>
          <textarea
            className="mono syntheticDataOutput"
            value={syntheticValue}
            readOnly
            placeholder="Click Generate"
          />
        </label>
      </div>

      <div className="modalActions">
        <button type="button" onClick={regenerateSyntheticValue}>
          Generate
        </button>
        <button type="button" onClick={copySyntheticValue} disabled={!syntheticValue}>
          {syntheticValueCopied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </dialog>
  )
}
