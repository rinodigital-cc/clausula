# Anexo de Proteção de Dados — minuta para revisão jurídica
### Contrato de operação de tratamento entre corretora e plataforma

> **Isto é uma minuta técnica, não parecer jurídico.** Eu não sou advogado.
> O objetivo é levar ao seu advogado um texto que já reflete corretamente a
> arquitetura do produto, em vez de ele partir de um modelo genérico que não
> descreve o que o sistema faz. **Nada aqui deve ser assinado sem revisão.**
>
> Os campos entre colchetes precisam ser preenchidos por você.

---

## Por que este documento existe antes da primeira venda

A corretora é **controladora** dos dados dos segurados. A plataforma é
**operadora** — trata em nome dela e sob suas instruções. Os provedores de IA,
OCR, hospedagem e observabilidade são **suboperadores**.

Três consequências práticas:

1. A corretora precisa autorizar formalmente o tratamento e conhecer a cadeia
   de suboperadores
2. Dados serão processados **fora do Brasil**, o que exige salvaguarda
   contratual adequada e transparência
3. A primeira corretora que fizer diligência vai perguntar exatamente isso.
   Não ter a resposta pronta trava a venda no momento em que ela já estava ganha

---

## 1. Definições e papéis

**Controladora:** [RAZÃO SOCIAL DA CORRETORA], que decide a finalidade e os meios
do tratamento dos dados pessoais contidos nos documentos que carrega e nas
consultas que seus usuários realizam.

**Operadora:** [SUA RAZÃO SOCIAL], que realiza o tratamento em nome da
Controladora, estritamente conforme suas instruções documentadas.

**Suboperadores:** terceiros contratados pela Operadora para prestação de
serviços de infraestrutura e processamento, listados no Anexo I.

---

## 2. Objeto e finalidade

A Operadora tratará dados pessoais exclusivamente para:

a) armazenar e processar documentos carregados pela Controladora;
b) extrair, estruturar e indexar o conteúdo desses documentos;
c) responder consultas de usuários autorizados com base nesse acervo;
d) registrar trilha de auditoria e métricas de uso.

**A Operadora não tratará dados pessoais para nenhuma finalidade própria.**
Especificamente, não utilizará conteúdo da Controladora para treinar modelos
próprios ou de terceiros, nem para melhorar o serviço prestado a outros
clientes.

---

## 3. Natureza dos dados

Os documentos carregados pela Controladora **podem conter** dados pessoais de
segurados — nome, documento, endereço, dados de bem segurado, histórico de
sinistro.

A Controladora declara que possui base legal para o tratamento desses dados e
que sua carga na plataforma é compatível com as finalidades informadas aos
titulares.

> **Observação para o advogado:** vale avaliar se cabe cláusula orientando a
> Controladora a não carregar dados sensíveis (saúde, biometria) quando não
> forem necessários à finalidade, e a consequência prática caso o faça.

---

## 4. Segurança

A Operadora mantém, no mínimo:

- **Isolamento lógico entre organizações**, imposto no nível do banco de dados
  por políticas de segurança em linha, e verificado por teste automatizado
  executado a cada alteração do sistema
- Criptografia em trânsito e em repouso
- Controle de acesso por papel, com registro de toda alteração de permissão
- Trilha de auditoria imutável para carga, publicação, alteração de permissão,
  remoção e exportação, retida por 5 anos
- Registro de todo acesso administrativo da Operadora a dados da Controladora
- Segregação de credenciais por função, com privilégio mínimo

**Acesso operacional:** a Operadora declara que pessoal técnico autorizado pode
acessar dados da Controladora exclusivamente para diagnóstico e suporte, com
registro em auditoria. A Controladora pode solicitar esse registro a qualquer
tempo.

> Esta cláusula existe porque a alternativa — omitir — é pior. Toda plataforma
> tem acesso operacional; declará-lo é o que diferencia transparência de
> descoberta desagradável.

---

## 5. Suboperadores e transferência internacional

A Controladora autoriza a contratação dos suboperadores listados no Anexo I.

**A Operadora informará a Controladora com antecedência mínima de [30] dias
sobre inclusão ou substituição de suboperador**, cabendo à Controladora
manifestar oposição fundamentada.

Parte do tratamento ocorre **fora do território nacional**, especificamente nos
serviços de modelo de linguagem, reconhecimento óptico de caracteres e
observabilidade. A Operadora declara manter com cada um desses fornecedores:

- instrumento contratual com salvaguardas de proteção adequadas à legislação
  brasileira vigente;
- vedação expressa ao uso do conteúdo para treinamento de modelos;
- configuração de retenção zero ou retenção mínima, quando oferecida pelo
  fornecedor.

> **Verificar com o advogado:** o formato e o prazo exigidos pela ANPD para
> cláusulas-padrão contratuais de transferência internacional. A regra e os
> prazos mudaram recentemente e precisam ser confirmados na data da assinatura.

---

## 6. Retenção e eliminação

| Categoria | Retenção |
|---|---|
| Documentos e versões | Durante a vigência do contrato |
| Consultas e citações | 5 anos — material de comprovação da Controladora |
| Registros de auditoria | 5 anos |
| Traços técnicos de processamento | 90 dias |
| Registros de aplicação | 30 dias |
| Cópias de segurança | 30 dias |

**Encerramento:** a Controladora poderá exportar seus dados em até [30] dias do
término. Após esse prazo, a Operadora eliminará os dados de forma definitiva em
até [30] dias.

**Limite declarado, e não contornável:** dados eliminados permanecem em cópias
de segurança até a expiração natural destas — até 30 dias. Durante esse período
não serão utilizados para restauração de dados cuja eliminação foi solicitada.

> Prometer eliminação instantânea em backup é promessa que nenhuma plataforma
> cumpre. Declarar a janela é mais defensável que omiti-la.

---

## 7. Direitos dos titulares

Os titulares são, em regra, os segurados da Controladora. Requisições chegam à
Controladora, que as encaminha à Operadora.

A Operadora prestará auxílio técnico em até [10] dias úteis para localização,
correção ou eliminação de dados.

---

## 8. Incidentes

A Operadora comunicará a Controladora em até **[24] horas** da ciência de
incidente de segurança que possa acarretar risco relevante aos titulares,
informando: natureza, dados afetados, número aproximado de titulares, medidas
adotadas e medidas recomendadas.

A comunicação à autoridade nacional e aos titulares cabe à Controladora, com
apoio técnico da Operadora.

---

## 9. Auditoria

A Controladora poderá solicitar, uma vez por ano, evidência documental dos
controles descritos na cláusula 4, incluindo o resultado do teste automatizado
de isolamento entre organizações.

---

# Anexo I — Suboperadores

**Preencher com os fornecedores efetivamente contratados antes de assinar.**

| Função | Fornecedor | País | Dados tratados |
|---|---|---|---|
| Hospedagem da aplicação | [ ] | [ ] | Todos |
| Banco de dados | [ ] | [ ] | Todos |
| Armazenamento de arquivos | [ ] | [ ] | Documentos |
| Modelo de linguagem | [ ] | [ ] | Trechos de documento e perguntas |
| Reconhecimento de texto (OCR) | [ ] | [ ] | Imagens de página |
| Observabilidade | [ ] | [ ] | Perguntas e trechos recuperados |
| E-mail transacional | [ ] | [ ] | Nome e e-mail de usuários |
| Pagamento | [ ] | [ ] | Dados cadastrais da corretora |

> **O fornecedor de observabilidade merece atenção.** Ele guarda perguntas reais
> e trechos de documento de todos os clientes, juntos — é o alvo de maior valor
> da plataforma. Não é "ferramenta de debug"; é suboperador com acesso a
> conteúdo, e precisa constar aqui.

---

# Antes de levar ao advogado

Três verificações que só você pode fazer:

1. **Confirmar o modo sem retenção com cada provedor de IA.** Nem todos
   oferecem, e alguns só no plano corporativo. A cláusula 5 assume que você
   contratou.
2. **Confirmar o formato de salvaguarda de transferência internacional exigido
   hoje.** A regra da ANPD mudou recentemente; seu advogado precisa checar a
   versão vigente e os prazos.
3. **Decidir os prazos entre colchetes.** Os valores sugeridos são
   conservadores e usuais, mas são compromissos que você terá de cumprir com
   uma pessoa só na operação — não prometa 24 horas de resposta a incidente se
   você não consegue.
