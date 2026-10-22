export function MeetingParticipantField({
  className,
  inputClassName,
}: Readonly<{ className?: string | undefined; inputClassName: string }>) {
  return (
    <label className={className}>
      E-mail do participante (opcional)
      <input
        aria-label="E-mail do participante (opcional)"
        autoComplete="email"
        className={inputClassName}
        maxLength={320}
        name="participantEmail"
        placeholder="participante@exemplo.com"
        type="email"
      />
      <span className="mt-1 block text-xs text-muted-foreground">
        O convidado receberá o convite e os lembretes pelo MillionSend: 3h, 1h,
        30 min antes e na hora. O Google Agenda também enviará o convite quando
        o responsável tiver a conta conectada.
      </span>
    </label>
  );
}
