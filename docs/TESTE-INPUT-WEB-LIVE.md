# Input Web ao vivo depois de um vídeo de 40 segundos

O próximo Input começa a preparar quando restam 15 segundos do item atual.
O tuner mantém uma janela local de três segmentos HLS, sem recodificar a origem.
O estado INPUT PRONTO exige quadros de vídeo realmente decodificados pelo FFprobe
e áudio decodificado quando a origem tem áudio. Abrir o processo não basta.

Na troca, o PROGRAM assume esse tuner e abre o segmento local mais recente.
O preparo não é cancelado pela mudança ENDED/seleção que acontece durante a troca.
Se o tuner encerrou ou a playlist ficou desatualizada, ele não é usado como pronto.
O STOP encerra o tuner, o servidor local e seus arquivos temporários.

Fontes gravadas com duração conhecida não são consumidas antecipadamente: elas
continuam abrindo diretamente no PROGRAM, preservando o início do conteúdo.
A janela HLS acrescenta a latência de segmentos à fonte ao vivo; não representa
vídeo de latência zero.

## Fonte pública usada no teste

France 24 English, 720p:

```text
https://live.france24.com/hls/live/2037218/F24_EN_HI_HLS/master_2300.m3u8
```

Encontrada no [catálogo IPTV](https://github.com/iptv-org/iptv/blob/master/streams/fr.m3u).
A URL é do domínio do canal. A playlist não tinha ENDLIST e seu MEDIA-SEQUENCE
avançou entre consultas. Vídeo e áudio também foram decodificados no teste.
Disponibilidade e URLs de transmissões públicas podem mudar.

## Reproduzir no Windows

1. Coloque um vídeo de 40 segundos primeiro na timeline.
2. Cadastre a URL acima no Input Web, protocolo HLS, motor FFmpeg, duração de 120 segundos.
3. Adicione esse Input como segundo item e reproduza o primeiro.
4. Confira PRÉ-CARREGANDO INPUT perto do segundo 25 e INPUT PRONTO antes do fim.
5. No terminal, confirme `Input pré-carregado assumido pelo PROGRAM` na troca.
6. Observe vídeo, áudio, pausa e parada no receptor e no monitor.

Na bancada Linux com DEV NULL SINK, o primeiro vídeo foi servido por HTTP para
manter a cadência real de 40 segundos sem um sender NDI Windows. O preparo começou
em 25,30 s, ficou pronto em 28,31 s e a entrada da France 24 com vídeo e PCM foi
detectada cerca de 206 ms após o evento de fim. A observação foi feita por polling
a cada 250 ms; não é uma medição de latência no receptor NDI/OMT Windows.

## QA automatizado

`npm run test:warm-input` gera HLS contínuo com vídeo e áudio em tempo real,
verifica segmentos avançando, confirma decodificação e testa take/cleanup.
Ele também faz parte de `npm test`.

Na máquina Linux em nuvem, use `FFMPEG_BIN=/usr/bin/ffmpeg` e
`FFPROBE_BIN=/usr/bin/ffprobe`. Os binários estáticos Linux deste ambiente falham
com SIGSEGV em algumas operações; os binários do sistema foram validados.
