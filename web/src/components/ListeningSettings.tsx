import { useId } from 'react'
import { useAudioPlayer, RATES } from '../hooks/useAudioPlayer'
import { canBoostVolume } from '../hooks/narration'
import {
  CHAPTER_PAUSES, setChapterPause, setContinueChapters, setReadTitles,
  useChapterPause, useContinueChapters, useReadTitles, useVolumeBoost,
} from '../hooks/usePreferences'
import { t } from '../locales'

export function ListeningSettings() {
  const player = useAudioPlayer()

  return (
    <div className="bg-surface rounded-xl border border-border p-5 md:p-6">
      <h2 className="text-lg font-semibold mb-4">{t('listening.title')}</h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="speed" className="block text-sm text-text-muted mb-2">{t('listening.speed')}</label>
          <select
            id="speed"
            value={player.rate}
            onChange={e => player.setRate(Number(e.target.value))}
            className="bg-page text-text text-base md:text-sm rounded-lg px-3 py-2 border border-border w-full max-w-xs"
          >
            {RATES.map(r => <option key={r} value={r}>{t('player.rate', { rate: r })}</option>)}
          </select>
        </div>
        <ListeningOptions />
      </div>
    </div>
  )
}

/** Between chapters, and loudness (books#37): in Settings and the player's panel. */
export function ListeningOptions() {
  const player = useAudioPlayer()
  const pause = useChapterPause()
  const pauseLabel = useId()
  const boost = useVolumeBoost()

  return (
    <div className="space-y-4">
      <Toggle
        label={t('listening.readTitles')}
        hint={t('listening.readTitlesHint')}
        checked={useReadTitles()}
        onChange={setReadTitles}
      />
      <div>
        <div id={pauseLabel} className="text-sm text-text">{t('listening.pause')}</div>
        <p className="text-xs text-text-dim mb-2">{t('listening.pauseHint')}</p>
        <div role="group" aria-labelledby={pauseLabel} className="flex flex-wrap gap-2">
          {CHAPTER_PAUSES.map(s => (
            <button
              key={s}
              onClick={() => setChapterPause(s)}
              aria-pressed={pause === s}
              className={`px-4 py-2 rounded-lg text-sm transition ${
                pause === s ? 'bg-accent text-btn-text font-semibold' : 'bg-surface-hover text-text-muted hover:text-text'
              }`}
            >
              {s === 0 ? t('listening.pauseOff') : t('listening.pauseSeconds', { s })}
            </button>
          ))}
        </div>
      </div>
      <Toggle
        label={t('listening.continue')}
        hint={t('listening.continueHint')}
        checked={useContinueChapters()}
        onChange={setContinueChapters}
      />
      {canBoostVolume && (
        <Toggle
          label={t('listening.boost')}
          hint={t('listening.boostHint')}
          checked={boost}
          onChange={player.setVolumeBoost}
        />
      )}
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  const id = useId()
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <span>
        <span id={`${id}-label`} className="block text-sm text-text">{label}</span>
        <span id={`${id}-hint`} className="block text-xs text-text-dim">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-1 w-5 h-5 shrink-0 accent-accent cursor-pointer"
      />
    </label>
  )
}
