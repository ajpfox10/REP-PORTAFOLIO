import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(channel="chrome", headless=False)
    context = browser.new_context()
    # (búsqueda en Google + captcha de Google: descartado)
    page.goto("https://cas.gdeba.gba.gob.ar/acceso/login/")
    # [LOGIN REDACTADO: usuario y contraseña los escribe el usuario a mano; nunca en el código]
    page.get_by_role("button", name="Acceder").click()
    page.locator("#cBsPka-cave").click()
    page.get_by_role("button", name="OK").click()
    page.get_by_role("row", name="GEDO 58 0 3 1 54 32 761 ", exact=True).get_by_role("button").click()
    page.get_by_role("button", name=" Inicio de Documento").click()
    page.get_by_role("row", name="Documento Electrónico  Descripción del tipo de documento   Libre Especial").get_by_role("textbox").click()
    page.get_by_role("row", name="Documento Electrónico  Descripción del tipo de documento   Libre Especial").get_by_role("textbox").fill("if")
    page.get_by_role("row", name="Documento Electrónico  Descripción del tipo de documento   Libre Especial").get_by_role("textbox").press("Tab")
    page.locator("#k2HP53-mask").click()
    page.locator("#k2HP_h-cave").get_by_role("textbox").press("CapsLock")
    page.locator("#k2HP_h-cave").get_by_role("textbox").fill("RENOVACION")
    page.locator("iframe[title=\"Editor de texto enriquecido, k2HPpj-cnt\"]").content_frame.locator("html").click()
    page.locator("iframe[title=\"Editor de texto enriquecido, k2HPpj-cnt\"]").content_frame.locator("body").fill("1")
    page.locator("#k2HPkk-real").fill("VSFER")
    page.close()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)
