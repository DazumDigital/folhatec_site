import { expect, test } from "@playwright/test";
import { ALL_ROUTES } from "./helpers";

/**
 * Conteúdo renderizado sem Sanity (fallback local): Home, Empresa,
 * provas de autoridade desativadas e ausência de textos internos.
 */

/** Termos técnicos/internos que nunca devem aparecer para o visitante. */
const INTERNAL_TEXT = [
  /fallback/i,
  /\bsanity\b/i,
  /\bmock\b/i,
  /\bstub\b/i,
  /preencher depois/i,
  /conteúdo pendente/i,
  /pendente de validação/i,
  /\bFIXME\b/,
  /\bXXX\b/,
  /dataLayer/,
  /\{\{|\}\}/,
];

test.describe("Home com fallback", () => {
  test("hero, CTAs e seções editoriais do fallback", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Soluções em etiquetas e identificação para sua");
    await expect(page.locator("h1")).toContainText("operação não parar.");
    const main = page.locator("main");
    await expect(main.getByRole("link", { name: "Solicitar cotação" }).first()).toBeVisible();
    await expect(main.getByRole("link", { name: "Falar com um especialista" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Uma etiqueta pode parecer um detalhe. Na operação, ela não é." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Conhecimento aplicado à operação." })).toBeVisible();
  });
});

test.describe("Empresa com fallback", () => {
  test("seções aprovadas visíveis; história e estrutura ocultas", async ({ page }) => {
    await page.goto("/empresa");
    await expect(page.locator("h1")).toHaveText("Parceira técnica para a identificação da sua operação.");
    await expect(page.getByRole("heading", { name: "A conversa começa pela aplicação." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compromisso com o que foi combinado." })).toBeVisible();
    await expect(page.locator("#historia")).toHaveCount(0);
    await expect(page.locator("#estrutura")).toHaveCount(0);
    // Nenhum ano, data ou número institucional inventado.
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(text).not.toMatch(/\d+\s*anos/i);
  });
});

test.describe("Provas de autoridade desativadas", () => {
  for (const route of ["/", "/empresa"]) {
    test(`${route} não renderiza bloco de autoridade`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator("#autoridade")).toHaveCount(0);
      await expect(page.getByText(/Depoimentos|Certificações|Empresas atendidas/)).toHaveCount(0);
    });
  }
});

test("nenhum texto técnico interno visível nas páginas públicas", async ({ page }) => {
  test.setTimeout(90_000);
  for (const route of [...ALL_ROUTES, "/rota-inexistente"]) {
    await page.goto(route);
    const text = await page.locator("body").innerText();
    for (const pattern of INTERNAL_TEXT) {
      expect(text, `texto interno ${pattern} em ${route}`).not.toMatch(pattern);
    }
  }
});

test.describe("Segmentos incluídos a pedido do cliente", () => {
  const NEW_SEGMENTS = [
    { slug: "vidros", title: "Indústria de vidros", image: "segmento-vidros" },
    { slug: "hospitais-laboratorios", title: "Hospitais e laboratórios", image: "segmento-hospitais-laboratorios" },
    { slug: "criogenia", title: "Criogenia", image: "segmento-criogenia" },
    { slug: "eletroeletronico", title: "Eletroeletrônico", image: "segmento-eletroeletronico" },
  ];

  test("cards na listagem com imagem própria e link para a página", async ({ page }) => {
    await page.goto("/segmentos");
    for (const segment of NEW_SEGMENTS) {
      const card = page.locator("article", { hasText: segment.title }).first();
      await expect(card.locator("img")).toHaveAttribute("src", new RegExp(`${segment.image}\.jpg`));
      await expect(card.getByRole("link", { name: new RegExp(segment.title) }).first()).toHaveAttribute("href", `/segmentos/${segment.slug}`);
    }
  });

  for (const segment of NEW_SEGMENTS) {
    test(`/segmentos/${segment.slug}: título, imagem e cotação com contexto`, async ({ page }) => {
      await page.goto(`/segmentos/${segment.slug}`);
      await expect(page.locator("h1")).toContainText(segment.title);
      await expect(page.locator("main img").first()).toHaveAttribute("src", new RegExp(`${segment.image}\.jpg`));
      await expect(page.locator(`main a[href="/solicitar-cotacao?segmento=${segment.slug}"]`).first()).toBeVisible();
    });
  }
});

test.describe("Instagram oficial", () => {
  for (const [route, scope] of [
    ["/contato", "main"],
    ["/", "footer"],
  ] as const) {
    test(`${route}: link no ${scope === "main" ? "conteúdo" : "rodapé"}, em nova aba e com rel seguro`, async ({ page }) => {
      await page.goto(route);
      const links = page.locator(`${scope} a[href="https://www.instagram.com/folhatec/"]`);
      await expect(links).toHaveCount(1);
      await expect(links).toHaveText("@folhatec");
      await expect(links).toHaveAttribute("target", "_blank");
      await expect(links).toHaveAttribute("rel", "noopener noreferrer");
      await expect(links).toHaveAccessibleName(/Instagram da FolhaTec/);
    });
  }
});
