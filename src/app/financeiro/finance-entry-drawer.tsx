"use client";

import { useRef, useState, type FormEvent } from "react";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";
import { reaisToCents, text, type Row } from "./finance-display";
import styles from "./finance-entry-drawer.module.css";

export type EntryDirection = "INCOME" | "EXPENSE";

export function FinanceEntryDrawer({ initialDirection, busy, accounts, categories, costCenters, today, onDismiss, onSave }: Readonly<{
  initialDirection: EntryDirection;
  busy: boolean;
  accounts: Row[];
  categories: Row[];
  costCenters: Row[];
  today: string;
  onDismiss: () => void;
  onSave: (payload: Record<string, unknown>, onError: (message: string) => void) => void;
}>) {
  const [direction, setDirection] = useState(initialDirection);
  const [status, setStatus] = useState("PLANNED");
  const [recurring, setRecurring] = useState(false);
  const [contactType, setContactType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef<string | null>(null);
  const isExpense = direction === "EXPENSE";
  const realized = !recurring && status === "SETTLED";
  const activeAccounts = accounts.filter((row) => row.active !== false);
  const matchingCategories = categories.filter((row) => row.active !== false && row.kind === direction);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const fields = new FormData(event.currentTarget);
    const optional = (key: string) => String(fields.get(key) ?? "").trim() || null;
    try {
      const tags = [...new Set((optional("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean))];
      if (tags.length > 12 || tags.some((tag) => tag.length > 40)) {
        setError("Use até 12 tags com no máximo 40 caracteres cada.");
        return;
      }
      const amountCents = reaisToCents(fields.get("amount"));
      requestKey.current ??= `finance-entry-ui:${crypto.randomUUID()}`;
      const common = {
        direction,
        description: fields.get("description"),
        counterparty: optional("counterparty"),
        counterpartyType: optional("counterpartyType"),
        tags,
        notes: optional("notes"),
        amountCents,
        categoryId: fields.get("categoryId"),
        financialAccountId: fields.get("financialAccountId"),
        costCenterId: optional("costCenterId"),
        requiresApproval: isExpense && !realized && fields.get("requiresApproval") === "on",
        idempotencyKey: requestKey.current,
      };
      if (recurring) {
        onSave({ ...common, action: "CREATE_RECURRENCE", firstCompetenceAt: fields.get("competenceAt"),
          firstDueAt: fields.get("dueAt"), installmentCount: Number(fields.get("installmentCount")) }, setError);
      } else {
        onSave({ ...common, action: "CREATE_ENTRY", status, competenceAt: fields.get("competenceAt"), dueAt: fields.get("dueAt"),
          settledAt: realized ? fields.get("settledAt") : null, customerAccountId: null }, setError);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível preparar o lançamento.");
    }
  }

  return <AccessibleDialog busy={busy} labelledBy="entry-drawer-title" onDismiss={onDismiss}
    backdropClassName={styles.backdrop ?? ""} className={styles.drawer ?? ""}>
    <header className={styles.header}>
      <h2 id="entry-drawer-title">{isExpense ? "Nova despesa" : "Nova entrada"}</h2>
      <button type="button" className={styles.close} aria-label="Fechar lançamento" onClick={onDismiss} disabled={busy}>×</button>
    </header>
    <form className={styles.form} onSubmit={save}>
      <fieldset disabled={busy} className={styles.fields}>
        <label>Descrição
          <input name="description" required minLength={3} maxLength={240}
            placeholder={isExpense ? "Ex. Mensalidade de software" : "Ex. Pagamento de cliente"}/>
        </label>
        <div className={styles.columns}>
          <label>Natureza
            <select aria-label="Natureza" value={direction} onChange={(event) => setDirection(event.target.value === "EXPENSE" ? "EXPENSE" : "INCOME")}>
              <option value="INCOME">Entrada</option><option value="EXPENSE">Despesa</option>
            </select>
          </label>
          <label>{recurring ? "Valor por parcela (R$)" : "Valor (R$)"}
            <input name="amount" inputMode="decimal" placeholder="0,00" required/>
          </label>
        </div>
        <div className={styles.columns}>
          <label>Data de competência<input name="competenceAt" type="date" defaultValue={today} required/></label>
          <label>Data de vencimento<input name="dueAt" type="date" defaultValue={today} required/></label>
        </div>
        {!recurring ? <div className={realized ? styles.columns : undefined}>
          <label>Status<select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="PLANNED">Previsto</option>
            <option value="SETTLED">{isExpense ? "Pago" : "Recebido"}</option>
          </select></label>
          {realized ? <label>{isExpense ? "Data do pagamento" : "Data do recebimento"}
            <input name="settledAt" type="date" defaultValue={today} max={today} required/>
          </label> : null}
        </div> : null}
        <label>Categoria
          <select aria-label="Categoria" key={direction} name="categoryId" defaultValue="" required>
            <option value="">Selecione</option>
            {matchingCategories.map((row) => <option value={text(row.id)} key={text(row.id)}>{text(row.name)}</option>)}
          </select>
        </label>
        <label>Conta
          <select aria-label="Conta" name="financialAccountId" defaultValue={activeAccounts.length === 1 ? text(activeAccounts[0]?.id, "") : ""} required>
            <option value="">Selecione</option>
            {activeAccounts.map((row) => <option value={text(row.id)} key={text(row.id)}>{text(row.name)}</option>)}
          </select>
        </label>
        <label>Centro de custo
          <select name="costCenterId">
            <option value="">Sem centro de custo</option>
            {costCenters.filter((row) => row.active !== false).map((row) => <option value={text(row.id)} key={text(row.id)}>{text(row.name)}</option>)}
          </select>
        </label>
        <div className={styles.columns}>
          <label>Contato<input name="counterparty" placeholder="Nome" minLength={2} maxLength={160} required={Boolean(contactType)}/></label>
          <label>Tipo de contato<select aria-label="Tipo de contato" name="counterpartyType" value={contactType} onChange={(event) => setContactType(event.target.value)}>
            <option value="">Não informado</option><option value="CUSTOMER">Cliente</option>
            <option value="SUPPLIER">Fornecedor</option><option value="OTHER">Outro</option>
          </select></label>
        </div>
        <div className={recurring ? styles.columns : undefined}>
          <label>Recorrência<select aria-label="Recorrência" value={recurring ? "MONTHLY" : ""} onChange={(event) => setRecurring(event.target.value === "MONTHLY")}>
            <option value="">Sem recorrência</option><option value="MONTHLY">Mensal</option>
          </select></label>
          {recurring ? <label>Número de parcelas<input name="installmentCount" type="number" min="2" max="120" defaultValue="2" required/></label> : null}
        </div>
        {recurring ? <p className={styles.hint}>As parcelas mensais serão criadas como previstas.</p> : null}
        {isExpense && !realized ? <label className={styles.checkbox}>
          <input name="requiresApproval" type="checkbox"/> Exigir aprovação antes do pagamento
        </label> : null}
        <label>Tags<input name="tags" placeholder="marketing, software" maxLength={500}/><small>Separe as tags por vírgula.</small></label>
        <label>Observações<textarea name="notes" placeholder="Notas adicionais" maxLength={2000} rows={4}/></label>
      </fieldset>
      <footer className={styles.footer}>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div>
          <Button type="button" variant="secondary" onClick={onDismiss} disabled={busy}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{busy ? "Salvando…" : recurring ? "Gerar parcelas" : "Salvar lançamento"}</Button>
        </div>
      </footer>
    </form>
  </AccessibleDialog>;
}
