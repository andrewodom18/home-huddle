import type { HouseholdPlan } from "../shared/contracts";
import { scenarioDates } from "../shared/scenarios";

export type PresetScenario = {
  id: string;
  kicker: string;
  title: string;
  description: string;
  prompt: string;
  tone: "sky" | "coral" | "lime";
};

export const PRESET_SCENARIOS: PresetScenario[] = [
  {
    id: "weekday",
    kicker: "A full week",
    title: "The school-week rhythm",
    description: "See dinner and school activities across five days.",
    prompt:
      "Plan September 21–25, 2026 for Maya, Leo, Jordan, and Casey. Date each event YYYY-MM-DD; use 5:30 PM–8:00 PM each day. Schedule a 30-minute family dinner daily, 45 minutes of Maya's math help Monday/Wednesday/Friday, and 20 minutes of Leo's reading Tuesday/Thursday. Jordan's Monday call is fixed at 6:30–6:50 PM; Casey can help Maya then.",
    tone: "sky",
  },
  {
    id: "chores",
    kicker: "Saturday",
    title: "Share the chores",
    description: "Divide the work fairly and leave time for a break.",
    prompt:
      "Split Saturday chores fairly between Alex, Sam, and Riley from 9:00 AM to 11:00 AM. Clean the kitchen (35 minutes), vacuum the floors (30 minutes), sort and start a small laundry load (20 minutes), and fold and put away a ready load (20 minutes). Both laundry tasks are light enough for Riley; do not give Riley heavy chores. Aim for 30 to 40 minutes of chores per person and include the same shared 15-minute break for everyone.",
    tone: "coral",
  },
  {
    id: "outing",
    kicker: "Across months",
    title: "Three family outings",
    description: "Two nonconsecutive September days and one October day.",
    prompt:
      "Plan Noor, Eli, and Grandma Jo on Sep 22 and Sep 24, then Oct 10, 2026. Date each event YYYY-MM-DD and stay within 10:00 AM–2:00 PM each date. Sep 22: travel to the botanical garden (25 minutes), then split the 75-minute garden visit into a 35-minute first walk and a 40-minute second walk together, with Grandma Jo's 10-minute seated rest between them. Have a 45-minute lunch afterward, then travel home (25 minutes). Sep 24: visit the accessible library together for 60 minutes, then give Grandma Jo a separate 10-minute seated rest. Oct 10: have a 90-minute family picnic together. Leave unused time free.",
    tone: "lime",
  },
];

export function presetScenarios(anchorDate: string): PresetScenario[] {
  const dates = scenarioDates(anchorDate);
  const [monday, , , , friday] = dates.weekday;
  const [gardenDate, libraryDate, picnicDate] = dates.outing;
  return PRESET_SCENARIOS.map((scenario) => {
    if (scenario.id === "weekday") return {
      ...scenario,
      prompt: `Plan ${monday} through ${friday} for Maya, Leo, Jordan, and Casey. Date each event YYYY-MM-DD; use 5:30 PM–8:00 PM each day. Schedule a 30-minute family dinner daily, 45 minutes of Maya's math help Monday/Wednesday/Friday, and 20 minutes of Leo's reading Tuesday/Thursday. Jordan's Monday call is fixed at 6:30–6:50 PM; Casey can help Maya then.`,
    };
    if (scenario.id === "chores") return {
      ...scenario,
      prompt: `On Saturday ${dates.chores}, split chores fairly between Alex, Sam, and Riley from 9:00 AM to 11:00 AM. Date each event ${dates.chores}. Clean the kitchen (35 minutes), vacuum the floors (30 minutes), sort and start a small laundry load (20 minutes), and fold and put away a ready load (20 minutes). Both laundry tasks are light enough for Riley; do not give Riley heavy chores. Aim for 30 to 40 minutes of chores per person and include the same shared 15-minute break for everyone.`,
    };
    return {
      ...scenario,
      description: "Two nonconsecutive days in one week and one in a later month.",
      prompt: `Plan Noor, Eli, and Grandma Jo on ${gardenDate} and ${libraryDate}, then ${picnicDate}. Date each event YYYY-MM-DD and stay within 10:00 AM–2:00 PM each date. ${gardenDate}: travel to the botanical garden (25 minutes), then split the 75-minute garden visit into a 35-minute first walk and a 40-minute second walk together, with Grandma Jo's 10-minute seated rest between them. Have a 45-minute lunch afterward, then travel home (25 minutes). ${libraryDate}: visit the accessible library together for 60 minutes, then give Grandma Jo a separate 10-minute seated rest. ${picnicDate}: have a 90-minute family picnic together. Leave unused time free.`,
    };
  });
}

export function revisionPromptsFor(plan: HouseholdPlan): string[] {
  const candidates = plan.items.filter((item) => !plan.requirements?.tasks.find((task) => task.id === item.taskId)?.fixedStartTime);
  const movable = candidates.find((item) => plan.items.filter((other) => other.task.toLowerCase() === item.task.toLowerCase()).length === 1) ?? candidates[0];
  const repeated = movable && plan.items.filter((item) => item.task.toLowerCase() === movable.task.toLowerCase()).length > 1;
  const date = repeated && movable?.date
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${movable.date}T12:00:00Z`))
    : undefined;
  return [
    movable ? `Move “${movable.task}”${date ? ` on ${date}` : ""} 15 minutes later` : "Try a different timing option",
    "Balance the workload more evenly",
    "Add a 10-minute transition buffer",
  ];
}
