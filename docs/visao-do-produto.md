# Visão do produto

## Problema

Ambientes de desenvolvimento web frequentemente nascem acoplados a uma linguagem, a um framework ou a uma forma específica de execução. Esse acoplamento dificulta a evolução do produto, aumenta o custo de manutenção e transforma cada nova integração em uma alteração estrutural no núcleo da IDE.

O tinyIde propõe uma separação explícita entre infraestrutura e especialização. O nome do produto descreve essa decisão: sem plugins, o aplicativo deve ser pequeno em capacidades e funcionar somente como editor de texto.

O núcleo deve conhecer conceitos como arquivo, documento, comando, região de interface, processo abstrato, diagnóstico e workspace. Ele não deve conhecer ferramentas concretas como terminal, Git, `manage.py`, ambiente virtual Python, `npm`, `cargo`, migration Django ou servidor de linguagem específico.

## Objetivo

Construir uma IDE web capaz de receber suporte a diferentes stacks sem exigir alterações no core.

O produto deve permitir que plugins adicionem:

- linguagens de programação;
- frameworks;
- servidores de linguagem;
- depuradores;
- test runners;
- linters e formatadores;
- gerenciadores de dependências;
- ferramentas de build;
- integrações com controle de versão;
- bancos de dados;
- containers e ambientes remotos;
- serviços externos;
- agentes de inteligência artificial.

## Escopo do núcleo

O core deve oferecer apenas capacidades genéricas:

1. shell básico da aplicação;
2. editor de texto e navegação de arquivos;
3. gerenciamento de workspace;
4. abstração de filesystem;
5. serviços abstratos necessários aos plugins, como processos;
6. command registry;
7. event bus;
8. configuração e persistência;
9. plugin API;
10. plugin host;
11. plugin manager;
12. controle de permissões.

## Fora do escopo do núcleo

O repositório principal não deve incluir implementações de suporte a tecnologias específicas.

São exemplos de funcionalidades externas ao core:

- terminal interativo e perfis de shell;
- integração com Git e outros sistemas de controle de versão;
- detecção de `pyproject.toml`;
- interpretação de `requirements.txt`;
- descoberta de interpretadores Python;
- criação de ambientes virtuais;
- execução de `pytest`;
- integração com `ruff`, `mypy`, `debugpy` ou Pyright;
- detecção de `manage.py`;
- execução de `runserver`, `migrate` ou `makemigrations`;
- execução de `npm`, `cargo`, `mvn` ou ferramentas equivalentes.

## Modelo de distribuição

O core e os plugins possuem ciclos de vida independentes.

Exemplo conceitual:

```text
tinyide-core
tinyide-plugin-python
tinyide-plugin-django
tinyide-plugin-git
tinyide-plugin-docker
```

Cada plugin pode ser distribuído por:

- marketplace oficial;
- registry privado;
- arquivo local;
- URL;
- repositório Git;
- diretório de desenvolvimento;
- pacote vinculado ao workspace.

## Critérios arquiteturais

A arquitetura deve atender aos seguintes critérios.

### Remoção

O tinyIde deve executar sem qualquer plugin instalado e continuar capaz de editar arquivos de texto.

### Independência

Remover os plugins Python e Django não pode exigir alteração no core.

### Extensibilidade

Uma nova linguagem deve poder ser integrada exclusivamente por APIs públicas.

### Substituição

Uma implementação de plugin deve poder ser substituída por outra que ofereça as mesmas capacidades.

### Isolamento

Uma falha em um plugin não deve derrubar a aplicação inteira.

### Segurança

Um plugin deve acessar apenas recursos autorizados.

### Compatibilidade

O plugin manager deve rejeitar extensões incompatíveis com a versão atual da plataforma.

### Desacoplamento

Plugins devem interagir por contratos e capacidades, nunca por imports internos entre pacotes.

### Simetria

Plugins mantidos pelo próprio projeto devem usar a mesma API pública, o mesmo ciclo de vida e as mesmas permissões disponíveis para plugins de terceiros. Não existem plugins privilegiados por imports, condições especiais ou acesso direto ao estado do shell.

