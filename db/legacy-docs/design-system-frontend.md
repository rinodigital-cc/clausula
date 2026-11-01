# Sistema de Design e Arquitetura de Frontend
### Plataforma de Especialistas de IA
**Seções 4 e 29 do briefing · Agosto/2026**

---

## Por que este documento vem antes do código

As duas telas que entreguei antes usavam valores soltos — 26px aqui, 17px ali,
escolhidos por intuição. Funciona para duas telas. Na décima, ninguém lembra
por que o espaçamento de um card é 22 e o de outro é 24, e a interface começa a
parecer montada por pessoas diferentes.

Tokens não são organização. São o que impede o produto de parecer amador no
mês quatro.

---

## 1. Tokens

### 1.1 Cor

Paleta curta de propósito. Uma cor forte só — o marca-texto. Se tudo pode ser
destacado, nada está destacado.

```css
:root{
  /* superfícies */
  --paper:#FBFAF8;      /* fundo da aplicação */
  --surface:#FFFFFF;    /* cards, listas, documentos */
  --sunk:#F2F1ED;       /* navegação, painel de evidência */

  /* texto — todos verificados em contraste */
  --ink:#14171A;        /* 15.8:1  título e corpo */
  --ink-2:#454C53;      /*  8.2:1  texto secundário */
  --ink-3:#6B737B;      /*  4.6:1  metadado, mínimo aceitável */

  /* estrutura */
  --rule:#E1DFDA;       /* divisória */
  --rule-2:#C7C4BC;     /* borda de campo e botão */

  /* significado */
  --mark:#F5DC8E;       /* marca-texto do trecho citado */
  --mark-edge:#C9A733;  /* marcador de citação */
  --act:#1B3A6B;        /* foco e link */
  --warn:#7A4E0C; --warn-bg:#FBF3E2; --warn-edge:#C99A3A;
  --ok:#1A5A40;
}
```

**Regra de uso do marca-texto:** aparece no trecho citado e no marcador de
citação. Em nenhum outro lugar. É a assinatura do produto — usar em botão ou
badge a desvaloriza.

**Regra de contraste:** `--ink-3` é o piso. Qualquer cinza mais claro reprova
em 4.5:1 e o corretor de 52 anos em monitor de escritório não lê.

### 1.2 Espaçamento — escala de 4

```css
--s1:4px;  --s2:8px;  --s3:12px; --s4:16px;
--s5:24px; --s6:32px; --s7:48px; --s8:64px;
```

Nenhum valor fora da escala. Se um espaçamento parece precisar de 18px, o
problema é a hierarquia, não a escala.

**Aplicação padrão:**

| Onde | Token |
|---|---|
| Dentro de badge, entre ícone e texto | `--s1` / `--s2` |
| Padding de botão e campo | `--s2` vertical, `--s3`–`--s4` horizontal |
| Entre itens de lista | `--s3` |
| Padding de card | `--s5` |
| Entre blocos de conteúdo | `--s5` |
| Entre seções da página | `--s6` |

### 1.3 Tipografia

Três famílias, cada uma com um trabalho:

```css
--ui:"Instrument Sans", system-ui, sans-serif;   /* interface */
--doc:"Newsreader", Georgia, serif;              /* texto de documento */
--mono:"JetBrains Mono", ui-monospace, monospace;/* metadado e código */
```

**A serifa não é decoração.** Cláusula de apólice em serifa lê como documento;
em sans lê como conteúdo de app. A diferença muda a percepção de autoridade
sem nenhum selo ou cadeado.

Escala:

| Papel | Tamanho / peso / entrelinha | Família |
|---|---|---|
| Título de tela | 19px / 600 / 1.3 · tracking -.015em | ui |
| Resposta principal | 19.5px / 400 / 1.45 | ui |
| Título de seção | 14.5px / 600 / 1.4 | ui |
| Corpo | 15px / 400 / 1.5 | ui |
| Corpo de documento | 16.5px / 400 / 1.72 | **doc** |
| Secundário | 13.5px / 400 / 1.5 | ui |
| Metadado | 11.5px / 400 · tracking .02em | **mono** |
| Rótulo de seção | 11px / 500 · uppercase · tracking .09em | mono |

Somente três pesos: 400, 500, 600. Sem 700 — negrito pesado empurra a
interface para o genérico.

### 1.4 Forma, borda e sombra

```css
--r:3px;        /* raio único */
--r-full:99px;  /* apenas chips */
```

**Sem sombra em cards.** Elevação vem de borda de 1px e mudança de superfície.
Sombra difusa é o vocabulário de painel administrativo antigo. Única exceção:
menu e modal flutuantes, onde há sobreposição real.

### 1.5 Grade e pontos de quebra

```css
--bp-sm:640px;   /* celular → tablet */
--bp-md:980px;   /* tablet → desktop */
--bp-lg:1280px;  /* desktop largo */
```

| Faixa | Casca | Consulta |
|---|---|---|
| < 640px | navegação em barra superior rolável | evidência **embutida** sob cada trecho |
| 640–980px | idem | idem |
| > 980px | barra lateral fixa de 216px | duas colunas: resposta \| documento |
| > 1280px | conteúdo com largura máxima de 1180px | idem |

**A quebra importante não é a largura, é o comportamento da evidência.** No
celular ela vem colada ao trecho; no desktop, em painel próprio. Isso não é
adaptação, é uma decisão diferente para cada contexto.

---

## 2. Componentes

Inventário, com a regra que cada um carrega.

### Ação
| Componente | Variantes | Regra |
|---|---|---|
| Botão | primário, secundário, discreto, perigo | Alvo mínimo 40px. Rótulo é verbo do resultado: "Publicar" gera "Publicado" |
| Chip de filtro | pressionado / solto | `aria-pressed`, nunca só cor |
| Menu de ações | — | Máximo 6 itens; ação destrutiva separada por divisória |

### Entrada
Campo de texto · área de texto · seleção · alternância · checkbox · upload por arrastar.

**Regras comuns:** rótulo sempre visível (nunca só placeholder) · erro abaixo do
campo, no blur · texto de ajuda antes do campo, não depois · altura mínima 42px.

### Estrutura
Barra lateral · barra superior · trilha de navegação (só no terceiro nível) ·
abas · trilho de etapas · lista · tabela · card.

### Comunicação
| Componente | Quando |
|---|---|
| Aviso em bloco | Informação que muda a decisão — exclusão aplicável, documento vencido |
| Aviso passageiro | Confirmação de ação rotineira · 3s · nunca bloqueia |
| Modal | Só decisão irreversível. Confirmação de leitura não é modal |
| Selo | Estado de objeto. Sempre ícone **ou** texto, nunca só cor |
| Dica flutuante | Explicação curta. Nunca contém informação exclusiva |

### Estados
Vazio · esqueleto · progresso determinado · progresso com etapa nomeada ·
erro em bloco · erro de campo · sem permissão · sem resultado de busca.

**Todo estado vazio tem três partes:** o que é, por que está vazio, o que fazer
agora. O botão leva à ação, nunca à ajuda.

---

## 3. Arquitetura de frontend

### 3.1 Rotas

```
/entrar
/convite/:token
/recuperar-senha

/consulta                          ← superfície do corretor
/consulta/:conversaId
/historico

/admin
/admin/boas-vindas                 ← onboarding
/admin/assistentes
/admin/assistentes/novo            ← wizard
/admin/assistentes/:id
  /visao-geral · /conhecimento · /configuracao
  /conversas · /usuarios · /uso · /publicacao
/admin/biblioteca
/admin/biblioteca/:documentoId
/admin/time
/admin/uso
/admin/conta
  /plano · /organizacao · /auditoria
```

### 3.2 Camadas

```
app/            rotas e layouts
components/
  primitives/   botão, campo, selo — sem regra de negócio
  patterns/     lista de documentos, cartão de citação, painel de evidência
  layouts/      casca do admin, casca da consulta
features/
  consulta/     componentes + hooks + serviços da consulta
  conhecimento/
  assistente/
  time/
  conta/
lib/
  tokens.css    fonte única de verdade visual
  api/          cliente e tipos
  auth/         sessão
```

**Regra de fronteira:** `primitives` não sabe o que é uma apólice. `features`
não redefine cor nem espaçamento. Toda decisão visual vem de `tokens.css`.

### 3.3 Estado — quatro tipos, quatro tratamentos

| Tipo | Exemplo | Como |
|---|---|---|
| Servidor | documentos, conversas, membros | Cache com revalidação; nunca duplicado em estado global |
| Sessão | organização atual, papel | Contexto, vindo do servidor a cada requisição |
| Interface | painel aberto, aba ativa | Estado local do componente |
| Formulário | wizard, configuração | Estado do formulário + rascunho persistido |

**Não existe estado global de aplicação.** É o erro mais comum em SaaS B2B:
tudo vira store, e depois ninguém sabe de onde veio um dado desatualizado.

### 3.4 Serviços

Cada área expõe funções tipadas; componente nunca chama endpoint direto.

```
conhecimento: listarDocumentos · enviarDocumento · acompanharProcessamento
              substituirVersao · arquivar
consulta:     perguntar (streaming) · listarHistorico · reportarErro
assistente:   criar · configurar · testar · publicar
time:         listar · convidar · alterarPapel · remover
```

### 3.5 Permissões na interface

Um hook `useCan(acao)` consulta a mesma matriz do servidor.

> Esconder botão é ergonomia, **nunca** segurança. A autorização de verdade está
> no servidor e no banco. A interface só evita frustração.

---

## 4. Onde os avisos técnicos viram português

| Interno | Na tela |
|---|---|
| Indexando / gerando embeddings | Preparando documento |
| Chunk / trecho recuperado | Trecho citado |
| Retrieval sem resultado | Não encontrei isso nos documentos |
| Baixa confiança de OCR | Não conseguimos ler as páginas X a Y |
| Conflito entre fontes | Encontramos informações diferentes |
| Versão superseded | Substituída em DD/MM |
| Rate limit atingido | Muitas consultas em pouco tempo. Aguarde um minuto |
| Fora do escopo | Isso é de outro ramo. Quer enviar como sugestão? |

Nenhum código de erro sem tradução. Nenhuma mensagem que culpe o usuário.

---

## 5. Ordem de implementação

A do briefing está quase certa. Uma troca:

| Briefing | Recomendado | Por quê |
|---|---|---|
| 1–4 Layout, navegação, autenticação, dashboard | igual | — |
| 5 Criação de especialista | **Conhecimento primeiro** | O wizard depende de upload funcionando. Fazer o wizard antes obriga a simular o upload — e simulação é o que a seção 30 proíbe |
| 6 Conhecimento | 5 Criação | — |
| 7–12 igual | igual | — |

**Critério para considerar uma tela pronta:** todo botão nela faz alguma coisa,
ou não está lá. Botão desabilitado com dica explicando por quê é aceitável;
botão que não responde, não.
