import { useState } from 'react'
import { Link } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import { ReadingSettings } from '../components/ReadingSettings'
import { ListeningSettings } from '../components/ListeningSettings'
import { getTheme, type Theme } from '../hooks/useTheme'
import { formatBytes, savedBytes, useOfflineBooks } from '../hooks/offlineBooks'
import { t } from '../locales'

export function SettingsPage() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme)
  const saved = Object.values(useOfflineBooks().saved)

  return (
    <div className="min-h-dvh bg-page text-text">
      <NavBar title={t('nav.settings')} />

      <main className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-4 md:space-y-6">
        <ReadingSettings
          currentTheme={currentTheme}
          setCurrentTheme={setCurrentTheme}
        />

        <ListeningSettings />

        <div className="bg-surface rounded-xl border border-border p-5 md:p-6">
          <h2 className="text-lg font-semibold mb-2">{t('settings.savedBooks')}</h2>
          <p className="text-sm text-text-muted">
            {saved.length === 0
              ? t('settings.noneSaved')
              : t('settings.savedCount', { count: saved.length, size: formatBytes(saved.reduce((sum, b) => sum + savedBytes(b), 0)) })}
            {' '}
            <Link to="/library" className="text-accent underline">{t('settings.manage')}</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
