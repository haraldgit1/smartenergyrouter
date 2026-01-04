// components/events/types.ts
export type EventRecord = {
  id?: string;
  ts: string;
  service: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | string;
  flow_id?: string;
  device_id?: string;
  msg?: string;
  payload?: any;
};

