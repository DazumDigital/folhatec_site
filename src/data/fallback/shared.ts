import type { ContentImage, LabeledValue, SeoFields } from "@/types/content";

export const emptySeo: SeoFields = {
  title: null,
  description: null,
  ogImage: null,
  noIndex: false,
};

/**
 * Pilares de atendimento aprovados no briefing (seção "Pilares da marca").
 * Reutilizados como "Diferencial FolhaTec" nas páginas de solução/segmento.
 */
export const serviceDifferentiators: LabeledValue[] = [
  {
    label: "Conhecimento técnico",
    description:
      "Entender materiais, aplicações e particularidades antes de indicar uma solução.",
  },
  {
    label: "Compromisso com prazo e qualidade",
    description: "Cumprir aquilo que foi acordado e entregar o que foi especificado.",
  },
  {
    label: "Atendimento próximo",
    description:
      "Relação consultiva, com entendimento da operação e das demandas do cliente.",
  },
];

/**
 * Imagem ilustrativa (gerada por IA e aprovada pelo cliente) dos cards e
 * páginas de soluções e segmentos — créditos em docs/image-credits.md.
 */
export function illustration(file: string, alt: string, width: number, height: number): ContentImage {
  return { url: `/images/${file}.jpg`, alt, width, height, blurDataUrl: null };
}
