import { useEffect, useRef, useState } from 'react'
import { VariableAutocompleteField } from '../../../shared/components/VariableAutocompleteField'
import type { VariableSuggestion } from '../../../shared/utils/variables'

type AuthType = 'none' | 'basic' | 'bearer'

function parseAuthorization(raw: string): { type: AuthType; username: string; password: string; token: string } {
  const value = (raw || '').trim()
  if (!value) return { type: 'none', username: '', password: '', token: '' }

  const basicMatch = value.match(/^basic\s+(.+)$/i)
  if (basicMatch) {
    const decoded = safeBase64Decode(basicMatch[1].trim())
    const idx = decoded.indexOf(':')
    if (idx >= 0) return { type: 'basic', username: decoded.slice(0, idx), password: decoded.slice(idx + 1), token: '' }
    return { type: 'basic', username: decoded, password: '', token: '' }
  }

  const bearerMatch = value.match(/^bearer\s+(.+)$/i)
  if (bearerMatch) return { type: 'bearer', username: '', password: '', token: bearerMatch[1].trim() }

  // Unknown format: keep it editable as a bearer token payload.
  return { type: 'bearer', username: '', password: '', token: value }
}

function safeBase64EncodeUtf8(input: string) {
  try {
    const bytes = new TextEncoder().encode(input)
    let bin = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize)
      bin += String.fromCharCode(...chunk)
    }
    return btoa(bin)
  } catch {
    try {
      return btoa(input)
    } catch {
      return ''
    }
  }
}

function safeBase64Decode(input: string) {
  try {
    const bin = atob(input)
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    try {
      return atob(input)
    } catch {
      return ''
    }
  }
}

export function AuthorizationTab(props: {
  value: string
  onChangeValue: (next: string) => void
  variableSuggestions: VariableSuggestion[]
}) {
  const menuWrapRef = useRef<HTMLDivElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const [{ type, username, password, token }, setState] = useState(() => parseAuthorization(props.value))

  useEffect(() => {
    const next = parseAuthorization(props.value)
    setState(prev => {
      if (
        prev.type === next.type &&
        prev.username === next.username &&
        prev.password === next.password &&
        prev.token === next.token
      ) return prev
      return next
    })
  }, [props.value])

  useEffect(() => {
    if (!menuOpen) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      const wrap = menuWrapRef.current
      if (t && wrap && wrap.contains(t)) return
      setMenuOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  function setType(nextType: AuthType) {
    setState(prev => {
      const next = { ...prev, type: nextType }
      if (nextType === 'none') {
        props.onChangeValue('')
        return { type: 'none', username: '', password: '', token: '' }
      }
      if (nextType === 'basic') {
        const hasAny = !!(next.username.trim() || next.password)
        props.onChangeValue(hasAny ? `Basic ${safeBase64EncodeUtf8(`${next.username}:${next.password}`)}` : '')
        return next
      }
      if (nextType === 'bearer') {
        props.onChangeValue(next.token.trim() ? `Bearer ${next.token}` : '')
        return next
      }
      return next
    })
  }

  function setUsername(nextUsername: string) {
    setState(prev => {
      const next = { ...prev, username: nextUsername, type: 'basic' as const }
      const hasAny = !!(next.username.trim() || next.password)
      props.onChangeValue(hasAny ? `Basic ${safeBase64EncodeUtf8(`${next.username}:${next.password}`)}` : '')
      return next
    })
  }

  function setPassword(nextPassword: string) {
    setState(prev => {
      const next = { ...prev, password: nextPassword, type: 'basic' as const }
      const hasAny = !!(next.username.trim() || next.password)
      props.onChangeValue(hasAny ? `Basic ${safeBase64EncodeUtf8(`${next.username}:${next.password}`)}` : '')
      return next
    })
  }

  function setToken(nextToken: string) {
    setState(prev => {
      const next = { ...prev, token: nextToken, type: 'bearer' as const }
      props.onChangeValue(next.token.trim() ? `Bearer ${next.token}` : '')
      return next
    })
  }

  const typeLabel = type === 'basic' ? 'Basic Auth' : type === 'bearer' ? 'Bearer Token' : 'None'

  return (
    <div className="accordion authAccordion">
      <div className="section">
        <div className="formRow">
          <div className="formLabel mono">Authorization</div>
          <div ref={menuOpen ? menuWrapRef : null} className="selectMenuWrap" style={{ minWidth: 180 }}>
            <button
              type="button"
              className="selectMenuBtn"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                setMenuOpen(v => !v)
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Authorization type"
              title="Authorization type"
            >
              {typeLabel}
            </button>

            {menuOpen ? (
              <div
                className="selectMenuPanel"
                role="menu"
                onPointerDown={e => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
              >
                <button
                  type="button"
                  className={`selectMenuItem ${type === 'basic' ? 'selectMenuItemActive' : ''}`}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setType('basic')
                  }}
                >
                  Basic Auth
                </button>
                <button
                  type="button"
                  className={`selectMenuItem ${type === 'bearer' ? 'selectMenuItemActive' : ''}`}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setType('bearer')
                  }}
                >
                  Bearer Token
                </button>
                <button
                  type="button"
                  className={`selectMenuItem ${type === 'none' ? 'selectMenuItemActive' : ''}`}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setType('none')
                  }}
                >
                  None
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {type === 'basic' ? (
          <>
            <div className="formRow">
              <div className="formLabel mono">Username</div>
              <VariableAutocompleteField
                className="mono"
                value={username}
                suggestions={props.variableSuggestions}
                onChangeValue={setUsername}
                placeholder="Username"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <div className="formRow">
              <div className="formLabel mono">Password</div>
              <VariableAutocompleteField
                className="mono"
                type="password"
                value={password}
                suggestions={props.variableSuggestions}
                onChangeValue={setPassword}
                placeholder="Password"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
          </>
        ) : null}

        {type === 'bearer' ? (
          <div className="formRow">
            <div className="formLabel mono">Token</div>
            <VariableAutocompleteField
              className="mono"
              value={token}
              suggestions={props.variableSuggestions}
              onChangeValue={setToken}
              placeholder="Bearer token…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
