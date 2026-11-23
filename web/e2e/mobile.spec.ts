import { test, expect, stubHuggingFace } from './fixtures'

// Phones (books#25): nothing scrolls sideways on the narrowest ones, and no field makes iOS zoom.
test.describe('small phone', () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true })

  for (const path of ['/', '/read/alice-in-wonderland/', '/library', '/settings']) {
    test(`${path} fits the screen and its fields don't zoom on focus`, async ({ context, baseURL, page, browserName }) => {
      // Touch emulation (pointer: coarse) is the mobile projects' business
      test.skip(browserName === 'firefox')
      await stubHuggingFace(context, baseURL!)
      // The smallest interface size, where rem-sized text is under 16 px
      await context.addInitScript(() => localStorage.setItem('bp-ui-scale', '80'))
      await page.goto(path)
      await expect(page.locator('header')).toBeVisible()
      await page.waitForLoadState('networkidle')
      const more = page.getByRole('button', { name: 'More reading options' })
      if (await more.isVisible()) await more.click()
      const { viewport, scroll, fields } = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        fields: [...document.querySelectorAll('input:not([type=range]):not([type=checkbox]), select, textarea')]
          .map(el => parseFloat(getComputedStyle(el).fontSize)),
      }))
      expect(scroll).toBeLessThanOrEqual(viewport + 1)
      for (const size of fields) expect(size).toBeGreaterThanOrEqual(16)
    })
  }
})
