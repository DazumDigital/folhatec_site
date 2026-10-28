# Infraestrutura

## Ambientes

| Ambiente    | `NEXT_PUBLIC_SITE_ENV` | Indexação | Sem canal de entrega (e-mail/webhook) |
| ----------- | ---------------------- | --------- | ---------------------- |
| Local       | `development`          | noindex   | stub (nada enviado)    |
| Staging     | `staging`              | noindex   | stub                   |
| Preview Vercel | qualquer            | **sempre noindex** (`VERCEL_ENV=preview`) | conforme env |
| Produção    | `production`           | index     | **erro 503**           |

Em produção, `NEXT_PUBLIC_SITE_URL` é obrigatória (https, não local). Sem ela o
build falha — verificado por `tests/e2e/production.spec.ts`, que faz um build
real em `.next-prod-check` (via `NEXT_DIST_DIR`).

## Envio das cotações por e-mail (Resend)

Canal principal de entrega (`src/features/quote/server/email.ts`), chamado
pela rota `POST /api/quote` depois de todas as validações.

| Variável | Tipo | Valor |
| --- | --- | --- |
| `RESEND_API_KEY` | secret (server) | chave da API do Resend, permissão "Sending access" |
| `QUOTE_EMAIL_FROM` | config | remetente num domínio verificado, ex. `Site FolhaTec <site@folhatec.com.br>` |
| `QUOTE_EMAIL_TO` | config (opcional) | padrão `folhatec@folhatec.com.br` |

- Mensagem: assunto `Nova solicitação de cotação | FolhaTec`, HTML + texto,
  só com os campos preenchidos (nome, empresa, e-mail, telefone, solução,
  segmento, mensagem, data/hora de Brasília, página de envio, entrada no
  site, referrer, campanha, consentimento).
- `Reply-To` = e-mail do solicitante; o remetente é sempre o domínio
  verificado (o e-mail do visitante nunca é usado como remetente).
- Sucesso (`form_success`) só após o Resend aceitar a mensagem (HTTP 200).
  Recusa, 5xx, timeout (8 s) ou rede → HTTP 502 e mensagem de erro no site.
  Aceite do provedor ≠ entrega na caixa de entrada (confirmar no teste real).
- `Idempotency-Key` por conteúdo + minuto: reenvio idêntico não duplica.
- Logs: apenas status HTTP e tipo de erro do provedor; sem dados pessoais.
- Webhook (abaixo) pode coexistir: o e-mail decide o resultado; falha do
  webhook só é registrada.

### Domínio do remetente (DNS)

O Resend só envia para terceiros a partir de um domínio verificado. O DNS de
`folhatec.com.br` está na Locaweb (e-mail também na Locaweb; SPF
`include:_spf.locaweb.com.br`; DMARC `p=none`). Domínio cadastrado no Resend
(conta `dazumdigital`, região São Paulo, envio ativo, recebimento desativado).
A verificação adiciona três registros **novos** — nenhum desses nomes existe
hoje no DNS e o MX/SPF do domínio raiz não mudam:

| Tipo | Nome (host) | Finalidade |
| --- | --- | --- |
| TXT | `resend._domainkey` | DKIM — assinatura que autentica os e-mails como `folhatec.com.br` |
| CNAME | `rsend` | Envio (SPF/retorno) delegado ao Resend |
| CNAME | `send` | Envio (SPF/retorno) delegado ao Resend |

Valores: copiar pelo botão de cópia do painel (Domains → folhatec.com.br),
exatamente como exibidos; TTL padrão/Auto. Sem proxy em CNAME.

### Configuração inválida

Se `RESEND_API_KEY`/`QUOTE_EMAIL_FROM` (ou `QUOTE_WEBHOOK_URL` sem e-mail)
estiverem presentes mas incompletos/inválidos, a API responde 503 em qualquer
ambiente e o site mostra erro — nunca o stub silencioso de homologação.

### Anti-abuso

Honeypot (`website`), validação server-side, JSON-only, limite de 16 KB,
contexto validado, recusa de `Origin` de outro site (HTTP 403) e
idempotência no envio. Rate limit persistente continua pendente
(`rate-limit.ts`): recomendado antes de campanhas, pois o plano gratuito do
Resend tem cota diária.

## Webhook de cotação (opcional)

- `QUOTE_WEBHOOK_URL`: endpoint HTTPS que recebe o lead (CRM, automação,
  e-mail transacional, planilha etc.).
- `QUOTE_WEBHOOK_SECRET`: se definido, o corpo é assinado com HMAC SHA-256 no
  header `x-folhatec-signature: sha256=<hex>`. O receptor deve recalcular a
  assinatura sobre o corpo bruto e comparar em tempo constante.
- Timeout: 8 s (`WEBHOOK_TIMEOUT_MS`). Resposta 2xx = entregue.
- Logs nunca contêm dados pessoais nem credenciais.

Payload (`QuoteLead`):

```json
{
  "submitted_at": "2026-09-25T13:00:00.000Z",
  "site": { "url": "https://…", "env": "production" },
  "contact": { "name": "…", "company": "…", "phone": "…", "email": "…" },
  "message": "…",
  "context": { "solution": "etiquetas", "segment": "alimentos" },
  "consent": { "privacy_policy": true, "accepted_at": "…" },
  "attribution": {
    "first_touch": { "utm_source": "…", "landing_page": "…", "referrer": null, "client_captured_at": "…" },
    "last_touch": { "…": "…" },
    "origin_url": "…",
    "conversion_page": "…",
    "referrer": null
  }
}
```

## Rate limit — PENDÊNCIA DE PRODUÇÃO

`src/features/quote/server/rate-limit.ts` define a interface `RateLimiter`. Não
há implementação em memória: em serverless cada instância tem memória própria,
então um `Map()` não protege de fato.

Antes do go-live, implementar com um provider persistente (ex.: Upstash Redis
/ Vercel Marketplace) — sugestão: 5 envios / 10 min por hash de IP — e
retorná-lo em `getRateLimiter()`. Até lá, a proteção é honeypot + validação
server-side + limite de tamanho. A ausência do provider não impede
desenvolvimento nem testes.

## Sanity

- Frontend: `@sanity/client` com `perspective: "published"`, CDN quando não há
  token, `next.revalidate = 300` e tags `sanity`, `solution`, `segment`, `homePage`, `companyPage`,
  `article`, `siteSettings`, `authoritySettings` e tipos de autoridade (prontas para revalidação on-demand via webhook
  do Sanity → `revalidateTag`, a implementar se necessário).
- Imagens servidas de `cdn.sanity.io` por `next/image` (AVIF/WebP).
- Studio: pacote separado em `sanity/`.

## Headers de segurança

Definidos em `next.config.ts`. **CSP — PENDÊNCIA DE PRODUÇÃO**: definir após
escolher as ferramentas de tracking (GTM exige nonce ou hashes para scripts
inline).

## Cookies / LGPD — PENDÊNCIA DE PRODUÇÃO

Nenhum tracker carrega sem IDs configurados e o formulário exige
consentimento. Não há cookie banner genérico: antes de ativar GTM/GA4/Ads/Meta
Pixel reais, definir o mecanismo de consentimento (ex.: Consent Mode v2) e
atualizar a Política de Privacidade.

## Deploy na Vercel

1. Node 24; build `npm run build`; framework Next.js.
2. Variáveis por ambiente (Production / Preview) conforme tabela acima.
3. Domínio final → `NEXT_PUBLIC_SITE_URL` (sem barra final).
4. Redirects 301 do site antigo em `next.config.ts` (`redirects()`), após o
   inventário de URLs (ver `go-live-checklist.md`).

## Git

O `.gitignore` exclui `node_modules`, `.next`, `out`, `.env*`, `.vercel`,
relatórios de teste e `*.tsbuildinfo`. Não usar Git LFS para build ou
dependências — esses arquivos nunca entram no repositório.
