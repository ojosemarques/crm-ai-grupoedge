export function mayAutomaticallyAttachBySharedPhone(input: Readonly<{ submittedEmail: string | null; candidateEmail: string | null }>): boolean {
  return Boolean(input.submittedEmail && input.candidateEmail && input.submittedEmail === input.candidateEmail);
}
