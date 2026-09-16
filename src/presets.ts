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
      "Split Saturday chores between Alex, Sam, and Riley from 9:00 AM to 11:00 AM. The kitchen needs 35 minutes, laundry needs two 20-minute steps, floors need 30 minutes, and Riley can only do light tasks. Include one shared 15-minute break.",
    tone: "coral",
  },
  {
    id: "outing",
    kicker: "Weekend",
    title: "Accessible outing",
    description: "Create a comfortable plan with travel and rest buffers.",
    prompt:
      "Plan a family outing for Noor, Eli, and Grandma Jo from 10:00 AM to 2:00 PM. Travel takes 25 minutes each way, lunch needs 45 minutes, Grandma Jo needs a seated break every hour, and everyone wants at least 75 minutes at the botanical garden.",
    tone: "lime",
  },
];

export const REVISION_PROMPTS = [
  "Move the first task 15 minutes later",
  "Balance the workload more evenly",
  "Add a 10-minute transition buffer",
];
