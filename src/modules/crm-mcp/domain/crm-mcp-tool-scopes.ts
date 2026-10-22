export const crmMcpToolScopes: Readonly<Record<string, string>> = Object.freeze({
  obter_contexto_crm: "crm:read", listar_leads: "crm:read", consultar_historico_lead: "crm:read",
  consultar_oportunidades: "crm:read", consultar_atividades: "crm:read", consultar_agenda: "crm:read",
  consultar_metas: "crm:read", consultar_forecast: "crm:read", buscar_crm: "crm:read",
  consultar_dashboard: "metrics:read", detalhar_dashboard: "metrics:read", catalogar_indicadores: "metrics:read",
  consultar_indicadores_integrados: "metrics:read", detalhar_indicador_integrado: "metrics:read",
  consultar_receita: "metrics:read", detalhar_receita: "metrics:read",
  consultar_auditoria: "audit:read", consultar_integracoes: "integrations:read",
  consultar_logs_operacionais: "operations:read", consultar_alertas_incidentes: "operations:read",
});
