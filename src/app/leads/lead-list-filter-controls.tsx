"use client";

import { useCallback, useId, useState } from "react";

import styles from "@/app/leads/leads-list.module.css";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";

export type FilterOption = Readonly<{ value: string; label: string }>;

export const leadFilterInputClass =
  "h-10 w-full rounded-[var(--radius-control)] border bg-card px-3 text-sm outline-none";

export function FilterCheckboxList({
  label,
  options,
  values,
  onChange,
}: Readonly<{
  label: string;
  options: readonly FilterOption[];
  values: readonly string[];
  onChange: (values: string[]) => void;
}>) {
  const [search, setSearch] = useState("");
  const normalized = search.trim().toLocaleLowerCase("pt-BR");
  const filtered = normalized
    ? options.filter((option) => option.label.toLocaleLowerCase("pt-BR").includes(normalized))
    : options;

  return (
    <fieldset className={styles.checkboxFieldset}>
      <legend>
        {label}
        <span className={styles.selectionCount}>{values.length} selecionado(s)</span>
      </legend>
      {options.length > 6 && (
        <label className={styles.optionSearch}>
          <span className="sr-only">Buscar em {label}</span>
          <input
            className={leadFilterInputClass}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Buscar em ${label.toLocaleLowerCase("pt-BR")}`}
            type="search"
            value={search}
          />
        </label>
      )}
      <div className={styles.checkboxOptions}>
        {filtered.map((option) => (
          <label className={styles.checkboxOption} key={option.value}>
            <input
              checked={values.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...values, option.value]
                    : values.filter((value) => value !== option.value),
                )
              }
              type="checkbox"
            />
            <span>{option.label}</span>
          </label>
        ))}
        {filtered.length === 0 && (
          <p className={styles.optionEmpty}>Nenhuma opção encontrada.</p>
        )}
      </div>
    </fieldset>
  );
}

export function MultiSelectDialog({
  label,
  options,
  values,
  onApply,
}: Readonly<{
  label: string;
  options: readonly FilterOption[];
  values: readonly string[];
  onApply: (values: string[]) => void;
}>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [workingValues, setWorkingValues] = useState<string[]>([...values]);
  const dismiss = useCallback(() => setOpen(false), []);
  const selectedLabel = options.find((option) => option.value === values[0])?.label ?? values[0];
  const summary =
    values.length === 0
      ? `${label}: Todos`
      : values.length === 1
        ? `${label}: ${selectedLabel}`
        : `${label}: ${values.length} selecionados`;

  return (
    <>
      <Button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={styles.filterTrigger}
        onClick={() => {
          setWorkingValues([...values]);
          setOpen(true);
        }}
        type="button"
        variant="secondary"
      >
        <span>{summary}</span>
        <span aria-hidden="true" className={styles.triggerChevron}>⌄</span>
      </Button>
      {open && (
        <AccessibleDialog
          className={styles.selectionDialog!}
          labelledBy={`${id}-title`}
          onDismiss={dismiss}
        >
          <div className={styles.dialogHeader}>
            <div>
              <h2 id={`${id}-title`}>Filtrar por {label.toLocaleLowerCase("pt-BR")}</h2>
              <p>Marque uma ou mais opções. Não é necessário usar Ctrl ou Command.</p>
            </div>
            <button aria-label={`Fechar filtro ${label}`} className={styles.closeButton} onClick={dismiss} type="button">×</button>
          </div>
          <FilterCheckboxList
            label={label}
            onChange={setWorkingValues}
            options={options}
            values={workingValues}
          />
          <div className={styles.dialogActions}>
            <Button onClick={() => setWorkingValues([])} type="button" variant="ghost">Limpar</Button>
            <Button
              onClick={() => {
                onApply(workingValues);
                setOpen(false);
              }}
              type="button"
            >
              Aplicar
            </Button>
          </div>
        </AccessibleDialog>
      )}
    </>
  );
}
