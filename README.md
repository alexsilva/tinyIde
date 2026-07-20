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

Validação completa:

```bash
npm run check
```

