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

## Preparação do ambiente

O build desktop é direcionado a distribuições Debian/Ubuntu em arquitetura `amd64`. O `node-pty`, usado pelo plugin Terminal, possui código nativo e exige uma toolchain de compilação instalada.

Ambiente validado:

- Node.js 24;
- npm 11;
- Linux `amd64` baseado em Debian.

Instale os pré-requisitos do sistema:

```bash
sudo apt update
sudo apt install -y build-essential python3 git
```

Clone o repositório incluindo os plugins mantidos como submódulos:

```bash
git clone --recurse-submodules <URL_DO_REPOSITORIO>
cd tinyIde
```

Para um checkout já existente, inicialize ou atualize os submódulos:

```bash
git submodule update --init --recursive
```

Instale as dependências do repositório principal:

```bash
npm ci
```

As dependências próprias do plugin Terminal são instaladas automaticamente por `npm run build:plugins`.

## Desenvolvimento no navegador

```bash
npm run dev
```

O Vite abre o navegador automaticamente. A aplicação fica disponível em:

```text
http://localhost:5173
```

Caso o sistema operacional não abra a janela, acesse esse endereço manualmente. Não abra `apps/web/index.html` diretamente por `file://`; a aplicação depende do servidor Vite.

O comando deve ser executado na raiz do repositório, onde está o `package.json` principal.

## Builds intermediários

Build apenas da aplicação web:

```bash
npm run build:web
```

Saída:

```text
apps/web/dist/
```

Build dos plugins que possuem frontend compilado:

```bash
npm run build:plugins
```

Esse comando prepara as dependências do Terminal e compila os plugins Git e Terminal.

Build completo dos recursos usados pelo Electron, sem gerar o pacote Debian:

```bash
npm run build:desktop
```

Para executar o host Electron diretamente durante o desenvolvimento:

```bash
npm run build:desktop
npm run start:desktop
```

## Gerar o pacote Debian

O projeto gera somente pacote `.deb` para Linux `amd64`:

```bash
npm run build:deb
```

O comando executa, nesta ordem:

1. build da aplicação web;
2. instalação das dependências próprias do Terminal;
3. build dos plugins Git e Terminal;
4. recompilação dos módulos nativos para o ABI do Electron;
5. geração do pacote Debian pelo `electron-builder`.

O artefato é criado em:

```text
release/tinyide_<versão>_amd64.deb
```

Exemplo para a versão atual:

```text
release/tinyide_0.1.0_amd64.deb
```

## Validar o pacote

Inspecione os metadados e o conteúdo antes de instalar:

```bash
dpkg-deb --info release/tinyide_*_amd64.deb
dpkg-deb --contents release/tinyide_*_amd64.deb
```

Instalação local:

```bash
sudo apt install ./release/tinyide_*_amd64.deb
```

Reinstalação da mesma versão:

```bash
sudo apt install --reinstall ./release/tinyide_*_amd64.deb
```

Remoção do pacote:

```bash
sudo apt remove tinyide
```

O pacote instala a aplicação em `/opt/tinyIde` e disponibiliza o comando `tinyide` em `/usr/bin`.

## Build limpo

Para remover apenas saídas geradas pelo repositório principal e reconstruir:

```bash
rm -rf apps/web/dist release
npm ci
git submodule update --init --recursive
npm run build:deb
```

Não remova manualmente os diretórios `plugins/git` e `plugins/terminal`; eles são submódulos Git.

## Validação completa

```bash
npm run check
```

Esse comando executa typecheck, testes, testes de desempenho, cobertura e builds configurados nos workspaces.

