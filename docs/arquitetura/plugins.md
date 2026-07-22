# Sistema de plugins

## Objetivo

O sistema de plugins transforma o tinyIde em uma plataforma extensível. Linguagens, frameworks, ferramentas e integrações são instalados conforme a necessidade do usuário ou do workspace.

Plugins não fazem parte do codebase principal. Durante o desenvolvimento, repositórios independentes podem ser montados em `plugins/` como submódulos Git, sem criar dependência de compilação ou imports no core.

## Componentes

### Plugin API

Define os contratos públicos disponíveis para extensões.

### Plugin manager

Gerencia descoberta, instalação, atualização, habilitação, desabilitação e remoção.

### Plugin host

Executa plugins em ambiente controlado, aplica permissões e captura falhas.

### Capability registry

Permite que plugins publiquem e consumam capacidades sem imports diretos.

### Extension hosts de interface

Regiões genéricas do shell recebem contribuições de interface. Um plugin deve poder registrar e remover uma barra lateral, painel inferior, item de status, ação ou editor especializado sem que o core conheça sua finalidade.

## Manifesto

Todo plugin deve possuir um manifesto declarativo.

```json
{
  "id": "tinyide.python",
  "name": "Python",
  "description": "Suporte a projetos e ambientes Python",
  "version": "1.0.0",
  "publisher": "tinyide",
  "engines": {
    "tinyide": ">=1.0.0 <2.0.0"
  },
  "entrypoints": {
    "frontend": "./dist/frontend.js",
    "backend": "./dist/backend.js"
  },
  "activationEvents": [
    "onLanguage:python",
    "workspaceContains:pyproject.toml",
    "workspaceContains:requirements.txt"
  ],
  "permissions": [
    "workspace.read",
    "workspace.write",
    "process.execute"
  ],
  "contributes": {
    "commands": [],
    "configuration": {},
    "taskProviders": [],
    "debugProviders": []
  }
}
```

O manifesto permite que o tinyIde avalie compatibilidade, permissões e contribuições antes de executar código do plugin.

Plugins oficiais seguem exatamente o mesmo manifesto, contexto, permissões e ciclo de vida de plugins externos. Qualquer exceção específica por ID de plugin é uma violação arquitetural.

## API pública

Exemplo conceitual do contexto entregue a um plugin:

```typescript
interface PluginContext {
  readonly commands: CommandRegistry;
  readonly workspace: WorkspaceApi;
  readonly filesystem: FileSystemApi;
  readonly processes: ProcessApi;
  readonly terminals: TerminalApi;
  readonly configuration: ConfigurationApi;
  readonly events: EventApi;
  readonly capabilities: CapabilityRegistry;
  readonly storage: PluginStorageApi;
  readonly ui: PluginUiApi;
  readonly subscriptions: Disposable[];
}
```

Uso válido:

```typescript
const folders = await context.workspace.getFolders();
```

Uso inválido:

```typescript
import { internalWorkspaceStore } from "@tinyide/workspace/internal";
```

## Ciclo de vida

Estados possíveis:

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

Fluxo esperado:

```text
instalação
→ validação
→ registro do manifesto
→ habilitação
→ espera por evento de ativação
→ ativação
→ execução
→ desativação
```

Ao desativar ou remover um plugin, todas as contribuições, comandos, listeners, sessões e recursos registrados por ele devem ser descartados. A aplicação deve retornar ao estado anterior sem recarregar ou recompilar o core.

## Eventos de ativação

Plugins devem ser carregados sob demanda.

Exemplos:

```text
onStartup
onCommand:python.runFile
onLanguage:python
onView:django.projects
workspaceContains:manage.py
workspaceContains:pyproject.toml
onCapability:python.runtime
```

A ativação tardia reduz tempo de inicialização, consumo de memória e superfície de falha.

## Pontos de contribuição

Plugins podem contribuir com:

### Interface

- painéis;
- views;
- menus;
- barra lateral;
- status bar;
- ações de editor;
- context menus;
- formulários.

### Editor

- linguagens;
- syntax highlighting;
- completion;
- diagnostics;
- hover;
- definição e referências;
- rename;
- formatting;
- code actions;
- semantic tokens.

### Workspace

- detectores de projeto;
- indexadores;
- watchers;
- árvores customizadas;
- recursos virtuais.

### Execução

- tarefas;
- runtimes;
- ambientes;
- terminais;
- shells;
- build providers.

### Debug e testes

- adapters de depuração;
- sessões;
- descoberta de testes;
- execução;
- cobertura;
- visualização de resultados.

## Registro de capacidades

Plugins devem se comunicar por capacidades públicas.

```typescript
interface CapabilityRegistry {
  register<T>(id: string, provider: T): Disposable;
  get<T>(id: string): T;
  tryGet<T>(id: string): T | undefined;
  getAll<T>(id: string): T[];
}
```

Exemplos:

```text
language.provider
task.provider
debug.provider
testing.provider
environment.provider
runtime.provider
python.runtime
django.project
git.repository
docker.executionTarget
```

## Dependências entre plugins

Um plugin pode declarar dependência de outro.

```json
{
  "id": "tinyide.django",
  "dependencies": {
    "tinyide.python": ">=1.0.0 <2.0.0"
  }
}
```

O plugin manager deve:

- validar a existência da dependência;
- resolver a ordem de ativação;
- detectar ciclos;
- impedir ativação quando requisitos obrigatórios não forem atendidos;
- informar incompatibilidades de versão.

## Instalação

O plugin manager deve suportar múltiplas fontes:

- marketplace oficial;
- registry privado;
- URL;
- pacote local;
- diretório de desenvolvimento;
- repositório Git;
- pacote fornecido pelo workspace.

Responsabilidades do processo de instalação:

- validar manifesto;
- verificar integridade;
- validar assinatura quando disponível;
- resolver dependências;
- conferir compatibilidade;
- apresentar permissões;
- persistir metadados;
- registrar a versão instalada.

## Versionamento

A API de plugins deve seguir versionamento semântico.

Plugins declaram a faixa de compatibilidade no campo `engines.tinyide`.

Mudanças incompatíveis na API pública devem ocorrer apenas em versões major da plataforma.

## Teste de desacoplamento

A implementação deve manter testes que comprovem:

1. inicialização com zero plugins;
2. ausência de imports do core para diretórios de plugins;
3. instalação e remoção sem recompilar a aplicação;
4. desaparecimento das contribuições após desativação;
5. falha de ativação isolada do restante do editor;
6. rejeição de permissões, versões e dependências inválidas;
7. inexistência de tratamento especial para plugins oficiais.

