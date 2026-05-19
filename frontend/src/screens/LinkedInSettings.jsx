import { useState, useEffect } from 'react'
import Toggle from '../components/Toggle'
import TagInput from '../components/TagInput'
import Slider from '../components/Slider'

export default function LinkedInSettings({ userId, settings, onSettingsUpdate }) {
  const li = settings?.linkedin || {}

  const [keywords, setKeywords] = useState(li.keywords || [])
  const [commentsPerDay, setCommentsPerDay] = useState(li.comments_per_day || 5)
  const [likesPerDay] = useState(li.likes_per_day || 5)
  const [addRange, setAddRange] = useState(li.people_add_range || [1, 3])
  const [addByKeywords, setAddByKeywords] = useState(li.add_people_by_keywords || false)
  const [addKeywords, setAddKeywords] = useState(li.add_people_keywords || [])
  const [sessionTimes, setSessionTimes] = useState(li.session_times || ['09:00', '14:00', '19:00'])
  const [newTime, setNewTime] = useState('')
  const [dirty, setDirty] = useState(false)

  const save = () => {
    onSettingsUpdate({
      linkedin: {
        ...li,
        keywords,
        comments_per_day: commentsPerDay,
        people_add_range: addRange,
        add_people_by_keywords: addByKeywords,
        add_people_keywords: addKeywords,
        session_times: sessionTimes,
      },
    })
    setDirty(false)
  }

  const markDirty = () => setDirty(true)

  const addSessionTime = () => {
    if (newTime && sessionTimes.length < 3 && !sessionTimes.includes(newTime)) {
      setSessionTimes([...sessionTimes, newTime].sort())
      setNewTime('')
      markDirty()
    }
  }

  const removeSessionTime = (time) => {
    setSessionTimes(sessionTimes.filter(t => t !== time))
    markDirty()
  }

  return (
    <div className="px-5 pt-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">LinkedIn</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Engagement settings</p>
        </div>
        {li.connected ? (
          <span className="text-xs px-2 py-1 rounded" style={{ background: '#e8f5e9', color: 'var(--color-success)' }}>
            ● Connected
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded" style={{ background: '#fff3e0', color: 'var(--color-warning)' }}>
            Not connected
          </span>
        )}
      </div>

      {/* Keywords */}
      <Section title="Keywords" subtitle="Posts matching these keywords will be targeted">
        <TagInput
          tags={keywords}
          onChange={(tags) => { setKeywords(tags); markDirty() }}
          placeholder="Add keyword..."
        />
      </Section>

      {/* Comments per day */}
      <Section title="Comments per day" subtitle={`${commentsPerDay} comments`}>
        <Slider
          min={1}
          max={15}
          value={commentsPerDay}
          onChange={(v) => { setCommentsPerDay(v); markDirty() }}
        />
      </Section>

      {/* Likes per day */}
      <Section title="Likes per day" subtitle="Fixed at 5 (maximum safe limit)">
        <div className="card text-center py-3">
          <span className="text-2xl font-bold">5</span>
          <span className="text-xs block" style={{ color: 'var(--color-muted)' }}>per day (fixed)</span>
        </div>
      </Section>

      {/* People to add */}
      <Section title="People to add per day" subtitle={`Random ${addRange[0]}–${addRange[1]} per day`}>
        <div className="flex gap-4 items-center">
          <div className="flex-1">
            <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Min</label>
            <Slider min={1} max={5} value={addRange[0]} onChange={(v) => {
              const newRange = [v, Math.max(v, addRange[1])]
              setAddRange(newRange)
              markDirty()
            }} />
          </div>
          <div className="flex-1">
            <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Max</label>
            <Slider min={1} max={5} value={addRange[1]} onChange={(v) => {
              const newRange = [Math.min(addRange[0], v), v]
              setAddRange(newRange)
              markDirty()
            }} />
          </div>
        </div>
      </Section>

      {/* Add people by keywords */}
      <Section title="Add people by keywords">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm">Enable keyword-based search</span>
          <Toggle
            value={addByKeywords}
            onChange={(v) => { setAddByKeywords(v); markDirty() }}
          />
        </div>
        {addByKeywords && (
          <TagInput
            tags={addKeywords}
            onChange={(tags) => { setAddKeywords(tags); markDirty() }}
            placeholder="Add search keyword..."
          />
        )}
      </Section>

      {/* Session times */}
      <Section title="Session times" subtitle={`${sessionTimes.length}/3 time slots (UTC)`}>
        <div className="space-y-2 mb-3">
          {sessionTimes.map(time => (
            <div key={time} className="card flex items-center justify-between py-3">
              <span className="text-sm font-medium">{time}</span>
              <button
                className="text-xs"
                style={{ color: 'var(--color-danger)' }}
                onClick={() => removeSessionTime(time)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        {sessionTimes.length < 3 && (
          <div className="flex gap-2">
            <input
              type="time"
              className="flex-1 px-3 py-2 border rounded-lg text-sm outline-none"
              value={newTime}
              onChange={e => setNewTime(e.target.value)}
              style={{ borderColor: '#ddd' }}
            />
            <button className="btn btn-sm" onClick={addSessionTime}>Add</button>
          </div>
        )}
      </Section>

      {/* Save */}
      {dirty && (
        <div className="fixed bottom-16 left-0 right-0 px-5 pb-4 pt-2 bg-white animate-slide-up">
          <button className="btn w-full" onClick={save}>
            Save Changes
          </button>
        </div>
      )}
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      {subtitle && <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>{subtitle}</p>}
      {children}
    </div>
  )
}
