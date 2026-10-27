import type { Segment } from "@/types/content";
import { emptySeo, illustration, serviceDifferentiators } from "./shared";

/**
 * Segmentos citados no briefing (seção 8) e, a partir de `vidros`, os
 * incluídos a pedido do cliente (27/10/2026). Desafios descrevem a
 * abordagem consultiva; nenhum cliente, número, norma, resistência ou faixa
 * de temperatura é citado — esses dados dependem de validação da FolhaTec.
 */
export const fallbackSegments: Segment[] = [
  {
    slug: "alimentos",
    title: "Alimentos e pescados",
    shortDescription:
      "Identificação para operações com umidade, refrigeração, grandes volumes e prazos curtos.",
    description:
      "Em alimentos, pescados e frigoríficos, a identificação acompanha processos com umidade, refrigeração e grandes volumes, muitas vezes com janelas curtas de expedição. A etiqueta representa um custo pequeno na operação, mas a sua falta pode impedir a liberação do produto.",
    image: illustration("segmento-alimentos", "Linha de embalagem de alimentos com bandejas identificadas por etiquetas com código de barras", 1536, 1024),
    visual: "food",
    challenges: [
      { label: "Umidade", description: "Etiquetas que precisam se manter aplicadas e legíveis em ambientes úmidos." },
      { label: "Refrigeração", description: "Aplicação e permanência em produtos resfriados ou congelados." },
      { label: "Rastreabilidade", description: "Informações de lote e origem acompanhando o produto." },
      { label: "Grandes volumes", description: "Fornecimento compatível com o ritmo da produção." },
      { label: "Prazos curtos", description: "Demandas inesperadas que não podem parar a expedição." },
    ],
    applications: [
      { label: "Identificação de produtos", description: null },
      { label: "Controle de lotes", description: null },
      { label: "Expedição", description: null },
    ],
    relatedSolutionSlugs: ["etiquetas", "ribbons", "equipamentos", "solucoes-especiais"],
    differentiators: serviceDifferentiators,
    faq: [],
    whatsappMessage:
      "Olá, vim pelo site da FolhaTec e gostaria de falar sobre identificação para alimentos e pescados.",
    order: 1,
    updatedAt: null,
    seo: {
      ...emptySeo,
      title: "Identificação para alimentos e pescados",
      description:
        "Etiquetas e soluções de identificação para operações de alimentos, pescados e frigoríficos, com umidade, refrigeração e prazos curtos.",
    },
  },
  {
    slug: "logistica",
    title: "Logística e transporte",
    shortDescription:
      "Identificação para expedição, rastreamento e leitura de códigos ao longo do transporte.",
    description:
      "Na logística e no transporte, a identificação acompanha o volume em diferentes etapas: separação, expedição, transporte e recebimento. A especificação precisa considerar a leitura dos códigos e as condições a que a etiqueta estará exposta no caminho.",
    image: illustration("segmento-logistica", "Paletes com caixas etiquetadas em centro de distribuição", 1536, 1024),
    visual: "logistics",
    challenges: [
      { label: "Identificação de volumes", description: "Informação clara em cada etapa do fluxo." },
      { label: "Rastreamento", description: "Acompanhamento do volume do envio ao recebimento." },
      { label: "Expedição", description: "Etiquetagem no ritmo da separação de pedidos." },
      { label: "Códigos de barras", description: "Impressão com leitura confiável." },
      { label: "Resistência no transporte", description: "Atrito, manuseio e variação de ambiente." },
    ],
    applications: [
      { label: "Etiquetagem de volumes", description: null },
      { label: "Expedição e recebimento", description: null },
      { label: "Leitura de códigos", description: null },
    ],
    relatedSolutionSlugs: ["etiquetas", "ribbons", "equipamentos"],
    differentiators: serviceDifferentiators,
    faq: [],
    whatsappMessage:
      "Olá, vim pelo site da FolhaTec e gostaria de falar sobre identificação para logística.",
    order: 2,
    updatedAt: null,
    seo: {
      ...emptySeo,
      title: "Identificação para logística e transporte",
      description:
        "Etiquetas e soluções de identificação para expedição, rastreamento e leitura de códigos em operações de logística e transporte.",
    },
  },
  {
    slug: "quimico",
    title: "Químico",
    shortDescription:
      "Identificação para ambientes agressivos e processos com requisitos técnicos específicos.",
    description:
      "Aplicações do setor químico podem envolver ambientes agressivos, contato com produtos e requisitos técnicos particulares. A especificação parte das condições reais do processo para indicar uma identificação que permaneça legível e aplicada.",
    image: illustration("segmento-quimico", "Tambores e contêineres químicos identificados com etiquetas de lote", 1536, 1024),
    visual: "chemical",
    challenges: [
      { label: "Resistência", description: "Identificação que suporta as condições do processo." },
      { label: "Ambientes agressivos", description: "Exposição a produtos e condições severas." },
      { label: "Requisitos técnicos", description: "Especificação alinhada às exigências da aplicação." },
      { label: "Identificação", description: "Informação legível durante todo o ciclo do produto." },
    ],
    applications: [
      { label: "Identificação de produtos", description: null },
      { label: "Controle de processo", description: null },
    ],
    relatedSolutionSlugs: ["etiquetas", "ribbons", "solucoes-especiais"],
    differentiators: serviceDifferentiators,
    faq: [],
    whatsappMessage:
      "Olá, vim pelo site da FolhaTec e gostaria de falar sobre identificação para o setor químico.",
    order: 3,
    updatedAt: null,
    seo: {
      ...emptySeo,
      title: "Identificação para a indústria química",
      description:
        "Soluções de identificação para ambientes agressivos e processos químicos com requisitos técnicos específicos.",
    },
  },
  {
    slug: "industria",
    title: "Indústria",
    shortDescription:
      "Identificação para borracha, plásticos e demais operações industriais.",
    description:
      "A indústria reúne cenários muito diferentes entre si. Por isso, a conversa começa pela aplicação, pelas condições de uso e pelo objetivo da identificação — seja em produção, estoque ou expedição.",
    image: illustration("segmento-industria", "Peças metálicas identificadas com etiquetas de lote em linha de produção", 1536, 1024),
    visual: "industry",
    challenges: [
      { label: "Processos diferentes", description: "Cada linha tem suas próprias condições de uso." },
      { label: "Identificação", description: "Produtos, componentes e volumes identificados com clareza." },
      { label: "Rastreabilidade", description: "Informação que acompanha o produto no processo." },
      { label: "Aplicações específicas", description: "Demandas que exigem uma solução sob medida." },
    ],
    applications: [
      { label: "Produção", description: null },
      { label: "Estoque", description: null },
      { label: "Expedição", description: null },
    ],
    relatedSolutionSlugs: ["etiquetas", "ribbons", "equipamentos", "solucoes-especiais"],
    differentiators: serviceDifferentiators,
    faq: [],
    whatsappMessage:
      "Olá, vim pelo site da FolhaTec e gostaria de falar sobre identificação para a minha indústria.",
    order: 4,
    updatedAt: null,
    seo: {
      ...emptySeo,
      title: "Identificação para operações industriais",
      description:
        "Soluções de identificação para borracha, plásticos e demais operações industriais, a partir da aplicação e das condições de uso.",
    },
  },
  {
    slug: "vidros",
    title: "Indústria de vidros",
    shortDescription:
      "Identificação para produção, movimentação e controle de chapas, peças e lotes de vidro.",
    description:
      "Na indústria de vidros, a identificação acompanha chapas, peças e lotes da produção à expedição, passando pela movimentação interna e pela armazenagem. A especificação considera a superfície, o manuseio e a etapa do processo em que a etiqueta será aplicada, para que a informação permaneça legível e rastreável.",
    image: illustration("segmento-vidros", "Chapas de vidro identificadas com etiqueta de lote em linha de produção", 1448, 1086),
    visual: "industry",
    challenges: [
      { label: "Rastreabilidade de lotes", description: "Informação de lote acompanhando chapas e peças no processo." },
      { label: "Movimentação interna", description: "Identificação clara durante transporte, armazenagem e separação." },
      { label: "Superfície de aplicação", description: "Avaliação da superfície e do momento em que a etiqueta é aplicada." },
      { label: "Organização do estoque", description: "Peças e chapas fáceis de localizar e conferir." },
    ],
    applications: [
      { label: "Identificação de chapas e peças", description: null },
      { label: "Controle de lotes", description: null },
      { label: "Expedição", description: null },
    ],
    relatedSolutionSlugs: ["etiquetas", "ribbons", "equipamentos", "solucoes-especiais"],
    differentiators: serviceDifferentiators,
    faq: [],
    whatsappMessage:
      "Olá, vim pelo site da FolhaTec e gostaria de falar sobre identificação para a indústria de vidros.",
    order: 5,
    updatedAt: null,
    seo: {
      ...emptySeo,
      title: "Identificação para a indústria de vidros",
      description:
        "Soluções de identificação e rastreabilidade para produção, movimentação e controle de chapas, peças e lotes na indústria de vidros.",
    },
  },
  {
    slug: "hospitais-laboratorios",
    title: "Hospitais e laboratórios",
    shortDescription:
      "Identificação para amostras, recipientes e materiais que exigem organização e rastreabilidade.",
    description:
      "Em hospitais e laboratórios, a identificação ajuda a organizar amostras, recipientes e materiais e a manter a rastreabilidade ao longo dos processos. A especificação parte do tipo de recipiente, do manuseio e das condições de armazenamento de cada operação; requisitos específicos são levantados antes da indicação de qualquer solução.",
    image: illustration("segmento-hospitais-laboratorios", "Tubos de amostras de laboratório identificados com etiquetas e códigos", 1927, 816),
    visual: "labels",
    challenges: [
      { label: "Identificação de amostras", description: "Informação clara em cada recipiente." },
      { label: "Rastreabilidade", description: "Registro que acompanha a amostra ou o material ao longo do processo." },
      { label: "Organização", description: "Materiais e recipientes fáceis de localizar e conferir." },
      { label: "Leitura de códigos", description: "Impressão legível para leitura confiável." },
    ],
    applications: [
      { label: "Identificação de amostras", description: null },
      { label: "Recipientes e materiais", description: null },
      { label: "Controle de estoque", description: null },
    ],
    relatedSolutionSlugs: ["etiquetas", "ribbons", "equipamentos", "solucoes-especiais"],
    differentiators: serviceDifferentiators,
    faq: [],
    whatsappMessage:
      "Olá, vim pelo site da FolhaTec e gostaria de falar sobre identificação para hospitais e laboratórios.",
    order: 6,
    updatedAt: null,
    seo: {
      ...emptySeo,
      title: "Identificação para hospitais e laboratórios",
      description:
        "Soluções de identificação para amostras, recipientes e materiais em hospitais e laboratórios, com foco em organização e rastreabilidade.",
    },
  },
  {
    slug: "criogenia",
    title: "Criogenia",
    shortDescription:
      "Identificação e rastreabilidade de materiais em armazenamento e processos criogênicos.",
    description:
      "Em operações criogênicas, a identificação acompanha materiais e recipientes armazenados por longos períodos, em condições muito diferentes das usuais. Por isso, a indicação de uma solução depende de avaliação técnica para cada aplicação: a conversa começa pelas condições reais de armazenamento e manuseio.",
    image: illustration("segmento-criogenia", "Frascos identificados com etiquetas em rack ao lado de um tanque criogênico", 1264, 843),
    visual: "chemical",
    challenges: [
      { label: "Condições de armazenamento", description: "Ambientes que exigem avaliação técnica antes de indicar a etiqueta." },
      { label: "Rastreabilidade", description: "Registro que acompanha o material durante todo o armazenamento." },
      { label: "Identificação de recipientes", description: "Informação legível em frascos e recipientes." },
      { label: "Leitura de códigos", description: "Impressão legível para leitura confiável." },
    ],
    applications: [
      { label: "Identificação de recipientes", description: null },
      { label: "Controle de inventário", description: null },
      { label: "Rastreabilidade de materiais", description: null },
    ],
    relatedSolutionSlugs: ["etiquetas", "ribbons", "equipamentos", "solucoes-especiais"],
    differentiators: serviceDifferentiators,
    faq: [],
    whatsappMessage:
      "Olá, vim pelo site da FolhaTec e gostaria de falar sobre identificação para operações de criogenia.",
    order: 7,
    updatedAt: null,
    seo: {
      ...emptySeo,
      title: "Identificação para criogenia",
      description:
        "Identificação e rastreabilidade de materiais e recipientes em armazenamento e processos criogênicos, a partir da avaliação de cada aplicação.",
    },
  },
  {
    slug: "eletroeletronico",
    title: "Eletroeletrônico",
    shortDescription:
      "Identificação técnica de componentes, equipamentos e conjuntos eletroeletrônicos.",
    description:
      "No setor eletroeletrônico, a identificação apoia o controle de componentes, placas, equipamentos e conjuntos ao longo da produção, dos testes e da expedição. A especificação considera o espaço disponível, a superfície e o processo de cada linha para manter a informação legível e rastreável.",
    image: illustration("segmento-eletroeletronico", "Placa eletrônica identificada com etiqueta de lote e código de barras", 1264, 843),
    visual: "equipment",
    challenges: [
      { label: "Componentes e conjuntos", description: "Identificação de placas, componentes e equipamentos montados." },
      { label: "Espaço reduzido", description: "Informação legível em áreas pequenas." },
      { label: "Rastreabilidade", description: "Registro de lote e origem ao longo da produção." },
      { label: "Controle de processo", description: "Identificação que apoia testes, montagem e expedição." },
    ],
    applications: [
      { label: "Identificação de componentes", description: null },
      { label: "Controle de produção", description: null },
      { label: "Expedição", description: null },
    ],
    relatedSolutionSlugs: ["etiquetas", "ribbons", "equipamentos", "solucoes-especiais"],
    differentiators: serviceDifferentiators,
    faq: [],
    whatsappMessage:
      "Olá, vim pelo site da FolhaTec e gostaria de falar sobre identificação para o setor eletroeletrônico.",
    order: 8,
    updatedAt: null,
    seo: {
      ...emptySeo,
      title: "Identificação para o setor eletroeletrônico",
      description:
        "Identificação técnica de componentes, placas, equipamentos e conjuntos eletroeletrônicos, apoiando o controle e a rastreabilidade dos processos.",
    },
  },
];
