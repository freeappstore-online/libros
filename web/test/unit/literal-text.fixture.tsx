// What locales.test.ts's check of text written into components must find, and must not
declare const t: (key: string) => string
declare const busy: boolean
declare const count: number

export const Fixture = () => (
  <div className="text-sm" aria-current={busy ? 'page' : undefined}>
    Saved
    <button aria-label="Close" title={t('common.close')}>&times;</button>
    {busy ? 'Pause' : 'Play'}
    {busy && t(busy ? 'player.pause' : 'player.play')}
    {count === 1 ? null : `${count} results`}
    <span key="label-key">A</span>
  </div>
)
