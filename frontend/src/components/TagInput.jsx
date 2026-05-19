import { useState } from 'react'

export default function TagInput({ tags, onChange, placeholder, prefix }) {
  const [inputValue, setInputValue] = useState('')

  const addTag = () => {
    const val = inputValue.trim()
    if (val && !tags.includes(val)) {
      onChange([...tags, val])
      setInputValue('')
    }
  }

  const removeTag = (tag) => {
    onChange(tags.filter(t => t !== tag))
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    }
    if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  return (
    <div>
      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {tags.map(tag => (
            <span key={tag} className="tag">
              {prefix && <span style={{ color: 'var(--color-muted)' }}>{prefix}</span>}
              {tag}
              <button onClick={() => removeTag(tag)}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 px-3 py-2 border rounded-lg text-sm outline-none focus:border-black transition-colors"
          placeholder={placeholder || 'Add tag...'}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ borderColor: '#ddd' }}
        />
        <button className="btn btn-sm" onClick={addTag}>+</button>
      </div>
    </div>
  )
}
