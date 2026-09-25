# QA — identificação editorial dentro da imagem do PROGRAM

O campo **Exibição** na Timeline e no OPEC/Scheduler é por ocorrência.
A marcação **Inédito**, **Reprise**, **Estreia**, **Especial** ou **Ao vivo**
é agora desenhada no vídeo de saída do FFmpeg, acima da posição configurada
para o logo. **Normal** não desenha legenda. O texto é branco em uma tarja
preta translúcida, alinhada à borda direita da marca d'água.

A legenda é desenhada *depois* do logo e do GC/hashtag no mesmo filtro do
PROGRAM: acompanha o frame NDI quando o sender nativo estiver disponível.
O monitor interno simula a mesma posição. Mudar a posição do logo nas
configurações também move a legenda. Se o logo estiver encostado no topo
da imagem, não haverá espaço físico acima dele; reposicione-o para baixo.

## Teste seguro do editor e monitor no Windows

Na pasta atual do projeto, **após concluir qualquer operação Git pendente**
e com o OneDrive pausado se estiver bloqueando `.git/objects`:

```cmd
git status
git pull --ff-only origin main
npm ci
npm run test:exhibition-output
npm run dev:test
```

Na bancada, marque **Logo** em um item da timeline e escolha **Reprise**.
Selecione-o: a tarja **REPRISE** deve aparecer na imagem do monitor,
acima do logo. Troque para **Inédito** e confira **INÉDITO**.
Troque para **Normal** e confira que a tarja desaparece. Salve no roteiro
OPEC, aplique-o e reabra o programa; a marcação deve persistir.

O script `test:exhibition-output` usa FFmpeg para renderizar **três
frames Full HD** com INÉDITO, REPRISE e AO VIVO; não exige um SDK NDI.
Ele verifica a validade da expressão e do filtro, mas não comprova a
chegada do sinal no receptor nem teste de sobreposição na imagem real.

## Validar a saída NDI efetiva

`npm run dev:test` desativa intencionalmente o NDI. Para validar o vídeo
transmitido, use uma **bancada separada da máquina do ar**, com
`ndi_test.exe` e `Processing.NDI.Lib.x64.dll` compilados e compatíveis.
Ligue a fonte NDI em um receiver (vMix ou NDI Studio Monitor) e compare
o programa com a prévia interna. Não execute outro sender com o mesmo
nome **Santtos TV - PROGRAM** simultaneamente na rede de produção.

O caminho atual do NDI transmite somente vídeo, sem áudio PCM integrado.
