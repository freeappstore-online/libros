import {
  BOOK_TEXT, UI_TEXT,
  setReaderFontSize, setUiScale, useReaderFontSize, useUiScale,
} from '../hooks/usePreferences'
import { t } from '../locales'

interface RowProps {
  label: string
  /** The A buttons' names */
  smaller: string
  larger: string
  hint: string
  value: number
  unit: string
  range: { min: number; max: number; step: number; default: number }
  onChange: (v: number) => void
}

function SizeRow({ label, smaller, larger, hint, value, unit, range, onChange }: RowProps) {
  const btn = 'w-10 h-10 shrink-0 rounded-lg bg-surface-hover text-text hover:bg-border disabled:opacity-40 transition'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm text-text">{label}</label>
        <span className="text-xs text-text-muted tabular-nums">
          {value}{unit}
          {value !== range.default && (
            <button onClick={() => onChange(range.default)} className="ml-2 text-accent hover:underline">{t('textSize.reset')}</button>
          )}
        </span>
      </div>
      <p className="text-xs text-text-dim mb-2">{hint}</p>
      <div className="flex items-center gap-2">
        <button className={btn} onClick={() => onChange(value - range.step)} disabled={value <= range.min}
          aria-label={smaller}><span className="text-xs">A</span></button>
        <input
          type="range" min={range.min} max={range.max} step={range.step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          aria-label={label}
          className="flex-1 accent-accent"
        />
        <button className={btn} onClick={() => onChange(value + range.step)} disabled={value >= range.max}
          aria-label={larger}><span className="text-lg leading-none">A</span></button>
      </div>
    </div>
  )
}

/** Book text size and interface text size: independent, applied immediately, saved on this device. */
export function TextSizeControls({ preview = true }: { preview?: boolean }) {
  const bookSize = useReaderFontSize()
  const uiScale = useUiScale()
  return (
    <div className="space-y-5">
      <SizeRow
        label={t('textSize.book')}
        smaller={t('textSize.bookSmaller')}
        larger={t('textSize.bookLarger')}
        hint={t('textSize.bookHint')}
        value={bookSize} unit="px" range={BOOK_TEXT} onChange={setReaderFontSize}
      />
      {preview && (
        <p className="text-text-muted rounded-lg bg-page p-3 -mt-2" style={{ fontSize: `${bookSize}px`, lineHeight: 1.8 }}>
          {t('textSize.sample')}
        </p>
      )}
      <SizeRow
        label={t('textSize.ui')}
        smaller={t('textSize.uiSmaller')}
        larger={t('textSize.uiLarger')}
        hint={t('textSize.uiHint')}
        value={uiScale} unit="%" range={UI_TEXT} onChange={setUiScale}
      />
    </div>
  )
}
