# Arquitetura de plugins

## Objetivo

O tinyIde é deliberadamente um editor de texto básico quando nenhum plugin está instalado. Recursos de IDE — linguagens, terminais, ambientes de execução, Git, depuração, testes, bancos de dados e integrações — devem ser fornecidos por plugins.

A regra arquitetural central é:

```text
plugin → @tinyide/plugin-api
app    → @tinyide/plugin-api + @tinyide/core
core   → abstrações genéricas
```

Dependências proibidas:

```text
plugin → apps/web
plugin → @tinyide/core
plugin → implementação interna de outro plugin
core   → plugin específico
app    → implementação interna de um plugin
```

Durante o desenvolvimento, plugins independentes podem ser montados em `plugins/` como submódulos Git. Isso facilita o trabalho local, mas não transforma os plugins em parte do codebase principal.

## Camadas da arquitetura

```text
┌──────────────────────────────────────────────┐
│ Plugins                                      │
│ Python · Ambientes Python · Terminal · etc.  │
└───────────────────┬──────────────────────────┘
                    │ contratos públicos
┌───────────────────▼──────────────────────────┐
│ @tinyide/plugin-api                          │
│ Manifestos, contexto, providers e hooks      │
└───────────────────┬──────────────────────────┘
                    │ adaptação
┌───────────────────▼──────────────────────────┐
│ apps/web                                     │
│ Host, workbench e integração com o navegador │
└───────────────────┬──────────────────────────┘
                    │ primitivas genéricas
┌───────────────────▼──────────────────────────┐
│ @tinyide/core                                │
│ Eventos, comandos, capabilities e lifecycle  │
└──────────────────────────────────────────────┘
```

### Core

O `@tinyide/core` contém somente infraestrutura genérica:

- `PluginManager`;
- `CommandRegistry`;
- `EventBus`;
- `CapabilityRegistry`;
- validação de manifestos;
- compatibilidade de versões;
- execução genérica de perfis.

O core não conhece Python, Terminal, Django, Git, XTerm, ambientes virtuais ou IDs de plugins específicos.

### Plugin API

O `@tinyide/plugin-api` é o contrato público compartilhado entre host e plugins. Ele define manifestos, contexto de ativação, providers, hooks, contribuições visuais e objetos descartáveis.

### Aplicação web

`apps/web` implementa o host concreto do navegador. Ele carrega módulos frontend, cria o contexto público, adapta registros para os registries internos e monta contribuições visuais no workbench.

### Plugins

Cada plugin implementa apenas sua responsabilidade. Um plugin não importa outro plugin para integrar funcionalidades; a colaboração ocorre por providers e hooks públicos.

## Manifesto

Todo plugin possui um `plugin.json`. Exemplo mínimo:

```json
{
  "id": "acme.hello",
  "name": "Hello",
  "description": "Exemplo mínimo de plugin para o tinyIde.",
  "version": "0.1.0",
  "publisher": "acme",
  "category": "tool",
  "engines": {
    "tinyide": ">=0.4.0 <1.0.0"
  },
  "entrypoints": {
    "frontend": "./src/index.js"
  }
}
```

Campos principais:

- `id`: identificador global, em minúsculas;
- `version`: versão semântica do plugin;
- `category`: atualmente `language` ou `tool`;
- `engines.tinyide`: faixa de compatibilidade com a plataforma;
- `entrypoints.frontend`: módulo carregado no navegador;
- `entrypoints.backend`: módulo opcional executado pelo host servidor;
- `dependencies`: dependências explícitas de outros plugins;
- `permissions`, `activationEvents` e `contributes`: metadados declarativos disponíveis para evolução do sistema.

O catálogo lê o manifesto antes de importar o código. O `PluginManager` valida o formato, a compatibilidade e as dependências antes da ativação.

Plugins oficiais usam os mesmos contratos e o mesmo ciclo de vida de plugins externos. Tratamento especial por ID de plugin é uma violação arquitetural.

## Ciclo de vida

Estados administrados pelo `PluginManager`:

```text
discovered
installed
disabled
enabled
activating
active
deactivating
failed
uninstalled
```

Fluxo atual:

```text
descoberta
→ instalação
→ validação do manifesto
→ habilitação
→ carregamento do frontend
→ init(context)
→ activate() opcional
→ active
```

Na desativação:

```text
deactivate() opcional
→ dispose das subscriptions em ordem reversa
→ remoção do módulo ativo
```

O entrypoint frontend deve exportar `init(context)`:

```js
export function init(context) {
  // registrar contribuições
}
```

Opcionalmente:

```js
export function activate() {
  // trabalho posterior ao registro
}

export function deactivate() {
  // encerramento específico do plugin
}
```

Recursos registrados devem ser incluídos em `context.subscriptions`. O host os descarta quando o plugin é desativado.

## PluginContext

Contrato atual simplificado:

```ts
interface PluginContext {
  readonly backend: PluginBackendApi;
  readonly commands: CommandRegistryApi;
  readonly events: EventBusApi;
  readonly extensions: PluginExtensionApi;
  readonly workbench: WorkbenchApi;
  readonly subscriptions: Disposable[];
}
```

### extensions

É a porta principal de contribuição:

```js
context.extensions.registerLanguageProvider(provider);
context.extensions.registerResourceIconProvider(provider);
context.extensions.registerExecutionEnvironmentProvider(provider);
context.extensions.registerExecutionProfileContributionProvider(provider);
context.extensions.registerScriptExecution(contribution);
context.extensions.registerResourceContextMenuProvider(provider);
context.extensions.registerInteractiveSessionProvider(provider);
context.extensions.registerInteractiveSessionHook(provider);
context.extensions.registerPluginSettingsProvider(provider);
context.extensions.registerWorkbenchSidebarHook(hook);
context.extensions.registerWorkbenchPanelHook(hook);
context.extensions.registerWorkbenchToolWindowHook(hook);
context.extensions.registerTextEditorLineDecorationProvider(provider);
context.extensions.registerWorkbenchResourceEditorProvider(provider);
```

O plugin não recebe acesso direto ao `CapabilityRegistry`. O host converte chamadas da API pública em registros internos.

### workbench

`context.workbench` oferece operações de interação com o host que não pertencem ao domínio de um plugin específico: abrir uma sidebar ou tool window, abrir um diálogo contribuído e solicitar destaque de texto. Contribuições visuais maiores devem ser registradas por `extensions`, para que o host possa descartá-las junto com o plugin.

Os contratos de `@tinyide/plugin-api` que recebem `HTMLElement`, `Blob` ou contextos de montagem são deliberadamente específicos do workbench web. Plugins que precisem ser portáveis devem manter sua lógica de domínio separada e concentrar a adaptação visual nesses providers.

## Acoplamento e limites de portabilidade

O acoplamento entre plugins e o core de domínio é mantido baixo: plugins dependem do contrato público, enquanto `@tinyide/core` administra ciclo de vida, comandos, eventos e capabilities sem conhecer plugins específicos.

O acoplamento restante está no host e na API visual:

- `apps/web` adapta cada registro público para uma capability interna e monta sidebars, painéis, tool windows e editores de recursos;
- os identificadores das capabilities precisam permanecer estáveis entre `plugin-api`, o adaptador do host e o runtime;
- a API visual usa tipos do navegador, portanto não deve ser tratada como contrato agnóstico para hosts desktop ou headless;
- uma nova superfície visual exige uma alteração correspondente no host, mesmo que os plugins continuem isolados.

Ao adicionar uma extensão, prefira este limite: tipos e comportamento genérico em `@tinyide/plugin-api`, adaptação de registro em `apps/web` e implementação específica dentro do plugin. Não introduza imports de `apps/web` ou `@tinyide/core` nos plugins.

As constantes de capability exportadas pelo SDK são a referência para novos adaptadores; evite repetir strings literais em consumidores quando houver uma constante pública equivalente.

### commands

Permite registrar e executar comandos públicos:

```js
const disposable = context.commands.register("acme.hello.show", (name = "mundo") => {
  return `Olá, ${name}!`;
});
context.subscriptions.push(disposable);
```

### events

É usado para eventos de domínio realmente necessários. Não emita eventos redundantes apenas para informar que um provider foi registrado; o registro em `extensions` já é a fonte de verdade.

### backend

Fornece acesso ao backend privado do próprio plugin:

```js
const result = await context.backend.request("/status");
```

O plugin não conhece o prefixo HTTP, seu ID na rota ou a implementação de transporte. O host aplica o escopo automaticamente.

## Como implementar um plugin frontend

Estrutura mínima recomendada:

```text
my-plugin/
├── plugin.json
├── package.json
├── jsconfig.json
├── src/
│   └── index.js
└── test/
    └── plugin.test.js
```

### 1. Criar o manifesto

`plugin.json`:

```json
{
  "id": "acme.hello",
  "name": "Hello",
  "description": "Adiciona um comando de exemplo.",
  "version": "0.1.0",
  "publisher": "acme",
  "category": "tool",
  "engines": {
    "tinyide": ">=0.4.0 <1.0.0"
  },
  "entrypoints": {
    "frontend": "./src/index.js"
  }
}
```

### 2. Implementar o entrypoint

`src/index.js`:

```js
/** @param {import("@tinyide/plugin-api").PluginContext} context */
export function init(context) {
  const command = context.commands.register("acme.hello.show", (name = "mundo") => {
    return `Olá, ${name}!`;
  });

  context.subscriptions.push(command);
}
```

A anotação JSDoc vincula o JavaScript ao SDK público e permite verificação estática sem converter o plugin para TypeScript.

### 3. Configurar a verificação do SDK

`jsconfig.json`:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true,
    "noImplicitAny": false,
    "skipLibCheck": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "baseUrl": "../..",
    "paths": {
      "@tinyide/plugin-api": ["packages/plugin-api/src/index.ts"]
    }
  },
  "include": ["src/**/*.js"]
}
```

Em um repositório externo publicado, substitua o mapeamento local pela dependência do pacote `@tinyide/plugin-api` correspondente à versão suportada.

### 4. Configurar scripts

`package.json`:

```json
{
  "name": "@acme/tinyide-plugin-hello",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p jsconfig.json",
    "test": "node --test",
    "check": "npm run typecheck && npm test"
  }
}
```

### 5. Testar o registro e o descarte

`test/plugin.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { init } from "../src/index.js";

test("registra o comando pelo contexto público", async () => {
  const registrations = [];
  const context = {
    backend: { async request() {} },
    commands: {
      register(id, handler) {
        registrations.push({ id, handler });
        return { dispose() {} };
      },
    },
    events: { async emit() {} },
    extensions: {},
    subscriptions: [],
  };

  init(context);

  assert.equal(context.subscriptions.length, 1);
  assert.equal(registrations[0].id, "acme.hello.show");
  assert.equal(await registrations[0].handler("tinyIde"), "Olá, tinyIde!");
});
```

## Como contribuir uma linguagem

Um plugin de linguagem registra um `LanguageProvider`:

```js
/** @type {import("@tinyide/plugin-api").LanguageProvider} */
const provider = {
  id: "sample-language",
  name: "Sample Language",
  extensions: [".sample"],
  highlight(source) {
    return [];
  },
  async lint(source, fileName, settings) {
    return [];
  },
};

/** @param {import("@tinyide/plugin-api").PluginContext} context */
export function init(context) {
  context.subscriptions.push(
    context.extensions.registerLanguageProvider(provider),
  );
}
```

O app consulta providers registrados; não há condição específica para o ID do plugin.

## Como contribuir uma tool window

Uma tool window é montada pelo plugin dentro de um container fornecido pelo workbench:

```js
const toolWindow = {
  id: "acme-view",
  pluginId: "acme.hello",
  label: "HELLO",
  order: 100,
  mount({ container, headerContainer, state, close }) {
    const title = document.createElement("strong");
    title.textContent = "Hello";
    headerContainer.append(title);

    const button = document.createElement("button");
    button.textContent = `Workspace: ${state.snapshot().workspaceName}`;
    button.addEventListener("click", close);
    container.append(button);

    return {
      dispose() {
        headerContainer.replaceChildren();
        container.replaceChildren();
      },
    };
  },
};

const hook = {
  id: "acme.hello.tool-windows",
  pluginId: "acme.hello",
  contribute: () => [toolWindow],
};

export function init(context) {
  context.subscriptions.push(
    context.extensions.registerWorkbenchToolWindowHook(hook),
  );
}
```

O app controla posição, altura, visibilidade, montagem e desmontagem. O plugin controla o conteúdo da sua região.

## Como implementar um backend de plugin

Use um backend quando a funcionalidade exigir APIs indisponíveis no navegador, como processos, PTY, inspeção de executáveis ou acesso controlado ao sistema de arquivos.

Atualize o manifesto:

```json
{
  "entrypoints": {
    "frontend": "./src/index.js",
    "backend": "./src/backend.mjs"
  }
}
```

O backend deve exportar `createBackend()`:

```js
export function createBackend({ workspaceRoot }) {
  return async function handle(request, response, relativePath) {
    if (request.method === "GET" && relativePath === "/status") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ workspaceRoot, ready: true }));
      return;
    }

    response.statusCode = 404;
    response.end("Not found");
  };
}
```

No frontend:

```js
/** @param {import("@tinyide/plugin-api").PluginContext} context */
export function init(context) {
  context.subscriptions.push(
    context.commands.register("acme.hello.status", () => {
      return context.backend.request("/status");
    }),
  );
}
```

O frontend não deve montar manualmente URLs como `/plugin-api/acme.hello/status`. Esse roteamento pertence ao host.

## Comunicação entre plugins

Plugins não importam implementações uns dos outros. A colaboração ocorre por contratos públicos.

Exemplo atual:

```text
Ambientes Python
       │ registra InteractiveSessionHook
       ▼
Plugin API / registry
       │ Terminal consulta hooks registrados
       ▼
Terminal
```

O plugin de ambientes pode contribuir:

```js
{
  environmentVariables: {
    VIRTUAL_ENV: "/workspace/.venv"
  },
  prependPathEntries: [
    "/workspace/.venv/bin"
  ],
  promptPrefix: "(.venv) "
}
```

O Terminal combina as contribuições ao criar uma sessão. Nenhum dos dois importa o outro.

Dependências obrigatórias podem ser declaradas no manifesto:

```json
{
  "dependencies": {
    "tinyide.python": ">=0.2.0 <1.0.0"
  }
}
```

O `PluginManager` valida presença e compatibilidade antes da habilitação e ativação.

## Ações semânticas

Quando uma contribuição pede ao host para executar uma ação conhecida, use um contrato semântico público em vez de um comando interno do app.

Correto:

```js
{
  id: "python-environments.runScript",
  label: "Executar script Python",
  action: "runScript",
  icon: "play"
}
```

Incorreto:

```js
{
  command: "core.resource.runScript"
}
```

A ação descreve a intenção. O host decide como implementá-la.

## Configuração e estado do workbench

Contribuições visuais recebem `WorkbenchStateApi`. O snapshot público atual contém:

```ts
interface WorkbenchStateSnapshot {
  readonly workspaceName: string;
  readonly workspaceRoot?: string;
  readonly activePanelId: string;
  readonly panelVisible: boolean;
  readonly activeToolWindowId?: string;
  readonly toolWindowVisible: boolean;
  readonly selectedExecutionEnvironmentId?: string;
  readonly pluginSettings: PluginSettingsMap;
}
```

Use propriedades públicas diretamente:

```js
const environmentId = state.snapshot().selectedExecutionEnvironmentId;
```

Não crie chaves textuais privadas, como `state.selections["execution.environment"]`.

## Instalação durante o desenvolvimento

O servidor de desenvolvimento descobre diretórios sob `plugins/` que contenham `plugin.json`. O catálogo apresenta esses plugins na interface.

Fluxo local:

1. montar ou clonar o repositório em `plugins/<nome>`;
2. criar um `plugin.json` válido;
3. garantir que o entrypoint frontend exista;
4. iniciar o tinyIde;
5. abrir a view **Plugins**;
6. instalar e habilitar o plugin pelo catálogo.

Quando a versão do manifesto muda, o host atualiza a URL do entrypoint com a versão para evitar restauração de código antigo em cache.

## Checklist de implementação

Antes de considerar um plugin concluído:

- não importa `apps/web` nem `@tinyide/core`;
- não importa a implementação de outro plugin;
- usa somente tipos e contratos de `@tinyide/plugin-api`;
- adiciona todos os registros a `context.subscriptions`;
- usa `context.backend` para seu backend privado;
- não conhece prefixos ou rotas internas do host;
- não referencia comandos `core.*` para ações semânticas;
- possui typecheck contra o SDK público;
- possui testes de registro, comportamento e descarte;
- funciona quando outros plugins opcionais estão ausentes;
- pode ser desativado sem recarregar o editor.

## Validação arquitetural

A base deve manter testes que comprovem:

1. inicialização com zero plugins;
2. ausência de imports do core para plugins específicos;
3. ausência de imports dos plugins para core ou app;
4. instalação e remoção sem recompilar o core;
5. desaparecimento das contribuições após desativação;
6. falha de ativação isolada do restante do editor;
7. rejeição de versões e dependências inválidas;
8. inexistência de tratamento especial para plugins oficiais;
9. typecheck dos frontends contra o SDK público;
10. integração dos plugins validada no navegador.

## Limite de isolamento atual

A arquitetura atual elimina acoplamento, mas ainda não é uma sandbox de segurança. Frontends são carregados por `import()` e executam no mesmo contexto JavaScript do app.

Para plugins de terceiros não confiáveis, a evolução prevista é:

```text
plugin confiável     → import() direto
plugin não confiável → iframe sandbox ou Web Worker
backend não confiável → processo ou worker isolado com permissões
```

Consulte também [Segurança e isolamento](seguranca.md).
