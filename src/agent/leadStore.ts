import type { LeadPayload } from "./prompt.js";

const leadByCallSid = new Map<string, LeadPayload>();

export function setLead(callSid: string, lead: LeadPayload) {
  leadByCallSid.set(callSid, lead);
}

export function getLead(callSid: string): LeadPayload | null {
  return leadByCallSid.get(callSid) ?? null;
}
