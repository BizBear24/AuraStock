import { expect, test } from '@playwright/test'

test.describe('signed-out experience', () => {
  test('protected pages redirect to sign in', async ({ page }) => {
    for (const path of ['/', '/products', '/scan', '/transfers', '/backups']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login$/)
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    }
  })

  test('sign-in form validates before calling the server', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Email is required')).toBeVisible()
    await expect(page.getByText('Password is required')).toBeVisible()
    await page.getByLabel('Email').fill('not-an-email')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Enter a valid email address')).toBeVisible()
  })

  test('sign-up checks the password rules', async ({ page }) => {
    await page.goto('/signup')
    await page.getByLabel('Full name').fill('Ada Lovelace')
    await page.getByLabel('Email').fill('ada@example.com')
    await page.getByLabel('Password', { exact: true }).fill('short')
    await page.getByLabel('Confirm password').fill('different')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Use at least 8 characters')).toBeVisible()
    await expect(page.getByText('Passwords do not match')).toBeVisible()
  })

  test('navigation between auth screens works', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'Create one' }).click()
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible()
    await page.getByRole('link', { name: 'Sign in' }).click()
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible()
  })
})

test.describe('installable app', () => {
  test('serves a valid web app manifest with real icons', async ({ page, request }) => {
    await page.goto('/login')
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBeTruthy()
    const manifest = await (await request.get(href!)).json()
    expect(manifest).toMatchObject({ name: 'AuraStock', display: 'standalone', start_url: '/' })
    const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose)
    expect(purposes).toEqual(expect.arrayContaining(['any', 'maskable']))
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const res = await request.get(icon.src)
      expect(res.ok()).toBe(true)
      expect(res.headers()['content-type']).toContain('image/png')
      const bytes = await res.body()
      expect(bytes.subarray(1, 4).toString()).toBe('PNG')
      expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(icon.sizes)
    }
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#171918')
  })

  test('opens with no connection once it has been loaded', async ({ page, context }) => {
    await page.goto('/login')
    // Wait until the service worker controls the page and has finished precaching.
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.ready
      return reg.active?.state === 'activated' && (await caches.keys()).length > 0
    })
    await page.reload()
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

    await context.setOffline(true)
    await page.goto('/signup')
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible()
    await page.goto('/products') // deep link, offline
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await context.setOffline(false)
  })
})

test.describe('layout', () => {
  test('never scrolls sideways', async ({ page }) => {
    for (const path of ['/login', '/signup', '/forgot-password']) {
      await page.goto(path)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, path).toBeLessThanOrEqual(0)
    }
  })

  test('is usable with the keyboard alone', async ({ page }) => {
    await page.goto('/login')
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Email')).toBeFocused()
    await page.keyboard.type('a@b.co')
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Password')).toBeFocused()
  })
})
