"""
Engagr — LinkedIn Cookie Login Helper (setup.py)
Opens a visible Playwright browser for the user to log in to LinkedIn.
Saves cookies to data/cookies.json for automated sessions.
"""

import asyncio
import json
import sys
from pathlib import Path

# Add backend dir to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import COOKIES_PATH, DATA_DIR


async def main():
    from playwright.async_api import async_playwright
    
    print("=" * 50)
    print("  Engagr — LinkedIn Login Setup")
    print("=" * 50)
    print()
    print("A browser window will open.")
    print("Please log in to LinkedIn, then press Enter here.")
    print()
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        
        page = await context.new_page()
        await page.goto("https://www.linkedin.com/login")
        
        print("🔗 Browser opened at LinkedIn login page.")
        print("📝 Log in with your credentials.")
        print()
        
        # Wait for the user to log in
        input("✅ Press Enter AFTER you've logged in successfully... ")
        
        # Verify login
        await page.goto("https://www.linkedin.com/feed/")
        await asyncio.sleep(3)
        
        if "/login" in page.url or "/authwall" in page.url:
            print("❌ Login verification failed. Please try again.")
            await browser.close()
            return
        
        # Save cookies
        cookies = await context.cookies()
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        COOKIES_PATH.write_text(json.dumps(cookies, indent=2), encoding="utf-8")
        
        print(f"✅ Cookies saved to {COOKIES_PATH}")
        print("🚀 You can now start the bot with: python main.py")
        
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
