import { z } from "zod";

export const GOOGLE_CALENDAR_PROVIDER_KEY = "GOOGLE_CALENDAR";
export const GOOGLE_CALENDAR_SCOPES = Object.freeze([
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
]);

const configurationSchema = z.object({
  clientId: z.string().trim().min(20),
  clientSecret: z.string().trim().min(20),
  encryptionKey: z.string().trim().min(32),
  canonicalUrl: z.string().url(),
}).strict();

export type GoogleCalendarConfiguration = z.infer<typeof configurationSchema>;

export function loadGoogleCalendarConfiguration(
  source: Readonly<Record<string, string | undefined>> = process.env,
): GoogleCalendarConfiguration {
  return configurationSchema.parse({
    clientId: source.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: source.GOOGLE_CALENDAR_CLIENT_SECRET,
    encryptionKey: source.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY,
    canonicalUrl: source.APP_CANONICAL_URL,
  });
}

export function googleCalendarRedirectUri(configuration: GoogleCalendarConfiguration) {
  return new URL("/api/integrations/google-calendar/callback", configuration.canonicalUrl).toString();
}
