// Original welcome guide; no downloaded documents or third-party text.
// Run from anywhere: node scripts/make-sample-pdf.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

const root = new URL("../", import.meta.url);
const doc = await PDFDocument.create();
doc.setTitle("Welcome - Okuma");
doc.setAuthor("Okuma");
doc.setSubject("An original, hands-on guide to reading, notes and AI");
// Stable metadata makes regenerating the sample content-key deterministic.
doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
const serif = await doc.embedFont(StandardFonts.TimesRoman);
const heading = await doc.embedFont(StandardFonts.TimesRomanBold);
const sans = await doc.embedFont(StandardFonts.Helvetica);
const ink = rgb(0.15, 0.16, 0.15);
const muted = rgb(0.39, 0.4, 0.38);
const accent = rgb(0.53, 0.28, 0.17);
const width = 595.28;
const height = 841.89;
const margin = 58;
const column = width - 2 * margin;
let page;
let y;

function lines(text, font, size, maxWidth = column) {
  const result = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      result.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) result.push(line);
  return result;
}

function text(value, { font = serif, size = 13, color = ink, gap = 14 } = {}) {
  for (const line of lines(value, font, size)) {
    if (y < 72) throw new Error(`Content overflow on page ${doc.getPageCount()}`);
    page.drawText(line, { x: margin, y, size, font, color });
    y -= size * 1.5;
  }
  y -= gap;
}

function section(title, body) {
  text(title, { font: heading, size: 17, gap: 5 });
  text(body);
}

function start(kicker, title, subtitle) {
  page = doc.addPage([width, height]);
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.985, 0.978, 0.957) });
  page.drawText("OKUMA  /  FIELD GUIDE", { x: margin, y: height - 43, font: sans, size: 8, color: muted });
  page.drawLine({ start: { x: margin, y: height - 57 }, end: { x: width - margin, y: height - 57 }, thickness: 0.5, color: muted });
  y = height - 99;
  text(kicker.toUpperCase(), { font: sans, size: 9, color: accent, gap: 24 });
  text(title, { font: heading, size: 34, gap: 8 });
  text(subtitle, { size: 15, color: muted, gap: 26 });
  page.drawLine({ start: { x: margin, y: 49 }, end: { x: width - margin, y: 49 }, thickness: 0.5, color: muted });
  page.drawText("Welcome / Original practice edition", { x: margin, y: 32, size: 8, font: sans, color: muted });
  page.drawText(`${doc.getPageCount()} / 6`, { x: width - margin - 24, y: 32, size: 8, font: sans, color: muted });
}

start("01 / Start here", "Welcome.", "A quiet place to read, mark up and understand your PDFs.");
text("Okuma keeps your books, highlights, notes and reading position together in this browser. Open a document, keep the passages that matter, then use AI when you want another explanation or a practice quiz.");
section("Try it in under a minute", "Select a sentence below and press H to highlight it. Press N to open a sticky note and write one thought. With your own API key added, select a passage and press Ctrl + K to ask a question. Press ? whenever you want the shortcut list.");
text("PRACTICE PASSAGE", { font: sans, size: 9, color: accent, gap: 8 });
text("Each morning, Mira carried a small notebook to the garden behind the library. She recorded where the shade ended, which flowers opened first, and how the soil felt after rain. At first the entries seemed unrelated. After several weeks, she noticed that the seedlings beside the stone wall grew more slowly, even though they received the same water as the others.", { size: 14 });
text("Instead of adding more water, Mira moved one pot into the afternoon light and left another by the wall. She compared them every day. Her notebook did not give her an instant answer; it helped her ask a better question. Careful attention turned an ordinary garden into a small experiment.", { size: 14 });
text("Try highlighting: 'it helped her ask a better question.' What changed in Mira's approach?", { size: 12, color: accent });

start("02 / Make it yours", "Mark a thought.", "Highlights remember a passage. Notes remember your thinking.");
section("Highlight text", "Drag across text in the PDF to select a phrase or sentence. Press H, or choose a highlight color from the selection tools. Click an existing highlight to change its color, ask about it or delete it. Ctrl + Z undoes the latest highlight, drawing or text annotation.");
section("Keep a passage as a note", "Select text and choose the Turkish action 'Nota ekle' (add to note). The passage is saved with its page reference. This is useful for a quotation you want to revisit or discuss later.");
section("Write a sticky note", "Press N to open the notes paper. Type a title and your own thoughts; changes save automatically. Drag its heading to move it, resize it from the corner, and use the note list to find or pin earlier notes. Try writing: 'Mira tested one change at a time.'");
section("Write directly on the page", "Use D for the pen, M for the marker, T to add text, or E for the eraser. Press Esc to return to normal reading and text selection. Hold Shift while dragging the marker for a straight line.");
text("Small experiment: highlight one observation on page 1, then write a note explaining why it matters.", { size: 13, color: accent });

start("03 / A reading companion", "Ask a better question.", "Your own AI key unlocks explanations, translations and quizzes.");
section("Add your own Gemini key", "Click \"Add AI key\" in the toolbar (or the button in the getting-started tips). Choose Google Gemini, open the key page below, create a key with your Google account, then paste it into the API key field and save. The key is yours, not provided by this app; Google offers a free tier with usage limits set by Google.");
text("https://aistudio.google.com/apikey", { font: sans, size: 13, color: accent, gap: 22 });
section("Ask about a selection", "Select a passage and press Ctrl + K to open the chat with that context. Try: 'Why did Mira move only one pot?' You can also double-click a word to request its meaning in context and a sentence translation.");
section("Ask about a page", "Open chat with Ctrl + K and ask about the current page, or specify the page number in your prompt. Try: 'Summarize page 1 in three points.' Check the response against the PDF; AI can make mistakes.");
section("Keep control of your key", "The key is stored in this browser. For an AI request, the app sends it through its API to your chosen provider with the requested document context. You can change or delete the key in AI settings. Reading, highlights, notes and export work without a key.");

start("04 / Check your understanding", "Turn pages into practice.", "A short quiz can show what you understood and what to reread.");
section("Request a quiz in chat", "Add your AI key, open chat, then ask for a multiple-choice quiz and name the pages. For this guide, try: 'Create a 3-question quiz from page 1 about Mira's experiment.' For your own textbook, try: 'Make a 5-question quiz from pages 12-15.'");
section("Use a focused page range", "Choose a short section with enough information for clear questions. The app uses the requested pages to build a quiz in the conversation. Answer the questions, review the explanations and return to the source passage when an answer surprises you.");
section("Ask for useful explanations", "Try: 'Explain why each wrong option is wrong.' Or ask the AI to explain a difficult point in simpler words before generating a second quiz. A quiz is a study aid; use the document to verify disputed answers.");
section("A practice question for you", "Which action made Mira's garden study more informative: watering every pot more often, moving one pot while keeping a comparison, or stopping her daily notes? Find a sentence on page 1 that supports your answer and highlight it.");
text("You can also keep difficult questions: Q crops a question from the page; Enter saves the crop and Ctrl + K asks the AI about it.", { size: 13, color: accent });

start("05 / Keep your work", "Your browser. Your library.", "Local storage is convenient. A backup makes it portable.");
section("Your reading data stays here", "Your imported PDFs, notes, highlights and reading progress are stored in this browser on this device. There is no account-based sync. A different browser or device has a separate library. Clearing site data can remove your work.");
section("AI uses the context you request", "Local reading does not need an AI service. When you use AI, the relevant selection, pages or other request context is sent to your chosen AI provider through the app's API. Your key stays in browser settings between requests; it is not an app account password.");
section("Download a backup", "Open the library with L and choose 'Back up'. Keep the downloaded JSON somewhere safe. It contains your saved study data, not the original PDF files. Keep copies of your PDFs separately too.");
section("Restore on another browser", "Choose 'Restore backup' in the library and select your saved JSON. Import the same PDF files again to reconnect their notes and highlights. Keep your API key separately; do not assume it is included in a study backup.");
section("Take an annotated PDF with you", "Ctrl + S writes annotations into a PDF and saves it. Ctrl + Shift + S chooses a new save location. A PDF export and a study-data backup serve different purposes; keep both when your work matters.");

start("06 / Keep nearby", "Keyboard shortcuts.", "Press ? in the reader for the current list and to reopen the tour.");
// Read the actual keys from the app, and require a matching English description.
const source = await readFile(new URL("src/components/shortcuts-dialog.tsx", root), "utf8");
const shortcutsBlock = source.match(/const SHORTCUTS(?::[^=]*)? = \[([\s\S]*?)\n\](?: as const)?;/)?.[1];
if (!shortcutsBlock) throw new Error("Cannot find the reader shortcut list");
const english = [
  "Ask about selected text (chat)", "Library; Esc returns to reading", "Next / previous page",
  "First / last page", "Go to a page number", "Find in document", "Next / previous search result",
  "Zoom in / out", "Reset zoom", "Zoom with the mouse", "Fit width / fit page",
  "Toggle bookmark for this page", "Focus mode (full screen, hide panels)", "Toggle left panel / vocabulary",
  "Select and translate a word", "Highlight selection; click highlight for actions",
  "Pen / marker / text / eraser; Esc releases tool", "Draw a straight marker line",
  "Temporary eraser while pen / text is active", "Notes paper: find, pin and move notes",
  "Crop a question; Enter saves, Ctrl K asks AI", "Paste a screenshot as a question or onto PDF",
  "Undo latest drawing / text / highlight", "Save annotations into PDF", "Save as (choose another location)",
  "Close the open window", "Show shortcuts",
];
const keys = [...shortcutsBlock.matchAll(/\["([^"]+)",\s*"[^"]+"\]/g)].map((match) => match[1]);
if (keys.length !== english.length) throw new Error("Update the sample's English shortcut descriptions");
const translatedKeys = {
  "→  /  ←": "Right / Left", "Ctrl + +  /  Ctrl + −": "Ctrl + + / Ctrl + -",
  "Ctrl + tekerlek": "Ctrl + wheel", "Çift tık": "Double-click",
  "Shift + sürükle": "Shift + drag", "Sağ tık basılı": "Hold right-click",
  shortcutsKeyWheel: "Ctrl + wheel", shortcutsKeyDoubleClick: "Double-click",
  shortcutsKeyDrag: "Shift + drag", shortcutsKeyRightClick: "Hold right-click",
};
for (const [i, key] of keys.entries()) {
  const keyText = translatedKeys[key] ?? key;
  const descriptionLines = lines(english[i], sans, 9, column - 153);
  page.drawText(keyText, { x: margin, y, size: 9, font: sans, color: accent });
  for (const [j, line] of descriptionLines.entries()) {
    page.drawText(line, { x: margin + 153, y: y - j * 12, size: 9, font: sans, color: ink });
  }
  y -= Math.max(18, descriptionLines.length * 12 + 6);
  if (y < 65) throw new Error("Shortcut page overflow");
}

const output = new URL("public/samples/welcome.pdf", root);
await mkdir(new URL("public/samples/", root), { recursive: true });
await writeFile(output, await doc.save());
console.log(`Wrote ${doc.getPageCount()} original pages to ${output.pathname}`);
