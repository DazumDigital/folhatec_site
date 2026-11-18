/**
 * Rate limit do endpoint de cotação.
 *
 * Em ambiente serverless (Vercel) um Map() em memória vale apenas para a
 * instância que recebeu a requisição: é proteção de MELHOR ESFORÇO contra
 * rajadas (mesmo IP batendo seguidamente na mesma instância "quente"), não
 * uma garantia global. Ele protege a conta SMTP da Locaweb contra abuso
 * simples; para garantia global, plugar um provider persistente
 * (ex.: Upstash Redis, Vercel KV/Marketplace) implementando `RateLimiter`.
 *
 * Só é aplicado quando existe um canal real de entrega configurado
 * (ver `hasDeliveryChannel`); em dev/staging sem canal, nada é limitado.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface RateLimiter {
  readonly name: string;
  /** `key` deve ser um identificador não pessoal (ex.: hash do IP). */
  check(key: string): Promise<RateLimitResult>;
}

export interface MemoryRateLimitOptions {
  /** Requisições por chave dentro da janela. */
  perKey: number;
  /** Requisições totais da instância dentro da janela. */
  global: number;
  windowMs: number;
  now?: () => number;
}

export function createMemoryRateLimiter(options: MemoryRateLimitOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();
  let globalHits: number[] = [];

  const recent = (list: number[], from: number) => list.filter((time) => time > from);

  return {
    name: "memory",
    async check(key) {
      const current = now();
      const from = current - options.windowMs;
      globalHits = recent(globalHits, from);
      const keyHits = recent(hits.get(key) ?? [], from);
      if (keyHits.length >= options.perKey || globalHits.length >= options.global) {
        const oldest = Math.min(...(keyHits.length >= options.perKey ? keyHits : globalHits));
        hits.set(key, keyHits);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - current) / 1000)) };
      }
      keyHits.push(current);
      globalHits.push(current);
      hits.set(key, keyHits);
      if (hits.size > 5000) hits.clear(); // limite de memória
      return { allowed: true };
    },
  };
}

/** Sem canal real configurado: não limita. */
const disabledRateLimiter: RateLimiter = {
  name: "disabled",
  async check() {
    return { allowed: true };
  },
};

/** 5 envios por IP e 30 por instância a cada 10 minutos. */
const quoteRateLimiter = createMemoryRateLimiter({ perKey: 5, global: 30, windowMs: 10 * 60 * 1000 });

export function getRateLimiter(deliveryConfigured: boolean): RateLimiter {
  return deliveryConfigured ? quoteRateLimiter : disabledRateLimiter;
}
