# Correção: imagem NDI partida no meio durante troca/corte

## Problema reproduzido

O FFmpeg entrega uma sequência de **bytes** BGRA, não um quadro por
evento de leitura. O antigo encadeamento enviava cada pedaço diretamente
ao stdin do sender NDI, que esperava sempre 1920×1080×4 = **8.294.400 bytes**
por quadro. Ao interromper um clipe ou dar seek no meio de um quadro,
o sender podia receber o começo do clipe novo como se fosse o final do
quadro antigo. O resultado é a imagem deslocada/partida e o erro pode
continuar nas imagens seguintes.

## Alteração

O novo `RawVideoFrameAligner` monta **quadros BGRA inteiros** antes
de enviá-los ao sender. Cada PLAY/seek ganha um montador novo. Em STOP,
o restante de um quadro incompleto é descartado, em vez de atravessar a
fronteira entre dois arquivos. O processo NDI permanece aberto e o
backpressure da pipe continua funcionando, sem buffer de quadros ilimitado.

A correção é no processo principal do Electron e funciona **também
com o executável NDI antigo (somente vídeo)**. Não precisa recompilar
`ndi_test.exe` só para corrigir a imagem partida. Para ativar áudio
NDI em conjunto, ainda é necessário compilar o sender moderno com o SDK.

## Teste na pasta atual do Windows

Com o Santtos TV fechado, sem substituir arquivos locais modificados:

```cmd
git status
git pull --ff-only origin main
npm run test:ndi-video
```

O teste não precisa do sender NDI nem do SDK: simula várias cenas Full HD,
bytes divididos dentro de pixels e linhas, **corte no meio de um quadro**,
novo PLAY, seek e sender com backpressure. Verifica que todos os quadros
recebidos continuam completos e que nenhum contém bytes do vídeo anterior.

Para conferir no receptor, abra a bancada NDI (fonte **Santtos TV - QA**):

```cmd
npm run check:ndi
npm run dev:ndi-test
```

A bancada NDI exige o executável moderno e instala um banco separado.
Se `check:ndi` informar sender antigo, não execute o comando QA;
continue usando a bancada `npm run dev:test` para testar interface e
conclua a compilação conforme `docs/TESTE-NDI-AUDIO.md` antes de
transmitir o sinal de teste.

Com a fonte QA no vMix, reproduza vídeo, avance 30 s, pause/reinicie,
troque entre dois vídeos e observe se nenhum quadro fica dividido na
lateral. **Não testar na fonte PROGRAM da emissora durante transmissão.**

Um teste automatizado de bytes não comprova a ausência de todos os
problemas no decoder/vMix/rede. Caso a imagem continue partida no
receiver após esta versão, enviar uma captura do vMix junto da versão
do `ndi_test.exe`, método de entrada e se ocorre apenas após um corte
ou já no primeiro quadro.
