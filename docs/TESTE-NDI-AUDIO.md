# Bancada NDI com áudio: homologação no Windows

Esta versão retira o diagnóstico operacional opcional. No PROGRAM,
as duas abas **NO AR** e **PRÓXIMO** foram reduzidas e há duas barras
verticais L/R ao lado do vídeo. No modo de prévia elas medem o áudio do
player Chromium; no modo NDI elas medem o PCM do FFmpeg na origem do
pipe NDI. **Não são um medidor de áudio recebido no vMix.**

## 1. Entender os três modos

| Comando | Banco | Fonte NDI | Áudio |
| --- | --- | --- | --- |
| `npm run dev:test` | Bancada isolada | NDI desativado | Barras da prévia |
| `npm run dev:ndi-test` | Bancada NDI separada | **Santtos TV - QA** | FFmpeg f32le 48kHz estéreo no sender NDI |
| `npm run dev` | Banco normal | **Santtos TV - PROGRAM** | Sender compatível envia PCM; antigo continua somente vídeo |

**Não abra duas versões simultaneamente**, principalmente se o
computador estiver realizando transmissão. O modo QA só pode iniciar
quando `ndi_test.exe --capabilities` comprova nome configurável e áudio.
Antes dessa verificação, executáveis legados nunca são invocados com
parâmetros desconhecidos — isso poderia criar acidentalmente uma segunda
fonte PROGRAM.

## 2. Atualizar o projeto existente

No CMD da pasta atual com o Santtos TV fechado:

```cmd
git status
git pull --ff-only origin main
npm run test:ndi-audio
npm run check:ndi
```

Se o Git mostrar alterações locais, preserve-as antes do `pull`.
Caso `npm ci` apresente EPERM em `esbuild.exe`, feche todos os
processos Electron/Vite/esbuild que estejam usando o arquivo e tente
novamente. **Não é necessário mover a pasta do projeto.**

Se `npm run check:ndi` reprovar por versão antiga, compile o binário
nativo com o NDI SDK oficial **instalado por você** e o compilador
Microsoft Visual C++ x64 (Visual Studio 2022, workload C++).

Abra o **x64 Native Tools Command Prompt for VS 2022**, navegue até
a mesma pasta do projeto e execute:

```cmd
set "NDI_SDK_DIR=C:\Program Files\NDI\NDI 6 SDK"
scripts\build-ndi.cmd
npm run check:ndi
```

Se o SDK estiver em outro diretório, mude `NDI_SDK_DIR`.
O `build-ndi.cmd` usa os arquivos existentes do SDK, compila
`src/core/ndi/ndi_test.cpp` e copia a DLL localmente, sem enviá-la
para terceiros. Use somente a distribuição autorizada pela licença
NDI. O teste automatizado `test:ndi-audio` verifica decodificação
real FFmpeg e os níveis L/R, mas **não substitui a compilação C++ com
o SDK nem um teste do receptor NDI**.

## 3. Abrir o teste NDI

```cmd
npm run dev:ndi-test
```

O título da janela deve conter **TESTE NDI (FONTE QA)**.
A faixa do cabeçalho deve exibir **BANCADA NDI — FONTE QA**.
Importe uma mídia com áudio estéreo para a biblioteca da bancada QA
(ela tem banco próprio, separado da bancada de prévia e do playout
principal). O arquivo original não é movido nem alterado.

No vMix ou NDI Studio Monitor **de outra estação da rede**,
localize a fonte **Santtos TV - QA**. Ela não deve substituir
**Santtos TV - PROGRAM**. Antes de PLAY, a fonte exibe quadro preto.
Dê PLAY no Santtos TV e valide **vídeo e áudio** no receptor.

## 4. Verificação operacional de áudio

- Confira as barras L/R da tela PROGRAM enquanto reproduz um
  vídeo com áudio; elas indicam o PCM *entregue ao canal de áudio local*.
- Confira se o medidor correspondente do vMix recebe sinal e se o
  canal selecionado no vMix está habilitado, sem MUTE.
- Ouça uma mídia com fala e verifique **sincronismo labial** no começo,
  na metade e após mais tempo de reprodução.
- Reproduza uma mídia com um tom somente no canal esquerdo e outra
  somente no direito para verificar se L/R não foram trocados.
- Pause, avance (seek), alterne entre dois arquivos e finalize o último.
  O áudio deve cessar na pausa e voltar no próximo PLAY sem congelamento.
- Teste um arquivo sem áudio: deve aparecer **SEM FAIXA**, nunca
  um sinal L/R falso. Teste um arquivo com mais de uma faixa,
  verificando que o áudio selecionado pela biblioteca é o transmitido.

O sistema usa dois processos FFmpeg (vídeo e PCM áudio) com o mesmo IN,
OUT e arquivo, e ambos são enviados pelo mesmo NDI sender. A produção
ainda requer medir o sincronismo real e eventuais derivações com o
receptor; **não considere o áudio homologado só porque as barras mexem**.

## 5. Limites e segurança

O teste NDI **não é o modo `dev:test`**: ele emite uma fonte de rede,
embora com nome QA e banco separado. Evite executá-lo na máquina que
estiver no ar. O áudio da prévia local e a monitoração de áudio
do vMix podem provocar eco se forem ouvidos simultaneamente.

Se o novo áudio não for reconhecido no vMix, registre o aviso do
cabeçalho e o nome de fonte em teste. Isso permite separar problema
de compilação/pipe nativo, detecção de faixa de áudio, recepção
ou sincronismo de PLAY.
