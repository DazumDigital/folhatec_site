# Infraestrutura

## Ambientes

| Ambiente    | `NEXT_PUBLIC_SITE_ENV` | Indexação | Sem canal de entrega (SMTP/webhook) |
| ----------- | ---------------------- | --------- | ---------------------- |
| Local       | `development`          | noindex   | stub (nada enviado)    |
| Staging     | `staging`              | noindex   | stub                   |
| Preview Vercel | qualquer            | **sempre noindex** (`VERCEL_ENV=preview`) | conforme env |
| Produção    | `production`           | index     | **erro 503**           |

Em produção, `NEXT_PUBLIC_SITE_URL` é obrigatória (https, não local). Sem ela o
build falha — verificado por `tests/e2e/production.spec.ts`, que faz um build
real em `.next-prod-check` (via `NEXT_DIST_DIR`).

## Envio das cotações por e-mail (SMTP Locaweb)

Canal principal de entrega (`src/features/quote/server/email.ts`, Nodemailer),
chamado pela rota `POST /api/quote` (runtime Node.js) depois de todas as
validações. Usa a conta do E-mail Locaweb já contratada pela FolhaTec.

| Variável | Tipo | Valor (Production) |
| --- | --- | --- |
| `SMTP_HOST` | config | `email-ssl.com.br` |
| `SMTP_PORT` | config | `465` |
| `SMTP_SECURE` | config | `true` (SSL/TLS direto) |
| `SMTP_USER` | config | `folhatec@folhatec.com.br` |
| `SMTP_PASSWORD` | **secret** | senha atual da caixa — cadastrar só na Vercel |
| `QUOTE_EMAIL_FROM` | config | `FolhaTec - Site <folhatec@folhatec.com.br>` |
| `QUOTE_EMAIL_TO` | config | `folhatec@folhatec.com.br` |
| `QUOTE_ALLOWED_HOSTS` | config (opcional) | padrão: domínio de `NEXT_PUBLIC_SITE_URL` (+ www/sem www) |

- Mensagem: assunto `Nova solicitação de cotação | Site FolhaTec`, HTML +
  texto, só com os campos preenchidos (nome, empresa, e-mail, telefone,
  solução, segmento, mensagem, data/hora de Brasília, página de envio, entrada
  no site, referrer, campanha, consentimento). Conteúdo do visitante escapado.
- `From` = `FolhaTec - Site <folhatec@folhatec.com.br>` (sempre o endereço
  autenticado — configuração com outro endereço é rejeitada); `Reply-To` =
  e-mail do solicitante. O e-mail do visitante nunca é remetente.
- Sucesso ("Solicitação enviada com sucesso!" + `form_success`) só quando o
  servidor SMTP aceita o destinatário. Falha de autenticação, conexão,
  timeout, recusa → HTTP 502 e mensagem de erro com telefone/e-mail
  alternativos. Aceite SMTP ≠ entrega na caixa (confirmar no teste real).
- Timeouts: conexão 8 s, saudação 8 s, inatividade 12 s, teto total 20 s
  (padrões do Nodemailer seriam de minutos). `maxDuration` da rota: 30 s.
- Duplicidade: trava no navegador + memória por instância (envio idêntico no
  mesmo minuto é entregue uma vez) + `Message-ID` estável por conteúdo.
- Logs: apenas o tipo/código do erro SMTP; sem dados pessoais nem senha.
- Webhook (abaixo) pode coexistir: o e-mail decide o resultado; falha do
  webhook só é registrada. Sem necessidade, deixe `QUOTE_WEBHOOK_URL` vazio.

### Hosts autorizados

O deploy de produção responde em `www.folhatec.com.br`, `folhatec.com.br`
(308 → www) e `folhatec-v3.vercel.app`. O envio real só ocorre nos hosts
autorizados — por padrão o host de `NEXT_PUBLIC_SITE_URL` e sua variante
com/sem `www`. Em outro host a API responde `stub` e o site informa
"Solicitação não enviada" com os canais alternativos. **Por isso
`NEXT_PUBLIC_SITE_URL` precisa ser `https://www.folhatec.com.br`** (ou definir
`QUOTE_ALLOWED_HOSTS=www.folhatec.com.br,folhatec.com.br`).

### Comportamento por configuração

| Situação | API | O que o visitante vê |
| --- | --- | --- |
| SMTP ok + host autorizado | 200 `delivered` | "Solicitação enviada com sucesso! Nossa equipe entrará em contato." |
| Falha SMTP (senha, conexão, timeout, recusa) | 502 | "Não foi possível enviar…" + telefone/e-mail |
| Configuração parcial/inválida | 503 | "Não foi possível enviar…" + telefone/e-mail |
| Sem canal em production | 503 | "Não foi possível enviar…" + telefone/e-mail |
| Sem canal em dev/staging, ou host não autorizado | 202 `stub` | "Solicitação não enviada." + telefone/e-mail |

### Compatibilidade Vercel × Locaweb

- Nodemailer roda em Node.js (rota com `runtime = "nodejs"`); SMTP de saída
  na porta 465 é permitido nas funções da Vercel.
- As funções rodam hoje na região `iad1` (EUA). Se a Locaweb bloquear ou
  alertar logins SMTP vindos do exterior, avaliar a região `gru1` (São Paulo)
  para a função — só após o teste real.
- SPF da Locaweb (`include:_spf.locaweb.com.br`) já cobre o envio pela
  própria Locaweb: nenhum registro DNS novo é necessário.

### Anti-abuso

Honeypot (`website`), validação server-side, JSON-only, limite de 16 KB,
contexto validado, recusa de `Origin` de outro site (403), hosts autorizados
e rate limit em memória quando há canal real (5 envios por IP e 30 por
instância a cada 10 min; melhor esforço por instância serverless — para
garantia global, provider persistente em `rate-limit.ts`).

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
