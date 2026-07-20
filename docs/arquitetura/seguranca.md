# Segurança e isolamento

## Modelo de ameaça

Plugins são código executável e podem solicitar acesso a arquivos, processos, rede, secrets e interface da aplicação. A plataforma deve assumir que uma extensão pode ser defeituosa, incompatível ou maliciosa.

O sistema de plugins precisa limitar o impacto de falhas e impedir acesso implícito a recursos privilegiados.

## Permissões

Cada plugin deve declarar as permissões necessárias no manifesto.

Exemplos:

```text
workspace.read
workspace.write
process.execute
terminal.create
network.request
storage.read
storage.write
secrets.read
ui.contribute
clipboard.read
clipboard.write
```

O usuário deve poder:

- consultar permissões antes da instalação;
- aprovar permissões sensíveis;
- revogar permissões quando possível;
- identificar qual plugin iniciou uma operação;
- desabilitar uma extensão problemática.

## Plugin host

O plugin host deve:

- carregar código em ambiente controlado;
- criar o contexto de execução;
- aplicar permissões;
- registrar contribuições;
- controlar o ciclo de vida;
- capturar exceções;
- limitar consumo de recursos;
- coletar logs;
- descarregar plugins;
- impedir que uma extensão bloqueie a interface principal.

## Estratégias de isolamento

Dependendo da responsabilidade do plugin, a execução pode ocorrer em:

- Web Worker;
- processo separado;
- worker no backend;
- iframe isolado;
- sandbox;
- container;
- runtime remoto.

Plugins frontend não devem receber acesso direto a recursos privilegiados do backend. Chamadas sensíveis devem passar por APIs autenticadas e validadas.

## Falhas

Falhas de plugins devem ser tratadas como erros isolados.

O host deve registrar:

- plugin responsável;
- versão;
- evento de ativação;
- operação executada;
- erro recebido;
- stack trace quando disponível;
- impacto sobre contribuições registradas.

O core deve permanecer operacional mesmo quando um plugin entra no estado `failed`.

## Integridade e procedência

O processo de instalação deve permitir:

- checksum do pacote;
- assinatura digital;
- identificação do publisher;
- origem do pacote;
- histórico de versões;
- bloqueio de versões revogadas;
- políticas corporativas de allowlist e denylist.

## Secrets

Secrets não devem ser expostos como configurações comuns.

O serviço de secrets deve:

- isolar dados por plugin;
- exigir permissão explícita;
- evitar retorno desnecessário do valor bruto;
- registrar operações administrativas relevantes;
- usar armazenamento seguro quando disponível.

