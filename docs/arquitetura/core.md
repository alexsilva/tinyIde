# Núcleo da plataforma

## Responsabilidade

O core fornece capacidades universais de uma IDE. Ele organiza o estado da aplicação, expõe serviços e oferece contratos para extensões.

Nenhuma funcionalidade do núcleo deve depender de uma linguagem, framework ou ferramenta específica.

## Interface da aplicação

O shell visual deve controlar:

- layout;
- abas;
- painéis;
- menus;
- barra lateral;
- barra de status;
- caixas de diálogo;
- notificações;
- atalhos;
- temas;
- persistência de estado visual.

Plugins podem contribuir com elementos de interface por pontos de extensão declarados, mas não devem manipular diretamente o estado interno do shell.

## Editor

O editor deve fornecer operações genéricas:

- abrir, editar e salvar arquivos;
- múltiplas abas;
- histórico de navegação;
- seleção de linguagem;
- marcadores e decorações;
- integração com diagnósticos;
- integração com ações de código;
- integração com providers de navegação, hover e completion.

O editor não implementa regras de linguagem. Ele consome providers registrados por plugins.

## Workspace

O serviço de workspace deve fornecer:

- abertura e fechamento de diretórios;
- workspaces com uma ou múltiplas raízes;
- busca de arquivos;
- busca textual;
- observação de alterações;
- leitura e escrita;
- configuração por workspace;
- armazenamento de estado;
- identificação de recursos.

O workspace não deve inferir diretamente qual linguagem ou framework existe no projeto.

## Sistema de arquivos

O core deve expor uma API abstrata de filesystem:

```typescript
interface FileSystemApi {
  readFile(uri: Uri): Promise<Uint8Array>;
  writeFile(uri: Uri, content: Uint8Array): Promise<void>;
  stat(uri: Uri): Promise<FileStat>;
  readDirectory(uri: Uri): Promise<DirectoryEntry[]>;
  createDirectory(uri: Uri): Promise<void>;
  delete(uri: Uri, options?: DeleteOptions): Promise<void>;
  watch(uri: Uri, options?: WatchOptions): Disposable;
}
```

A implementação pode operar sobre:

- filesystem local;
- filesystem remoto;
- container;
- armazenamento em nuvem;
- armazenamento do navegador;
- filesystem virtual;
- repositório conectado.

## Processos

O runtime de processos deve ser genérico:

```typescript
interface ProcessService {
  spawn(command: ProcessCommand): Promise<ProcessHandle>;
}
```

O serviço deve suportar:

- diretório de trabalho;
- variáveis de ambiente;
- entrada padrão;
- saída padrão e de erro;
- cancelamento;
- código de saída;
- logs;
- associação com terminal;
- execução em um target específico.

O core não deve conhecer comandos como `python`, `manage.py`, `npm` ou `cargo`.

## Terminal

O terminal deve oferecer:

- criação de sessões;
- entrada e saída interativas;
- redimensionamento;
- encerramento;
- associação com processos;
- reconexão opcional;
- execução local ou remota.

Plugins podem criar perfis ou sessões especializadas por meio da API pública.

## Comandos

Toda ação da aplicação deve ser representada por um comando identificado por nome estável.

Exemplos do core:

```text
workspace.open
workspace.close
file.save
editor.close
terminal.create
plugin.install
plugin.disable
```

Plugins registram comandos adicionais sem alterar o registry central.

## Eventos

O event bus permite comunicação desacoplada.

Exemplos de eventos da plataforma:

```text
workspace.opened
workspace.closed
file.created
file.changed
editor.activeFileChanged
process.started
process.completed
plugin.installed
plugin.activated
plugin.failed
```

Eventos devem possuir payloads tipados, contratos versionados e regras claras de ordenação quando necessário.

## Configuração

O serviço de configuração deve aceitar os seguintes escopos:

- usuário;
- workspace;
- projeto;
- plugin;
- sessão.

Cada plugin declara seu próprio schema. O core valida, persiste e disponibiliza valores sem precisar conhecer o significado de cada chave.

## Armazenamento

Plugins devem possuir armazenamento isolado, identificado pelo seu próprio ID.

O serviço pode oferecer:

- estado local;
- estado por workspace;
- cache descartável;
- secrets, quando autorizado;
- migração de versões de dados.

