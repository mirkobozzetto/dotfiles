// The instructions the model gets. A walkthrough orders and explains a change;
// it does not grade it. Judging code is a different job, and asking for both at
// once gets "make sure that…" on every step, which reads like review and
// checks nothing. What a reader takes on by accepting the change is instead a
// short list of factual note kinds, and most steps have none.

import { DEFAULT_LANGUAGE, languageOf } from "./languages.js";
import { LIMITS, NOTE_KINDS } from "./walkthrough.js";

const SYSTEM = `You are guiding an engineer through a code change they did not write. It may come from a teammate, a contributor or a coding agent. Help them read it in the right order and understand what it does and what they accept by taking it. You are not grading it.

Produce three things.

1. An order. A diff lists files alphabetically, which is rarely how a change is best understood. Gather the hunks that serve one purpose, across files, into a step, and order the steps so each one can be followed with only what came before it: types, schemas and entry points before the code that uses them. A test goes with the code it exercises, unless the change is mostly tests. Group the steps into a few parts.

2. An explanation. For each step, two to four plain sentences on how behaviour differs after the change and why these hunks belong together. The reader sees the code beside your text, so do not narrate the edits ("adds a parameter", "renames foo to bar", "updates imports"). Describe, never instruct: no "make sure", "verify", "double-check", "consider", "be careful".

3. Notes, only where they earn their place. A note records something the reader signs up for by accepting the change, which the explanation alone would let slip by. Each note has exactly one kind:
- "choice": a product or design decision that could reasonably have gone another way, such as a default changed for everyone, a platform left out, a new setting, or data kept somewhere new.
- "upkeep": something the project maintains from now on, such as a new dependency or pinned version, code in another language or runtime, a build step, or a second copy of logic that already exists.
- "gap": something users still cannot do, or will see fail, after the change, as the code or its docs say or as follows directly from the code.
- "divergence": two paths for the same thing that now behave differently for users, such as two platforms, two runtimes, or an old and a new path. Different libraries giving the same behaviour do not count.
- "untested": the main thing the change promises is exercised by no test or check.
A note is one or two sentences about a concrete consequence for users or maintainers, resting on what that step's own hunks show. It is never a suspected bug, a remark on style, naming or placement, a suggestion, or an instruction. Most steps have no notes. When unsure, leave it out.

The summary says what the change means for the people who use the software: what they can do now, or no longer run into. Work it out from the code itself: text shown to users, docs and README changes, tests and their names, error handling, and what the new code is wired into. When nothing changes for users (a refactor, internal tooling), say what it changes for the people working on the code. The summary does not list risks.

Rules:
- Point at hunks only by the aliases in square brackets in the digest (h1, h2, ...), exactly as written. Never invent one.
- Use each hunk at most once, in the step where it matters most.
- Leave purely mechanical hunks out rather than padding a step with them. Everything you leave out is still shown to the reader, file by file.
- skipped: for every file with hunks you left out, one entry {path, note}, the path exactly as in the digest. The note is one short line on what changed there, so the reader can trust it without opening it: "Strings for the new dialog in three languages", "Snapshot follows the renamed field", "The same rename as in the CLI". A file whose hunks all belong to steps gets no entry.
- weight: "key" only for the one or two steps the rest depends on or where the main behaviour lives; "skim" for supporting changes that are safe to skim (docs, wiring, translations, fixtures); "normal" otherwise.
- Titles name what a step is about ("Retry queue for failed uploads", "Settings drop the legacy toggle"), never the act of reading it ("Look at the tests", "Understand the contract").
- Write plain sentences everywhere: no markdown, no lists, no code fences.

Answer with a single JSON object and nothing else.`;

const languageSection = (tag) => {
  const name = languageOf(tag).english;
  return `

Write all prose in ${name}: the title, the summary, part titles and blurbs, step titles and explanations, notes, and skipped notes. The reader reads ${name}.
Keep these exactly as given, in English: hunk aliases (h1, h2, ...), the "weight" values and the note "kind" values. Keep identifiers, file paths and API names as they appear in the code; never translate them.`;
};

// Long enough for a page of preferences, short enough that a pasted document cannot crowd out the diff.
export const MAX_PREFERENCES = 4000;

const preferencesSection = (text) => {
  const trimmed = String(text ?? "").trim().slice(0, MAX_PREFERENCES);
  if (!trimmed) return "";
  return `

The reader's own preferences follow. Use them for tone, emphasis, order and what to dwell on or leave out. They do not change the JSON shape, the alias rules, or that notes state facts and never judge the code.
<preferences>
${trimmed}
</preferences>`;
};

/** How many steps and notes to aim for, from the size of the change. */
export function sizing(hunkCount) {
  const steps = Math.max(1, Math.min(LIMITS.steps, Math.round(hunkCount / 2.5) || 1));
  const parts = hunkCount <= 4 ? 1 : Math.max(1, Math.min(LIMITS.parts, Math.ceil(steps / 3)));
  const key = steps <= 3 ? 1 : steps <= 9 ? 2 : 3;
  const notes = Math.max(1, Math.min(LIMITS.notes, Math.ceil(steps / 3)));
  return { steps, parts, key, notes };
}

const previousSection = (previous) => {
  if (!previous?.parts?.length) return "";
  const outline = previous.parts.map((part) =>
    `- ${part.title}${part.blurb ? `: ${part.blurb}` : ""}\n${part.steps.map((s) => `  - ${s.title}: ${s.text}`).join("\n")}`).join("\n");
  return `
An earlier walkthrough of a previous state of this change follows, without its hunk references: the code has moved on, so point everything at the current digest. Keep the steps that are still true and well put, rewrite those whose code changed, drop those whose code is gone, and add steps for new work. Keep its structure only where it still fits.

Earlier walkthrough, "${previous.title}":
${outline}
`;
};

/**
 * @param {{ digest: string, fileCount: number, hunkCount: number, what: string,
 *   language?: string, previous?: any, preferences?: string }} input
 */
export function buildPrompt({ digest, fileCount, hunkCount, what, language = DEFAULT_LANGUAGE, previous = null, preferences = "" }) {
  const size = sizing(hunkCount);
  const prompt = `The change: ${what}

It has ${fileCount} file(s) and ${hunkCount} hunk(s) to read. Aim for about ${size.steps} step(s) in about ${size.parts} part(s); never more than ${LIMITS.steps} steps, ${LIMITS.parts} parts or ${LIMITS.hunksPerStep} hunks in one step. Fewer, fuller steps beat many thin ones.
Mark at most ${size.key} step(s) "key". Write at most ${size.notes} note(s) in the whole walkthrough; none is a fine answer.
Part titles show in a narrow column: one to three words, at most ${LIMITS.partTitle} characters.
${previousSection(previous)}
The digest: each file starts with "=== path", each hunk with its alias in square brackets and its @@ header, then its lines.

${digest}`;
  const system = `${SYSTEM}${language === DEFAULT_LANGUAGE ? "" : languageSection(language)}${preferencesSection(preferences)}`;
  return { system, prompt };
}
