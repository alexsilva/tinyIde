# tinyIde

IDE web extensível e agnóstica de linguagem.

O repositório contém o núcleo da plataforma e sua documentação. Suporte a linguagens e frameworks, incluindo Python e Django, será distribuído por plugins instaláveis externos ao codebase principal.

## Documentação

```bash
python -m pip install -r requirements-docs.txt
python -m mkdocs serve
```

## Protótipo

O protótipo inicial contém:

- shell web de IDE;
- command registry;
- event bus;
- capability registry;
- plugin manager;
- validação e persistência de manifestos externos;
- abertura de diretórios pela File System Access API do navegador.

Python, Django e plugins de demonstração não são incorporados ao repositório principal.

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

