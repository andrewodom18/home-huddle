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
    kicker: "Tonight",
    title: "Dinner + homework",
    description: "Balance one adult call, two school tasks, and dinner.",
    prompt:
      "Plan tonight for Maya and Leo (children) and Jordan and Casey (adults) from 5:30 PM to 8:00 PM. Dinner takes 30 minutes, Maya needs 45 minutes of math help, and Leo needs 20 minutes of reading. Jordan has a fixed call from 6:30 PM to 6:50 PM; do not move it. Casey can help with homework while Jordan is on the call.",
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
    kicker: "Weekend",
    title: "Accessible outing",
    description: "Create a comfortable plan with travel and rest buffers.",
    prompt:
      "Plan a comfortable family outing for Noor, Eli, and Grandma Jo from 10:00 AM to 2:00 PM. Everyone travels to and from the botanical garden (25 minutes each way), spends 75 minutes there together, and has a 45-minute lunch. Add two separate 10-minute seated breaks for Grandma Jo, one before lunch and one after. Finish the return trip by 2:00 PM; unused time can stay free.",
    tone: "lime",
  },
];

export const REVISION_PROMPTS = [
  "Move the first task 15 minutes later",
  "Balance the workload more evenly",
  "Add a 10-minute transition buffer",
];
