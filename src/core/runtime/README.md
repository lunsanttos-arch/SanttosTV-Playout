# Runtime de release Windows

A distribuição profissional usa `ffmpeg.exe`, `ffprobe.exe` e `manifest.json` nesta pasta. O pacote deve ser uma versão mantida (no mínimo 7.1.5) e homologada na bancada; os binários do ffmpeg-static permanecem apenas como fallback de desenvolvimento.

O manifest contém `{"ffmpegSha256":"...","ffprobeSha256":"..."}`. O build verifica a versão e os hashes dos executáveis antes de empacotar. Registre também a origem, versão, licença e obrigações de distribuição do build utilizado. Não altere os arquivos de um instalador já publicado.

Os binários não são versionados no Git; o workflow de release usa o diretório SANTTOS_MEDIA_RUNTIME de uma máquina Windows dedicada, com executáveis e manifest previamente aprovados; confere versões e SHA-256 antes de montar o pacote. Variáveis opcionais FFMPEG_BIN/FFPROBE_BIN permitem escolher runtimes para a bancada.

Arquivos LICENSE e SOURCE são obrigatórios no candidato Lite (o conteúdo precisa ser revisado pela equipe). `npm run build:lite` gera o instalador NSIS Windows x64 e um kit versionado com inventário e hashes, sem sobrescrever candidatos anteriores. Consulte `docs/INSTALACAO-LITE.md`. A presença dos documentos não certifica, por si, direitos de redistribuição.
