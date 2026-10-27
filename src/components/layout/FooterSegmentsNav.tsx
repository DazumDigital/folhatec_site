"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * Item "Segmentos" do rodapé como accordion: começa recolhido e expande a
 * lista completa de segmentos (botão nativo — mouse, toque e teclado).
 * A página /segmentos continua acessível pelo primeiro item da lista.
 */
export function FooterSegmentsNav({
  segments,
  linkClass,
}: {
  segments: Array<{ slug: string; title: string }>;
  linkClass: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 text-white/75 transition-colors hover:text-white"
      >
        Segmentos
        <Icon name="chevron" size={14} className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <ul id={listId} hidden={!open} className="menu-enter mt-3 grid gap-2.5 border-l border-white/15 pl-3">
        <li>
          <Link href="/segmentos" className={linkClass}>
            Ver todos os segmentos
          </Link>
        </li>
        {segments.map((segment) => (
          <li key={segment.slug}>
            <Link href={`/segmentos/${segment.slug}`} className={linkClass}>
              {segment.title}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
