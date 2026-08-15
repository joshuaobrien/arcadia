import { expect, test } from '@playwright/test'

test('browses the library and opens an album', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('Arcadia')
  await expect(page.locator('.brand')).toContainText('arcadia')
  await expect(page.getByRole('heading', { name: 'Albums' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Static Bloom by Arcadia Test Ensemble' })).toBeVisible()

  await page.getByRole('button', { name: 'Open Static Bloom by Arcadia Test Ensemble' }).click()

  await expect(page.locator('.album-detail-copy').getByRole('heading', { name: 'Static Bloom' })).toBeVisible()
  await expect(page.locator('.library-track-row')).toHaveCount(2)
  await expect(page.getByText('Signal One', { exact: true })).toBeVisible()
  await expect(page.getByText('Signal Two', { exact: true })).toBeVisible()
})

test('plays songs, advances the album queue, and opens Now Playing', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Songs' })).toBeVisible()

  await page.getByRole('button', { name: 'Play Signal One' }).click()
  await expect(page.getByRole('region', { name: 'Now playing' })).toContainText('Signal One')

  await page.locator('audio').evaluate(audio => audio.dispatchEvent(new Event('ended')))
  await expect(page.getByRole('region', { name: 'Now playing' })).toContainText('Signal Two')

  await page.getByRole('button', { name: 'Open Now Playing visualizer' }).click()
  await expect(page.getByRole('region', { name: 'Now playing visualizer' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Signal Two' })).toBeVisible()
})

test('keeps library navigation usable on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Open Static Bloom by Arcadia Test Ensemble' })).toBeVisible()
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Songs' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play Signal One' })).toBeVisible()
})
