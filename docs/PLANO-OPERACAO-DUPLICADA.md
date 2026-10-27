# Operação futura em duas máquinas

Requisito informado pelo responsável em 17/10/2026 (America/Sao_Paulo): após a implantação na TV, o Santtos deverá trabalhar em duplicata com outra máquina.

Essa necessidade deve orientar as próximas decisões de arquitetura: identificar versões dos materiais e da programação, permitir replicação verificável e preparar recuperação coerente de estado. O modo de operação entre as máquinas, o mecanismo de comutação e a política de sincronização ainda precisam ser definidos; não há redundância automática implementada ou homologada nesta etapa.

Atualização de 27/10/2026: o responsável confirmou dois computadores com vMix. A proposta de duas cadeias completas, arbitragem externa e implantação por etapas está em [OPERACAO-DUPLICADA-ARQUITETURA.md](OPERACAO-DUPLICADA-ARQUITETURA.md).
