# Evidência do candidato 0.3.0-rc.1

Bancada executada em Linux, Node 24, Electron 44.7.2 e FFmpeg/FFprobe 7.1.5. O runtime Electron foi verificado pelo SHA-256 oficial do pacote. As execuções nativas usam perfis descartáveis, sem emissão NDI real.

- `npm test`: suíte completa aprovada; inclui backup, restauração, recuperação, controlador, relatórios, gráficos, transportes, PCM, pacing, blocos/desfazer, segurança, backend, frontend e as novas regressões do motor/supervisor.
- Electron real: aplicar OPEC parado e durante o ar; respeitar FRZ; encerrar renderer durante exibição; pular arquivo removido com relatório e sucessor. O backend continuou e a interface reconectou ao estado real.
- Fechar/reabrir: item e posição retomados; pausa mantida; FRZ retido; grade concluída não reiniciada. Uma gravação atrasada do cliente não substituiu o checkpoint do item em execução.
- HLS `https://encode.ontvbrasil.com.br/PortoAlegre24hs/video.m3u8`: aplicação OPEC durante o ar, 80 alterações de gráficos sem trocar geração e três blocos locais seguintes. Repetição com bloqueio de requisições de segmentos confirmou a saída para os próximos blocos.
- SRT/RTMP simultâneos: H.264/AAC em receptores FFmpeg loopback; destinos derrubados e restabelecidos durante o mesmo item; saída recuperada sem depender do próximo item.
- SRT usando o motor do Electron, com NDI e OMT desligados: preto/silêncio antes da mídia, clipe local de 4 segundos em aproximadamente 4,12 segundos de execução incluindo a abertura, áudio real recebido e fluxo mantido após EOF. O primeiro quadro recebido foi preto com crominância neutra.
- PCM PROGRAM: conexão de pipe real, bytes recebidos, reconexão automática e fechamento deliberado. Standby: silêncio contínuo, supressão enquanto o decoder entrega imagem, troca de perfil e contagem racional de amostras.
- Relatórios: horário de entrada efetiva na primeira imagem, XLSX/HTML/XML válidos, motivo/sucessor de PULADO POR ERRO e duração parcial desconhecida identificada após interrupção. Pasta restaurada inválida voltou à pasta padrão.
- Auditoria de dependências: produção sem vulnerabilidades; conjunto completo sem altas/críticas, com oito entradas moderadas de uma cadeia de ferramentas de build. Ver descrição em OPERACAO-E-RECUPERACAO.md.
- O coletor de burn-in foi testado por poucos segundos. Isso valida o coletor, **não** 24/72 horas reais.

Não executados: instalador NSIS em Windows limpo, SDK/senders NDI/OMT Windows com receptores em outro PC, assinatura do instalador, matriz completa de perfis e ensaios físicos de 24/72 horas. O gate de pacote nesta nuvem bloqueia corretamente a ausência do runtime NDI. O workflow preparado exige máquina Windows e runtimes aprovados; não foi anunciado um instalador pronto.

Ver [HOMOLOGACAO-WINDOWS.md](HOMOLOGACAO-WINDOWS.md) para critérios, medidas de cortes/A-V, carga de disco/histórico, ensaio contínuo e rollback. Pré-carga local A/B completa e migração das gravações JSON restantes dependem dessas medidas; não são declaradas implementadas por esta evidência.
