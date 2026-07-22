# tinyIde

Editor web extensível que se transforma em uma IDE pela instalação de plugins.

Sem plugins, o tinyIde deve permanecer um editor de texto básico: abre workspaces, navega por arquivos, edita e salva texto e gerencia extensões. Linguagens, terminal, controle de versão, execução, depuração, bancos de dados, agentes e integrações pertencem a plugins independentes.

O repositório contém o núcleo da plataforma e sua documentação. Os plugins usados durante o desenvolvimento são repositórios independentes montados em `plugins/` como submódulos Git; eles não podem ser importados pelo core nem receber APIs privadas.

## Documentação

```bash
python -m pip install -r requirements-docs.txt
python -m mkdocs serve
```

## Protótipo

O núcleo atual contém:

- shell web de IDE;
- command registry;
- event bus;
- capability registry;
- plugin manager;
- validação e persistência de manifestos externos;
- abertura de diretórios pela File System Access API do navegador.

O objetivo arquitetural e a validação da implementação atual estão documentados em [Core mínimo e validação das premissas](docs/arquitetura/core-minimo.md).

```bash
npm install
npm run dev
```

O Vite abre o navegador automaticamente. A aplicação fica disponível em:

```text
http://localhost:5173
```

Caso o sistema operacional não abra a janela, acesse esse endereço manualmente. Não abra `apps/web/index.html` diretamente por `file://`; a aplicação depende do servidor Vite.

O comando deve ser executado na raiz do repositório, onde está o `package.json` principal.

Validação completa:

```bash
npm run check
```

