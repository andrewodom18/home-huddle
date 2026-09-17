import type { ChatRequest, PlanRequirements } from "./contracts";

export const SCENARIO_REQUIREMENTS: Record<NonNullable<ChatRequest["scenarioId"]>, PlanRequirements> = {
  weekday: {
    source: "scenario",
    timeWindow: { startTime: "5:30 PM", endTime: "8:00 PM" },
    tasks: [
      { id: "dinner", label: "Dinner", durationMinutes: 30, requiredParticipants: ["Maya", "Leo", "Jordan", "Casey"] },
      { id: "math-help", label: "Maya's math help", durationMinutes: 45, requiredParticipants: ["Maya"], atLeastOneOf: ["Jordan", "Casey"] },
      { id: "reading", label: "Leo's reading", durationMinutes: 20, requiredParticipants: ["Leo"] },
      { id: "jordan-call", label: "Jordan's fixed call", durationMinutes: 20, requiredParticipants: ["Jordan"], fixedStartTime: "6:30 PM" },
    ],
  },
  chores: {
    source: "scenario",
    timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
    tasks: [
      { id: "kitchen", label: "Clean the kitchen", durationMinutes: 35, allowedParticipants: ["Alex", "Sam"] },
      { id: "vacuum", label: "Vacuum the floors", durationMinutes: 30, allowedParticipants: ["Alex", "Sam"] },
      { id: "start-laundry", label: "Sort and start laundry", durationMinutes: 20 },
      { id: "fold-laundry", label: "Fold and put away laundry", durationMinutes: 20 },
      { id: "shared-break", label: "Shared break", durationMinutes: 15, kind: "break", requiredParticipants: ["Alex", "Sam", "Riley"] },
    ],
    workload: { participants: ["Alex", "Sam", "Riley"], minMinutes: 30, maxMinutes: 40, excludeTaskIds: ["shared-break"] },
  },
  outing: {
    source: "scenario",
    timeWindow: { startTime: "10:00 AM", endTime: "2:00 PM" },
    tasks: [
      { id: "outbound-travel", label: "Travel to botanical garden", durationMinutes: 25, kind: "travel", requiredParticipants: ["Noor", "Eli", "Grandma Jo"] },
      { id: "garden", label: "Botanical garden", durationMinutes: 75, requiredParticipants: ["Noor", "Eli", "Grandma Jo"] },
      { id: "break-before-lunch", label: "Seated break before lunch", durationMinutes: 10, kind: "break", requiredParticipants: ["Grandma Jo"] },
      { id: "lunch", label: "Lunch", durationMinutes: 45, requiredParticipants: ["Noor", "Eli", "Grandma Jo"] },
      { id: "break-after-lunch", label: "Seated break after lunch", durationMinutes: 10, kind: "break", requiredParticipants: ["Grandma Jo"] },
      { id: "return-travel", label: "Travel home", durationMinutes: 25, kind: "travel", requiredParticipants: ["Noor", "Eli", "Grandma Jo"] },
    ],
    ordering: [
      { beforeTaskId: "outbound-travel", afterTaskId: "garden" },
      { beforeTaskId: "garden", afterTaskId: "break-before-lunch" },
      { beforeTaskId: "break-before-lunch", afterTaskId: "lunch" },
      { beforeTaskId: "lunch", afterTaskId: "break-after-lunch" },
      { beforeTaskId: "break-after-lunch", afterTaskId: "return-travel" },
    ],
  },
};

export function scenarioRequirements(scenarioId: ChatRequest["scenarioId"]): PlanRequirements | undefined {
  return scenarioId ? structuredClone(SCENARIO_REQUIREMENTS[scenarioId]) : undefined;
}
