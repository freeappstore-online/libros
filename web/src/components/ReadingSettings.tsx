import { type Theme, setTheme } from '../hooks/useTheme'
import { TextSizeControls } from './TextSizeControls'
import { t } from '../locales'

interface ReadingSettingsProps {
  currentTheme: Theme
  setCurrentTheme: (t: Theme) => void
}

export function ReadingSettings({ currentTheme, setCurrentTheme }: ReadingSettingsProps) {

  return (
    <div className="bg-surface rounded-xl border border-border p-5 md:p-6">
      <h2 className="text-lg font-semibold mb-4">{t('settings.reading')}</h2>
      <div className="space-y-4">
        <div>
          <div id="theme-label" className="block text-sm text-text-muted mb-3">{t('settings.theme')}</div>
          <div role="group" aria-labelledby="theme-label" className="flex flex-wrap gap-2">
            {(['dark', 'light', 'sepia'] as const).map(theme => (
              <button
                key={theme}
                onClick={() => { setCurrentTheme(theme); setTheme(theme) }}
                aria-pressed={currentTheme === theme}
                className={`px-4 py-2 rounded-lg text-sm transition ${
                  currentTheme === theme
                    ? 'bg-accent text-btn-text font-semibold'
                    : 'bg-surface-hover text-text-muted hover:text-text'
                }`}
              >
                {t(`theme.${theme}`)}
              </button>
            ))}
          </div>
        </div>

        <TextSizeControls />
      </div>
    </div>
  )
}
