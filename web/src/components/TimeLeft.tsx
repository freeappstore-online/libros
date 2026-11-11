import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { getNarrationTime, useNarrationPosition } from '../hooks/narration'
import { chapterSeconds, isNarrated, preparedUrl, usePreparedManifest } from '../hooks/preparedAudio'
import { remainingTime } from '../hooks/remainingTime'
import { LOCALE, t } from '../locales'

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return t('duration.underMinute')
  if (minutes < 60) return t('duration.minutes', { m: minutes })
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? t('duration.hoursMinutes', { h, m }) : t('duration.hours', { h })
}

interface Props {
  slug: string
  chapters: { content: string }[]
  chapterIdx: number
  /** How far down the chapter the reader has scrolled, 0–1 */
  scroll: number
}

/**
 * Reading and listening have separate positions and speeds. Missing audio never
 * contributes a reading estimate to the listening total.
 */
export function TimeLeft({ slug, chapters, chapterIdx, scroll }: Props) {
  const manifest = usePreparedManifest()
  const player = useAudioPlayer()
  const position = useNarrationPosition()
  if (!chapters[chapterIdx]) return null
  const narrated = Boolean(manifest && isNarrated(manifest, slug))
  const url = narrated ? preparedUrl(slug, chapterIdx) : null
  // Pausing keeps the audio's position; scrolling only changes the reading estimate.
  const played = url ? position.url === url && position.duration > 0 ? position.time : getNarrationTime(url) : 0
  const times = remainingTime(chapters, chapters.map((_, i) => manifest ? chapterSeconds(manifest, slug, i) : null),
    chapterIdx, scroll, player.rate, played)

  return (
    <p
      className="text-xs text-text-dim mb-4 md:mb-6"
    >
      <span className="block" title={t('timeLeft.estimate')}>
        {t('timeLeft.reading', { left: t('timeLeft.chapter', { time: formatDuration(times.readingChapter) }) })}
        {chapters.length > 1 && <> · {t('timeLeft.book', { time: formatDuration(times.readingBook) })}</>}
      </span>
      {narrated && <span className="block">
        {t('timeLeft.listening', {
          rate: LOCALE.number(player.rate),
          left: times.audioChapter === null ? t('timeLeft.noAudio') : t('timeLeft.chapter', { time: formatDuration(times.audioChapter) }),
        })}
        {chapters.length > 1 && <> · {t(times.partial ? 'timeLeft.audioAvailable' : 'timeLeft.book', { time: formatDuration(times.audioBook) })}</>}
      </span>}
    </p>
  )
}
