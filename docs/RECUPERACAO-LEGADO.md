# Recuperação local

A pasta `.recovery/` é reservada a cópias de trabalho, inventários, relatórios locais e arquivos de recuperação. Ela é ignorada pelo Git e não faz parte da aplicação nem da distribuição pública.

## Preservar e verificar

- Mantenha os originais e seus históricos ao preparar uma integração.
- Use `git bundle verify caminho-do-backup.bundle` para conferir um backup Git.
- Compare os hashes SHA-256 registrados no inventário local.
- Exercite a restauração clonando o bundle em um diretório novo; não sobrescreva o checkout em uso.
- Consulte o relatório local para saber o alcance dos arquivos preservados e das verificações realizadas.

Backups Git abrangem arquivos versionados. Banco de dados, Auth, credenciais e arquivos ignorados precisam de uma rotina de backup própria. Não publique arquivos de recuperação ou relatórios contendo informações privadas no repositório público.
