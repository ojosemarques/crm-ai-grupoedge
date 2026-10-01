import type { TeamCoachingSuggestion, TeamManagementPerson } from "@/modules/metrics/domain/team-management-contracts";

export function taskCompletionPercentage(completed: number, total: number): number | null {
  return total === 0 ? null : Math.round((completed / total) * 10_000) / 100;
}

export function workedQueueCorrectly(person: Pick<TeamManagementPerson, "taskCompletionPercentage" | "leadsWithoutNextAction" | "forgottenLeads">): boolean {
  return (person.taskCompletionPercentage === null || person.taskCompletionPercentage >= 80)
    && person.leadsWithoutNextAction === 0
    && person.forgottenLeads === 0;
}

export function buildCoachingSuggestions(
  people: readonly TeamManagementPerson[],
): readonly TeamCoachingSuggestion[] {
  const sdrConversions = people.flatMap((person) => person.sdrConversionPercentage === null ? [] : [person.sdrConversionPercentage]);
  const sellerConversions = people.flatMap((person) => person.sellerConversionPercentage === null ? [] : [person.sellerConversionPercentage]);
  const sdrAverage = sdrConversions.length ? sdrConversions.reduce((sum, value) => sum + value, 0) / sdrConversions.length : null;
  const sellerAverage = sellerConversions.length ? sellerConversions.reduce((sum, value) => sum + value, 0) / sellerConversions.length : null;

  return people.flatMap((person) => {
    const suggestions: TeamCoachingSuggestion[] = [];
    if (person.leadsWithoutNextAction > 0) suggestions.push({ memberId: person.id, memberName: person.name, priority: "HIGH", title: "Planejar o próximo passo", reason: `${person.leadsWithoutNextAction} lead(s) aberto(s) sem próxima ação.`, action: "Revisar a carteira e registrar tarefa, data e objetivo para cada lead." });
    if (person.forgottenLeads > 0) suggestions.push({ memberId: person.id, memberName: person.name, priority: "HIGH", title: "Recuperar leads esquecidos", reason: `${person.forgottenLeads} lead(s) ultrapassaram o limite de estagnação.`, action: "Priorizar contato hoje e decidir entre avançar, nutrir ou desqualificar." });
    if (person.averageFirstResponseSeconds !== null && person.averageFirstResponseSeconds > 180) suggestions.push({ memberId: person.id, memberName: person.name, priority: "MEDIUM", title: "Reduzir o tempo de resposta", reason: `Primeira resposta média de ${Math.round(person.averageFirstResponseSeconds)} segundos.`, action: "Reservar blocos para a fila nova e ativar alertas de entrada imediata." });
    if (person.taskCompletionPercentage !== null && person.taskCompletionPercentage < 80) suggestions.push({ memberId: person.id, memberName: person.name, priority: "MEDIUM", title: "Melhorar a execução da fila", reason: `${person.taskCompletionPercentage.toLocaleString("pt-BR")}% das tarefas do período foram concluídas.`, action: "Começar pelas atrasadas e usar Concluir e próximo durante o bloco comercial." });
    if (sdrAverage !== null && person.sdrConversionPercentage !== null && person.sdrConversionPercentage + 5 < sdrAverage) suggestions.push({ memberId: person.id, memberName: person.name, priority: "LOW", title: "Treinar qualificação", reason: `Conversão SDR ${person.sdrConversionPercentage.toLocaleString("pt-BR")}% contra média do time de ${sdrAverage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%.`, action: "Revisar abordagens, objeções e dois atendimentos recentes com o gerente." });
    if (sellerAverage !== null && person.sellerConversionPercentage !== null && person.sellerConversionPercentage + 5 < sellerAverage) suggestions.push({ memberId: person.id, memberName: person.name, priority: "LOW", title: "Revisar condução de oportunidades", reason: `Conversão de vendas ${person.sellerConversionPercentage.toLocaleString("pt-BR")}% contra média do time de ${sellerAverage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%.`, action: "Revisar diagnóstico, proposta e próximos passos das oportunidades abertas." });
    return suggestions;
  }).sort((left, right) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 })[left.priority] - ({ HIGH: 0, MEDIUM: 1, LOW: 2 })[right.priority] || left.memberName.localeCompare(right.memberName, "pt-BR"));
}
