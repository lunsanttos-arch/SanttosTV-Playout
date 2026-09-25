# Santtos TV Automation

Sistema de automacao e playout local para Windows, com interface Electron,
biblioteca de midias, timeline, roteiro diario, FFmpeg e saida NDI.

## Situacao do projeto

Versao npm atual: 0.2.0. Ainda e um **alpha para ensaios**, nao uma versao
homologada para transmissao ininterrupta.

- Banco atual: JSON persistido em `app.getPath("userData")/database/santtos-tv.json`.
  Nao ha SQLite implementado nesta versao.
- Escrita do banco, configuracao da biblioteca e historico de exibicao: atomica,
  com backup `.bak`. Arquivos danificados bloqueiam a inicializacao, preservando
  o original em vez de substituir a grade por dados vazios.
- Saida NDI nativa: **somente video** 1920x1080 29.97p neste momento.
  O sinal de audio ainda nao e enviado pelo sender C++.
- Os campos SRT nas configuracoes estao implementados como configuracao, mas o
  transporte SRT de saida nao esta integrado ao playout deste repositorio.
- O `ndi_test.exe` e a DLL do SDK nao estao no Git, portanto a clonagem do
  repositorio, por si so, nao habilita NDI nativo.

## Rodar para desenvolvimento (Windows)

```powershell
npm ci
npm run test
npm run dev
```

Para visualizar o sinal NDI, compile o sender C++ com o SDK oficial NDI x64
e copie os binarios para `src/core/ndi/`. Sao necessarios
`ndi_test.exe` e `Processing.NDI.Lib.x64.dll`, compativeis entre si.
O programa mostra NDI OFFLINE e tenta reiniciar o sender quando ele nao estiver
disponivel; nao confunda esta tentativa com sinal efetivamente transmitido.

## Gerar instalador Windows

```powershell
npm ci
npm test
npm run build
```

O comando de build verifica previamente a presenca dos dois binarios NDI e
bloqueia a distribuicao de um instalador incompleto. O builder copia esses
arquivos para `resources/ndi`, fora do ASAR, e desempacota FFmpeg/FFprobe.

**Licenciamento:** a distribuicao da biblioteca NDI depende dos termos atuais
do SDK e do contrato de licenca do aplicativo. Leia
https://docs.ndi.video/all/developing-with-ndi/sdk/software-distribution
antes de distribuir a DLL ou um instalador contendo-a.

## Operacao e recuperacao

Antes de instalar na maquina do ar, faca copia do banco, biblioteca e historico
de exibicao e execute ensaios com videos reais no Windows. Se o banco estiver
danificado, o programa bloqueia a inicializacao; **nao apague o original**.
Recupere a ultima copia verificada `.bak` depois de confirmar seu conteudo.
O banco legado da pasta `database/` do projeto e copiado, sem ser apagado,
quando a pasta de dados do usuario ainda nao possui banco.

O QA automatizado inclui testes de seguranca, dados, frontend e stress de
fumaca. Ele nao substitui os testes de video, audio, sincronismo, NDI e
recuperacao de falha na bancada de transmissao.
