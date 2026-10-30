# Instalador Windows x64 — 0.3.0-rc.1

Publicado em 30/10/2026 como candidato de instalação.

- [Instalador `.exe`](https://github.com/lunsanttos-arch/SanttosTV-Playout/releases/download/v0.3.0-rc.1/Santtos-Playout-Setup-0.3.0-rc.1.exe)
- [Kit, inventário e instruções](https://github.com/lunsanttos-arch/SanttosTV-Playout/releases/tag/v0.3.0-rc.1)
- Tamanho: 193.468.498 bytes.
- SHA-256: `4a750083ccbb544b04044e4435772ab5e58e0189b4e008a931da40327a0ba4b2`.
- Código empacotado: `c3335dde98bd26f90fbc13b6cf2663df414a4cde`.
- Authenticode: `NotSigned` (sem certificado de assinatura digital).

O PC de operação não precisa de Node/npm/Git/SDK. O pacote contém Electron, FFmpeg/FFprobe 9.0.2 e emissores NDI/OMT com seus runtimes. A mídia da emissora, os dados de operação e o cache não são incorporados ao instalador. Para migrar, exportar backup de dados do Santtos atual, instalar no usuário Windows de operação, importar o backup e conferir caminhos/unidades de rede e saídas. Consultar [INSTALACAO-LITE.md](INSTALACAO-LITE.md).

## Verificações executadas no Windows

O [build 41105547157](https://github.com/lunsanttos-arch/SanttosTV-Playout/actions/runs/41105547157) concluiu com sucesso:

- Execução das capacidades do NDI fornecido pelo responsável e inicialização real do runtime OMT.
- Conferência dos hashes e recursos de FFmpeg/FFprobe.
- TypeScript, bundle da interface e testes do frontend.
- Kit de release, runtime de mídia e nivelamento de áudio.
- RTMP/SRT: recepção H.264/AAC e reconexão; SRT Listener aguardando oito segundos antes da conexão do receptor.
- Geração NSIS e inventário dos componentes empacotados.
- Instalação silenciosa do próprio `.exe` em diretório temporário, conferindo hashes de 12 componentes instalados.
- Abertura do aplicativo instalado com perfil vazio isolado, IPC de produção e análise aprovada de vídeo gerado pelo runtime instalado.
- Motor PROGRAM do aplicativo instalado em `PLAYING`, com 25 quadros efetivamente entregues pelo decoder na amostra de conferência.

A [publicação 41106157710](https://github.com/lunsanttos-arch/SanttosTV-Playout/actions/runs/41106157710) conferiu a procedência do build, os hashes do kit e publicou a pré-release sem sobrescrever versões anteriores.

São verificações de instalação e funcionamento básico. Não constituem ensaio prolongado nem homologação de recepção NDI/OMT/vMix no equipamento da emissora. O espelhamento entre dois PCs permanece uma especificação futura e não foi implementado neste pacote.

## Ajustes encontrados durante a preparação

O teste de captura passou a pedir encerramento normal do FFmpeg para fechar o arquivo antes de analisá-lo. `SIGINT` via Node encerrava o processo abruptamente no Windows, produzindo amostras incompletas no teste.

No transporte SRT Listener, o período para esvaziar os buffers iniciais agora considera o momento da conexão do receptor. Antes, uma conexão depois de oito segundos podia ser tratada como encoder travado ao iniciar. O ajuste mantém limites de memória e não muda o relógio ou a velocidade das amostras de áudio/vídeo.
