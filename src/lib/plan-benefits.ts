export function teamPlanBenefits(plan: {
  teamInsights: boolean;
  teamExport: boolean;
}) {
  return [
    "Meu dia para colaboradores vinculados",
    ...(plan.teamInsights
      ? [`Indicadores da equipe: até ${plan.teamExport ? 90 : 31} dias`]
      : []),
    ...(plan.teamInsights && plan.teamExport
      ? ["Exportação dos indicadores em CSV"]
      : []),
  ];
}
