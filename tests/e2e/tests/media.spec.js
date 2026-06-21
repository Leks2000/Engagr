import { test, expect } from '@playwright/test'
import { installMockBackend, openFeed, mediaItem } from './fixtures.js'

/**
 * Media preview scenario: a post with an image attachment should render the
 * MediaPreview component inline so the user sees the post media in Telegram
 * without opening the link. Assets are routed through the backend
 * /api/media/proxy endpoint (see MediaPreview.jsx) to bypass CDN hotlink
 * protection. These tests guard that pipeline end-to-end, including the
 * graceful "Media unavailable — Retry" fallback that replaced the old
 * silent-disappear-on-error behaviour.
 */
test.describe('Post media preview', () => {
  test('renders an inline image for a media post', async ({ page }) => {
    await installMockBackend(page, { items: [mediaItem], language: 'en' })
    await openFeed(page)
    // The MediaPreview <img> has alt="post media"
    const mediaImg = page.locator('img[alt="post media"]').first()
    await expect(mediaImg).toBeVisible({ timeout: 8000 })
    // The image src is now routed through the backend proxy (not the raw
    // CDN url) so it survives hotlink protection in the Telegram webview.
    await expect(mediaImg).toHaveAttribute('src', /\/api\/media\/proxy/)
    await expect(mediaImg).toHaveAttribute('src', /url=/)
  })

  test('media image decodes without broken-state fallback', async ({ page }) => {
    await installMockBackend(page, { items: [mediaItem], language: 'en' })
    await openFeed(page)
    const mediaImg = page.locator('img[alt="post media"]').first()
    await expect(mediaImg).toBeVisible({ timeout: 8000 })
    // naturalWidth > 0 means the browser actually decoded the image (not broken)
    const ok = await mediaImg.evaluate((el) => el.complete && el.naturalWidth > 0)
    expect(ok).toBeTruthy()
  })

  test('shows graceful fallback + retry chip instead of vanishing on 403', async ({ page }) => {
    // proxyFails simulates a CDN hotlink 403 — the exact failure mode that
    // used to make MediaPreview silently disappear. The fix surfaces a
    // "Media unavailable — Retry" chip so the user understands the state.
    await installMockBackend(page, { items: [mediaItem], language: 'en', proxyFails: true })
    await openFeed(page)
    // No broken <img> should remain visible once the fallback kicks in
    const fallback = page.locator('.media-fallback')
    await expect(fallback).toBeVisible({ timeout: 8000 })
    await expect(fallback).toContainText('Media unavailable')
    await expect(fallback.locator('button', { hasText: 'Retry' })).toBeVisible()
  })
})
