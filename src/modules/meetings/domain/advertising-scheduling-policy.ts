export function canScheduleAdvertisingMeeting(roleKey: string, workspaceScheduler: boolean): boolean {
  return workspaceScheduler || ["administrator", "commercial_manager", "sdr"].includes(roleKey);
}
