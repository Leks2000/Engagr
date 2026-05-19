export default function Slider({ min, max, value, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-medium" style={{ color: 'var(--color-muted)', minWidth: 16 }}>
        {min}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        className="flex-1"
      />
      <span className="text-sm font-bold" style={{ minWidth: 24, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}
