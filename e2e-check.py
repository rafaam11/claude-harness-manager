from playwright.sync_api import sync_playwright

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:5173")
    page.wait_for_load_state("networkidle")

    assert page.locator("nav h1").inner_text() == "Harness Manager"
    # Overview 카드 렌더 확인
    page.wait_for_selector(".card", timeout=5000)
    print("Overview cards:", page.locator(".card").count())

    # 각 페이지 탭 순회
    for label in ["Workspace", "Catalog", "Memory", "Cleanup", "Config Editor"]:
        page.click(f"nav button:has-text('{label}')")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(300)

    # Workspace 3개 하위 뷰 순회 + 스크린샷
    page.click("nav button:has-text('Workspace')")
    page.wait_for_load_state("networkidle")
    for sub in ["Projects", "Plans", "Timeline"]:
        page.click(f".ws-subtabs button:has-text('{sub}')")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        page.screenshot(path=f"e2e-workspace-{sub.lower()}.png", full_page=True)

    page.click("nav button:has-text('Overview')")
    page.wait_for_timeout(300)
    page.screenshot(path="e2e-overview.png", full_page=True)
    page.click("nav button:has-text('Cleanup')")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    page.screenshot(path="e2e-cleanup.png", full_page=True)
    browser.close()

print("console errors:", errors if errors else "없음")
