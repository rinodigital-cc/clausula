import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/ui/brand";
import { SiteFooter, SiteHeader } from "@/ui/site";
import { IconSearch, IconWarn } from "@/ui/icons";

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name} — Respostas técnicas sobre seguros, com a fonte à vista` },
  alternates: { canonical: "/" },
};

const FAQ: [string, string][] = [
  [
    "De onde vêm as respostas?",
    "Dos documentos que a sua corretora coloca na plataforma, como condições gerais, manuais e procedimentos. A IA não completa a resposta com conhecimento de fora: se a informação não estiver nos documentos, ela avisa que não encontrou.",
  ],
  [
    "A ApoIA Seguro substitui o corretor?",
    "Não. Ela encurta o caminho até o trecho certo do documento. A interpretação para o caso do cliente e a orientação continuam sendo do corretor, que confere a fonte antes de responder.",
  ],
  [
    "Uma corretora vê os documentos de outra?",
    "Não. Cada corretora consulta apenas os próprios documentos e o próprio histórico. Dentro da corretora, quem administra decide quem tem acesso.",
  ],
  [
    "Posso confiar em qualquer resposta?",
    "Confie na fonte, não na frase. Cada resposta indica o documento, a cláusula e a página, e avisa quando a vigência terminou, quando documentos discordam ou quando a evidência é parcial.",
  ],
  [
    "Como começo?",
    "A plataforma está em fase piloto. Conte um pouco sobre a sua corretora na página de contato e combinamos uma demonstração com documentos de verdade.",
  ],
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="conteudo">
        <section className="hero">
          <div className="container hero-grid">
            <div className="hero-copy">
              <span className="eyebrow"><span className="dot" />IA para corretores de seguros</span>
              <h1 className="display">Respostas técnicas sobre seguros, com a fonte à vista.</h1>
              <p className="lead">
                Pergunte sobre coberturas, exclusões, carências e franquias. A {BRAND.name} procura nas condições gerais e nos
                documentos da sua corretora e mostra o trecho de onde veio cada resposta.
              </p>
              <div className="row">
                <Link href="/contato" className="btn btn-primary btn-lg">Quero testar com a minha corretora</Link>
                <Link href="#como-funciona" className="btn btn-secondary btn-lg">Ver como funciona</Link>
              </div>
              <p className="muted" style={{ fontSize: "var(--text-sm)" }}>Em fase piloto, com corretoras convidadas.</p>
            </div>

            <div className="hero-demo" aria-label="Exemplo simulado de consulta">
              <span className="demo-label">Simulação · seguradora e documento fictícios</span>
              <div className="demo-card">
                <div className="q">
                  <IconSearch size={18} />
                  O residencial cobre queima de aparelho por oscilação de energia?
                </div>
                <div className="body">
                  <div className="alert alert-warn" role="note">
                    <IconWarn />
                    <div><b>Exclusão:</b> aparelhos com mais de 10 anos de fabricação.</div>
                  </div>
                  <span className="ai-tag"><span aria-hidden="true">●</span> Resumo da IA · confira nas fontes</span>
                  <p style={{ color: "var(--ink)", fontSize: "var(--text-lg)", lineHeight: 1.5 }}>
                    Sim, desde que a apólice tenha a cobertura adicional de <b>Danos Elétricos</b>. A cobertura básica não inclui esse risco.
                  </p>
                  <h3 className="evidence-title">Fonte: o que está escrito no documento</h3>
                  <blockquote className="quote">
                    “7.2 Estão cobertos os danos causados a aparelhos elétricos e eletrônicos por{" "}
                    <mark>variação de tensão, curto-circuito ou descarga elétrica</mark>, desde que contratada a cobertura adicional…”
                  </blockquote>
                  <div className="row">
                    <span className="cite-chip"><span className="dot" />CG Seguradora Aurora · Residencial v4</span>
                    <span className="cite-chip plain">cláusula 7.2 · p. 18</span>
                  </div>
                </div>
              </div>
              <div className="legend" aria-label="Legenda das cores">
                <span><i style={{ background: "var(--accent)" }} />Azul: o que a IA escreveu</span>
                <span><i style={{ background: "var(--evidence-dot)" }} />Verde: o que está no documento</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-dark">
          <div className="container stack">
            <h2>Menos dúvida. Mais clareza. Mais segurança para orientar o cliente.</h2>
            <p style={{ maxWidth: "62ch", fontSize: "var(--text-lg)", color: "#d6e2f3" }}>
              Condições gerais, manuais e procedimentos estão espalhados por várias seguradoras. A {BRAND.name} aproxima essa
              informação de quem atende o cliente, sem tirar do corretor a palavra final.
            </p>
          </div>
        </section>

        <section className="section" id="como-funciona" aria-labelledby="como-funciona-t">
          <div className="container stack-lg">
            <div className="stack-sm">
              <span className="eyebrow"><span className="dot" />Como funciona</span>
              <h2 id="como-funciona-t">Três passos, do documento à resposta conferida.</h2>
            </div>
            <ol className="steps">
              <li>
                <span className="n">01</span>
                <h3>A corretora reúne os documentos</h3>
                <p>Condições gerais, manuais e procedimentos em PDF, organizados por seguradora e produto, com vigência.</p>
              </li>
              <li>
                <span className="n">02</span>
                <h3>O corretor pergunta do seu jeito</h3>
                <p>Em linguagem comum, como perguntaria a um colega experiente. Dá para filtrar por seguradora.</p>
              </li>
              <li>
                <span className="n">03</span>
                <h3>A IA responde com a fonte</h3>
                <p>Exclusões e condições aparecem primeiro, com o trecho grifado no documento. Você confere e decide.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="section" id="confianca" aria-labelledby="confianca-t" style={{ background: "var(--surface)", borderBlock: "1px solid var(--line)" }}>
          <div className="container stack-lg">
            <div className="stack-sm">
              <span className="eyebrow"><span className="dot" />Confiança</span>
              <h2 id="confianca-t">Feita para apoiar a sua análise, não para decidir por você.</h2>
            </div>
            <div className="is-isnot">
              <div className="card card-pad stack-sm">
                <h3 style={{ fontSize: "var(--text-lg)" }}>O que a {BRAND.name} faz</h3>
                <ul>
                  <li>Encontra o trecho certo nas condições gerais e documentos da corretora.</li>
                  <li>Mostra documento, cláusula, página e versão de cada resposta.</li>
                  <li>Avisa quando a vigência terminou ou quando documentos discordam.</li>
                  <li>Diz “não encontrei” em vez de inventar.</li>
                </ul>
              </div>
              <div className="card card-pad stack-sm">
                <h3 style={{ fontSize: "var(--text-lg)" }}>O que ela não faz</h3>
                <ul>
                  <li>Não garante cobertura nem substitui a apólice do cliente.</li>
                  <li>Não presta aconselhamento jurídico.</li>
                  <li>Não responde com informação de fora dos documentos.</li>
                  <li>Não mistura documentos de corretoras diferentes.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="perguntas" aria-labelledby="perguntas-t">
          <div className="container stack-lg" style={{ maxWidth: 880 }}>
            <h2 id="perguntas-t">Perguntas frequentes</h2>
            <div className="faq">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
            <div className="row">
              <Link href="/contato" className="btn btn-primary btn-lg">Falar sobre um piloto</Link>
              <Link href="/entrar" className="btn btn-ghost btn-lg">Já tenho acesso</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
