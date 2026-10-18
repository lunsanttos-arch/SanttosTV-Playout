# Reprodução da Biblioteca e nivelamento — 17/10/2026

## Assistir aos arquivos

O botão **Assistir** da Biblioteca abre um reprodutor local independente, dentro do Santtos, com pausa, busca e volume. Fechar ou pressionar Escape libera a mídia e devolve o foco. Essa reprodução não altera a fila, o decoder, o relógio ou as saídas do PROGRAM. O áudio de escuta usa o dispositivo local do computador.

São aceitos somente identificadores de materiais cadastrados. A resolução do arquivo utiliza a política existente de origem/cache, inclusive o fallback em cache quando disponível. O protocolo de mídia mantém autorização e suporte a busca por intervalos. Se o Chromium não conseguir reproduzir o formato, a janela oferece abertura no player do sistema, também restrita ao material cadastrado e às extensões de vídeo permitidas. Não se inicia uma transcodificação pesada durante o ar. O player do sistema depende das associações/codecs instalados no Windows.

### Programação e Opec remota

**Assistir** também está nos itens definidos da Programação e na Biblioteca da Opec, no aplicativo e no navegador. No roteiro, respeita IN/OUT do bloco: começa no IN, para no OUT e restringe a busca ao trecho. Conteúdos a definir e lacunas ao vivo não apresentam esse botão. A consulta não modifica itens, observações, duração ou fila do PROGRAM.

No navegador, o arquivo vem do master por uma rota HTTP autenticada pela sessão da Opec. São aceitos somente IDs de materiais cadastrados; a rota não recebe caminhos arbitrários do cliente. Suporta HEAD, Range e cancelamento quando a conexão é fechada. O master resolve origem/cache usando a política existente e não envia o catálogo inteiro a cada busca no vídeo. Não é necessário compartilhar as pastas do Windows com o computador da Opec.

A reprodução remota depende de um formato compatível com o navegador, como MP4/H.264/AAC. Um formato incompatível ou uma sessão encerrada gera um aviso; não se inicia conversão pesada em tempo real. A alternativa de abrir no player do sistema fica no aplicativo, onde existe acesso local ao arquivo.

Verificação: testes HTTP cobrem autenticação, HEAD, intervalos, busca inválida, ID inexistente, origem proibida e resolução em cache. `DISPLAY=:98 node scripts/run-native-qa.cjs --opec-watch-only` exercita a reprodução desktop de um bloco 2–4 s, busca limitada ao OUT, fila preservada, reprodução real no navegador autenticado e a continuidade do PROGRAM durante a consulta remota. Essa integração e `npm test` passaram após a extensão à Programação/Opec.

## Nivelamento de áudio

Ativado por padrão em **Configurações → Operação → Nivelamento de áudio**. Desligar e salvar mantém o decoder no ar; a escolha é aplicada na próxima abertura de material. O áudio original do arquivo não é modificado. A escuta independente da Biblioteca reproduz o original, sem o processamento de emissão.

A análise completa agora mede o áudio principal até o fim, usando `loudnorm` do FFmpeg para obter loudness integrado, true peak e LRA. Há medições separadas para o downmix mono e estéreo. Os resultados ficam associados à assinatura de aprovação do arquivo. Materiais aprovados na versão anterior recebem essa medição ao carregar a Biblioteca. O trabalho continua na fila única de baixa prioridade, com cancelamento e prazos limitados.

No decoder comum, antes de liberar PCM pelo relógio de vídeo:

1. Arquivo medido: ganho fixo para alvo inicial de **−23 LUFS**, limitado entre −36 e +18 dB. Não se amplifica automaticamente material medido abaixo de −60 LUFS. Silêncio permanece silêncio.
2. Ao vivo ou arquivo ainda sem medição válida: compressor RMS com canais vinculados, ataque de 20 ms, recuperação de 250 ms, razão 3:1 e ganho de compensação de 6 dB. Ele controla a dinâmica; não garante loudness integrado constante em um sinal ao vivo.
3. Limitador a 192 kHz, com teto interno de aproximadamente −1,5 dBFS, recuperação de 80 ms e compensação do lookahead de 5 ms; retorno à frequência configurada. O teto inclui margem para a reamostragem, mas não é uma promessa sobre o true peak após AAC ou o receptor.

NDI, OMT, SRT, RTMP, medidor e monitor recebem esse mesmo PCM. Não foi aberto um segundo decoder de áudio. As saídas mantêm o controle existente por quantidade de amostras associada aos quadros. Gain fixo e limitação preservam a maior parte da dinâmica; conteúdos com picos muito altos, ruído ou nível extremamente baixo podem não atingir exatamente −23 LUFS. Isso não constitui certificação de conformidade EBU/ATSC ou de uma norma contratual da emissora.

## Validação

- `npm run test:audio-leveling`: FFmpeg real, fontes com 26 dB de diferença, comparação de LUFS, medição mono e estéreo, transiente com picos, duração/quantidade exata de amostras, marcador de sincronismo em 44,1/48 kHz, silêncio e bypass.
- `node scripts/test-media-quality.js`: fila de QC com a medição incorporada, corrupção, substituição do arquivo e cancelamento.
- `DISPLAY=:98 node scripts/run-native-qa.cjs --library-only`: Chromium real reproduzindo arquivo, controles e Escape, PROGRAM e fila preservados, bloqueio de identificador não cadastrado, filtro no decoder comum e bypass salvo aplicado somente ao decoder seguinte.
- `npm test` e `DISPLAY=:98 node scripts/run-native-qa.cjs --live`: regressões de programação, persistência, recuperação, contingência, A/B e saídas, mais o HLS PortoAlegre24hs com gráficos/aplicação da Opec e interrupção de segmentos.

Resultado em 17/10/2026: os testes acima passaram em Linux/DEV NULL, incluindo a sequência completa e a repetição do teste de reprodução/foco depois do ajuste final da janela. O teste de HLS foi atualizado para a confirmação visível da aplicação e para uma grade alinhada à data/hora do ensaio, preservando a tolerância de três minutos.

Os testes em Linux/DEV NULL não substituem medição no Windows/vMix em 1080p59,94/60. O nível após os encoders, os canais L/R e o sincronismo físico ainda precisam ser homologados.
