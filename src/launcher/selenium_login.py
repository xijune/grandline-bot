#!/usr/bin/env python3
"""
GrandLine Online - Launcher Selenium
Login automatique + injection du bot + démarrage du farm.
"""

# Windows console: force UTF-8 to avoid UnicodeEncodeError on arrows/emoji
import sys as _sys
if hasattr(_sys.stdout, "reconfigure"):
    try:
        _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        _sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


import time
import os
import sys
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

# ============================================================
# CONFIG
# ============================================================
EMAIL = os.getenv("GL_EMAIL", "")
PASSWORD = os.getenv("GL_PASSWORD", "")
if not EMAIL or not PASSWORD:
    print("ERR Définis GL_EMAIL et GL_PASSWORD (variables d'environnement).")
    print("   Exemple : export GL_EMAIL=ton_pseudo GL_PASSWORD=ton_mdp")
    sys.exit(1)

HEADLESS = False
IMPLICIT_WAIT = 10
PAGE_LOAD_TIMEOUT = 30

# Chemin vers le script injectable
ROOT = Path(__file__).resolve().parents[2]
INJECT_SCRIPT = ROOT / "src" / "inject" / "glbot.js"


def create_driver(headless: bool = False) -> webdriver.Chrome:
    options = Options()
    if headless:
        options.add_argument("--headless=new")

    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1400,900")
    options.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    )

    driver = webdriver.Chrome(options=options)
    driver.execute_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT)
    return driver


def wait_and_click(driver, by, value, timeout=15, desc=""):
    try:
        el = WebDriverWait(driver, timeout).until(
            EC.element_to_be_clickable((by, value))
        )
        el.click()
        if desc:
            print(f"  -> {desc}")
        return True
    except TimeoutException:
        print(f"  WARN️ Timeout : {desc or value}")
        return False


def login(driver, email: str, password: str) -> bool:
    print("-> Ouverture de GrandLine Online...")
    driver.get("https://grandline-online.fr/")

    wait = WebDriverWait(driver, 20)

    try:
        email_input = wait.until(EC.presence_of_element_located((By.NAME, "email")))
        password_input = driver.find_element(By.NAME, "password")
    except TimeoutException:
        print("ERR Formulaire de login introuvable")
        return False

    # Remplissage robuste (SPA)
    driver.execute_script(
        """
        arguments[0].value = arguments[1];
        arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
        arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
        """,
        email_input,
        email,
    )
    driver.execute_script(
        """
        arguments[0].value = arguments[1];
        arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
        arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
        """,
        password_input,
        password,
    )

    # Se souvenir de moi (JS — évite ElementClickIntercepted)
    try:
        remember = driver.find_element(By.NAME, "remember")
        if not remember.is_selected():
            driver.execute_script("arguments[0].click();", remember)
    except NoSuchElementException:
        pass

    print("-> Clic sur Se connecter...")
    wait_and_click(driver, By.CSS_SELECTOR, "button.embark-button", desc="Se connecter")

    # Attendre le hub
    try:
        wait.until(lambda d: "JOUER" in d.page_source or "Bukima" in d.page_source)
        print("✅ Connexion réussie")
        return True
    except TimeoutException:
        print("WARN️ Timeout après login - vérifie les identifiants")
        return False


def enter_world(driver) -> bool:
    print("-> Entrée dans le monde...")
    time.sleep(1.5)

    if not wait_and_click(driver, By.CSS_SELECTOR, "button.hub-jouer", desc="JOUER"):
        return False

    # Phaser charge — attendre la scène plutôt que cliquer des modales fragile
    t0 = time.time()
    while time.time() - t0 < 45:
        try:
            ok = driver.execute_script(
                "return !!(window.__grandlineScene && window.__grandlineScene.character)"
            )
            if ok:
                break
        except Exception:
            pass
        # fermer popups en JS (évite tab crash Selenium click)
        try:
            driver.execute_script(
                """
                for (const b of document.querySelectorAll('button')) {
                  const t = (b.innerText || '').trim();
                  if (/passer le guide|continuer|fermer|je reste|retour au jeu|^×$|^x$/i.test(t)) {
                    try { b.click(); } catch (e) {}
                  }
                }
                document.querySelectorAll('button.modal-close').forEach(b => { try { b.click(); } catch(e){} });
                """
            )
        except Exception:
            pass
        time.sleep(0.6)

    time.sleep(1)
    try:
        ok = driver.execute_script(
            "return !!(window.__grandlineScene && window.__grandlineScene.character)"
        )
    except Exception:
        ok = False
    if ok:
        print("OK En jeu (scene)")
        return True
    print("WARN scene pas encore prête")
    return False



def inject_bot(driver) -> bool:
    if not INJECT_SCRIPT.exists():
        print(f"ERR Script introuvable : {INJECT_SCRIPT}")
        return False

    print(f"-> Injection de {INJECT_SCRIPT.name}...")
    code = INJECT_SCRIPT.read_text(encoding="utf-8")

    try:
        driver.execute_script(code)
        time.sleep(0.8)

        # Vérifier que GLBot est bien là
        has_bot = driver.execute_script("return typeof window.GLBot !== 'undefined'")
        if has_bot:
            print("✅ GLBot injecté")
            return True
        else:
            print("WARN️ Injection terminée mais GLBot absent")
            return False
    except Exception as e:
        print(f"ERR Erreur injection : {e}")
        return False


def start_farm(driver):
    print("-> Démarrage du farm...")
    try:
        driver.execute_script("window.GLBot && window.GLBot.startFarm()")
        print("✅ Farm lancé")
    except Exception as e:
        print(f"WARN️ Impossible de lancer le farm : {e}")


def main():
    print("=" * 50)
    print(" GrandLine Bot - Launcher")
    print("=" * 50)

    driver = create_driver(headless=HEADLESS)

    try:
        if not login(driver, EMAIL, PASSWORD):
            driver.quit()
            sys.exit(1)

        if not enter_world(driver):
            print("WARN️ Impossible d'entrer dans le monde")
            # on continue quand même au cas où on est déjà en jeu

        if not inject_bot(driver):
            print("Tu peux coller manuellement src/inject/glbot.js dans la console")
        else:
            start_farm(driver)

        print("\n-> Bot en cours. Laisse cette fenêtre ouverte.")
        print("-> Appuie sur Entrée ici pour fermer le navigateur.\n")
        input()

    except KeyboardInterrupt:
        print("\nArrêt demandé")
    finally:
        try:
            driver.execute_script("window.GLBot && window.GLBot.stopFarm()")
        except Exception:
            pass
        driver.quit()
        print("Navigateur fermé")


if __name__ == "__main__":
    main()
