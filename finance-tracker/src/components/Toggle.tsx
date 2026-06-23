interface ToggleProps {
  value: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
}

export function Toggle({ value, onChange, label, disabled = false }: ToggleProps) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <div
        role="switch"
        aria-checked={value}
        onClick={() => !disabled && onChange(!value)}
        style={{
          width: 44, height: 24, borderRadius: 12, flexShrink: 0,
          background: value ? 'var(--violet)' : 'var(--bg4)',
          border: `1px solid ${value ? 'transparent' : 'var(--border2)'}`,
          position: 'relative', transition: 'background 0.2s, border-color 0.2s',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: value ? 23 : 3,
          width: 16, height: 16, borderRadius: '50%',
          background: 'white',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
          transition: 'left 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </div>
      {label && (
        <span style={{ fontSize: 14, color: 'var(--text2)', userSelect: 'none' }}>
          {label}
        </span>
      )}
    </label>
  )
}
