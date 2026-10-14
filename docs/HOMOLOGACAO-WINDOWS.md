# Homologação do candidato Windows

Status: roteiro preparado; instalador, recepção Windows NDI/OMT e transmissão contínua de 24/72 horas precisam de execução na bancada. Não interpretar testes Linux/DEV NULL como aprovação dessas etapas.

## Produzir um candidato rastreável

1. Máquina de build Windows x64: Node 24, MSVC x64 e SDK/runtime NDI licenciado. Definir `NDI_SDK_DIR` conforme `scripts/build-ndi.cmd`. OMT usa sender e DLLs oficiais presentes no projeto.
2. Preparar build FFmpeg/FFprobe mantido (mínimo 7.1.5) com codecs e filtros necessários; guardar origem, versão, licença e SHA-256. Colocar executáveis em `src/core/runtime` com manifest `{"ffmpegSha256":"…","ffprobeSha256":"…"}`. O check executa `-version`, verifica os hashes e exige os filtros, encoders e protocolos utilizados pelo PROGRAM, incluindo drawtext, libx264, AAC, SRT e RTMP. Arquivos LICENSE/SOURCE fornecidos junto ao runtime são incluídos nos recursos do pacote.
3. `npm ci`, `npm test`, `npm audit --audit-level=high`, `npm run build`. O build bloqueia NDI incompleto/antigo, OMT ausente ou runtime de mídia inválido. Não contornar esses bloqueios.
4. Alternativa automatizada: workflow **Windows release candidate**, em runner dedicado `[self-hosted, Windows, X64, santtos-release]`, com `NDI_SDK_DIR` e `SANTTOS_MEDIA_RUNTIME` configurados. Faz testes/build e produz instalador e SHA256SUMS como artifact. Não publica release final automaticamente. Assinatura Authenticode exige certificado de distribuição; registrar se o candidato foi assinado.
5. Instalar em Windows limpo sem Node/Git/Vite/SDK. Conferir ícone, abertura, atualização, desinstalação e preservação dos dados do usuário. Guardar o instalador anterior para rollback. Fazer backup de dados antes da atualização; uma versão antiga pode não compreender formatos de dados novos, portanto restaurar seu backup correspondente ao voltar.

## Matriz funcional em dois computadores

Registrar versão/commit, Windows, CPU/GPU/RAM/discos, perfil, topologia de rede, modelo do receptor e arquivos usados. Usar resolução/FPS/pixel format oficialmente oferecidos pelo produto; não liberar um perfil sem teste.

| Cenário | Evidência exigida |
|---|---|
| NDI e OMT em outro PC | Descoberta, imagem, canais L/R, ritmo e sincronismo; testar desligamento/retorno do receptor e firewall. ONLINE do sender não prova recepção. |
| SRT e RTMP | Caller/listener conforme oferecido, destino desligado e reconectado no mesmo item; validar A/V depois do retorno. |
| Grade local e HLS | Playlist repetida, IN/OUT, VFR, arquivo sem áudio e multicanal; medir primeira imagem, cortes e buracos de áudio no receptor. |
| HLS do usuário | `https://encode.ontvbrasil.com.br/PortoAlegre24hs/video.m3u8`: aplicar OPEC durante o ar; interromper requisições/rede; confirmar próximo vídeo e relatório. |
| Controles simultâneos | Logo nos blocos, hashtag, identificação, aplicar OPEC, LOOP, FRZ, pausa, seek, monitor e todas as saídas. Editar biblioteca/importar enquanto transmite. |
| Fontes inválidas | Arquivo removido/corrompido, URL indisponível e filler removido. Confirmar PULADO POR ERRO, motivo, sucessor e preto/silêncio contínuos. |
| Interface e processo | Encerrar renderer: motor segue. Encerrar processo principal: supervisor reabre no instalado. Fechar normalmente: não reabre. Não usar taskkill indiscriminado em apps Electron de terceiros. |
| Reinício do PC | Autostart no login, retomar checkpoint; pausa continua pausada, FRZ continua retido e grade concluída continua concluída. Testar rede ainda indisponível no login. |
| Disco e cache | Cache cheio, volume remoto indisponível, disco lento/sem espaço, histórico/biblioteca grandes. Medir efeito sobre quadros/A-V e mensagens de erro. |
| Backup e restauração | Exportar, pasta adicional offline, retenção, arquivo corrompido e restauração com player parado. Religar caminhos em outro PC. Não esperar cópia dos vídeos. |
| OPEC remoto | Pastas e drag/drop, lacunas vermelhas, substituição master, blocos encaixados nas próximas lacunas, desfazer e conflito de edição. Calendário e relatório abrem corretamente. |

## Ensaio de 24 horas e depois 72 horas reais

Executar no hardware-alvo, com receptores, fontes locais e ao vivo, saídas simultâneas e ações da matriz. Medir CPU/RAM de Electron e FFmpeg/senders pelo Monitor de Desempenho Windows, crescimento de buffers, perdas no receptor, sincronismo A/V e duração dos cortes. Registrar cada intervenção e interrupção planejada; definir os limites aceitos para cada perfil antes de aprovar.

O coletor observa uma instância com `--remote-debugging-port=9333` e escreve evidência em pasta separada:

```cmd
npm run burn-in -- --hours 24 --port 9333 --output C:\Santtos-QA\24h
npm run burn-in -- --hours 72 --port 9333 --output C:\Santtos-QA\72h
```

A porta de depuração deve ficar restrita à bancada e ao próprio PC. O coletor é observador; não abre nem modifica a playlist. `--smoke-seconds 5` testa apenas o coletor. `stress:72h` continua sendo ensaio acelerado de ciclos, sem homologar 72 horas reais ou receptores. O sumário do coletor mantém `receiverVerified: false`; anexar as medições externas e a matriz preenchida.

Condições mínimas: tempo real integral concluído, nenhuma falha espontânea não explicada, continuidade dentro dos limites acordados, recuperação dos incidentes induzidos, relatórios íntegros, memória/buffers estáveis e recepção A/V comprovada. Sem esses registros, o pacote permanece candidato/piloto assistido.

## Regressão funcional automática

`npm run test:native-integration` em Linux com DISPLAY/Xvfb abre uma instância descartável do Electron, sem transmissão NDI real. Verifica OPEC parado/no ar, FRZ, crash do renderer, arquivo removido, relatório, coletor e reabertura em PLAYING/PAUSED/FRZ/grade concluída. O CI instala FFmpeg completo e usa esse caminho; o runtime de release Windows continua sujeito aos gates acima. `npm run test:native-integration -- --live` acrescenta o HLS do usuário, gráficos no ar e bloqueio deliberado de requisições de segmento; depende de a transmissão externa estar disponível. Logs ficam em `build/native-qa`.
