# SanTTos Playout Lite — instalação e atualização

O pacote Windows x64 inclui o aplicativo e os runtimes de reprodução e saídas por rede. O computador de operação não precisa de Node, npm, Git, Vite ou SDK NDI. Saída física SDI/HDMI dedicada não integra esta edição.

## Primeira instalação

1. Use o instalador da versão entregue e confira seu SHA-256 com `Get-FileHash .\Santtos-Playout-Setup-VERSAO.exe -Algorithm SHA256` no PowerShell, comparando com `SHA256SUMS.txt` recebido por um canal confiável. Confira o editor/assinatura Authenticode; um hash não substitui assinatura digital.
2. Execute o instalador no usuário Windows que operará o sistema. Mantenha esse usuário nas atualizações. O instalador permite escolher a pasta e cria atalhos; os dados permanecem no perfil do usuário, separados dos binários.
3. Abra pelo atalho. Configure biblioteca, perfil e saídas. Autorize apenas as regras de rede necessárias na rede da emissora. Confira recepção real no vMix e os caminhos dos materiais antes de operar.

## Atualizar sem perder os dados

1. Em Configurações → Backup de dados, use **Exportar backup** e guarde o arquivo `.santtos-backup` fora da pasta de instalação. Identifique a versão correspondente. Guarde também o instalador anterior.
2. O backup inclui os dados definidos pelo aplicativo; não inclui vídeos/cache e não substitui uma cópia completa do perfil para retorno de versão. Com o Santtos fechado, copie também a pasta de dados inteira para um local separado. Na instalação padrão ela fica em `%APPDATA%\santtos-tv-playout`; confirme o caminho da pasta de backups mostrado no aplicativo (a pasta de dados é a pasta pai de `data-backups`).
3. Faça a atualização em janela de manutenção, com saída de contingência disponível. Feche normalmente o aplicativo antes de executar o novo instalador. Não atualize enquanto estiver no ar.
4. Instale no mesmo usuário/local. O instalador preserva os dados; não inicia automaticamente a reprodução ao finalizar. Abra o aplicativo e confira biblioteca, programação, posição, relatórios e saídas.

## Voltar à versão anterior

1. Feche normalmente o aplicativo e preserve uma cópia dos dados atuais para diagnóstico.
2. Reinstale o instalador anterior. Com o aplicativo fechado, restaure a cópia completa da pasta de dados feita naquela versão; mantenha a cópia atual separada. Não misture dados novos com antigos.
3. Abra e confira caminhos, programação e saídas antes de voltar ao ar. A restauração `.santtos-backup` também existe no aplicativo, mas cobre somente os arquivos enumerados nesse formato; não é rollback completo do perfil.

Não existe atualização automática nem garantia de compatibilidade de dados novos com versões antigas. A desinstalação preserva os dados; sua exclusão deve ser uma ação deliberada, depois do backup.

## Preparar o candidato (equipe técnica)

Em Windows x64 com Node 24, MSVC e SDK NDI licenciados, prepare o runtime conforme `src/core/runtime/README.md`, incluindo arquivos LICENSE e SOURCE. Execute `npm ci`, `npm test` e `npm run build:lite`. O comando compila o NDI, verifica os runtimes, gera NSIS e monta `build/release-VERSAO` com instalador, inventário, lockfile, hashes e estes roteiros.

O diretório de candidato não é sobrescrito. Para outro candidato, preserve o anterior fora de `build` e use uma nova versão. `release.json` registra versões/hashes dos componentes essenciais; não certifica homologação ou direitos de redistribuição. Revise também as licenças NDI, OMT, codecs, Electron e dependências antes da venda. Assinatura requer certificado configurado no ambiente de build. O candidato só vira versão final após a homologação documentada em `HOMOLOGACAO-WINDOWS.md`.
