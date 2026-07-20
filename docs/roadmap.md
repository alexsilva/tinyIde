# Roadmap

## Direção

O roadmap deve validar primeiro os contratos da plataforma. A implementação de muitas funcionalidades especializadas antes da estabilização da Plugin API aumentaria o acoplamento e dificultaria a evolução do projeto.

## Fase 1 — Fundação do core

Objetivo: fornecer uma IDE mínima funcional sem plugins de linguagem.

Entregas:

- shell visual;
- editor;
- explorer;
- workspace;
- filesystem abstrato;
- terminal;
- execução genérica de processos;
- command registry;
- event bus;
- configuração;
- persistência de estado;
- logs da plataforma.

Critério de conclusão:

> O usuário consegue abrir um workspace, editar arquivos, executar comandos genéricos e usar o terminal sem instalar suporte a uma linguagem.

## Fase 2 — Infraestrutura de plugins

Objetivo: permitir a instalação e execução de extensões externas.

Entregas:

- manifesto;
- Plugin API inicial;
- plugin host;
- plugin manager;
- instalação local;
- ativação tardia;
- habilitação e desabilitação;
- registro de comandos;
- registro de contribuições de interface;
- capability registry;
- armazenamento isolado;
- logs por plugin.

Critério de conclusão:

> Um plugin de demonstração externo pode ser instalado, ativado, executar um comando e contribuir com uma view sem acessar módulos internos.

## Fase 3 — Segurança e compatibilidade

Objetivo: tornar o ecossistema controlável e previsível.

Entregas:

- permissões declarativas;
- isolamento de execução;
- validação de compatibilidade;
- dependências entre plugins;
- detecção de ciclos;
- checksums;
- assinatura opcional;
- políticas de origem;
- tratamento de falhas;
- limites de recursos.

## Fase 4 — Plugin Python externo

Objetivo: validar suporte completo a uma linguagem sem alterar o core.

Entregas do projeto externo:

- detecção de projeto;
- seleção de interpretador;
- ambientes virtuais;
- execução de arquivos e módulos;
- package managers;
- testes;
- lint;
- formatação;
- type checking;
- depuração;
- servidor de linguagem.

Qualquer deficiência encontrada deve resultar em evolução genérica da Plugin API, nunca em uma exceção específica para Python no core.

## Fase 5 — Plugin Django externo

Objetivo: validar composição entre plugins.

Entregas do projeto externo:

- dependência explícita do plugin Python;
- detecção de projeto Django;
- comandos de gerenciamento;
- servidor de desenvolvimento;
- migrations;
- testes;
- visualizações de apps, rotas e models.

## Fase 6 — Distribuição

Objetivo: permitir descoberta e distribuição segura de extensões.

Entregas:

- catálogo ou marketplace;
- registries privados;
- pesquisa;
- instalação por versão;
- atualização;
- rollback;
- identificação de publishers;
- canais estável e experimental;
- políticas corporativas.

## Regras de evolução

Durante todas as fases:

1. o core não deve importar plugins reais;
2. a API pública deve ser preferida a acessos internos;
3. contratos devem ser versionados;
4. falhas devem ser observáveis;
5. permissões devem ser explícitas;
6. execution targets devem permanecer abstratos;
7. funcionalidades específicas devem ser implementadas fora da base.

