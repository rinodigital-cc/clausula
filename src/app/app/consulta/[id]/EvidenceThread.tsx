"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Geo = { d: string; x1: number; y1: number; x2: number; y2: number; len: number };

/**
 * Fio de evidência: liga a afirmação ativa (na resposta) ao trecho grifado
 * (no documento). É a assinatura visual da ApoIA Seguro: mostra, sem precisar
 * ler legenda, de onde veio cada frase.
 *
 * Puramente decorativo (aria-hidden): a mesma ligação existe em texto, no
 * número da fonte e no rótulo “cl. · p.”. Só aparece no desktop, quando os
 * dois pontos estão visíveis; some com o rolar e volta no lugar certo.
 */
export function EvidenceThread() {
  const sp = useSearchParams();
  return <EvidenceDrawing key={sp.toString()} hasSource={!!sp.get("fonte")} />;
}

function EvidenceDrawing({ hasSource }: { hasSource: boolean }) {
  const [geo, setGeo] = useState<Geo | null>(null);
  const raf = useRef(0);

  const [settled, setSettled] = useState(false);

  useEffect(() => {
    // Leva o grifo para o terço superior da folha do documento
    const mark = document.getElementById("trecho");
    const box = mark?.closest<HTMLElement>(".doc-text");
    if (mark && box) {
      const delta = mark.getBoundingClientRect().top - box.getBoundingClientRect().top - 96;
      box.scrollTo({ top: box.scrollTop + delta, behavior: "instant" as ScrollBehavior });
    }
    // Se a afirmação ligada à fonte escolhida está fora da tela (ou sob o campo de pergunta), traz para o centro
    const claim = document.querySelector<HTMLElement>("[data-claim-active] > a");
    if (claim && hasSource) {
      const r = claim.getBoundingClientRect();
      if (r.top < 90 || r.bottom > window.innerHeight - 130) claim.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [hasSource]);

  useEffect(() => {
    if (!geo || settled) return;
    const t = window.setTimeout(() => setSettled(true), 900);
    return () => window.clearTimeout(t);
  }, [geo, settled]);

  useEffect(() => {
    const measure = () => {
      raf.current = 0;
      if (window.innerWidth <= 1040) return setGeo(null);
      const claim = document.querySelector<HTMLElement>("[data-claim-active] > a");
      const mark = document.getElementById("trecho");
      const card = claim?.closest<HTMLElement>(".answer");
      const box = mark?.closest<HTMLElement>(".doc-text");
      if (!claim || !mark || !card || !box) return setGeo(null);
      const c = claim.getBoundingClientRect();
      const a = card.getBoundingClientRect();
      const m = mark.getClientRects()[0] ?? mark.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const y1 = c.top + c.height / 2;
      const y2 = m.top + m.height / 2;
      const visible = y1 > 70 && y1 < window.innerHeight - 10 && y2 > b.top + 4 && y2 < b.bottom - 4;
      if (!visible) return setGeo(null);
      const x1 = a.right;
      const x2 = Math.max(m.left - 6, x1 + 24);
      const dx = (x2 - x1) * 0.55;
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      setGeo({ d, x1, y1, x2, y2, len: Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.4) });
    };
    const schedule = () => {
      if (!raf.current) raf.current = requestAnimationFrame(measure);
    };
    // Espera a entrada animada da resposta e do grifo antes de desenhar
    const t = window.setTimeout(schedule, 1300);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  if (!geo) return null;
  return (
    <svg className="evidence-thread" aria-hidden="true" width="100%" height="100%">
      <defs>
        <linearGradient id="ev-grad" gradientUnits="userSpaceOnUse" x1={geo.x1} y1={0} x2={geo.x2} y2={0}>
          <stop offset="0" stopColor="#0f6e68" stopOpacity="0.95" />
          <stop offset="1" stopColor="#12a08f" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <path className={settled ? undefined : "draw"} d={geo.d} style={{ ["--len" as string]: geo.len }} />
      <circle cx={geo.x1} cy={geo.y1} r={4.5} />
      <circle cx={geo.x2} cy={geo.y2} r={4.5} />
    </svg>
  );
}
