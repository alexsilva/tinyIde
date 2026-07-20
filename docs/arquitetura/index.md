# Arquitetura

## Visão geral

O tinyIde é dividido em quatro camadas principais:

```text
┌───────────────────────────────────────────────┐
│ Interface web                                 │
│ Editor, painéis, menus, terminal e navegação  │
├───────────────────────────────────────────────┤
│ Serviços genéricos do core                    │
│ Workspace, comandos, eventos, processos       │
├───────────────────────────────────────────────┤
│ Infraestrutura de extensibilidade             │
│ Plugin API, host, manager e permissões         │
├───────────────────────────────────────────────┤
│ Plugins externos                              │
│ Linguagens, frameworks, ferramentas e runtimes│
└───────────────────────────────────────────────┘
```

O limite entre o core e os plugins é definido pela API pública da plataforma.

## Organização sugerida do repositório principal

```text
tinyide/
├── apps/
│   ├── web/
│   └── server/
├── packages/
│   ├── core/
│   ├── editor/
│   ├── workspace/
│   ├── filesystem/
│   ├── terminal/
│   ├── process-runtime/
│   ├── command-registry/
│   ├── event-bus/
│   ├── configuration/
│   ├── plugin-api/
│   ├── plugin-host/
│   ├── plugin-manager/
│   ├── permissions/
│   ├── storage/
│   └── ui-kit/
├── docs/
├── tests/
└── examples/
```

O diretório `examples` pode conter plugins mínimos usados apenas para demonstrar a API pública.

Exemplos aceitáveis:

```text
examples/
├── hello-world-plugin/
├── sample-command-plugin/
└── sample-panel-plugin/
```

Plugins reais de linguagem ou framework não devem existir nessa estrutura.

## Regra de dependência

As dependências devem apontar para dentro da plataforma, nunca para implementações externas.

```text
plugin externo
    ↓
plugin API pública
    ↓
serviços do core
```

O caminho inverso é proibido:

```text
core
    ✕ importa plugin Python
    ✕ conhece Django
    ✕ executa regras de framework
```

## Agnosticismo de execução

O tinyIde deve ser independente do local onde comandos são executados.

Uma abstração de target permite que a mesma funcionalidade opere em diferentes ambientes:

```typescript
interface ExecutionTarget {
  readonly id: string;
  readonly type: "local" | "container" | "remote" | "browser";

  execute(command: ProcessCommand): Promise<ProcessHandle>;
}
```

Targets possíveis:

- processo local no servidor;
- container;
- host remoto via SSH;
- ambiente cloud;
- sandbox;
- runtime WebAssembly;
- execução no próprio navegador.

Plugins de linguagem devem consumir essa abstração e não assumir um sistema operacional ou infraestrutura específicos.

