const META_PIXEL_ID_PATTERN = /^[0-9]{3,40}$/;

type MetaPixelFunction = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: MetaPixelFunction;
  loaded: boolean;
  version: string;
};

export type MetaPixelWindow = Window & {
  fbq?: MetaPixelFunction;
  _fbq?: MetaPixelFunction;
  __crmMetaPixels?: Set<string>;
  __crmMetaPageViews?: Set<string>;
  __crmMetaLeadEvents?: Set<string>;
};

function pixelQueue(target: MetaPixelWindow): MetaPixelFunction {
  if (target.fbq) return target.fbq;
  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  }) as MetaPixelFunction;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  target.fbq = fbq;
  target._fbq = fbq;
  return fbq;
}

function initializedPixels(target: MetaPixelWindow) {
  target.__crmMetaPixels ??= new Set<string>();
  return target.__crmMetaPixels;
}

export function initializeMetaPixel(target: MetaPixelWindow, pixelId: string): boolean {
  if (!META_PIXEL_ID_PATTERN.test(pixelId)) return false;
  const fbq = pixelQueue(target);
  const initialized = initializedPixels(target);
  if (!initialized.has(pixelId)) {
    initialized.add(pixelId);
    fbq("init", pixelId);
  }
  target.__crmMetaPageViews ??= new Set<string>();
  const pageViewKey = `${pixelId}:${target.location.href}`;
  if (!target.__crmMetaPageViews.has(pageViewKey)) {
    target.__crmMetaPageViews.add(pageViewKey);
    fbq("track", "PageView");
  }
  return true;
}

export function trackMetaLead(target: MetaPixelWindow, pixelId: string, eventId: string): boolean {
  if (!META_PIXEL_ID_PATTERN.test(pixelId) || !/^[a-f0-9]{64}$/.test(eventId)) return false;
  const fbq = pixelQueue(target);
  const initialized = initializedPixels(target);
  if (!initialized.has(pixelId)) {
    initialized.add(pixelId);
    fbq("init", pixelId);
  }
  target.__crmMetaLeadEvents ??= new Set<string>();
  const leadKey = `${pixelId}:${eventId}`;
  if (target.__crmMetaLeadEvents.has(leadKey)) return true;
  target.__crmMetaLeadEvents.add(leadKey);
  fbq("track", "Lead", {}, { eventID: eventId });
  return true;
}
