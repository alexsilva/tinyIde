# tinyIde

O **tinyIde** é um editor de texto web extensível que se transforma em uma IDE pela composição de plugins.

Seu objetivo não é fornecer uma IDE especializada em uma tecnologia específica. O projeto fornece uma base genérica sobre a qual linguagens, frameworks, ferramentas, runtimes e integrações podem ser adicionados por meio de plugins instaláveis.

## Definição do produto

> Sem plugins, o tinyIde é apenas um editor de texto básico. Toda capacidade que o transforma em uma IDE é entregue por plugins instaláveis, removíveis e versionados de forma independente.

O tinyIde deve permanecer funcional sem qualquer plugin instalado. Nesse estado, a aplicação deve ser capaz apenas de:

- abrir e gerenciar workspaces;
- navegar por arquivos;
- editar e salvar conteúdo;
- organizar abas e o layout básico do editor;
- persistir o estado essencial do workspace;
- instalar, atualizar, habilitar, desabilitar e remover plugins.

## Princípios fundamentais

### O núcleo fornece mecanismos

O core concentra capacidades que não dependem de uma linguagem ou framework:

- editor;
- workspace;
- sistema de arquivos;
- comandos;
- eventos;
- configuração;
- interface da aplicação;
- gerenciamento de plugins;
- permissões e isolamento.

Esses mecanismos não devem produzir recursos de IDE por conta própria. Por exemplo, o core pode hospedar uma região de painel e expor uma API genérica de processos, mas o terminal visível e seus perfis de shell pertencem ao plugin de terminal.

### Plugins fornecem especialização

O suporte a Python, Django, JavaScript, Rust, Git, terminal, Docker, bancos de dados, depuração, testes ou qualquer outra ferramenta deve ser distribuído como plugin.

Esses plugins não pertencem ao repositório principal e não devem ser importados diretamente pelo core.

### A API pública define o limite

Plugins interagem com a plataforma exclusivamente por APIs públicas, estáveis e versionadas. O uso de módulos internos do tinyIde é considerado inválido.

## Estrutura desta documentação

- [Visão do produto](visao-do-produto.md): objetivos, escopo e critérios arquiteturais.
- [Arquitetura](arquitetura/index.md): componentes e limites da plataforma.
- [Core mínimo e validação](arquitetura/core-minimo.md): princípio que dá nome ao produto, regras de dependência e situação atual do código.
- [Núcleo da plataforma](arquitetura/core.md): responsabilidades do core.
- [Sistema de plugins](arquitetura/plugins.md): instalação, ativação e contratos de extensão.
- [Segurança e isolamento](arquitetura/seguranca.md): permissões e execução controlada.
- [Python e Django](ecossistema/python-django.md): primeiros plugins previstos, fora do codebase principal.
- [Roadmap](roadmap.md): evolução incremental do projeto.

