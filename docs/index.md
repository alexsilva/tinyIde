# tinyIde

O **tinyIde** é uma plataforma de desenvolvimento integrada executada no navegador, projetada para ser extensível, agnóstica de linguagem e independente do ambiente de execução.

Seu objetivo não é fornecer uma IDE especializada em uma tecnologia específica. O projeto fornece uma base genérica sobre a qual linguagens, frameworks, ferramentas, runtimes e integrações podem ser adicionados por meio de plugins instaláveis.

## Definição do produto

> O tinyIde é uma plataforma web de desenvolvimento extensível. O núcleo oferece infraestrutura genérica de IDE; funcionalidades específicas de linguagens, frameworks e ferramentas são entregues por plugins externos, instaláveis e versionados de forma independente.

O tinyIde deve permanecer funcional sem plugins de linguagem instalados. Nesse estado, a aplicação ainda deve ser capaz de:

- abrir e gerenciar workspaces;
- navegar por arquivos;
- editar e salvar conteúdo;
- abrir terminais;
- executar comandos genéricos;
- persistir configurações;
- instalar, atualizar, habilitar, desabilitar e remover plugins.

## Princípios fundamentais

### O núcleo fornece mecanismos

O core concentra capacidades que não dependem de uma linguagem ou framework:

- editor;
- workspace;
- sistema de arquivos;
- terminal;
- execução de processos;
- comandos;
- eventos;
- configuração;
- interface da aplicação;
- gerenciamento de plugins;
- permissões e isolamento.

### Plugins fornecem especialização

O suporte a Python, Django, JavaScript, Rust, Git, Docker, bancos de dados ou qualquer outra tecnologia deve ser distribuído como plugin.

Esses plugins não pertencem ao repositório principal e não devem ser importados diretamente pelo core.

### A API pública define o limite

Plugins interagem com a plataforma exclusivamente por APIs públicas, estáveis e versionadas. O uso de módulos internos do tinyIde é considerado inválido.

## Estrutura desta documentação

- [Visão do produto](visao-do-produto.md): objetivos, escopo e critérios arquiteturais.
- [Arquitetura](arquitetura/index.md): componentes e limites da plataforma.
- [Núcleo da plataforma](arquitetura/core.md): responsabilidades do core.
- [Sistema de plugins](arquitetura/plugins.md): instalação, ativação e contratos de extensão.
- [Segurança e isolamento](arquitetura/seguranca.md): permissões e execução controlada.
- [Python e Django](ecossistema/python-django.md): primeiros plugins previstos, fora do codebase principal.
- [Roadmap](roadmap.md): evolução incremental do projeto.

