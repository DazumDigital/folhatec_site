import { expect, test, type Page } from "@playwright/test";
import { SEGMENT_SLUGS } from "./helpers";

test.describe("Header desktop", () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test("exibe links principais, CTA e navegações sem ambiguidade", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav).toBeVisible();
    for (const label of ["Empresa", "Segmentos", "Conteúdos", "Contato"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole("button", { name: "Soluções" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Solicitar cotação" })).toBeVisible();

    // Menu mobile existe no DOM, mas oculto no desktop.
    await expect(page.getByRole("navigation", { name: "Navegação mobile" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Abrir menu" })).toBeHidden();
  });

  test("dropdown de Soluções abre com mouse (hover) e fecha ao sair", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: "Soluções" });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.hover();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const menu = page.locator("#menu-solucoes");
    await expect(menu.getByRole("link", { name: /Etiquetas/ })).toBeVisible();
    await page.mouse.move(10, 600);
    await expect(menu).toBeHidden();
  });

  test("dropdown funciona por clique e navega", async ({ page }) => {
    await page.goto("/");
    await page.mouse.move(10, 600);
    const button = page.getByRole("button", { name: "Soluções" });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.locator("#menu-solucoes").getByRole("link", { name: /Ribbons/ }).click();
    await expect(page).toHaveURL(/\/solucoes\/ribbons$/);
    await expect(page.locator("h1")).toHaveText("Ribbons");
    await expect(page.locator("#menu-solucoes")).toHaveCount(0);
  });

  test("dropdown funciona por teclado: seta abre, Tab percorre, Escape fecha e devolve foco", async ({ page }) => {
    await page.goto("/");
    await page.mouse.move(10, 600);
    const button = page.getByRole("button", { name: "Soluções" });
    await button.focus();
    await page.keyboard.press("ArrowDown");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#menu-solucoes a").first()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#menu-solucoes a").nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
  });

  test("dropdown fecha quando o foco sai dele", async ({ page }) => {
    await page.goto("/");
    await page.mouse.move(10, 600);
    const button = page.getByRole("button", { name: "Soluções" });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const count = await page.locator("#menu-solucoes a").count();
    for (let i = 0; i <= count; i += 1) await page.keyboard.press("Tab");
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("link ativo marcado com aria-current", async ({ page }) => {
    await page.goto("/empresa");
    await expect(
      page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Empresa", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("skip link leva ao conteúdo principal", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#conteudo$/);
  });
});

test.describe("Menu mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("abre/fecha com aria, foco, Escape e bloqueio de scroll", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeHidden();

    const toggle = page.getByRole("button", { name: "Abrir menu" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-controls", "menu-mobile");

    await toggle.click();
    const close = page.getByRole("button", { name: "Fechar menu" });
    await expect(close).toHaveAttribute("aria-expanded", "true");
    const mobileNav = page.getByRole("navigation", { name: "Navegação mobile" });
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Empresa" })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(mobileNav).toBeHidden();
    await expect(page.getByRole("button", { name: "Abrir menu" })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("clique em link fecha o menu e navega", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Abrir menu" }).click();
    const mobileNav = page.getByRole("navigation", { name: "Navegação mobile" });
    await mobileNav.getByRole("link", { name: "Etiquetas" }).click();
    await expect(page).toHaveURL(/\/solucoes\/etiquetas$/);
    await expect(mobileNav).toBeHidden();
    await expect(page.getByRole("button", { name: "Abrir menu" })).toHaveAttribute("aria-expanded", "false");
  });

  test("foco fica contido entre botão e itens do menu", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Abrir menu" });
    await toggle.click();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Fechar menu" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    const focusedInsideMenu = await page.evaluate(() => Boolean(document.activeElement?.closest("#menu-mobile")));
    expect(focusedInsideMenu).toBe(true);
  });

  test("botão fecha o menu", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Abrir menu" }).click();
    await page.getByRole("button", { name: "Fechar menu" }).click();
    await expect(page.getByRole("navigation", { name: "Navegação mobile" })).toBeHidden();
  });
});

test.describe("Rodapé: Segmentos em accordion", () => {
  const footerNav = (page: Page) => page.getByRole("navigation", { name: "Institucional no rodapé" });

  test("começa recolhido; clique expande todos os segmentos e recolhe de novo", async ({ page }) => {
    await page.goto("/");
    const nav = footerNav(page);
    const toggle = nav.getByRole("button", { name: "Segmentos" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const list = nav.locator(`#${await toggle.getAttribute("aria-controls")}`);
    await expect(list).toBeHidden();
    // Demais links da navegação continuam visíveis.
    for (const label of ["Empresa", "Conteúdos", "Contato"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(list).toBeVisible();
    await expect(list.getByRole("link")).toHaveCount(1 + SEGMENT_SLUGS.length);
    await expect(list.getByRole("link", { name: "Ver todos os segmentos" })).toHaveAttribute("href", "/segmentos");
    for (const slug of SEGMENT_SLUGS) {
      await expect(list.locator(`a[href="/segmentos/${slug}"]`)).toBeVisible();
    }

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(list).toBeHidden();
  });

  test("teclado: Enter abre, Tab entra na lista, Espaço recolhe", async ({ page }) => {
    await page.goto("/");
    const toggle = footerNav(page).getByRole("button", { name: "Segmentos" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveAttribute("href", "/segmentos");
    await toggle.focus();
    await page.keyboard.press(" ");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("Rodapé: accordion no mobile (toque)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("toque abre a lista e navega para um segmento novo", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Institucional no rodapé" });
    const toggle = nav.getByRole("button", { name: "Segmentos" });
    await toggle.scrollIntoViewIfNeeded();
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await nav.getByRole("link", { name: "Criogenia" }).tap();
    await expect(page).toHaveURL(/\/segmentos\/criogenia$/);
  });
});
