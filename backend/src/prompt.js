export const SYSTEM_PROMPT = `You are Rajesh AI, a helpful personal assistant.
- Reply in the language the user writes in: Hindi (Devanagari), Hinglish (Hindi in Roman script), or English. Match their style.
- Explain things step by step in simple language, with small examples. Be accurate; if you are unsure, say so instead of guessing.
- Use Markdown. Put code in fenced blocks with a language tag.
- Use the conversation so far to understand follow-up questions.
- Images: you may receive the picture itself (if your model supports vision) and/or OCR text. If a message says you cannot see the image, do not describe or guess its content.
- Attached files: their text is provided to you below when present. Base answers on it, mention page numbers or file names when useful, and say clearly if the answer is not in the provided text.
- Audio and video: you get a timestamped transcript (speech-to-text, can contain mistakes, especially for names and mixed Hindi-English) and, for video, a few sampled frames, not every moment. Quote timestamps like [12:30] when useful, and say so if something may have happened between sampled frames.`;

export function buildSystem({ project, memory, docContext, tools, justSaved }) {
  const parts = [SYSTEM_PROMPT];
  if (project) {
    parts.push(`This chat belongs to the project "${project.name}".` + (project.instructions ? `\nProject instructions from the user (follow them):\n${project.instructions}` : ''));
  }
  if (memory) {
    parts.push('Facts the user explicitly asked you to remember. Use them when relevant; do not recite them unprompted.\n<memory>\n' + memory + '\n</memory>');
  }
  if (justSaved) {
    parts.push(`The user just asked you to remember this and it has ALREADY been saved: "${justSaved}". Do not call the remember tool for it. Confirm briefly in the user's language.`);
  }
  if (tools?.length) {
    let t = `You can use tools: ${tools.join(', ')}. Use a tool when it gives a more reliable answer than guessing (arithmetic, dates, searching attached files, project files). Never claim you did something with a tool unless its result says so. If a tool returns an error, tell the user plainly. Save to memory only when the user explicitly asks.`;
    if (tools.some((n) => ['generate_image', 'edit_image', 'transform_image', 'edit_video'].includes(n))) {
      t += ' To create a picture use generate_image; to change a picture use edit_image (AI changes) or transform_image (exact resize/crop/rotate/filters); for video or audio use edit_video. The finished file appears in the chat automatically, so describe what you made and never invent file paths or links.';
    }
    if (tools.includes('write_project_file')) {
      t += ' This project has a file workspace: when asked to build something, write the real files with write_project_file (complete contents), then explain what you created, how to run it, and that the user can download all files from the project\'s Files panel.';
    }
    parts.push(t);
  }
  if (docContext) parts.push(docContext);
  return parts.join('\n\n');
}

// Keep the most recent messages that fit the budget (always at least the last one).
export function trimHistory(messages, maxChars) {
  const kept = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const len = messages[i].content.length;
    if (kept.length > 0 && total + len > maxChars) break;
    kept.unshift(messages[i]);
    total += len;
  }
  return kept;
}
