/** Cheap, dependency-free token estimate (~4 chars/token for code). Good enough for budgeting. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
