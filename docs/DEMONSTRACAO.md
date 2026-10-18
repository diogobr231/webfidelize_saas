# Contas de demonstração

Criadas a pedido do proprietário. Endereços reservados `.invalid`, sem caixas postais reais e sem envio de e-mails. A senha foi a fornecida pelo proprietário, não registrada neste repositório. Não reutilizar estas contas para operar empresas reais.

| Segmento     | Login                        | Página pública local                            |
| ------------ | ---------------------------- | ----------------------------------------------- |
| Salão        | salao@example.invalid        | http://localhost:3000/agendar/demo-salao        |
| Pet shop     | pet-shop@example.invalid     | http://localhost:3000/agendar/demo-pet-shop     |
| Clínica      | clinica@example.invalid      | http://localhost:3000/agendar/demo-clinica      |
| Escritório   | escritorio@example.invalid   | http://localhost:3000/agendar/demo-escritorio   |
| Restaurante  | restaurante@example.invalid  | http://localhost:3000/agendar/demo-restaurante  |
| Fornecedores | fornecedores@example.invalid | http://localhost:3000/agendar/demo-fornecedores |
| Logística    | logistica@example.invalid    | http://localhost:3000/agendar/demo-logistica    |
| Academia     | academia@example.invalid     | http://localhost:3000/agendar/demo-academia     |

Cada empresa tem dois clientes, dois serviços, dois profissionais e um agendamento inicial fictício. O plano Empresarial foi atribuído somente para testar os limites durante o trial de sete dias, sem simular pagamento ou assinatura ativa. Dados adicionais de QA podem aparecer no salão.

O script `scripts/seed-demo.sql` só cria tenants marcados como DEMO e pode ser repetido sem duplicar essas empresas. Não altera dados de empresas reais. As contas Auth foram provisionadas por uma função temporária com autenticação própria de curta duração; depois ela foi substituída por resposta 404 e JWT obrigatório. Nenhuma chave service_role foi copiada para o app.

O administrador usa a conta particular escolhida pelo proprietário; seu endereço e senha não são necessários nos fontes. O bootstrap de SUPER_ADMIN foi consumido.

## Roteiro para testar

1. Entre em `/entrar` com uma conta acima.
2. Abra a empresa DEMO, confira clientes, serviços e profissionais.
3. Abra Disponibilidade; adicione um turno em um dia sem horário ou remova um turno e cadastre dois turnos separados para testar almoço.
4. Abra a página pública em outra aba, selecione serviço, profissional e data.
5. Reserve com nome fictício e telefone de teste. Confira o novo registro na agenda da mesma empresa.
6. Consulte novamente: horários que se sobrepõem à reserva não estarão disponíveis.
7. Entre com outro nicho: os registros anteriores não devem aparecer.

As entradas de restaurante, logística e outros nichos usam o núcleo de agenda. Mesas, comandas, rotas, prontuário e módulos especializados continuam fora deste incremento.
