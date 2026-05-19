import { useState } from 'react'
import TagInput from '../components/TagInput'
import Slider from '../components/Slider'

export default function RedditSettings({ userId, settings, onSettingsUpdate }) {
  const rd = settings?.reddit || {}

  const [subreddits, setSubreddits] = useState(rd.subreddits || [])
  const [keywords, setKeywords] = useState(rd.keywords || [])
  const [commentsPerDay, setCommentsPerDay] = useState(rd.comments_per_day || 5)
  const [sessionTimes, setSessionTimes] = useState(rd.session_times || ['09:00', '14:00', '19:00'])
  const [newTime, setNewTime] = useState('')
  const [dirty, setDirty] = useState(false)

  const markDirty = () => setDirty(true)

  const save = () => {
    onSettingsUpdate({
      reddit: {
        ...rd,
        subreddits,
        keywords,
        comments_per_day: commentsPerDay,
        session_times: sessionTimes,
      },
    })
    setDirty(false)
  }

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
          <h1 className="text-xl font-bold tracking-tight">Reddit</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Engagement settings</p>
        </div>
        {rd.connected ? (
          <span className="text-xs px-2 py-1 rounded" style={{ background: '#e8f5e9', color: 'var(--color-success)' }}>
            ● Connected
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded" style={{ background: '#fff3e0', color: 'var(--color-warning)' }}>
            Not connected
          </span>
        )}
      </div>

      {/* Subreddits */}
      <Section title="Subreddits" subtitle="Target subreddits for engagement">
        <TagInput
          tags={subreddits}
          onChange={(tags) => { setSubreddits(tags); markDirty() }}
          placeholder="Add subreddit (e.g. webdev)..."
          prefix="r/"
        />
      </Section>

      {/* Keywords */}
      <Section title="Keywords" subtitle="Filter posts by these keywords">
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

      {/* Upvotes per day */}
      <Section title="Upvotes per day" subtitle="Fixed at 5 (maximum safe limit)">
        <div className="card text-center py-3">
          <span className="text-2xl font-bold">5</span>
          <span className="text-xs block" style={{ color: 'var(--color-muted)' }}>per day (fixed)</span>
        </div>
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
