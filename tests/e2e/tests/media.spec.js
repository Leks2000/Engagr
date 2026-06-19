import { test, expect } from '@playwright/test'
import { installMockBackend, openFeed, mediaItem } from './fixtures.js'

/**
 * Media preview scenario: a post with an image attachment should render the
 * MediaPreview component inline so the user sees the post media in Telegram
 * without opening the link. This guards the Task-1 feature end-to-end.
 */
test.describe('Post media preview', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page, { items: [mediaItem], language: 'en' })
  })

  test('renders an inline image for a media post', async ({ page }) => {
    await openFeed(page)
    // The MediaPreview <img> has alt="post media"
    const mediaImg = page.locator('img[alt="post media"]').first()
    await expect(mediaImg).toBeVisible({ timeout: 8000 })
    // The image src should point at the mocked attachment URL
    await expect(mediaImg).toHaveAttribute('src', /placehold\.co/)
  })

  test('media image loads without broken-state fallback', async ({ page }) => {
    await openFeed(page)
    const mediaImg = page.locator('img[alt="post media"]').first()
    await expect(mediaImg).toBeVisible({ timeout: 8000 })
    // naturalWidth > 0 means the browser actually decoded the image (not broken)
    const ok = await mediaImg.evaluate((el) => el.complete && el.naturalWidth > 0)
    expect(ok).toBeTruthy()
  })
})
