import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Генерация тегов по тексту с помощью GPT-5 nano
 * Оптимизировано для платформы обучения рисованию
 */
export async function generateTagsFromText(
  title: string,
  text?: string
): Promise<string[]> {
  try {
    const content = [title, text].filter(Boolean).join(". ");

    if (!content.trim()) {
      return [];
    }

    const response = await openai.chat.completions.create({
      model: "gpt-5-nano-2025-08-07",
      messages: [
        {
          role: "system",
          content: `You are an assistant for a drawing tutorial platform. Analyze the title and description of a tutorial and return 5 to 10 lowercase English tags that clearly describe what is being taught or demonstrated.

Tags should represent:
- Objects (e.g. 'hands', 'head', 'eyes', 'face', 'body')
- Concepts (e.g. 'perspective', 'volume', 'anatomy', 'proportions')
- Techniques (e.g. 'shading', 'construction', 'sketching', 'blending')
- Art styles (e.g. 'realistic', 'cartoon', 'anime', 'portrait')

Do not include vague or generic terms like 'art', 'drawing', 'illustration', 'tutorial', 'guide', 'learn', 'how-to'.

Reply with only a comma-separated list of useful tags.`,
        },
        {
          role: "user",
          content: `Generate tags for this tutorial:\nTitle: ${title}${text ? `\nDescription: ${text}` : ""}`,
        },
      ],
      max_tokens: 100,
    });

    const tagString = response.choices[0].message.content?.trim() || "";

    // Преобразуем "eyes, drawing, anatomy" → ["eyes", "drawing", "anatomy"]
    const tags = tagString
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length < 30); // фильтруем слишком длинные теги

    console.log(`Generated ${tags.length} tags from text:`, tags);
    // console.log("Token usage:", response.usage);

    return tags;
  } catch (err) {
    console.error("Ошибка при генерации тегов по тексту:", err);
    return [];
  }
}