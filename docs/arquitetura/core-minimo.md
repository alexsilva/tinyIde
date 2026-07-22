# Core mínimo e validação das premissas

## Por que o produto se chama tinyIde

O nome **tinyIde** descreve o limite arquitetural do produto, não o tamanho da interface. Sem plugins, a aplicação é apenas um editor de texto básico com gerenciamento de workspace e de extensões. A experiência de IDE é formada pela composição de plugins.

Consequentemente, terminal, Git, linguagens, ambientes, execução, testes, depuração, bancos de dados e agentes não pertencem ao core. O fato de um plugin ser mantido pelo próprio projeto não altera essa regra.

## Regra de dependência

```text
plugin concreto
    ↓
@tinyide/plugin-api
    ↓
serviços e extension hosts do core
```

O sentido inverso é proibido. O core não pode importar plugins, consultar IDs conhecidos para alterar seu comportamento ou expor APIs privadas para extensões oficiais.

## Mecanismo e capacidade

O core pode fornecer um **mecanismo genérico** usado por plugins, mas não a **capacidade concreta** apresentada ao usuário.

| Mecanismo do core | Capacidade fornecida por plugin |
| --- | --- |
| região encaixável de painel | terminal, problemas de uma ferramenta, banco de dados |
| registro de comandos | commit, executar teste, criar ambiente |
| serviço abstrato de processos | shell, test runner, servidor de desenvolvimento |
| decorações e diagnósticos | lint de Python, TypeScript ou outra linguagem |
| capability registry | runtime Python, repositório Git, target Docker |
| armazenamento com namespace | configuração e cache de cada plugin |

## Critérios de aceitação

A separação está correta quando:

1. a aplicação inicia com zero plugins e continua editando texto;
2. remover todos os plugins não deixa painéis ou comandos específicos órfãos;
3. `apps/` e `packages/` não importam módulos de plugins concretos;
4. plugins oficiais usam somente `@tinyide/plugin-api` e endpoints autorizados;
5. instalação, ativação e remoção não exigem recompilar o core;
6. toda contribuição retorna um `Disposable` ou possui ciclo de vida equivalente;
7. falhas e permissões de um plugin são isoladas;
8. configurações de plugin usam namespace próprio e escopo explícito;
9. dependências entre plugins são declaradas no manifesto;
10. uma implementação pode ser substituída por outra que ofereça a mesma capacidade.

## Validação da implementação em 22 de julho de 2026

Esta seção registra o estado observado no código e deve ser revisada conforme a arquitetura evoluir.

### Premissas confirmadas

| Premissa | Evidência atual |
| --- | --- |
| O core não importa plugins concretos | `packages/core` depende de `@tinyide/plugin-api`; não foram encontrados imports para `plugins/`. |
| Plugins possuem distribuição independente | `plugins/python`, `plugins/python-venv` e `plugins/terminal` estão registrados como submódulos em `.gitmodules`. |
| Descoberta e carregamento são genéricos | `apps/web/src/app/platform.ts` lê manifestos e usa import dinâmico do entrypoint informado. |
| Plugins publicam capacidades | Python, ambientes e terminal registram providers no `CapabilityRegistry`, sem import direto pelo core. |
| Desativação remove registros | `ModulePluginHost` descarta as subscriptions do contexto em ordem reversa. |
| Estado sem plugins é funcional | Em um perfil novo do navegador, a aplicação iniciou com `0 plugin(s)` e apresentou explorador, editor de texto e painéis genéricos, sem terminal ou ambientes. |
| Configuração local existe | `apps/web/execution-backend.mjs` persiste o workspace em `.tinyide/settings.json`. |

### Premissas atendidas parcialmente

| Área | Situação encontrada | Consequência |
| --- | --- | --- |
| Interface do terminal | `apps/web/src/app/App.tsx` importa XTerm e implementa o painel e a sessão do terminal. O provider vem do plugin, mas a apresentação concreta ainda pertence ao shell. | O plugin de terminal não é totalmente substituível e o core web conhece detalhes da ferramenta. |
| Neutralidade de linguagem | `App.tsx` contém textos, formulários e fluxos de ambientes Python, além de um perfil padrão com executável `python`. | O shell conhece Python e venv, contrariando o core agnóstico. |
| Limite da Plugin API | `packages/plugin-api/src/index.ts` contém operações específicas como `createVenv` e `validatePythonExecutable`. | Contratos de um plugin concreto passaram a fazer parte da API pública da plataforma. |
| Eventos de ativação | Os manifestos declaram `activationEvents`, mas `TinyIdePlatform` ativa o plugin imediatamente após instalar ou restaurar. | Ainda não há ativação tardia real. |
| Permissões | Manifestos declaram permissões, mas não há aplicação efetiva delas no host ou nos endpoints. | A permissão é informativa, não uma fronteira de segurança. |
| Isolamento | `ModulePluginHost` usa import dinâmico no mesmo contexto JavaScript da aplicação. | Erros de ativação são capturados, mas o plugin não está isolado em worker, iframe ou processo. |
| Backend de plugins | O middleware de desenvolvimento localiza backends pelo manifesto no filesystem, sem vincular a rota ao estado instalado e habilitado do plugin manager. | O ciclo de vida do backend não acompanha integralmente o frontend. |
| Escopo de ativação | Instalação e estado habilitado são persistidos globalmente em `localStorage`. | Ainda não existe política completa de habilitação por workspace. |

## Prioridades arquiteturais

1. Remover do shell toda interface e semântica específica de Python e ambientes virtuais.
2. Transformar terminal, ambientes e outras tool windows em contribuições completas de interface, não apenas providers de dados.
3. Separar contratos universais da API de contratos pertencentes a plugins específicos.
4. Implementar ativação por evento, verificação de permissões e isolamento do plugin host.
5. Vincular backend, recursos e descarte ao mesmo ciclo de vida do plugin.
6. Definir instalação global e habilitação/configuração por workspace de forma explícita.

Esses pontos não invalidam o caminho atual. A base de manifesto, plugin manager, capability registry, carregamento dinâmico e submódulos já demonstra a direção correta; os principais desvios estão na interface web e no excesso de contratos especializados dentro da API pública.
