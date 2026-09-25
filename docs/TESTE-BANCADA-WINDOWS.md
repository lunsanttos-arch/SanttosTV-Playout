# Santtos TV Automation — teste seguro no Windows

Esta etapa valida interface, importacao, timeline, roteiros, persistencia e relatorios
**sem criar fonte NDI**. A bancada tem banco exclusivo em
`%APPDATA%\\SanttosTVAutomation-Testbench\\database\\santtos-tv.json` e
relatorios em
`%APPDATA%\\SanttosTVAutomation-Testbench\\documents\\Santtos TV\\Relatórios de Exibição`.

## Antes de abrir

Use um computador de teste, com Node.js 22 e Git. Mesmo sendo uma bancada
isolada, nunca substitua a instalacao que esta no ar. Mantenha a pasta
`database` e os dados existentes com backup externo.

PowerShell:

```powershell
git clone https://github.com/lunsanttos-arch/SanttosTV-Playout.git
cd SanttosTV-Playout
npm ci
npm test
npm run dev:test
```

Se ja clonou o repositorio em outra pasta de desenvolvimento:

```powershell
git checkout main
git pull --ff-only
npm ci
npm test
npm run dev:test
```

**Nao use `npm run dev` para este primeiro ensaio:** esse comando nao
habilita a isolacao de dados e tenta ligar a fonte NDI PROGRAM real.

A faixa superior deve exibir "BANCADA ISOLADA — SEM SAÍDA NDI".
O player deve informar "PRÉVIA DE TESTE (SEM NDI)" quando estiver
reproduzindo. NDI OFFLINE neste modo e **esperado**, nao e falha.
O monitor usa os formatos aceitos pelo Chromium; a compatibilidade
de video do FFmpeg/NDI sera ensaiada depois com o sender nativo.

## Roteiro da primeira rodada

1. Abra a bancada e importe dois arquivos MP4 curtos, preferencialmente
   H.264 com audio AAC. Confirme miniaturas/metadata e status na biblioteca.
2. Adicione os dois clipes a timeline, reordene e edite in/out points.
   Salve a timeline; reproduza a previa, teste pausa, seek, proximo e loop.
3. Crie/edite um roteiro diario e aplique na timeline.
4. Configure uma pasta na biblioteca e adicione uma nova aba personalizada.
   Feche o aplicativo e inicie `npm run dev:test` novamente.
5. Verifique se a timeline, o roteiro, as abas e as configuracoes foram
   preservados. Confira os arquivos de relatorio na pasta da bancada.

Se houver erro, informe a acao, o texto exato exibido, se o video reproduz
na previa e o log do terminal. Nao compartilhe arquivos de cadastro reais
nem senhas de transporte.

**Limitacoes deste ensaio:** nao testa transmissao NDI, SRT, audio no ar,
instalador NSIS, sincronismo de 29.97 FPS nem um burn-in de 72 horas.
Essas validacoes entram em etapas proprias antes da homologacao.
