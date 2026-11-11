// The catalogue's Audiobooks filter (books#34).
import { test, expect, stubHuggingFace, SLUG } from './fixtures'

test.beforeEach(async ({ context, baseURL }) => {
  await stubHuggingFace(context, baseURL!)
})

const listed = (page: import('@playwright/test').Page) =>
  page.locator('main section').last().locator('a[href^="/read/"]')

test('Audiobooks filters the list to narrated books, combines with search, and survives going back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('heading', { name: 'Audiobooks', exact: true }).waitFor()
  const all = await listed(page).count()
  expect(all).toBeGreaterThan(1)

  const toggle = page.getByRole('button', { name: 'Audiobooks', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page).toHaveURL(/[?&]audio=1/)
  await expect(page.getByRole('heading', { name: '1 audiobook', exact: true })).toBeVisible()
  await expect(listed(page)).toHaveCount(1)
  await expect(listed(page).first()).toHaveAttribute('href', `/read/${SLUG}/`)

  // With a search that matches no audiobook
  await page.getByLabel('Search books').fill('dracula')
  await expect(listed(page)).toHaveCount(0)
  await page.getByLabel('Search books').fill('')

  // Open the book and come back: still filtered
  await listed(page).first().click()
  await page.waitForSelector('article h2')
  await page.goBack()
  await expect(page.getByRole('button', { name: 'Audiobooks', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(listed(page)).toHaveCount(1)

  await page.getByRole('button', { name: 'Audiobooks', exact: true }).click()
  await expect(page).not.toHaveURL(/audio=1/)
  await expect(listed(page)).toHaveCount(all)
})

test('"See all audiobooks" on the shelf turns the filter on', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'See all audiobooks' }).click()
  await expect(page.getByRole('button', { name: 'Audiobooks', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(listed(page)).toHaveCount(1)
})

test('a partly narrated book says how many chapters can be heard', async ({ context, baseURL, page }) => {
  await context.unrouteAll()
  await stubHuggingFace(context, baseURL!, { durations: [300, 300, 300, null, null, null, null, null, null, null, null, null] })
  await page.goto('/?audio=1')
  await expect(listed(page).first()).toContainText('Audiobook · 3/12 ch')
})
