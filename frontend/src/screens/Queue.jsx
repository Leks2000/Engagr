import { useState, useEffect, useCallback } from 'react'
import { api } from '../App'
import Card from '../components/Card'

export default function Queue({ userId }) {
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')

  const loadQueue = useCallback(async () => {
    try {
      const data = await api.get(`/api/queue/${userId}`)
      setQueue(data)
    } catch (err) {
      console.error('Failed to load queue:', err)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    loadQueue()
    const interval = setInterval(loadQueue, 15000)
    return () => clearInterval(interval)
  }, [loadQueue])

  const handleApprove = async (itemId) => {
    try {
      await api.post(`/api/queue/${userId}/${itemId}/approve`)
      setQueue(q => q.filter(item => item.id !== itemId))
    } catch (err) {
      console.error('Approve error:', err)
    }
  }

  const handleSkip = async (itemId) => {
    try {
      await api.post(`/api/queue/${userId}/${itemId}/skip`)
      setQueue(q => q.filter(item => item.id !== itemId))
    } catch (err) {
      console.error('Skip error:', err)
    }
  }

  const handleRegenerate = async (itemId) => {
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/regenerate`)
      setQueue(q => q.map(item =>
        item.id === itemId
          ? { ...item, comment: result.comment, selected_comment: result.comment }
          : item
      ))
    } catch (err) {
      console.error('Regenerate error:', err)
    }
  }

  const handleSelectVariant = async (itemId, variantIndex) => {
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/select`, {
        variant_index: variantIndex,
      })
      setQueue(q => q.map(item =>
        item.id === itemId
          ? { ...item, comment: result.comment, selected_comment: result.comment }
          : item
      ))
    } catch (err) {
      console.error('Select variant error:', err)
    }
  }

  const handleEdit = (item) => {
    setEditingId(item.id)
    setEditText(item.selected_comment || item.comment)
  }

  const handleEditSave = async () => {
    if (!editingId || !editText.trim()) return
    try {
      await api.post(`/api/queue/${userId}/${editingId}/edit`, {
        comment: editText.trim(),
      })
      setQueue(q => q.map(item =>
        item.id === editingId
          ? { ...item, comment: editText.trim(), selected_comment: editText.trim() }
          : item
      ))
      setEditingId(null)
      setEditText('')
    } catch (err) {
      console.error('Edit error:', err)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 px-5 pt-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="queue-skeleton" />
        ))}
      </div>
    )
  }

  return (
    <div className="px-5 pt-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">📋 Queue</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {queue.length} pending comment{queue.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button className="btn btn-sm" onClick={loadQueue}>
          ↻ Refresh
        </button>
      </div>

      {queue.length === 0 ? (
        <div className="text-center py-16 empty-state">
          <div className="empty-illu">🧠💬</div>
          <p className="text-base font-semibold mb-1">No items in review queue</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Run a session from Dashboard to generate AI comments.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map((item, i) => (
            <div
              key={item.id}
              className="animate-slide-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {editingId === item.id ? (
                <div className="queue-card" style={{ borderLeft: '3px solid #0A66C2' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`badge badge-${item.platform}`}>
                      {item.platform}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      Editing comment
                    </span>
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
                    {item.post_excerpt || item.excerpt}
                  </p>
                  <textarea
                    className="w-full px-3 py-2 border rounded-lg text-sm outline-none resize-none"
                    style={{ borderColor: '#ddd', minHeight: 80 }}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    autoFocus
                  />
                  <div className="flex gap-2 mt-3">
                    <button className="btn btn-sm flex-1" onClick={handleEditSave}>
                      💾 Save
                    </button>
                    <button
                      className="btn btn-sm flex-1"
                      onClick={() => { setEditingId(null); setEditText('') }}
                      style={{ color: 'var(--color-muted)', borderColor: '#ddd' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <Card
                  item={item}
                  onApprove={() => handleApprove(item.id)}
                  onEdit={() => handleEdit(item)}
                  onSkip={() => handleSkip(item.id)}
                  onRegenerate={() => handleRegenerate(item.id)}
                  onSelectVariant={handleSelectVariant}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
