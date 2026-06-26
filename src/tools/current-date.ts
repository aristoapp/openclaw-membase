import type { OpenClawPluginApi } from "../types";
import { toolResponse } from "../update-check";

function timezoneOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

export function localIsoString(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${timezoneOffset(date)}`;
}

export function buildCurrentDateText(now = new Date()): string {
  const local = localIsoString(now);
  const utc = now.toISOString();
  return [
    "Current date/time:",
    `- local_time: ${local}`,
    `- local_date: ${local.slice(0, 10)}`,
    `- utc_time: ${utc}`,
    `- utc_date: ${utc.slice(0, 10)}`,
  ].join("\n");
}

export function registerCurrentDateTool(api: OpenClawPluginApi) {
  api.registerTool({
    name: "membase_get_current_date",
    label: "Get Current Date",
    description:
      "Get the current runtime local time and UTC time. Use before converting relative dates like today, yesterday, or this week into membase_search date_from/date_to filters.",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      return await toolResponse(buildCurrentDateText());
    },
  });
}
