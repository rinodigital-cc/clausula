import type { Metadata } from "next";
import { BRAND } from "@/ui/brand";
import { SiteFooter, SiteHeader } from "@/ui/site";
import { Alert } from "@/ui/components";

export const metadata: Metadata = { title: "Privacidade" };

export default function PrivacidadePage() {
  return (
    <>
      <SiteHeader />
      <main id="conteudo" className="section">
        <article className="container legal stack" style={{ maxWidth: 820 }}>
          <h1>Privacidade</h1>
          <Alert tone="warn" title="Versão preliminar.">
            Este texto resume como os dados são tratados hoje e ainda passará por revisão jurídica antes da publicação do site.
          </Alert>
          <h2>Dados do formulário de contato</h2>
          <p>
            Guardamos nome, e-mail e, se você informar, corretora, telefone, tamanho da equipe e mensagem. Usamos esses dados só para
            responder ao seu contato sobre a {BRAND.name}. O endereço de rede é guardado de forma irreversível (resumo criptográfico), apenas
            para limitar envios automáticos.
          </p>
          <h2>Dados de quem usa a plataforma</h2>
          <p>
            Nome, e-mail, papel na corretora, perguntas feitas, respostas e avaliações. Cada corretora acessa apenas os próprios dados e
            documentos. Senhas são guardadas de forma irreversível; ninguém da equipe tem acesso a elas.
          </p>
          <h2>Documentos enviados</h2>
          <p>
            Os documentos enviados por uma corretora são usados apenas para responder às consultas dela. Quem envia confirma que a
            corretora tem direito de usar o documento na plataforma.
          </p>
          <h2>Seus direitos</h2>
          <p>
            Você pode pedir acesso, correção ou exclusão dos seus dados. Enquanto o canal oficial de atendimento não estiver publicado,
            faça o pedido pelo formulário de contato.
          </p>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
