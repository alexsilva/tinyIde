# Python e Django

## Papel no projeto

Python e Django são as primeiras tecnologias previstas para validar o modelo de extensibilidade do tinyIde.

Eles não fazem parte do núcleo e não devem ser adicionados ao repositório principal.

A função desses plugins é provar que a API pública do tinyIde é suficiente para implementar uma experiência completa de linguagem e framework sem acoplamento interno.

## Distribuição independente

Estrutura conceitual:

```text
tinyide-core
tinyide-plugin-python
tinyide-plugin-django
```

Cada projeto possui:

- repositório próprio;
- versionamento próprio;
- pipeline próprio;
- documentação própria;
- pacote instalável próprio;
- compatibilidade explícita com versões do tinyIde.

## Plugin Python

Responsabilidades previstas:

- detectar projetos Python;
- reconhecer `pyproject.toml`, `requirements.txt`, `setup.py` e arquivos `.py`;
- descobrir interpretadores;
- selecionar runtime;
- criar ambientes virtuais;
- instalar dependências;
- executar arquivos e módulos;
- integrar testes;
- fornecer lint e formatação;
- integrar type checking;
- fornecer depuração;
- integrar um servidor de linguagem.

O plugin Python deve orquestrar ferramentas externas por adaptadores. Ele não precisa reimplementar ambientes virtuais, package managers, test runners ou servidores de linguagem.

Capacidades possíveis:

```text
python.runtime
python.environment
python.packageManager
python.testing
python.debug
```

## Plugin Django

O plugin Django deve depender do plugin Python.

Responsabilidades previstas:

- detectar `manage.py`;
- localizar módulos de configuração;
- identificar apps;
- executar servidor de desenvolvimento;
- criar e aplicar migrations;
- criar apps;
- abrir shell;
- executar testes;
- apresentar rotas;
- oferecer visualizações de models, templates e migrations.

Manifesto conceitual:

```json
{
  "id": "tinyide.django",
  "version": "1.0.0",
  "dependencies": {
    "tinyide.python": ">=1.0.0 <2.0.0"
  }
}
```

Consumo de uma capacidade Python:

```typescript
const pythonRuntime = context.capabilities.get<PythonRuntime>(
  "python.runtime"
);

await pythonRuntime.executeFile({
  file: "manage.py",
  args: ["runserver"]
});
```

## Critério de sucesso

Os plugins Python e Django validam a arquitetura quando:

1. podem ser instalados e removidos sem alteração no core;
2. usam apenas APIs públicas;
3. declaram permissões e dependências;
4. operam em diferentes execution targets;
5. falham sem derrubar a aplicação;
6. podem ser atualizados independentemente;
7. podem ser substituídos por implementações alternativas.

## Não objetivo

O tinyIde não deve se tornar uma IDE Python com suporte posterior a outras linguagens.

Python e Django são consumidores iniciais da plataforma, não fundamentos arquiteturais do produto.

