# Arquivos MKV

O Santtos já aceita `.mkv` na seleção e varredura da biblioteca, no arraste de arquivos para a Programação e no protocolo autorizado de consulta. O PROGRAM abre o original pelo FFmpeg, sem exigir conversão para MP4. A aprovação de qualidade continua obrigatória, como nos demais formatos.

MKV é um contêiner: os codecs de vídeo e áudio contidos nele também precisam ser suportados. A compatibilidade do motor FFmpeg é diferente da compatibilidade do player HTML do Chromium ou do navegador da Opec. Não se deve prometer que todo MKV abrirá em qualquer navegador. O player de consulta do aplicativo oferece abertura no player do sistema quando o formato não é compatível; a prévia MP4 existente é uma cópia de consulta, não uma conversão obrigatória para exibição.

## Verificação em 27/10/2026

O executor nativo permite selecionar `SANTTOS_QA_CONTAINER=mkv` (padrão: `mp4`). Ele gera um MKV real com H.264/AAC, importa pelo IPC de produção, aguarda a análise completa e verifica que o caminho preservou o contêiner original.

Com FFmpeg/FFprobe do sistema e Electron real em Linux/Xvfb, passaram:

- `--library-only`: consulta Chromium, pause/seek/volume/fechamento e reprodução simultânea no motor sem alterar sua geração ou PID.
- `--opec-watch-only`: consulta do trecho na Programação do aplicativo e da versão web, com limites de entrada/saída.
- `--monitor-only`: vídeo no canvas do PROGRAM e agendamento PCM/WebAudio, recuperação após travamento simulado do monitor e manutenção do mesmo decoder no motor.

O teste `npm run test:proxy` também passou com MKV de origem: gera prévia H.264/AAC, reutiliza cache e mantém autorização do acesso.

Exemplo reproduzível no ambiente de desenvolvimento Linux:

```sh
DISPLAY=:98 FFMPEG_BIN=/usr/bin/ffmpeg FFPROBE_BIN=/usr/bin/ffprobe \
SANTTOS_QA_CONTAINER=mkv node scripts/run-native-qa.cjs --library-only
```

Esses testes verificam o MKV H.264/AAC gerado. Não substituem a validação dos codecs de cada distribuidora nem a recepção física NDI/OMT no Windows.
