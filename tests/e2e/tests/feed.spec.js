import { test, expect } from '@playwright/test'
import { installMockBackend, openFeed, USER_ID, pendingItem, newPostItem } from './fixtures.js'

/**
 * Full Feed lifecycle scenario (the user's "approve → published" flow):
 *   1. Posts appear in the Feed
 *   2. A new_post item can generate variants
 *   3. A pending item shows variants; user can select another variant
 *   4. User presses Approve → status flips to approved
 *   5. User can Skip / Decline and the badge updates
 *
 * This is the offline "Browser MCP" auto-test: no real backend, no extension.
 */
test.describe('Feed lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page, { items: [pendingItem, newPostItem], language: 'en' })
  })

  test('renders feed items with platform badges', async ({ page }) => {
    await openFeed(page)
    // Jane Doe (linkedin pending) is visible
    await expect(page.getByText('Jane Doe').first()).toBeVisible()
    // @devnews (x new_post) is visible
    await expect(page.getByText('@devnews').first()).toBeVisible()
    // LinkedIn + X badges present
    await expect(page.getByText('LinkedIn', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('X', { exact: true }).first()).toBeVisible()
  })

  test('generate variants for a new_post item', async ({ page }) => {
    await openFeed(page)
    const genBtn = page.getByRole('button', { name: /generate reply variants/i })
    await genBtn.first().click()
    // After regenerate, the mock returns 3 variants → status becomes pending
    await expect(page.getByText(/Regenerated take 1/i).first()).toBeVisible({ timeout: 8000 })
  })

  test('select a different variant and approve', async ({ page }) => {
    await openFeed(page)
    // Target the variant row by its label, then the Select button within it.
    const variant2Row = page.locator('.queue-card-variant').filter({ hasText: 'Variant 2' })
    await variant2Row.getByRole('button', { name: /^select$/i }).click()
    // That row becomes "Selected"
    await expect(variant2Row.getByRole('button', { name: /selected/i })).toBeVisible()

    // Press Approve (primary button). queue-btn-primary is the class on the
    // <button> itself; its label is "✓ Approve".
    const approveBtn = page.locator('button.queue-btn-primary').first()
    await approveBtn.click()
    // Status badge flips to "Approved" (STATUS_META uses a capitalised label)
    await expect(page.getByText(/approved/i).first()).toBeVisible({ timeout: 8000 })
  })

  test('decline a pending item updates the badge', async ({ page }) => {
    await openFeed(page)
    // Decline button is rendered for pending items
    const declineBtn = page.getByRole('button', { name: /decline/i }).first()
    await declineBtn.click()
    // STATUS_META renders "Declined" (capitalised) — match case-insensitively
    await expect(page.getByText(/declined/i).first()).toBeVisible({ timeout: 8000 })
  })

  test('status filter chips reflect counts', async ({ page }) => {
    await openFeed(page)
    // "All" chip should show total count (2 items)
    await expect(page.getByRole('button', { name: /All \(\d+\)/ })).toBeVisible()
    // A "Pending" chip exists
    await expect(page.getByRole('button', { name: /Pending review/i })).toBeVisible()
  })
})
