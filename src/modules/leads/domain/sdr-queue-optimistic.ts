import type { SdrQueueSection } from "@/modules/leads/domain/sdr-queue-contracts";

export function hideCompletedTaskFromSections(
  sections: readonly SdrQueueSection[],
  completedTaskIds: ReadonlySet<string>,
): readonly SdrQueueSection[] {
  if (completedTaskIds.size === 0) return sections;

  return sections.map((section) => {
    const items = section.items.filter(
      (item) =>
        !item.nextActionTaskId ||
        !completedTaskIds.has(item.nextActionTaskId),
    );
    const removedCount = section.items.length - items.length;
    if (removedCount === 0) return section;

    return {
      ...section,
      total: Math.max(0, section.total - removedCount),
      items,
    };
  });
}
