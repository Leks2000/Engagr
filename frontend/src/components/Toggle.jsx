export default function Toggle({ value, onChange }) {
  return (
    <div
      className={`toggle-track ${value ? 'active' : ''}`}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
    >
      <div className="toggle-knob" />
    </div>
  )
}
