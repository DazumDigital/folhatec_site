import type { Metadata } from "next";
import { IS_INDEXABLE, absoluteUrl } from "@/lib/config/env";
import type { ContentImage, SeoFields } from "@/types/content";

export const SITE_NAME = "FolhaTec";

/**
 * Imagem de compartilhamento padrão (WhatsApp, LinkedIn, Facebook, X) para
 * páginas sem imagem própria. 1200×630 (1,91:1), recortada da foto aprovada
 * do hero (impressora imprimindo etiquetas). Soluções, segmentos e artigos
 * continuam usando a própria imagem. URL relativa: o Next a torna absoluta
 * com o `metadataBase` do layout.
 */
export const DEFAULT_SHARE_IMAGE: ContentImage = {
  url: "/og/folhatec-compartilhamento.jpg",
  alt: "Impressora térmica imprimindo etiquetas com código de barras — FolhaTec",
  width: 1200,
  height: 630,
  blurDataUrl: null,
};

/**
 * Metadata da página 404. O Next injeta <meta name="robots" content="noindex">
 * automaticamente; `robots: null` remove o valor herdado do layout para não
 * duplicar a tag. Usada no not-found e nas rotas dinâmicas sem conteúdo.
 */
export const NOT_FOUND_METADATA: Metadata = {
  title: "Página não encontrada",
  description: "A página que você procura não existe ou foi movida.",
  robots: null,
};

interface BuildMetadataInput {
  title: string;
  description: string;
  /** Caminho canônico, ex.: "/solucoes/etiquetas". */
  path: string;
  seo?: SeoFields | null;
  image?: ContentImage | null;
  type?: "website" | "article";
  publishedTime?: string | null;
  modifiedTime?: string | null;
  /** Título já completo (sem o sufixo " | FolhaTec"). */
  absoluteTitle?: boolean;
}

/**
 * Metadata padrão de página pública: title, description, canonical absoluto,
 * Open Graph, Twitter e robots conforme ambiente.
 * Campos SEO do CMS (quando existirem) têm precedência.
 */
export function buildMetadata(input: BuildMetadataInput): Metadata {
  const title = input.seo?.title ?? input.title;
  const description = input.seo?.description ?? input.description;
  const url = absoluteUrl(input.path);
  const ogImage = input.seo?.ogImage ?? input.image ?? DEFAULT_SHARE_IMAGE;
  const index = IS_INDEXABLE && !input.seo?.noIndex;

  return {
    title: input.absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: input.type ?? "website",
      locale: "pt_BR",
      siteName: SITE_NAME,
      url,
      title,
      description,
      images: [{ url: ogImage.url, width: ogImage.width, height: ogImage.height, alt: ogImage.alt }],
      ...(input.type === "article" && input.publishedTime
        ? { publishedTime: input.publishedTime, modifiedTime: input.modifiedTime ?? undefined }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
  };
}
