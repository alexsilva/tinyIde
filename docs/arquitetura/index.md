# Arquitetura

## Visão geral

O tinyIde é dividido em quatro camadas principais:

```text
┌───────────────────────────────────────────────┐
│ Shell web mínimo                              │
│ Editor de texto, arquivos e hosts de extensão │
├───────────────────────────────────────────────┤
│ Serviços genéricos do core                    │
│ Workspace, comandos, eventos, processos       │
├───────────────────────────────────────────────┤
│ Infraestrutura de extensibilidade             │
│ Plugin API, host, manager e permissões         │
├───────────────────────────────────────────────┤
│ Plugins externos                              │
│ Terminal, Git, linguagens, ferramentas e IA   │
└───────────────────────────────────────────────┘
```

O limite entre o core e os plugins é definido pela API pública da plataforma.

## Organização atual do repositório principal

```text
tinyide/
├── apps/
│   └── web/
├── packages/
│   ├── core/
│   └── plugin-api/
├── plugins/                 # submódulos/repositórios independentes para desenvolvimento
├── docs/
└── site/
```

O diretório `plugins/` não torna as extensões parte do core. Cada entrada deve apontar para um repositório independente, possuir manifesto próprio e ser carregada apenas pelo runtime de plugins.

Exemplos aceitáveis:

```text
examples/
├── hello-world-plugin/
├── sample-command-plugin/
└── sample-panel-plugin/
```

Nenhum pacote de `apps/` ou `packages/` pode importar código desses diretórios.

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

