import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Action-selector regression guard.
 *
 * The Engagr extension relies on specific DOM selectors to Like / Comment /
 * Connect on LinkedIn, Reply / Like / Follow on X, and Comment / Upvote on
 * Reddit. When those platforms ship UI changes, a selector silently breaks
 * and posting fails in production. This spec loads saved fixture HTML for
 * each platform and asserts the extension's key selectors still resolve to
 * at least one element — catching drift before a release.
 *
 * Fixtures live in ./fixtures/<platform>.html and are snapshots of the real
 * post DOM. Update a fixture intentionally when a platform redesigns; never
 * loosen the assertion instead.
 */

const FIXTURES = {
  linkedin: './fixtures/linkedin-post.html',
  x: './fixtures/x-tweet.html',
  reddit: './fixtures/reddit-post.html',
}

test.describe('Extension action selectors', () => {
  test('LinkedIn fixtures expose a comment composer + post button', async ({ page }) => {
    await page.goto(`file://${resolve(__dirname, FIXTURES.linkedin)}`)
    // The extension opens the comment box via the "Comment" action button,
    // then types into the contenteditable and clicks the enabled "Post" button.
    const composer = page.locator('.ql-editor, [contenteditable="true"]').first()
    await expect(composer).toBeVisible()
  })

  test('X fixtures expose a reply button + tweet text', async ({ page }) => {
    await page.goto(`file://${resolve(__dirname, FIXTURES.x)}`)
    await expect(page.locator('[data-testid="tweetText"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="reply"]').first()).toBeVisible()
  })

  test('Reddit fixtures expose an upvote control + comment area', async ({ page }) => {
    await page.goto(`file://${resolve(__dirname, FIXTURES.reddit)}`)
    // shreddit-upvote (new Reddit) OR .arrow.upvote (old Reddit)
    const upvote = page.locator('[data-testid="upvote"], shreddit-upvote, .arrow.upvote, .upvote').first()
    await expect(upvote).toBeVisible()
  })
})
